#!/usr/bin/env node
// cli/capture.mjs — "show the product" capture pipeline. Screenshots a real URL into
// public/captures/<slug>/ so DeviceFrame/KenBurns/Parallax (engine/components/) have a real
// asset to display instead of synthetic graphics.
//
// USAGE
//   node cli/capture.mjs <url> [slug] [--scroll=N]
//
//   <url>     required — page to capture, e.g. https://example.com/dashboard
//   [slug]    optional — output folder name under public/captures/. Defaults to a
//             slugified hostname+path (e.g. "example-com-dashboard").
//   --scroll=N  optional — also capture N additional evenly-spaced scroll-position
//             frames (public/captures/<slug>/scroll-0.png … scroll-(N-1).png), useful
//             for a Parallax/scroll-reveal treatment of a long page. Omit for a single
//             fullPage screenshot only.
//
// OUTPUT
//   public/captures/<slug>/full.png          — fullPage screenshot
//   public/captures/<slug>/scroll-N.png       — optional scroll frames
//   public/captures/<slug>/meta.json          — { url, capturedFiles, viewport, ts:null }
//
// Then point a component at it via the path RELATIVE TO public/ (staticFile() resolves
// against public/), e.g.:
//   { "component": "DeviceFrame", "props": { "src": "captures/<slug>/full.png", ... } }
//
// DEPENDENCY DECISION (read before "fixing" this by adding playwright to package.json):
// This script deliberately does NOT install playwright itself — `npx playwright install
// chromium` pulls a ~300MB browser binary, which is too heavy a side effect for a repo
// script to trigger unprompted, especially in this environment where package.json
// changes are reviewed carefully (see task brief: "if it is NOT installed, DO NOT
// install it"). Instead this script feature-detects playwright at runtime via a dynamic
// import wrapped in try/catch. If present, it does a real capture. If absent, it prints
// copy-pasteable setup instructions and exits non-zero — the rest of the pipeline
// (DeviceFrame/KenBurns/Parallax) already works today against ANY existing image file
// (see public/captures/placeholder.png), so lacking playwright blocks only this one
// script, not the components or the render.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const slugArg = args.filter((a) => !a.startsWith("--"))[1];
const scrollArg = args.find((a) => a.startsWith("--scroll="));
const scrollCount = scrollArg ? Math.max(0, parseInt(scrollArg.split("=")[1], 10) || 0) : 0;

if (!url) {
  console.error("Usage: node cli/capture.mjs <url> [slug] [--scroll=N]");
  process.exit(1);
}

const slugify = (u) => {
  try {
    const parsed = new URL(u);
    return `${parsed.hostname}${parsed.pathname}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "capture";
  } catch {
    return "capture";
  }
};
const slug = slugArg ?? slugify(url);
const outDir = path.resolve("public/captures", slug);

// --- feature-detect playwright without installing it (see header comment) ---
let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error(`
✕ playwright is not installed — capture.mjs needs it to drive a real browser.

This script will NOT install it automatically (chromium download is ~300MB and
shouldn't be a side effect of running a capture). To enable real captures, run:

    npm i -D playwright
    npx playwright install chromium

Then re-run:

    node cli/capture.mjs "${url}"${slugArg ? ` ${slugArg}` : ""}

Until then, the rest of the pipeline still works: DeviceFrame / KenBurns / Parallax
(engine/components/) render any existing image file. Point a scene's "src" prop at
public/captures/placeholder.png (already in the repo) or any other pre-existing asset
under public/, using the path RELATIVE TO public/, e.g. "captures/placeholder.png".
`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const { chromium } = playwright;
const browser = await chromium.launch();
try {
  const viewport = { width: 1440, height: 900 };
  const page = await browser.newPage({ viewport });
  console.log(`→ navigating to ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  const fullPath = path.join(outDir, "full.png");
  await page.screenshot({ path: fullPath, fullPage: true });
  console.log(`✓ wrote ${path.relative(".", fullPath)}`);

  const capturedFiles = ["full.png"];

  if (scrollCount > 0) {
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = pageHeight > viewport.height ? (pageHeight - viewport.height) / Math.max(1, scrollCount - 1) : 0;
    for (let i = 0; i < scrollCount; i++) {
      const y = Math.round(step * i);
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(150); // let lazy-loaded content/animations settle
      const framePath = path.join(outDir, `scroll-${i}.png`);
      await page.screenshot({ path: framePath });
      capturedFiles.push(`scroll-${i}.png`);
      console.log(`✓ wrote ${path.relative(".", framePath)}`);
    }
  }

  writeFileSync(
    path.join(outDir, "meta.json"),
    `${JSON.stringify({ url, slug, viewport, capturedFiles }, null, 2)}\n`,
  );

  console.log(`\n✓ capture complete — public/captures/${slug}/`);
  console.log(`  use in a scene prop as: "captures/${slug}/full.png"`);
} finally {
  await browser.close();
}
