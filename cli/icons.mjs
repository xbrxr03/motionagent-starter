#!/usr/bin/env node
// cli/icons.mjs — pull real brand SVGs from Iconify into public/icons/.
//
// House rule (matches the project's existing "no fabricated real screenshots"
// discipline): never hand-draw a brand mark when a real one is one fetch away.
// Icon.tsx's Lucide set covers generic UI iconography (arrows, checks, etc.)
// deliberately — this is the separate, narrower job of pulling an actual
// third-party logo (Slack, GitHub, Claude, ...), the same role
// public/icons/logos-claude-icon.svg already fills for one brand by hand.
//
// Talks to Iconify's public REST API directly (api.iconify.design) — no
// account, no API key, no extra global CLI to install. This is deliberately
// simpler than the equivalent competitor tool, which shells out to a
// separately-installed `better-icons` binary; that dependency being missing
// is exactly the kind of first-run friction this script avoids by design.
//
// CLI:
//   node cli/icons.mjs <brand> [<brand2> ...]     Fetch by name — resolves to
//                                                  the "logos:" set (Iconify's
//                                                  curated real-brand-mark
//                                                  collection) unless the
//                                                  brand already contains a
//                                                  "set:name" prefix.
//   node cli/icons.mjs --search <query>           List candidate icon ids
//                                                  without fetching anything.
//
// Examples:
//   node cli/icons.mjs github slack figma
//   node cli/icons.mjs logos:anthropic mdi:youtube
//   node cli/icons.mjs --search notion
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("public/icons");
const API_BASE = "https://api.iconify.design";

const USAGE =
  "Usage: node cli/icons.mjs <brand> [<brand2> ...]\n" +
  "       node cli/icons.mjs --search <query>\n";

async function search(query) {
  const res = await fetch(`${API_BASE}/search?query=${encodeURIComponent(query)}&limit=20`);
  if (!res.ok) {
    console.error(`✕ Search failed (${res.status})`);
    process.exit(1);
  }
  const data = await res.json();
  const ids = data.icons ?? [];
  if (ids.length === 0) {
    console.log(`No icons found for "${query}".`);
    return;
  }
  console.log(`${ids.length} match(es) for "${query}":\n`);
  for (const id of ids) console.log(`  ${id}`);
  console.log(`\nFetch one with: node cli/icons.mjs <id>`);
}

async function fetchOne(brand) {
  const id = brand.includes(":") ? brand : `logos:${brand}`;
  const [prefix, name] = id.split(":");
  const url = `${API_BASE}/${prefix}/${name}.svg`;
  const res = await fetch(url);
  if (!res.ok || res.status === 404) {
    console.error(`✕ Could not fetch ${id} (${res.status}). Try: node cli/icons.mjs --search ${brand}`);
    return false;
  }
  const svg = await res.text();
  if (!svg.trim().startsWith("<svg")) {
    console.error(`✕ ${id} did not resolve to a real SVG — try --search ${brand} to find the right id.`);
    return false;
  }
  const safeName = id.replace(":", "-");
  const outPath = path.join(OUT_DIR, `${safeName}.svg`);
  writeFileSync(outPath, svg, "utf8");
  console.log(`✓ Saved public/icons/${safeName}.svg`);
  return safeName;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  if (argv[0] === "--search") {
    const query = argv.slice(1).join(" ");
    if (!query) {
      console.error(USAGE);
      process.exit(2);
    }
    await search(query);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const saved = [];
  for (const brand of argv) {
    const safeName = await fetchOne(brand);
    if (safeName) saved.push(safeName);
  }

  if (saved.length > 0) {
    console.log("\nWire into a plan/component:");
    for (const name of saved) {
      console.log(`  <Img src={staticFile("icons/${name}.svg")} style={{ width: 96, height: 96 }} />`);
    }
  }
  if (saved.length < argv.length) process.exitCode = 1;
}

main();
