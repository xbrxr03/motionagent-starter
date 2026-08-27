#!/usr/bin/env node
// render-gate.mjs — Deterministic render freshness gate.
//
// Checks that each plan's rendered MP4 on disk is NEWER than every source file
// the plan depends on (plan JSON, transcript, audio, generated beats, engine
// components, tokens). Also sanity-checks the MP4 with ffprobe (valid video,
// duration within tolerance of plan.durationMs), and samples stills across the
// render to catch a blank/broken frame before anyone has to eyeball it (the gap
// flagged by the 2026-08 ReelStack comparison: their CLI auto-fails a render on
// a blank still, ours only had freshness+duration checks).
//
// Exits 0 if all plans pass, 1 if any fail. Designed to be run before reporting
// a pack recreation as "done" — if this gate fails, the render is stale, broken,
// or blank, and must be re-rendered before claiming completion.
//
// Usage:
//   node cli/render-gate.mjs demo/plan-ui-mate-capability-showcase.json
//   node cli/render-gate.mjs demo/plan-talking-head-capability-showcase.json
//   node cli/render-gate.mjs --all
//   node cli/render-gate.mjs --all --render-dir out/renders
//
// --all             Check every demo/plan-*.json except the canonical calibration
//                   plans (plan.json, plan2.json, plan3.json, plan-warden.json).
// --render-dir DIR  Base directory to search for rendered MP4s (default: out/renders).
// --out PLAN=MP4    Explicit mapping: plan path = expected render path. Use once
//                   per plan for ad-hoc naming conventions that don't follow the
//                   default slug-matching heuristic.
// --tolerance MS    Duration tolerance in milliseconds (default: 500).
// --skip-frames     Skip the blank-still sampling check (freshness+duration only).
// --verbose         Show per-source mtime details.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  ".."
);
const CALIBRATION_PLANS = new Set([
  "plan.json",
  "plan2.json",
  "plan3.json",
  "plan-warden.json",
]);

// ---------------------------------------------------------------------------
// Arg parsing (lightweight, matches cli/kit.mjs style)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    plans: [],
    renderDir: null,
    outMap: new Map(),
    all: false,
    tolerance: 500,
    skipFrames: false,
    verbose: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") {
      args.all = true;
    } else if (argv[i] === "--render-dir") {
      args.renderDir = argv[++i];
    } else if (argv[i] === "--out") {
      // --out planPath=mp4Path
      const pair = argv[++i];
      const eq = pair.indexOf("=");
      if (eq === -1) {
        console.error(`--out requires planPath=mp4Path format, got: ${pair}`);
        process.exit(1);
      }
      args.outMap.set(pair.slice(0, eq), pair.slice(eq + 1));
    } else if (argv[i] === "--tolerance") {
      args.tolerance = Number(argv[++i]);
    } else if (argv[i] === "--skip-frames") {
      args.skipFrames = true;
    } else if (argv[i] === "--verbose" || argv[i] === "-v") {
      args.verbose = true;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      usage();
      process.exit(0);
    } else {
      positional.push(argv[i]);
    }
  }
  if (args.all) {
    const demoDir = path.join(REPO_ROOT, "demo");
    const files = fs
      .readdirSync(demoDir)
      .filter((f) => f.startsWith("plan-") && f.endsWith(".json"))
      .filter((f) => !CALIBRATION_PLANS.has(f))
      .sort()
      .map((f) => path.join("demo", f));
    args.plans = files;
  } else {
    args.plans = positional;
  }
  if (!args.renderDir) {
    args.renderDir = path.join(REPO_ROOT, "out", "renders");
  } else if (!path.isAbsolute(args.renderDir)) {
    args.renderDir = path.resolve(args.renderDir);
  }
  return args;
}

function usage() {
  console.log(
    "Usage: node cli/render-gate.mjs [options] [plan ...]\n" +
      "  --all               Check all demo/plan-*.json (excludes calibration plans)\n" +
      '  --render-dir DIR    Base directory for rendered MP4s (default: out/renders)\n' +
      '  --out PLAN=MP4      Explicit plan-to-render mapping (repeatable)\n' +
      "  --tolerance MS      Duration tolerance in ms (default: 500)\n" +
      "  --skip-frames       Skip the blank-still sampling check\n" +
      "  --verbose / -v      Show per-source mtime details\n" +
      "  --help              Show this help"
  );
}

// ---------------------------------------------------------------------------
// Resolve transcript path (mirrors render-core.mjs's resolveTranscriptPath)
// ---------------------------------------------------------------------------

function resolveTranscriptPath(plan, planPath) {
  if (typeof plan?.meta?.transcript === "string" && plan.meta.transcript.length) {
    return plan.meta.transcript;
  }
  const base = path.basename(planPath);
  const numericMatch = base.match(/^plan(\d*)\.json$/i);
  if (numericMatch) {
    return path.join("demo", "input", `transcript${numericMatch[1]}.json`);
  }
  const swappedBase = base.replace(/^plan/, "transcript");
  return path.join("demo", "input", swappedBase);
}

// ---------------------------------------------------------------------------
// Slug tokenization for fuzzy MP4 matching
// ---------------------------------------------------------------------------

function slugTokens(slug) {
  return slug
    .replace(/^plan-?/, "")
    .replace(/\.json$/, "")
    .split("-")
    .filter((t) => t.length > 0);
}

function tokenOverlap(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let count = 0;
  for (const t of sa) {
    if (sb.has(t)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Find the rendered MP4 for a plan
// ---------------------------------------------------------------------------

function findRenderForPlan(planPath, renderDir, outMap) {
  // 1. Explicit --out override
  const resolved = path.resolve(planPath);
  if (outMap.has(resolved) || outMap.has(planPath)) {
    const mp4 = outMap.get(resolved) || outMap.get(planPath);
    return path.isAbsolute(mp4) ? mp4 : path.resolve(mp4);
  }

  const planSlug = path
    .basename(planPath, ".json")
    .replace(/^plan-?/, "");
  const planTokens = slugTokens(path.basename(planPath));
  // Minimum token overlap for a match: 1 when the plan slug has only 1
  // meaningful token (e.g. "plan-kano" → ["kano"]), otherwise 2 to avoid
  // false positives from short/ambiguous slugs.
  const minOverlap = planTokens.length <= 1 ? 1 : 2;

  if (!fs.existsSync(renderDir)) {
    return null;
  }

  // Walk renderDir recursively for MP4s, score by token overlap
  const candidates = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".mp4")) {
        const stem = entry.name.replace(/\.mp4$/, "");
        const mp4Tokens = stem.split("-").filter((t) => t.length > 0);
        const overlap = tokenOverlap(planTokens, mp4Tokens);
        if (overlap >= minOverlap) {
          candidates.push({ path: full, overlap, stem });
        }
      }
    }
  }
  walk(renderDir);

  if (candidates.length === 0) return null;

  // Sort: exact stem match first, then highest overlap, then longest stem
  candidates.sort((a, b) => {
    if (a.stem === planSlug) return -1;
    if (b.stem === planSlug) return 1;
    if (a.overlap !== b.overlap) return b.overlap - a.overlap;
    return b.stem.length - a.stem.length;
  });

  return candidates[0].path;
}

// ---------------------------------------------------------------------------
// Collect source files whose mtimes must precede the render
// ---------------------------------------------------------------------------

function collectSourceFiles(plan, planPath) {
  const sources = [];

  // 1. The plan JSON itself
  sources.push(path.resolve(planPath));

  // 2. Transcript
  const transcriptRel = resolveTranscriptPath(plan, planPath);
  const transcriptAbs = path.resolve(REPO_ROOT, transcriptRel);
  if (fs.existsSync(transcriptAbs)) {
    sources.push(transcriptAbs);
  }

  // 3. Audio file (plan.audio relative to public/)
  if (typeof plan.audio === "string" && plan.audio.length) {
    const audioAbs = path.resolve(REPO_ROOT, "public", plan.audio);
    if (fs.existsSync(audioAbs)) {
      sources.push(audioAbs);
    }
  }

  // 4. Generated beats file
  const planBasename = path.basename(planPath, ".json");
  const beatsSlug = planBasename.replace(/^plan-?/, "");
  const beatsPath = path.join(
    REPO_ROOT,
    "engine",
    "generated",
    `beats-${beatsSlug}.ts`
  );
  if (fs.existsSync(beatsPath)) {
    sources.push(beatsPath);
  }

  // 5. Engine core (conservative — any change invalidates renders)
  const engineDir = path.join(REPO_ROOT, "engine");
  for (const sub of ["", "components", "styles", "generated"]) {
    const dir = sub ? path.join(engineDir, sub) : engineDir;
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /\.(tsx?|js|mjs)$/.test(entry.name)) {
          sources.push(path.join(dir, entry.name));
        }
      }
    }
  }

  // 6. Compiled tokens
  const familiesJson = path.join(
    REPO_ROOT,
    "tokens",
    "compiled",
    "families.json"
  );
  if (fs.existsSync(familiesJson)) {
    sources.push(familiesJson);
  }

  return sources;
}

// ---------------------------------------------------------------------------
// mtime helpers
// ---------------------------------------------------------------------------

function getMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function fmtTime(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

// ---------------------------------------------------------------------------
// ffprobe sanity check
// ---------------------------------------------------------------------------

function ffprobeCheck(mp4Path, expectedDurationMs, toleranceMs) {
  try {
    const result = execSync(
      `ffprobe -v error -print_format json -show_format -show_streams "${mp4Path}"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const info = JSON.parse(result);
    const durationSec = Number(info.format?.duration ?? NaN);
    if (isNaN(durationSec) || durationSec <= 0) {
      return {
        ok: false,
        error: `ffprobe: invalid duration (${info.format?.duration})`,
      };
    }
    const expectedSec = expectedDurationMs / 1000;
    const diff = Math.abs(durationSec - expectedSec);
    if (diff > toleranceMs / 1000) {
      return {
        ok: false,
        error:
          `duration mismatch: render ${durationSec.toFixed(3)}s vs plan ` +
          `${expectedSec.toFixed(3)}s (diff ${(diff * 1000).toFixed(0)}ms, ` +
          `tolerance ${toleranceMs}ms)`,
      };
    }
    const streams = info.streams ?? [];
    const hasVideo = streams.some((s) => s.codec_type === "video");
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    if (!hasVideo) {
      return { ok: false, error: "ffprobe: no video stream found" };
    }
    return {
      ok: true,
      durationSec,
      streams: streams
        .map((s) =>
          `${s.codec_type}:${s.codec_name}${s.codec_type === "video" ? `@${s.width}x${s.height}` : ""}`
        )
        .join(", "),
    };
  } catch (e) {
    return { ok: false, error: `ffprobe failed: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Blank/broken-frame sampling — catches a render that ffprobe calls "valid"
// (right duration, has a video stream) but is actually a blank or near-solid
// frame, e.g. a crashed component, an unrendered async asset, or a scene that
// never got its content wired up. Samples 3 points across the render (avoids
// exact 0%/100% since fade-in/out frames are legitimately near-solid) and
// flags any frame whose luma range (YMAX-YMIN) is suspiciously flat.
// ---------------------------------------------------------------------------

const BLANK_FRAME_THRESHOLD = 10; // YMAX-YMIN below this reads as "no real content"
const SAMPLE_FRACTIONS = [0.08, 0.5, 0.92];

function extractStill(mp4Path, atSec, outPngPath) {
  execSync(
    `ffmpeg -y -ss ${atSec.toFixed(3)} -i "${mp4Path}" -frames:v 1 "${outPngPath}"`,
    { stdio: ["pipe", "pipe", "pipe"] }
  );
}

function frameLumaRange(pngPath) {
  const out = execSync(
    `ffmpeg -i "${pngPath}" -vf "signalstats,metadata=print:file=-" -f null - 2>&1`,
    { encoding: "utf8", shell: "/bin/sh" }
  );
  const ymin = /lavfi\.signalstats\.YMIN=(-?[\d.]+)/.exec(out);
  const ymax = /lavfi\.signalstats\.YMAX=(-?[\d.]+)/.exec(out);
  if (!ymin || !ymax) return null;
  return Number(ymax[1]) - Number(ymin[1]);
}

function checkBlankFrames(mp4Path, durationSec) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-gate-"));
  try {
    const flagged = [];
    for (const frac of SAMPLE_FRACTIONS) {
      const atSec = durationSec * frac;
      const png = path.join(tmpDir, `f-${frac}.png`);
      try {
        extractStill(mp4Path, atSec, png);
        const range = frameLumaRange(png);
        if (range === null) {
          flagged.push({ atSec, error: "could not read frame stats" });
        } else if (range < BLANK_FRAME_THRESHOLD) {
          flagged.push({ atSec, range });
        }
      } catch (e) {
        flagged.push({ atSec, error: e.message.split("\n")[0] });
      }
    }
    return flagged;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.plans.length === 0) {
    console.error("No plan paths given. Pass plan paths or use --all.");
    usage();
    process.exit(1);
  }

  let passCount = 0;
  let failCount = 0;
  const results = [];

  for (const planRelPath of args.plans) {
    const planAbsPath = path.resolve(planRelPath);
    const planSlug = path
      .basename(planRelPath, ".json")
      .replace(/^plan-?/, "");

    // Read plan
    let plan;
    try {
      plan = JSON.parse(fs.readFileSync(planAbsPath, "utf8"));
    } catch (e) {
      console.error(`✗ PLAN INVALID — ${planSlug} (${e.message})`);
      failCount++;
      continue;
    }

    // Find the rendered MP4
    const mp4Path = findRenderForPlan(planRelPath, args.renderDir, args.outMap);

    if (!mp4Path) {
      console.error(
        `✗ RENDER MISSING — ${planSlug} (no MP4 found under ${path.relative(REPO_ROOT, args.renderDir)})`
      );
      failCount++;
      continue;
    }

    const mp4Rel = path.relative(REPO_ROOT, mp4Path);

    // Collect source files and find which are newer than the render
    const sources = collectSourceFiles(plan, planRelPath);
    const renderMtime = getMtime(mp4Path);

    const newerSources = sources
      .filter((src) => getMtime(src) > renderMtime)
      .sort((a, b) => getMtime(b) - getMtime(a));

    if (newerSources.length > 0) {
      const newest = newerSources[0];
      const ageHours = ((getMtime(newest) - renderMtime) / 3600000).toFixed(1);
      const newerRel = newerSources
        .slice(0, 5)
        .map((s) => path.relative(REPO_ROOT, s));
      let msg = `rendered ${fmtTime(renderMtime)}, but ${path.relative(REPO_ROOT, newest)} changed ${fmtTime(getMtime(newest))} (${ageHours}h newer)`;
      if (newerSources.length > 1) {
        msg += `\n  all newer sources (${newerSources.length}): ${newerRel.join(", ")}${newerSources.length > 5 ? ` +${newerSources.length - 5} more` : ""}`;
      }
      console.error(`✗ RENDER STALE — ${planSlug}\n  ${msg}`);
      failCount++;
      continue;
    }

    // Duration check
    const durationMs = plan.durationMs;
    let durationOk = true;
    let durationInfo = "";
    if (typeof durationMs === "number" && durationMs > 0) {
      const probe = ffprobeCheck(mp4Path, durationMs, args.tolerance);
      if (!probe.ok) {
        durationOk = false;
        durationInfo = probe.error;
      } else {
        durationInfo = `${probe.durationSec.toFixed(3)}s (plan ${(durationMs / 1000).toFixed(3)}s) streams=[${probe.streams}]`;
      }
    } else {
      durationInfo = "no durationMs in plan, skipped";
    }

    if (!durationOk) {
      console.error(`✗ RENDER INVALID — ${planSlug} (${durationInfo})`);
      failCount++;
      continue;
    }

    if (!args.skipFrames && typeof durationMs === "number" && durationMs > 0) {
      const flagged = checkBlankFrames(mp4Path, durationMs / 1000);
      if (flagged.length > 0) {
        const detail = flagged
          .map((f) =>
            f.error
              ? `${f.atSec.toFixed(1)}s: ${f.error}`
              : `${f.atSec.toFixed(1)}s: luma range ${f.range.toFixed(1)} (< ${BLANK_FRAME_THRESHOLD})`
          )
          .join("; ");
        console.error(`✗ RENDER BLANK — ${planSlug} (${detail})`);
        failCount++;
        continue;
      }
    }

    if (args.verbose) {
      const oldestSource = sources.sort((a, b) => getMtime(a) - getMtime(b))[0];
      console.log(
        `  ${planSlug}: render ${fmtTime(renderMtime)}, oldest source ${path.relative(REPO_ROOT, oldestSource)} ${fmtTime(getMtime(oldestSource))}`
      );
    }

    console.log(`✓ RENDER FRESH — ${planSlug} (${mp4Rel}, ${durationInfo})`);
    passCount++;
  }

  console.log(
    `\n${passCount} pass, ${failCount} fail`
  );

  if (failCount > 0) {
    process.exit(1);
  }
}

main();