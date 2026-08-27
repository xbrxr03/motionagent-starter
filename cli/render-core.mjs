#!/usr/bin/env node
// render-core.mjs — shared render pipeline: lint-gate + remotion render + audio master + mux.
// Both cli/render-final.mjs (CLI) and mcp/server.mjs's `render` tool (when planPath is
// given) delegate to renderFinal() here, so lint-refusal behavior and transcript-path
// inference can never diverge between the two entry points again (HARDENING.md: mcp/
// server.mjs's `render` tool used to hardcode transcriptPath to "demo/input/transcript.json"
// regardless of which plan was being rendered, silently linting plan2/plan3 against the
// wrong transcript; and MCP-driven renders had no audio mastering at all).
//
// Always captures child-process stdout/stderr rather than inheriting — this module is
// imported by mcp/server.mjs, whose own stdout IS the MCP JSON-RPC channel over stdio;
// inheriting a child's stdout would corrupt that stream. Callers get output via the
// optional onLog callback (cli/render-final.mjs prints it; mcp/server.mjs collects it
// into the tool result instead).
//
// Known gap: the `sfx` string ("path:atMs[,path:atMs...]") is parsed and its file paths
// existence-checked by cli/audio-master.mjs, which only runs AFTER the remotion
// render — so a malformed/missing SFX entry still costs a full render before erroring.
// Pre-parsing it here would duplicate audio-master.mjs's parser (the exact divergence
// this module exists to prevent), so it stays late until the parser is extractable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lint, RULE_NAMES } from "../lint/lint.mjs";
import { run as kitRun } from "./kit.mjs";
import { planSfxToArg } from "../sfx/registry.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, ".."); // this repo's own root, independent of caller cwd
const AUDIO_MASTER_SCRIPT = path.join(REPO_ROOT, "cli", "audio-master.mjs");
const FAMILIES_PATH = path.join(REPO_ROOT, "tokens", "compiled", "families.json");

export const PLATFORMS = ["ig", "tiktok"];

// Chromium GL backends Remotion accepts for `--gl=`. Default is "angle" (real GPU, fast) —
// what every 2D comp already rendered with, so nothing about existing behavior changes.
// "swangle" (SwiftShader = pure-CPU ANGLE) is the machine-INDEPENDENT backend used for
// golden/reference renders of the WebGL tier: GPU shaders drift per-vendor (IMPLEMENTATION.md
// "The one genuinely hard constraint"), swangle is bit-identical everywhere at the cost of
// speed. The rest are passed through for completeness (Linux CI may want egl/vulkan).
export const GL_BACKENDS = ["angle", "swangle", "swiftshader", "egl", "vulkan", "angle-egl"];

// Caller-supplied paths resolve against the caller's cwd (matches cli/lint.mjs and
// mcp/server.mjs's convention — normally invoked from the project root).
export const resolveCallerPath = (p, cwd = process.cwd()) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));

export function readJson(p, cwd = process.cwd()) {
  const resolved = resolveCallerPath(p, cwd);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (e) {
    // Name the file — renderFinal() reads two JSON files (plan + transcript), and a bare
    // "Unexpected token" / ENOENT gives the caller no way to tell which one is broken.
    throw new Error(`failed to read JSON at ${resolved}: ${e.message}`, { cause: e });
  }
}

// The plan2/plan3 filename convention (demo/plan2.json + demo/input/transcript2.json etc.) —
// THE single source of truth for this inference. Do not reimplement this elsewhere.
//
// Returns null when planPath's basename doesn't match the convention, rather than
// silently falling back to "demo/input/transcript.json" — a stress-test proved that fallback
// was the exact bug category this module exists to prevent, one layer down: a
// byte-identical copy of a real plan named e.g. "plan2-fixed.json" silently linted clean
// against plan.json's own (wrong) transcript. renderFinal() refuses rather than guessing;
// callers with a non-conventional filename must pass transcriptPath explicitly.
export function inferTranscriptPath(planPath) {
  const base = path.basename(planPath);
  const m = base.match(/^plan(\d*)\.json$/i);
  if (!m) return null;
  return path.join("demo", "input", `transcript${m[1]}.json`);
}

// resolveTranscriptPath(plan, planPath) — THE full transcript-pairing chain, in one place.
// Used to be two divergent implementations: renderFinal() below only tried steps 1-2 and
// THREW when neither matched, while cli/lint-all.mjs (which lints every demo/plan*.json,
// including the hyphen-suffixed ones) carried a third, more general step itself. That meant
// a plan lint-all.mjs already accepted clean (e.g. plan-showcase.json, paired via step 3)
// could make `render-final` throw outright on the exact same plan. This function is the
// merge — both renderFinal() and lint-all.mjs call it now, so they can't diverge again.
//
// Resolution order:
//   1. plan.meta.transcript — EXPLICIT pairing (schema/plan.ts meta.transcript, v1.1): the
//      plan names its own transcript, repo-root-relative. Lets a plan reuse an existing
//      transcript under a different basename (plan-blind-yahoo.json -> transcript-yahoo.json)
//      without a duplicate transcript file just to satisfy a basename convention.
//   2. inferTranscriptPath(planPath) — the numeric plan<N>.json <-> transcript<N>.json
//      convention (plan2.json -> demo/input/transcript2.json).
//   3. The generalized "plan" -> "transcript" basename swap in demo/input/, for the
//      hyphen-suffixed plans (plan-showcase.json -> demo/input/transcript-showcase.json)
//      that don't match step 2's numeric-only regex.
//
// Step 3 always matches something (it's a pure string swap on the basename), so this
// function NEVER returns null and never throws — INTENTIONALLY WIDENS what renderFinal()
// below will attempt: previously, any planPath that didn't fit steps 1-2 made renderFinal()
// refuse up front with a clear "could not infer a transcript path" error. Now it instead
// guesses via step 3 and lets the normal readJson() failure (in renderFinal(), on whatever
// path this returns) surface if that guess doesn't exist. The tradeoff is deliberate: lint-
// all.mjs already had to accept exactly these plans, and it's better for the two entry
// points to agree — even on a guess — than to silently disagree on which plans are valid.
export function resolveTranscriptPath(plan, planPath) {
  if (typeof plan?.meta?.transcript === "string" && plan.meta.transcript.length) {
    return plan.meta.transcript;
  }
  const inferred = inferTranscriptPath(planPath);
  if (inferred) return inferred;
  const base = path.basename(planPath).replace(/^plan/, "transcript");
  return path.join("demo", "input", base);
}

// Module-level cache — families.json is an immutable build output (npm run compile:tokens
// regenerates it as a whole file, never patches it in place), so re-reading+re-parsing it
// on every call only burns time: cli/generate-variants.mjs alone calls this once per
// family per run (~9x for the full family set) against the same unchanged file.
let familiesCache = null;

export function loadFamilyTokens(familyId) {
  if (!familiesCache) {
    familiesCache = JSON.parse(fs.readFileSync(FAMILIES_PATH, "utf8"));
  }
  return familiesCache[familyId] ?? { id: familyId };
}

export function firstFailureLine(failures) {
  if (!failures.length) return "";
  const f = failures[0];
  return ` — first: ${f.ruleId} ${f.message}`;
}

export function formatLintReport(failures, warnings) {
  const lines = [];
  for (const w of warnings) {
    lines.push(`⚠ ${w.ruleId} ${RULE_NAMES[w.ruleId] ?? ""}: ${w.message}`);
  }
  if (failures.length) {
    lines.push(`✕ LINT FAILED (${failures.length}):`);
    for (const f of failures) {
      const hint = f.fixHint ? ` (fix: ${f.fixHint})` : "";
      lines.push(`  ✕ ${f.ruleId} ${RULE_NAMES[f.ruleId] ?? ""}: ${f.message}${hint}`);
    }
  }
  return lines.join("\n");
}

// Thin throw-on-failure wrapper over kit.run() (cli/kit.mjs — always captures, never
// inherits stdio, safe to call from an MCP stdio server). kit.run() itself never throws
// (every caller decides for itself whether a failure is fatal); renderFinal() below always
// treats a subprocess failure as fatal, so this restores that throwing contract on top.
function run(cmd, args, { label, cwd = process.cwd(), onLog = () => {} } = {}) {
  const result = kitRun(cmd, args, { cwd, onLog });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(`${label ?? cmd} not found on PATH (tried to run "${cmd}")`);
    }
    throw result.error;
  }
  if (!result.ok) {
    throw new Error(`${label ?? cmd} exited ${result.status}\n${result.stderr || result.stdout || ""}`);
  }
  return result;
}

// The shared pipeline: lint-gate -> remotion render -> audio-master -> ffmpeg mux -> ffprobe.
//
// Throws on hard failures (bad plan.audio, missing files, a shelled-out tool failing).
// Returns {ok:false, refused:true, lint, transcriptPath} on a lint refusal (expected,
// structured — not thrown). Returns {ok:true, finalPath, durationSec, sizeBytes,
// streamSummary, lint, transcriptPath} on success.
export async function renderFinal({
  compositionId,
  planPath,
  out,
  propsPath,
  music,
  sfx,
  platform = "ig",
  transcriptPath,
  presetId,
  familyId,
  force = false,
  gl = "angle",
  cwd = process.cwd(),
  onLog = () => {},
}) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`platform must be one of: ${PLATFORMS.join(", ")}`);
  }
  if (!GL_BACKENDS.includes(gl)) {
    throw new Error(`gl must be one of: ${GL_BACKENDS.join(", ")}`);
  }

  // presetId resolves against the CALLER's cwd, same convention as planPath/transcriptPath
  // — "presets/<id>.json" relative to wherever this was invoked from. Undefined preset
  // means "use DEFAULT_THRESHOLDS" (presets/dials.mjs) — lint() already handles that.
  let preset;
  if (presetId) {
    const presetPath = resolveCallerPath(`presets/${presetId}.json`, cwd);
    if (!fs.existsSync(presetPath)) {
      throw new Error(`preset "${presetId}" not found at ${presetPath}`);
    }
    preset = readJson(presetPath, cwd);
  }

  let plan = readJson(planPath, cwd);
  const styleFamily = familyId || preset?.family;
  if (styleFamily || presetId) {
    plan = {
      ...plan,
      meta: {
        ...(plan.meta ?? {}),
        ...(presetId ? { preset: presetId } : {}),
        ...(styleFamily ? { family: styleFamily } : {}),
      },
    };
  }
  // An explicit transcriptPath argument always wins (caller override); otherwise the full
  // 3-step chain in resolveTranscriptPath() above — see its header for what step 3 means
  // for renderFinal()'s acceptance (deliberately widened, no longer throws here).
  const resolvedTranscriptPath = transcriptPath || resolveTranscriptPath(plan, planPath);
  const transcript = readJson(resolvedTranscriptPath, cwd);
  const familyTokens = loadFamilyTokens(plan.meta?.family ?? "signal");

  onLog(
    `plan=${planPath} transcript=${resolvedTranscriptPath} family=${plan.meta?.family ?? "signal"} ` +
      `composition=${compositionId} platform=${platform}${preset ? ` preset=${preset.id}` : ""}`,
  );

  // --- lint gate — refuse unless force ---
  const { failures, warnings } = lint(plan, transcript, familyTokens, preset);
  const report = formatLintReport(failures, warnings);
  if (report) onLog(report);
  if (failures.length > 0 && !force) {
    return { ok: false, refused: true, lint: { failures, warnings }, transcriptPath: resolvedTranscriptPath };
  }
  if (failures.length > 0 && force) {
    onLog(`⚠ proceeding despite ${failures.length} lint failure(s) — force was set`);
  } else {
    onLog(`lint passed — ${plan.scenes.length} scenes, ${warnings.length} warning(s)`);
  }

  const finalPath = resolveCallerPath(out, cwd);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  // --- pre-flight the audio inputs BEFORE the expensive remotion render ---
  // These used to be checked only when the mastering step reached them, i.e. AFTER a
  // full multi-minute render — a typo'd plan.audio or missing music file burned the
  // whole render before erroring. Same checks, same error text, just hoisted.
  if (typeof plan.audio !== "string") {
    throw new Error(`plan.audio must be a string path relative to public/, got: ${JSON.stringify(plan.audio)}`);
  }
  const voPath = resolveCallerPath(path.join("public", plan.audio), cwd);
  if (!fs.existsSync(voPath)) {
    throw new Error(`voiceover file not found: ${voPath} (from plan.audio="${plan.audio}")`);
  }
  const musicPath = music ? resolveCallerPath(music, cwd) : undefined;
  if (musicPath && !fs.existsSync(musicPath)) {
    throw new Error(`music file not found: ${musicPath} (from music="${music}")`);
  }

  // --- resolve plan-authored SFX cues (DEFAULT OFF) ---
  // Only when meta.sfxEnabled===true AND sfxCues[] is non-empty: each cue resolves through
  // sfx/sfx-registry.json to a cached CC0 asset, and planSfxToArg() builds audio-master's
  // `path:atMs,...` string — VALIDATING here (unknown cue, or atMs outside [0,durationMs])
  // so a bad cue throws BEFORE the multi-minute render, not after (unlike the CLI `sfx`
  // string, whose late-check is the module-header "known gap"). When the flag is off/absent
  // planSfxArg is "" and `sfx` passes through UNCHANGED, so a plan that doesn't use SFX
  // produces a byte-identical audio-master invocation (and thus byte-identical output audio)
  // to before this feature existed.
  const planSfxArg = planSfxToArg(plan);
  let sfxArg = sfx;
  if (planSfxArg) {
    sfxArg = sfx ? `${sfx},${planSfxArg}` : planSfxArg;
    onLog(`sfx: mixing ${plan.sfxCues.length} plan cue(s) (meta.sfxEnabled) at -4dB`);
  }

  const tmpTag = `motionagent-${process.pid}-${Date.now()}`;
  const tmpVideoPath = path.join(os.tmpdir(), `${tmpTag}-video.mp4`);
  const tmpMasterPath = path.join(os.tmpdir(), `${tmpTag}-master.wav`);
  const styleOverrideActive = Boolean(familyId || preset?.family || presetId);
  if (styleOverrideActive && compositionId !== "DynamicPlanReel") {
    throw new Error(
      `style overrides require composition "DynamicPlanReel" so chrome/tokens match the overridden family; got "${compositionId}"`,
    );
  }

  let tmpPropsPath = null;
  if (compositionId === "DynamicPlanReel" && !propsPath) {
    tmpPropsPath = path.join(os.tmpdir(), `${tmpTag}-props.json`);
    fs.writeFileSync(tmpPropsPath, JSON.stringify({ plan }));
  }
  const resolvedPropsPath = propsPath ? resolveCallerPath(propsPath, cwd) : tmpPropsPath;

  try {
    // --- render the composition (raw-VO-baked video) to a scratch tmp path ---
    onLog(
      `rendering "${compositionId}" -> ${tmpVideoPath} (--gl=${gl}` +
        `${resolvedPropsPath ? ` props=${resolvedPropsPath}` : ""})`,
    );
    const remotionArgs = ["remotion", "render", compositionId, tmpVideoPath, `--gl=${gl}`, "--log=error"];
    if (resolvedPropsPath) {
      remotionArgs.push(`--props=${resolvedPropsPath}`);
    }
    run("npx", remotionArgs, {
      label: "remotion render",
      cwd,
      onLog,
    });

    // --- master the audio: VO + optional music + optional SFX -> mastered wav ---
    // (SFX paths inside the `sfx` string are parsed and existence-checked by
    // audio-master.mjs itself — see the known-gap note in the module header.)
    onLog(`mastering audio (VO=${voPath}) -> ${tmpMasterPath}`);
    const masterArgs = [AUDIO_MASTER_SCRIPT, "--vo", voPath];
    if (musicPath) masterArgs.push("--music", musicPath);
    if (sfxArg) masterArgs.push("--sfx", sfxArg); // audio-master.mjs parses "path:atMs,..." itself
    masterArgs.push("--platform", platform, "--out", tmpMasterPath);
    run("node", masterArgs, { label: "cli/audio-master.mjs", cwd, onLog });

    // --- mux: swap the raw-VO track for the mastered mix ---
    // plan.durationMs (and hence the rendered video's length) is canonical — R5 only
    // requires the audio-lock tail to be >=350ms after the VO ends, so the mastered
    // VO-only track is routinely SHORTER than the video. `-af apad` pads the audio with
    // trailing silence first so it's never the shorter stream; `-shortest` then always
    // caps the output at the video's length.
    onLog(`muxing video + mastered audio -> ${finalPath}`);
    run(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        tmpVideoPath,
        "-i",
        tmpMasterPath,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "copy",
        "-af",
        "apad",
        "-c:a",
        "aac",
        "-shortest",
        finalPath,
      ],
      { label: "ffmpeg mux", cwd, onLog },
    );

    // --- confirm: ffprobe the final file ---
    const probe = run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", finalPath],
      { label: "ffprobe", cwd, onLog },
    );
    const info = JSON.parse(probe.stdout);
    const durationSec = Number(info.format?.duration ?? NaN);
    const sizeBytes = Number(info.format?.size ?? fs.statSync(finalPath).size);
    const streamSummary = (info.streams ?? [])
      .map((s) => `${s.codec_type}:${s.codec_name}${s.codec_type === "video" ? `@${s.width}x${s.height}` : ""}`)
      .join(", ");

    onLog(`done -> ${finalPath}`);
    onLog(
      `duration=${durationSec.toFixed(3)}s (plan.durationMs=${(plan.durationMs / 1000).toFixed(3)}s) ` +
        `size=${(sizeBytes / 1024 / 1024).toFixed(2)}MB streams=[${streamSummary}]`,
    );

    return {
      ok: true,
      finalPath,
      durationSec,
      sizeBytes,
      streamSummary,
      lint: { failures, warnings },
      transcriptPath: resolvedTranscriptPath,
    };
  } finally {
    for (const p of [tmpVideoPath, tmpMasterPath, tmpPropsPath]) {
      if (p) fs.rmSync(p, { force: true });
    }
  }
}
