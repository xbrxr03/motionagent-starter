#!/usr/bin/env node
// cli/motionagent.mjs — MotionAgent CLI scaffolder.
// Thin orchestration layer wrapping existing cli/*.mjs scripts.
// Zero new dependencies; all logic delegates to the underlying scripts.
//
// CLI:
//   node cli/motionagent.mjs init
//   node cli/motionagent.mjs scaffold --pack=<pack> --name=<slug> --vo=<path.wav> [--brief="<one-line brief>"]
//   node cli/motionagent.mjs beats <vo.wav> --slug=<slug>
//   node cli/motionagent.mjs render <plan.json> [--platform=ig|tiktok|shorts] [--preset=<pack>|--family=<family>]
//   node cli/motionagent.mjs style-matrix <plan.json> [--mode=lint|render]
//   node cli/motionagent.mjs lint <plan.json> --preset=<pack>
//   node cli/motionagent.mjs capture <url> --slug=<slug>
//   node cli/motionagent.mjs --version

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS_DIR = path.resolve(REPO_ROOT, "presets");
const PACKS_DIR = path.resolve(REPO_ROOT, "packs");
const PKG_PATH = path.resolve(REPO_ROOT, "package.json");
const ROOT_TSX_PATH = path.resolve(REPO_ROOT, "engine", "Root.tsx");

// ---------------------------------------------------------------------------
// Composition ID lookup (built once per invocation, not per render call)
// ---------------------------------------------------------------------------

let _compositionMap = null;

/**
 * Parse engine/Root.tsx to build a map from demo/plan-*.json (relative) paths
 * to the Composition `id` they're registered under. Every render needs this
 * because Remotion identifies compositions by string ID, not by plan filename,
 * and no plan file carries a `meta.compositionId` field.
 */
function buildCompositionMap() {
  if (_compositionMap) return _compositionMap;

  const src = fs.readFileSync(ROOT_TSX_PATH, "utf8");

  // 1. Extract import bindings: import <var> from "../demo/<file>.json"
  const importRe = /import\s+(\w+)\s+from\s+"([^"]*demo\/[^"]*\.json)"/g;
  const varToFile = new Map();
  for (const m of src.matchAll(importRe)) {
    // Normalize "../demo/plan-foo.json" → "demo/plan-foo.json"
    varToFile.set(m[1], m[2].replace(/^\.\.\//, ""));
  }

  // 2. Extract Composition IDs: <Composition id="<id>" ... plan: asPlan(<var>)
  //    Can span multiple lines, so we use a dotAll-capable regex on the full source.
  const compRe = /<Composition\s+id="(\w+)"[^>]*?defaultProps=\{\{\s*plan:\s*asPlan\((\w+)\)/gs;
  const fileToId = new Map();
  for (const m of src.matchAll(compRe)) {
    const compId = m[1];
    const varName = m[2];
    const relPath = varToFile.get(varName);
    if (relPath) {
      fileToId.set(relPath, compId);
    }
  }

  // 3. Also index by basename (e.g. "plan-foo.json") for convenience
  const byBasename = new Map();
  for (const [relPath, compId] of fileToId) {
    byBasename.set(path.basename(relPath), compId);
  }

  _compositionMap = { byRelPath: fileToId, byBasename };
  return _compositionMap;
}

/**
 * Resolve a plan file path to its Remotion Composition ID.
 * Returns null if no match is found.
 */
function resolveCompositionId(planPath) {
  const map = buildCompositionMap();
  const basename = path.basename(planPath);

  // Try basename match first (most common: "plan-foo.json")
  if (map.byBasename.has(basename)) {
    return map.byBasename.get(basename);
  }

  // Try relative path match
  const rel = path.relative(REPO_ROOT, path.resolve(planPath)).replace(/\\/g, "/");
  if (map.byRelPath.has(rel)) {
    return map.byRelPath.get(rel);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
  return pkg.version ?? "0.0.0";
}

function checkNodeVersion() {
  const major = parseInt(process.version.slice(1).split(".")[0], 10);
  if (major < 20) {
    console.error(`✕ Node ${process.version} detected — MotionAgent requires Node ≥ 20.`);
    process.exit(1);
  }
}

function checkTool(name) {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Read the one-line buyer-facing description for a pack from the preset's own
 *  description field first (this is written as clean summary text), falling back to
 *  README.md's first real prose line only if the preset has none. */
function packDescription(packId) {
  // Try presets/<pack>.json description first — written as clean summary text.
  try {
    const preset = JSON.parse(fs.readFileSync(path.resolve(PRESETS_DIR, `${packId}.json`), "utf8"));
    if (preset.description) {
      const d = preset.description;
      return d.length > 120 ? d.slice(0, 117) + "…" : d;
    }
  } catch { /* fall through */ }

  // Fall back to packs/<pack>/README.md's first non-heading, non-blank line.
  const readme = path.resolve(PACKS_DIR, packId, "README.md");
  try {
    const lines = fs.readFileSync(readme, "utf8").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (/^(ground truth|internal|private|reference):/i.test(line)) continue;
      return line.length > 120 ? line.slice(0, 117) + "…" : line;
    }
  } catch { /* fall through */ }

  return "Style pack for MotionAgent reels.";
}

function listPacks() {
  const files = fs.readdirSync(PRESETS_DIR).filter((f) => f.endsWith(".json"));
  const packs = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    // Only list presets that have a corresponding packs/<id>/ directory —
    // these are the actual style packs, not generic dial presets like balanced/calm/punchy.
    if (!fs.existsSync(path.resolve(PACKS_DIR, id))) continue;
    try {
      const preset = JSON.parse(fs.readFileSync(path.resolve(PRESETS_DIR, f), "utf8"));
      packs.push({ id, label: preset.label ?? id });
    } catch { /* skip malformed */ }
  }
  return packs;
}

function die(msg) {
  console.error(`✕ ${msg}`);
  process.exit(1);
}

function usage() {
  console.log(`MotionAgent v${readVersion()} — reel scaffolder CLI (free starter: UI Mate + Talking Head)

Usage:
  node cli/motionagent.mjs init
  node cli/motionagent.mjs scaffold --pack=<pack> --name=<slug> --vo=<path.wav> [--brief="<one-line brief>"]
  node cli/motionagent.mjs beats <vo.wav> --slug=<slug>
  node cli/motionagent.mjs render <plan.json> [--platform=ig|tiktok|shorts] [--composition=<id>] [--preset=<pack>|--family=<family>]
  node cli/motionagent.mjs style-matrix <plan.json> [--mode=lint|render] [--packs=a,b,c]
  node cli/motionagent.mjs lint <plan.json> --preset=<pack>
  node cli/motionagent.mjs capture <url> --slug=<slug>
  node cli/motionagent.mjs --version

Commands:
  init       Check dependencies and list available packs
  scaffold   Ingest voiceover and produce transcript + beats, then print
             next-step Director instructions (does NOT automate LLM stages)
  beats      Standalone voiceover → transcript + beats (ingest only)
  render     Render a plan.json to final video
  style-matrix
             Lint or render one plan across the shipped pack presets
  lint       Lint a plan.json against a pack's preset
  capture    Screenshot a URL for use in DeviceFrame/KenBurns/Parallax scenes

Options:
  --pack=<pack>          Pack id (ui-mate or talking-head)
  --name=<slug>          Output slug (used for transcript/beats filenames)
  --vo=<path.wav>        Path to voiceover audio file
  --brief="<text>"       One-line creative brief (idea-only, no voiceover)
  --slug=<slug>          Output slug (for beats/capture)
  --platform=<id>        Target platform: ig (default), tiktok, or shorts
  --composition=<id>     Override Remotion composition ID (auto-resolved by default)
  --preset=<pack>        Pack preset id for render/lint; render implies that preset's family
  --family=<family>      Render with a raw token family override
  --version              Print version and exit
`);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdInit() {
  checkNodeVersion();
  console.log(`MotionAgent v${readVersion()} (free starter)\n`);

  // Dependency checks
  const hasFfmpeg = checkTool("ffmpeg");
  const hasWhisper = checkTool("whisper-cli");
  console.log("Dependencies:");
  console.log(`  ${hasFfmpeg ? "✓" : "✗"} Node.js ${process.version} (≥ 20)`);
  console.log(`  ${hasFfmpeg ? "✓" : "✗"} ffmpeg`);
  console.log(`  ${hasWhisper ? "✓" : "✗"} whisper-cli`);
  if (!hasFfmpeg || !hasWhisper) {
    console.log("\nMissing dependencies:");
    if (!hasFfmpeg) console.log("  • ffmpeg — install via: brew install ffmpeg");
    if (!hasWhisper) console.log("  • whisper-cli — install via: brew install whisper-cpp");
  }
  console.log();

  // Smoke test — proves the actual render pipeline produces real pixels, not
  // just that binaries exist on PATH. Only runs when the deps it needs are
  // present; a missing-deps run stops at the dependency report above.
  if (hasFfmpeg) {
    smokeTestRender();
  }

  // Pack list
  const packs = listPacks();
  console.log("Available packs (free starter):");
  for (const { id, label } of packs) {
    const desc = packDescription(id);
    console.log(`  ${label.padEnd(20)} ${desc}`);
  }
  console.log("\nThe paid tier adds 5 more packs (Grove Editorial, Fun Money, SaaS Motion,");
  console.log("Workflow Poster, Fly Motion) — see README.md.");
}

function smokeTestRender() {
  const smokePlanPath = path.resolve(REPO_ROOT, "demo/plan-ui-mate-capability-showcase.json");
  process.stdout.write("Smoke test (render pipeline)... ");
  if (!fs.existsSync(smokePlanPath)) {
    console.log("✗ skipped (calibration plan missing)");
    return;
  }
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(smokePlanPath, "utf8"));
  } catch (e) {
    console.log(`✗ FAILED (calibration plan is not valid JSON: ${e.message})`);
    return;
  }

  const tag = `motionagent-smoke-${process.pid}-${Date.now()}`;
  const propsPath = path.join(os.tmpdir(), `${tag}-props.json`);
  const videoPath = path.join(os.tmpdir(), `${tag}-frame0.mp4`);
  const stillPath = path.join(os.tmpdir(), `${tag}-frame0.png`);
  fs.writeFileSync(propsPath, JSON.stringify({ plan }));

  try {
    // `remotion still` doesn't reliably initialize a WebGL context in every
    // environment (confirmed: fails here even with --gl=swangle on a
    // WebGL-backed component, while `render` succeeds) — --frames=0-0 gets
    // the same single-frame result through the render path that's actually
    // proven to work, at effectively the same cost (~0.5s).
    execFileSync(
      "npx",
      ["remotion", "render", "DynamicPlanReel", videoPath, "--gl=angle", `--props=${propsPath}`, "--frames=0-0", "--log=error"],
      { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch (e) {
    console.log("✗ FAILED");
    console.log(`  Composition did not render: ${(e.stderr ?? e.message).toString().split("\n")[0]}`);
    cleanupSmokeFiles(propsPath, videoPath, stillPath);
    return;
  }

  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 1024) {
    console.log("✗ FAILED (no output written)");
    cleanupSmokeFiles(propsPath, videoPath, stillPath);
    return;
  }

  try {
    execFileSync("ffmpeg", ["-y", "-i", videoPath, "-frames:v", "1", stillPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stats = execFileSync(
      "ffmpeg",
      ["-i", stillPath, "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const ymin = /lavfi\.signalstats\.YMIN=(-?[\d.]+)/.exec(stats);
    const ymax = /lavfi\.signalstats\.YMAX=(-?[\d.]+)/.exec(stats);
    const range = ymin && ymax ? Number(ymax[1]) - Number(ymin[1]) : null;
    if (range === null) {
      console.log("✓ frame rendered (could not verify content — ffmpeg stats unavailable)");
    } else if (range < 10) {
      console.log(`✗ FAILED (frame rendered but reads as blank — luma range ${range.toFixed(1)})`);
    } else {
      console.log("✓ real pixels confirmed");
    }
  } catch {
    console.log("✓ frame rendered (could not verify content)");
  }

  cleanupSmokeFiles(propsPath, videoPath, stillPath);
}

function cleanupSmokeFiles(...paths) {
  for (const p of paths) {
    try { fs.rmSync(p, { force: true }); } catch {}
  }
}

function cmdScaffold(args) {
  const pack = args.pack ?? die("--pack is required (e.g. --pack=ui-mate)");
  const name = args.name ?? die("--name is required (e.g. --name=my-reel)");
  const vo = args.vo;
  const brief = args.brief;

  if (!vo && !brief) {
    die("Provide either --vo=<path.wav> (for an existing voiceover) or --brief=\"<one-line brief>\" (for idea-only scaffolding).");
  }

  // Validate pack
  const packs = listPacks();
  const packIds = packs.map((p) => p.id);
  if (!packIds.includes(pack)) {
    die(`Unknown pack "${pack}". Available: ${packIds.join(", ")}`);
  }

  console.log(`MotionAgent scaffold — pack: ${pack}, slug: ${name}\n`);

  if (brief && !vo) {
    // Idea-only path
    console.log("[idea-only mode] Brief provided, no voiceover.\n");
    console.log("Next steps:");
    console.log(`  1. Write a TTS-ready script for the brief.`);
    console.log(`  2. Produce a voiceover audio file (TTS or human recording).`);
    console.log(`  3. Run:  node cli/motionagent.mjs beats <vo.wav> --slug=${name}`);
    console.log(`  4. Outline each beat, choose a component per beat from packs/${pack}/pack.json,`);
    console.log(`     and compile that outline into a schema-valid plan.json (see schema/plan.ts,`);
    console.log(`     schema/plan.schema.json, and demo/plan-${pack}-capability-showcase.json for a`);
    console.log(`     worked example).`);
    console.log(`  5. Then lint + render:`);
    console.log(`       node cli/motionagent.mjs lint <plan.json> --preset=${pack}`);
    console.log(`       node cli/motionagent.mjs render <plan.json> --platform=ig\n`);
    return;
  }

  // VO path — run ingest, then point at the plan-authoring step
  const voPath = path.resolve(vo);
  if (!fs.existsSync(voPath)) {
    die(`Voiceover file not found: ${voPath}`);
  }

  console.log(`Running ingest: ${voPath} → transcript-${name}.json + beats-${name}.ts\n`);

  execFileSync(
    process.execPath,
    [path.resolve(REPO_ROOT, "cli/ingest.mjs"), "--audio", voPath, "--slug", name],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );

  console.log("\n✓ Ingest complete.\n");
  console.log("Next steps:");
  console.log(`  1. Read demo/input/transcript-${name}.json (word-level timing) and outline`);
  console.log(`     each beat, choosing a component per beat from packs/${pack}/pack.json.`);
  console.log(`  2. Compile that outline into a schema-valid plan.json (schema/plan.ts,`);
  console.log(`     schema/plan.schema.json — demo/plan-${pack}-capability-showcase.json is a`);
  console.log(`     worked example plan/transcript pair for this pack).`);
  console.log(`  3. Lint + fix:  node cli/motionagent.mjs lint <plan.json> --preset=${pack}`);
  console.log(`\n  Then render:  node cli/motionagent.mjs render <plan.json> --platform=ig`);
}

function cmdBeats(args) {
  const vo = args._positional?.[0];
  const slug = args.slug ?? die("--slug is required");

  if (!vo) die("Usage: node cli/motionagent.mjs beats <vo.wav> --slug=<slug>");

  const voPath = path.resolve(vo);
  if (!fs.existsSync(voPath)) die(`File not found: ${voPath}`);

  // ingest.mjs handles ffmpeg → whisper → beats pipeline
  execFileSync(
    process.execPath,
    [path.resolve(REPO_ROOT, "cli/ingest.mjs"), "--audio", voPath, "--slug", slug],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
}

function cmdRender(args) {
  const planPath = args._positional?.[0];
  if (!planPath) die("Usage: node cli/motionagent.mjs render <plan.json> [--platform=ig|tiktok|shorts] [--composition=<id>] [--preset=<pack>|--family=<family>] [--out=<path>]");

  const resolved = path.resolve(planPath);
  if (!fs.existsSync(resolved)) die(`Plan file not found: ${resolved}`);

  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (e) {
    die(`Plan file is not valid JSON: ${resolved}\n  ${e.message}`);
  }
  const originalFamily = plan.meta?.family ?? "signal";
  let styleSuffix = "";

  if (args.preset) {
    const presetPath = path.resolve(PRESETS_DIR, `${args.preset}.json`);
    if (!fs.existsSync(presetPath)) die(`Preset not found: ${presetPath}`);
    const preset = JSON.parse(fs.readFileSync(presetPath, "utf8"));
    plan.meta = {
      ...(plan.meta ?? {}),
      preset: args.preset,
      family: args.family ?? preset.family ?? originalFamily,
    };
    styleSuffix = `.${args.preset}`;
  } else if (args.family) {
    plan.meta = {
      ...(plan.meta ?? {}),
      family: args.family,
    };
    styleSuffix = `.${args.family}`;
  }

  // Resolve composition ID: explicit --composition flag wins, then Root.tsx lookup.
  // Unregistered buyer-authored plans render through DynamicPlanReel with runtime props.
  let compId = args.composition ?? null;
  if (!compId) {
    compId = resolveCompositionId(planPath);
  }
  const styleOverride = Boolean(args.preset || args.family);
  const dynamicFallback = !compId || styleOverride;
  if (!compId || styleOverride) {
    compId = "DynamicPlanReel";
  }

  // Platform mapping — render-final.mjs already accepts ig/tiktok/shorts directly
  const platform = args.platform ?? "ig";

  // Output path — --out overrides the default out/renders/<slug>.mp4
  const slug = path.basename(planPath, ".json");
  const outPath = args.out
    ? path.resolve(REPO_ROOT, args.out)
    : path.resolve(REPO_ROOT, "out/renders", `${slug}${styleSuffix}.mp4`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const renderArgs = [
    path.resolve(REPO_ROOT, "cli/render-final.mjs"),
    "--composition", compId,
    "--plan", resolved,
    "--out", outPath,
    "--platform", platform,
  ];
  if (args.preset) renderArgs.push("--preset", args.preset);
  if (plan.meta?.family !== originalFamily || args.family) renderArgs.push("--family", plan.meta.family);
  if (args.force) renderArgs.push("--force");

  const propsPath =
    dynamicFallback || compId === "DynamicPlanReel"
      ? path.join(os.tmpdir(), `motionagent-dynamic-props-${process.pid}-${Date.now()}.json`)
      : null;

  try {
    if (propsPath) {
      fs.writeFileSync(propsPath, JSON.stringify({ plan }));
      if (dynamicFallback) {
        console.log(
          `DynamicPlanReel fallback: no Root.tsx composition registered for ${path.basename(planPath)}; ` +
            `using meta.family="${plan.meta?.family ?? "signal"}".`,
        );
      }
      renderArgs.push("--props", propsPath);
    }

    execFileSync(process.execPath, renderArgs, { cwd: REPO_ROOT, stdio: "inherit" });
  } finally {
    if (propsPath) fs.rmSync(propsPath, { force: true });
  }
}

function cmdStyleMatrix(args) {
  const planPath = args._positional?.[0];
  if (!planPath) die("Usage: node cli/motionagent.mjs style-matrix <plan.json> [--mode=lint|render] [--packs=a,b,c]");
  const matrixArgs = [path.resolve(REPO_ROOT, "cli/style-matrix.mjs"), planPath];
  if (args.mode) matrixArgs.push("--mode", args.mode);
  if (args.packs) matrixArgs.push("--packs", args.packs);
  if (args.platform) matrixArgs.push("--platform", args.platform);
  if (args.force) matrixArgs.push("--force");
  execFileSync(process.execPath, matrixArgs, { cwd: REPO_ROOT, stdio: "inherit" });
}

function cmdLint(args) {
  const planPath = args._positional?.[0];
  const preset = args.preset ?? die("--preset is required (e.g. --preset=ui-mate)");

  if (!planPath) die("Usage: node cli/motionagent.mjs lint <plan.json> --preset=<pack>");

  const resolved = path.resolve(planPath);
  if (!fs.existsSync(resolved)) die(`Plan file not found: ${resolved}`);

  // Delegate directly to cli/lint.mjs with --preset
  execFileSync(
    process.execPath,
    [path.resolve(REPO_ROOT, "cli/lint.mjs"), resolved, "--preset", preset],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
}

function cmdCapture(args) {
  const url = args._positional?.[0];
  const slug = args.slug ?? die("--slug is required");

  if (!url) die("Usage: node cli/motionagent.mjs capture <url> --slug=<slug>");

  // capture.mjs takes <url> [slug] [--scroll=N]
  execFileSync(
    process.execPath,
    [path.resolve(REPO_ROOT, "cli/capture.mjs"), url, slug],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
}

// ---------------------------------------------------------------------------
// Arg parsing (minimal, matches existing cli/*.mjs style)
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version") {
      console.log(readVersion());
      process.exit(0);
    }
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      if (eqIdx !== -1) {
        // --key=value
        const key = a.slice(2, eqIdx);
        const val = a.slice(eqIdx + 1);
        flags[toCamel(key)] = val;
      } else {
        // --key value (or boolean flag with no value)
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[toCamel(key)] = next;
          i++;
        } else {
          flags[toCamel(key)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  flags._positional = positional;
  return flags;
}

function toCamel(name) {
  return name.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.length === 0) {
  usage();
  process.exit(1);
}

// --version can appear as the only arg or alongside a command
if (argv.includes("--version")) {
  console.log(readVersion());
  process.exit(0);
}

const command = argv[0];
const rest = argv.slice(1);

switch (command) {
  case "init":
    cmdInit();
    break;
  case "scaffold":
    cmdScaffold(parseCliArgs(rest));
    break;
  case "beats":
    cmdBeats(parseCliArgs(rest));
    break;
  case "render":
    cmdRender(parseCliArgs(rest));
    break;
  case "style-matrix":
    cmdStyleMatrix(parseCliArgs(rest));
    break;
  case "lint":
    cmdLint(parseCliArgs(rest));
    break;
  case "capture":
    cmdCapture(parseCliArgs(rest));
    break;
  default:
    console.error(`✕ Unknown command: ${command}`);
    usage();
    process.exit(1);
}
