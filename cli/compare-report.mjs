#!/usr/bin/env node
// compare-report.mjs — Source-vs-recreation visual comparison report generator.
//
// Extracts matching-timestamp frame pairs from a real source video and the
// corresponding MotionAgent recreation, then generates an HTML swipe/side-by-side
// comparison report for human visual QA grading.
//
// Usage:
//   node cli/compare-report.mjs <pack> <slug>
//   node cli/compare-report.mjs <pack> <slug> --frames 8
//   node cli/compare-report.mjs <pack> --all
//   node cli/compare-report.mjs --all
//   node cli/compare-report.mjs <pack> <slug> --source /path/to/source.mp4
//   node cli/compare-report.mjs <pack> <slug> --recreation /path/to/recreation.mp4
//
// Examples:
//   node cli/compare-report.mjs ui-mate my-reel --source path/to/reference.mp4 --recreation out/renders/my-reel.mp4
//
// The report opens in a browser with `open report.html` and lets a human
// swipe through frame pairs — source on the left, recreation on the right.
//
// This starter does not ship research/selected-recreation-targets.json (the manifest
// that maps <pack> <slug> pairs to reference source videos), so pass --source and
// --recreation explicitly.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MANIFEST_PATH = path.join(ROOT, "research/selected-recreation-targets.json");
const RENDERS_DIR = path.join(ROOT, "out/renders");
const REPORTS_DIR = path.join(ROOT, "out/compare-reports");

const DEFAULT_FRAMES = 8;

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    pack: null,
    slug: null,
    all: false,
    frames: DEFAULT_FRAMES,
    source: null,
    recreation: null,
    open: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--frames") args.frames = Number(argv[++i]);
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--recreation") args.recreation = argv[++i];
    else if (a === "--no-open") args.open = false;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node cli/compare-report.mjs [pack] [slug] [options]

Options:
  --all             Generate reports for all packs (or all targets in a pack)
  --frames N        Number of frame pairs to extract (default: ${DEFAULT_FRAMES})
  --source PATH     Explicit path to source video (skip manifest lookup)
  --recreation PATH Explicit path to recreation MP4 (skip default naming)
  --no-open         Don't open the report in browser after generating
  --help            Show this help

Examples:
  node cli/compare-report.mjs ui-mate my-reel --source ref.mp4 --recreation out/renders/my-reel.mp4

Without --source/--recreation, this looks up research/selected-recreation-targets.json,
which this starter does not ship — pass both flags explicitly.`);
      process.exit(0);
    } else if (!a.startsWith("-")) {
      if (!args.pack) args.pack = a;
      else if (!args.slug) args.slug = a;
    }
  }
  return args;
}

// ── Manifest lookup ──────────────────────────────────────────────────────────

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    console.error("Run cli/reference-manifest.mjs first, or use --source/--recreation for explicit paths.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function findTarget(manifest, pack, slug) {
  for (const ref of manifest.refs) {
    if (ref.workingPackName === pack) {
      for (const t of ref.targets) {
        if (t.topicSlug === slug) {
          return { sourcePath: path.join(manifest.root, t.relPath), target: t, ref };
        }
      }
    }
  }
  return null;
}

function findTargetsForPack(manifest, pack) {
  for (const ref of manifest.refs) {
    if (ref.workingPackName === pack) {
      return ref.targets.map(t => ({
        slug: t.topicSlug,
        sourcePath: path.join(manifest.root, t.relPath),
        target: t,
        ref,
      }));
    }
  }
  return null;
}

function findAllTargets(manifest) {
  const result = [];
  for (const ref of manifest.refs) {
    for (const t of ref.targets) {
      result.push({
        pack: ref.workingPackName,
        slug: t.topicSlug,
        sourcePath: path.join(manifest.root, t.relPath),
        target: t,
        ref,
      });
    }
  }
  return result;
}

// ── Recreation MP4 path resolution ───────────────────────────────────────────

function findRecreation(pack, slug) {
  // Try common naming conventions
  const shortPack = pack.replace(/-.*/, ""); // e.g. "grove-editorial" → "grove"
  const candidates = [
    path.join(RENDERS_DIR, `${pack}-recreations`, `${slug}.mp4`),
    path.join(RENDERS_DIR, `${pack}-recreations`, `${shortPack}-${slug}.mp4`),
    path.join(RENDERS_DIR, `${pack}-recreations`, `${pack}-${slug}.mp4`),
    path.join(RENDERS_DIR, `${pack}`, `${slug}.mp4`),
    path.join(RENDERS_DIR, `${pack}-${slug}.mp4`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Fallback: scan the recreation directory for any MP4 whose name contains the slug
  const recDir = path.join(RENDERS_DIR, `${pack}-recreations`);
  if (fs.existsSync(recDir)) {
    const files = fs.readdirSync(recDir).filter(f => f.endsWith(".mp4"));
    for (const f of files) {
      if (f.includes(slug)) return path.join(recDir, f);
    }
  }

  // Last fallback: any MP4 in renders/ containing the slug
  if (fs.existsSync(RENDERS_DIR)) {
    const files = fs.readdirSync(RENDERS_DIR).filter(f => f.endsWith(".mp4"));
    for (const f of files) {
      if (f.includes(slug)) return path.join(RENDERS_DIR, f);
    }
  }

  return null;
}

// ── Frame extraction ─────────────────────────────────────────────────────────

function getDuration(videoPath) {
  const out = execSync(
    `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
    { encoding: "utf8" }
  );
  const info = JSON.parse(out);
  return parseFloat(info.format.duration);
}

function extractFrames(videoPath, outputDir, prefix, count, durationSec) {
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate evenly-spaced timestamps (skip first and last 5% to avoid credits/fades)
  const skipStart = durationSec * 0.05;
  const skipEnd = durationSec * 0.95;
  const interval = (skipEnd - skipStart) / (count + 1);
  const timestamps = [];
  for (let i = 1; i <= count; i++) {
    timestamps.push(skipStart + interval * i);
  }

  const paths = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const outFile = path.join(outputDir, `${prefix}_${String(i + 1).padStart(2, "0")}.jpg`);
    try {
      execSync(
        `ffmpeg -y -hide_banner -loglevel error ` +
        `-ss ${ts.toFixed(3)} -i "${videoPath}" ` +
        `-frames:v 1 -q:v 2 "${outFile}"`,
        { encoding: "utf8" }
      );
      paths.push({ file: path.basename(outFile), timestampSec: ts, index: i + 1 });
    } catch (e) {
      console.warn(`  Warning: failed to extract frame at ${ts.toFixed(2)}s from ${path.basename(videoPath)}`);
    }
  }
  return paths;
}

// ── HTML report generation ───────────────────────────────────────────────────

function generateReport(pack, slug, framePairs, reportDir) {
  const screens = framePairs.map((pair, i) => ({
    name: `${(pair.source.timestampSec).toFixed(1)}s`,
    source: pair.source.file,
    recreation: pair.recreation.file,
    timestampSec: pair.source.timestampSec,
  }));

  const html = generateHTML(pack, slug, screens);

  const reportPath = path.join(reportDir, "report.html");
  fs.writeFileSync(reportPath, html, "utf8");

  // Generate config.js
  const config = {
    generatedAt: new Date().toISOString(),
    pack,
    slug,
    screens: screens.map(s => ({
      name: s.name,
      timestampSec: s.timestampSec,
      source: s.source,
      recreation: s.recreation,
    })),
  };
  fs.writeFileSync(path.join(reportDir, "config.js"), `const reportConfig = ${JSON.stringify(config, null, 2)};\n`, "utf8");

  return reportPath;
}

function generateHTML(pack, slug, screens) {
  const screenItems = screens.map((s, i) =>
    `      <li onclick="selectScreen(${i})">${s.name}</li>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:;">
<title>Source vs Recreation — ${pack} / ${slug}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0D0D0D; color: #fff; display: flex; height: 100vh; overflow: hidden; }

  .sidebar {
    width: 260px; min-width: 260px; background: #111; border-right: 1px solid #333;
    display: flex; flex-direction: column; overflow-y: auto;
  }
  .sidebar header { padding: 20px 16px 8px; }
  .sidebar header h1 { font-size: 15px; font-weight: 600; color: #e0e0e0; }
  .sidebar header .pack { font-size: 12px; color: #888; margin-top: 2px; }
  .sidebar header time { font-size: 11px; color: #555; display: block; margin-top: 4px; }

  .screen-list { list-style: none; padding: 8px 0; flex: 1; }
  .screen-list li {
    padding: 10px 16px; cursor: pointer; font-size: 14px; color: #aaa;
    border-left: 3px solid transparent; transition: all 0.15s;
  }
  .screen-list li:hover { background: #1f1f1f; color: #fff; }
  .screen-list li.active { background: #1f1f1f; color: #fff; border-left-color: #00d4aa; }

  .main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }

  .screen-header { text-align: center; padding: 16px 24px 8px; }
  .screen-header .timestamp { font-size: 24px; font-weight: 700; color: #fff; }
  .screen-header .label { font-size: 12px; color: #666; margin-top: 4px; }

  .controls { display: flex; justify-content: center; gap: 8px; padding: 0 16px 12px; }
  .controls button {
    padding: 8px 20px; border: 1px solid #444; background: #1a1a1a;
    color: #aaa; border-radius: 8px; cursor: pointer; font-size: 14px;
    transition: all 0.15s;
  }
  .controls button:hover { background: #252525; color: #fff; }
  .controls button.active { background: #00d4aa; border-color: #00d4aa; color: #0D0D0D; }

  .labels { display: flex; justify-content: center; gap: 24px; padding: 0 16px 12px; font-size: 13px; color: #888; }
  .labels span::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  .labels .lbl-source::before { background: #ff6b6b; }
  .labels .lbl-recreation::before { background: #00d4aa; }

  :root { --img-width: 400px; }

  .side-by-side { display: none; justify-content: center; align-items: start; gap: 24px; padding: 0 24px 24px; }
  .side-by-side .panel { text-align: center; width: var(--img-width); flex-shrink: 0; }
  .side-by-side .panel img { width: 100%; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
  .side-by-side .panel p { margin-top: 8px; font-size: 13px; color: #888; }

  .swipe-container {
    position: relative; width: var(--img-width); margin: 0 auto 24px;
    overflow: hidden; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.4);
    user-select: none; -webkit-user-select: none;
  }
  .swipe-container .img-base { display: block; width: 100%; pointer-events: none; }
  .swipe-container .img-overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    object-fit: fill; pointer-events: none; clip-path: inset(0 50% 0 0);
  }
  .swipe-container .slider-line {
    position: absolute; top: 0; width: 2px; height: 100%; background: #fff;
    pointer-events: none; z-index: 2;
  }
  .swipe-container .slider-handle {
    position: absolute; top: 50%; width: 36px; height: 36px; border-radius: 50%;
    background: #fff; transform: translate(-50%, -50%); z-index: 3;
    cursor: ew-resize; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
  }
  .swipe-container .slider-handle::before { content: '\\25C0\\00a0\\25B6'; font-size: 10px; color: #333; }

  .swipe-label { position: absolute; bottom: 12px; padding: 4px 12px; border-radius: 6px; background: rgba(0,0,0,.6); font-size: 12px; color: #fff; z-index: 4; pointer-events: none; }
  .swipe-label.left { left: 12px; }
  .swipe-label.right { right: 12px; }

  .nav-hint { text-align: center; padding: 8px; font-size: 12px; color: #555; }
</style>
</head>
<body>
  <nav class="sidebar">
    <header>
      <h1>Source vs Recreation</h1>
      <div class="pack">${pack} / ${slug}</div>
      <time id="timestamp"></time>
    </header>
    <ul class="screen-list" id="screen-list">
${screenItems}
    </ul>
    <div class="nav-hint">Use ← → arrow keys to navigate</div>
  </nav>

  <div class="main">
  <div class="screen-header" id="screen-header"></div>

  <div class="controls">
    <button id="btn-side" onclick="setMode('side')">Side by Side</button>
    <button id="btn-swipe" class="active" onclick="setMode('swipe')">Swipe</button>
  </div>
  <div class="labels">
    <span class="lbl-source">Source</span>
    <span class="lbl-recreation">Recreation</span>
  </div>

  <div class="side-by-side" id="side-view">
    <div class="panel"><img id="side-source" src="" alt="Source"><p>Source (real video)</p></div>
    <div class="panel"><img id="side-recreation" src="" alt="Recreation"><p>Recreation (MotionAgent)</p></div>
  </div>

  <div class="swipe-container" id="swipe-view">
    <img class="img-base" id="swipe-base" src="" alt="Recreation">
    <img class="img-overlay" id="swipe-overlay" src="" alt="Source">
    <div class="slider-line" id="slider-line"></div>
    <div class="slider-handle" id="slider-handle"></div>
    <div class="swipe-label left">Source</div>
    <div class="swipe-label right">Recreation</div>
  </div>
  </div><!-- .main -->

<script src="config.js"></script>
<script>
  // Render timestamp
  document.getElementById('timestamp').textContent = reportConfig.generatedAt;

  // Render screen list
  const listEl = document.getElementById('screen-list');
  let currentScreen = 0;

  reportConfig.screens.forEach((screen, i) => {
    const li = listEl.children[i];
    if (li) {
      li.onclick = () => selectScreen(i);
    }
  });

  function selectScreen(index) {
    currentScreen = index;
    const screen = reportConfig.screens[index];

    // Update list
    Array.from(listEl.children).forEach((li, i) => {
      li.classList.toggle('active', i === index);
    });

    // Update header
    const headerEl = document.getElementById('screen-header');
    headerEl.innerHTML = '<div class="timestamp">' + screen.timestampSec.toFixed(1) + 's</div>' +
      '<div class="label">Frame ' + (index + 1) + ' of ' + reportConfig.screens.length + '</div>';

    // Update images
    document.getElementById('side-source').src = screen.source;
    document.getElementById('side-recreation').src = screen.recreation;
    document.getElementById('swipe-base').src = screen.recreation;
    document.getElementById('swipe-overlay').src = screen.source;

    // Re-init slider after image loads
    document.getElementById('swipe-base').onload = initSlider;
  }

  let currentMode = 'swipe';
  function setMode(mode) {
    currentMode = mode;
    document.getElementById('swipe-view').style.display = mode === 'swipe' ? 'block' : 'none';
    document.getElementById('side-view').style.display = mode === 'side' ? 'flex' : 'none';
    document.getElementById('btn-swipe').classList.toggle('active', mode === 'swipe');
    document.getElementById('btn-side').classList.toggle('active', mode === 'side');
    if (mode === 'swipe') initSlider();
  }

  const container = document.getElementById('swipe-view');
  const overlayImg = document.getElementById('swipe-overlay');
  const line = document.getElementById('slider-line');
  const handle = document.getElementById('slider-handle');
  let dragging = false;

  function updateSlider(x) {
    const rect = container.getBoundingClientRect();
    const pos = Math.max(0, Math.min(x - rect.left, rect.width));
    const pct = pos / rect.width * 100;
    const clipRight = (100 - pct).toFixed(2);
    overlayImg.style.clipPath = 'inset(0 ' + clipRight + '% 0 0)';
    line.style.left = pct.toFixed(2) + '%';
    handle.style.left = pct.toFixed(2) + '%';
  }

  function initSlider() {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0) updateSlider(rect.left + rect.width / 2);
  }

  handle.addEventListener('mousedown', e => { e.preventDefault(); dragging = true; });
  handle.addEventListener('touchstart', () => dragging = true, { passive: true });
  window.addEventListener('mouseup', () => dragging = false);
  window.addEventListener('touchend', () => dragging = false);
  window.addEventListener('mousemove', e => { if (dragging) updateSlider(e.clientX); });
  window.addEventListener('touchmove', e => { if (dragging) updateSlider(e.touches[0].clientX); }, { passive: true });
  container.addEventListener('click', e => updateSlider(e.clientX));
  window.addEventListener('resize', initSlider);

  // Keyboard navigation
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      selectScreen(Math.min(currentScreen + 1, reportConfig.screens.length - 1));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      selectScreen(Math.max(currentScreen - 1, 0));
    }
  });

  selectScreen(0);
  setMode('swipe');
</script>
</body>
</html>`;
}

// ── Single target report ─────────────────────────────────────────────────────

function processTarget(pack, slug, args, manifest) {
  console.log(`\nProcessing ${pack}/${slug}...`);

  // Find source video
  let sourcePath = args.source;
  if (!sourcePath && manifest) {
    const found = findTarget(manifest, pack, slug);
    if (found) {
      sourcePath = found.sourcePath;
    }
  }
  if (!sourcePath) {
    console.error(`  ERROR: No source video found for ${pack}/${slug}. Use --source to specify explicitly.`);
    return null;
  }
  if (!fs.existsSync(sourcePath)) {
    console.error(`  ERROR: Source video not found: ${sourcePath}`);
    return null;
  }

  // Find recreation video
  let recreationPath = args.recreation;
  if (!recreationPath) {
    recreationPath = findRecreation(pack, slug);
  }
  if (!recreationPath) {
    console.error(`  ERROR: No recreation MP4 found for ${pack}/${slug}. Searched in ${RENDERS_DIR}/.`);
    console.error(`  Use --recreation to specify explicitly.`);
    return null;
  }
  if (!fs.existsSync(recreationPath)) {
    console.error(`  ERROR: Recreation video not found: ${recreationPath}`);
    return null;
  }

  console.log(`  Source:      ${sourcePath}`);
  console.log(`  Recreation:  ${recreationPath}`);

  const reportDir = path.join(REPORTS_DIR, `${pack}-${slug}`);
  fs.mkdirSync(reportDir, { recursive: true });

  const framesDir = path.join(reportDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  // Get durations
  const sourceDur = getDuration(sourcePath);
  const recreationDur = getDuration(recreationPath);
  console.log(`  Source duration:      ${sourceDur.toFixed(1)}s`);
  console.log(`  Recreation duration:  ${recreationDur.toFixed(1)}s`);

  // Extract frames from both videos at the same relative timestamps
  // Use the shorter duration to ensure both videos have content at each timestamp
  const effectiveDuration = Math.min(sourceDur, recreationDur);

  const sourceFrames = extractFrames(sourcePath, framesDir, "source", args.frames, effectiveDuration);
  const recreationFrames = extractFrames(recreationPath, framesDir, "recreation", args.frames, effectiveDuration);

  if (sourceFrames.length === 0 || recreationFrames.length === 0) {
    console.error(`  ERROR: Failed to extract frames. Source: ${sourceFrames.length}, Recreation: ${recreationFrames.length}`);
    return null;
  }

  // Pair up frames by index
  const pairCount = Math.min(sourceFrames.length, recreationFrames.length);
  const framePairs = [];
  for (let i = 0; i < pairCount; i++) {
    framePairs.push({
      source: sourceFrames[i],
      recreation: recreationFrames[i],
    });
  }

  console.log(`  Extracted ${pairCount} frame pairs`);

  // Generate report
  const reportPath = generateReport(pack, slug, framePairs, reportDir);
  console.log(`  Report: ${reportPath}`);

  return { pack, slug, reportPath, pairCount };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const manifest = fs.existsSync(MANIFEST_PATH) ? loadManifest() : null;

let results = [];

if (args.all && !args.pack) {
  // All targets across all packs
  if (!manifest) {
    console.error("--all requires the manifest at research/selected-recreation-targets.json");
    process.exit(1);
  }
  const allTargets = findAllTargets(manifest);
  for (const t of allTargets) {
    const r = processTarget(t.pack, t.slug, args, manifest);
    if (r) results.push(r);
  }
} else if (args.all && args.pack) {
  // All targets in one pack
  if (!manifest) {
    console.error("--all requires the manifest at research/selected-recreation-targets.json");
    process.exit(1);
  }
  const targets = findTargetsForPack(manifest, args.pack);
  if (!targets) {
    console.error(`Pack "${args.pack}" not found in manifest.`);
    process.exit(1);
  }
  for (const t of targets) {
    const r = processTarget(args.pack, t.slug, args, manifest);
    if (r) results.push(r);
  }
} else if (args.pack && args.slug) {
  // Single target
  const r = processTarget(args.pack, args.slug, args, manifest);
  if (r) results.push(r);
} else {
  console.error("Provide <pack> <slug>, <pack> --all, or --all. Use --help for usage.");
  process.exit(1);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Generated ${results.length} report(s):`);
for (const r of results) {
  console.log(`  ${r.pack}/${r.slug}: ${r.pairCount} frame pairs → ${r.reportPath}`);
}

if (results.length === 0 && !args.all) {
  console.error("\nNo reports generated. Check pack name, slug, and file paths.");
  process.exit(1);
}

// Open the first report
if (results.length > 0 && args.open) {
  const first = results[0];
  console.log(`\nOpening first report: ${first.reportPath}`);
  try {
    execSync(`open "${first.reportPath}"`, { encoding: "utf8" });
  } catch {
    console.log("(open command not available — open the HTML file manually in a browser)");
  }
}

console.log(`\nDone.`);