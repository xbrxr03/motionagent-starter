#!/usr/bin/env node
// Audio mastering chain (ROADMAP "Sound finished" / ARCHITECTURE §8).
// VO + optional music bed + optional SFX cues -> sidechain-ducked mix -> two-pass
// loudnorm master. Recipe is spec'd in IMPLEMENTATION.md ("## Audio mastering"):
//   1. 3-layer filter_complex: VO 0dB / music -8dB sidechain-ducked under VO
//      (asplit VO to feed BOTH the sidechain trigger and the final mix,
//      normalize=0 on amix so our explicit dB levels aren't auto-compensated) /
//      SFX -4dB -> premaster wav.
//   2. Two-pass loudnorm: pass 1 measures (print_format=json), pass 2 applies
//      loudnorm=I=<target>:TP=-1:LRA=11:linear=true:measured_* with an explicit
//      -ar 48000 (loudnorm silently resamples to 192k otherwise).
//
// Beat-detection landmine (PACKS.md): this script never shells to essentia/aubio/
// madmom for analysis. SFX timing here is caller-supplied (--sfx path:atMs), not
// detected. Bundled beds should ship with precomputed BPM/downbeat metadata.
//
// CLI:
//   node cli/audio-master.mjs --vo <path> [--music <path>]
//     [--sfx <path:atMs>[,<path:atMs>...]] [--platform ig|tiktok] --out <path>
//     [--keep-premaster] [--debug-duck <path>]
//
// Platform loudness targets (ARCHITECTURE §8 / ROADMAP): ig I=-14 LUFS, tiktok I=-10 LUFS.
// Both TP=-1 dBTP, LRA=11.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, runAsync as kitRunAsync } from "./kit.mjs";

const PLATFORM_TARGETS = { ig: -14, tiktok: -10 };

const USAGE =
  "Usage: node cli/audio-master.mjs --vo <path> [--music <path>]\n" +
  "  [--sfx <path:atMs>[,<path:atMs>...]] [--platform ig|tiktok] --out <path>\n" +
  "  [--keep-premaster] [--debug-duck <path>]";

function parseCliArgs(argv) {
  const args = parseArgs(argv, {
    // --debug-duck: also emit the isolated post-sidechain music stem (pre-mix) — useful
    // for proving/inspecting the ducking envelope in isolation. No-op without --music.
    string: ["vo", "music", "sfx", "platform", "out", "debug-duck"],
    boolean: ["keep-premaster"],
    required: ["vo", "out"],
    defaults: { platform: "ig", keepPremaster: false },
    usage: USAGE,
  });
  if (!(args.platform in PLATFORM_TARGETS)) {
    throw new Error(`--platform must be one of: ${Object.keys(PLATFORM_TARGETS).join(", ")}`);
  }
  return args;
}

function parseSfxArg(sfxArg) {
  if (!sfxArg) return [];
  return sfxArg.split(",").map((token) => {
    const idx = token.lastIndexOf(":");
    if (idx === -1) throw new Error(`--sfx entry missing ":atMs" — got "${token}"`);
    const filePath = token.slice(0, idx);
    const atMs = Number(token.slice(idx + 1));
    if (!filePath || Number.isNaN(atMs) || atMs < 0) {
      throw new Error(`--sfx entry malformed — got "${token}"`);
    }
    return { filePath, atMs };
  });
}

// Thin reject-on-failure wrapper over kit.runAsync() (cli/kit.mjs — the non-blocking
// `spawn` form, never rejects itself). Every ffmpeg call below is `await`ed and expected
// to throw on failure (propagating to main().catch), so this restores that contract.
async function run(cmd, args) {
  const result = await kitRunAsync(cmd, args);
  if (result.error) throw result.error;
  if (!result.ok) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}\n${result.stderr}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

// Standardize every branch to 48k/stereo before amix — amix requires matching
// sample rate/channel layout across inputs, and this also avoids amix silently
// picking a lossy common format.
const STD = "aresample=48000,aformat=channel_layouts=stereo";

// Build the filter_complex + input list for the premaster (and optional debug-duck) mix.
function buildPremasterGraph({ music, sfxCues, debugDuck }) {
  const inputs = []; // ffmpeg -i args, in order; index 0 is always VO
  const parts = [];
  const mixLabels = [];

  inputs.push("VO_PLACEHOLDER"); // filled in by caller
  if (music) {
    // [vosc] feeds the sidechain trigger below — only split when something consumes it.
    // An unconsumed asplit output is a hard ffmpeg error ("Filter 'asplit' has output 0
    // (vosc) unconnected"), which used to crash the SFX-without-music path.
    //
    // sidechaincompress stops the instant EITHER of its two inputs runs out of samples,
    // and [vosc] (raw VO) is usually SHORTER than the music bed and shorter than the
    // video's own intended length (R5 only requires a >=350ms tail after the VO ends,
    // so a VO-less visual tail is normal). Unpadded, that silently hard-cut the music to
    // dead silence for the whole tail (proven: a 71.8s bed + 55.96s VO premaster
    // measured exactly 55.960s; a finished mastered-with-music render measured -inf RMS
    // across the video's last ~0.8s). `apad` extends [vosc] with silence so
    // sidechaincompress instead runs for as long as [musicpre] does; the final
    // render-core.mjs mux still caps the OUTPUT at the video's own length via
    // `-af apad`+`-shortest`, so this can't make the final file too long.
    parts.push(`[0:a]asplit=2[voscpre][vomix]`);
    parts.push(`[voscpre]apad[vosc]`);
    parts.push(`[vomix]${STD},volume=0dB[vo]`);
  } else {
    parts.push(`[0:a]${STD},volume=0dB[vo]`);
  }
  mixLabels.push("[vo]");

  const wantDebugDuck = Boolean(debugDuck && music);

  if (music) {
    const musicIdx = inputs.length;
    inputs.push(music);
    parts.push(`[${musicIdx}:a]${STD},volume=-8dB[musicpre]`);
    // Sidechain-ducked under the VO: [vosc] (the raw, undelayed VO split) is the
    // control signal. detection=rms for a smoother, voice-appropriate envelope.
    parts.push(
      `[musicpre][vosc]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300:makeup=1:detection=rms[musicduck]`
    );
    if (wantDebugDuck) {
      // Pad labels are single-use — split so the ducked stem can feed both the
      // final mix and a standalone debug output.
      parts.push(`[musicduck]asplit=2[musicduck_mix][musicduck_dbg]`);
      mixLabels.push("[musicduck_mix]");
    } else {
      mixLabels.push("[musicduck]");
    }
  }

  sfxCues.forEach((cue, i) => {
    const sfxIdx = inputs.length;
    inputs.push(cue.filePath);
    const label = `sfx${i}`;
    parts.push(`[${sfxIdx}:a]${STD},adelay=${Math.round(cue.atMs)}:all=1,volume=-4dB[${label}]`);
    mixLabels.push(`[${label}]`);
  });

  parts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[premix]`);

  const outputs = [{ label: "[premix]", role: "premaster" }];
  if (wantDebugDuck) {
    outputs.push({ label: "[musicduck_dbg]", role: "debugDuck" });
  }

  return { inputs, filterComplex: parts.join(";"), outputs };
}

async function mixPremaster({ vo, music, sfxCues, debugDuck, premasterPath }) {
  if (!music && sfxCues.length === 0) {
    // VO-only master: no filter_complex needed, just carry the VO through at 0dB
    // and standardize format so downstream loudnorm behaves predictably.
    await run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      vo,
      "-af",
      `${STD},volume=0dB`,
      premasterPath,
    ]);
    return;
  }

  const { inputs, filterComplex, outputs } = buildPremasterGraph({ music, sfxCues, debugDuck });
  inputs[0] = vo;

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const inputPath of inputs) args.push("-i", inputPath);
  args.push("-filter_complex", filterComplex);
  for (const o of outputs) {
    args.push("-map", o.label);
    args.push(o.role === "premaster" ? premasterPath : debugDuck);
  }
  await run("ffmpeg", args);
}

// Pass 1: measure loudness stats as JSON.
async function measureLoudness(inputPath, targetI) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner",
    "-i",
    inputPath,
    "-af",
    `loudnorm=I=${targetI}:TP=-1:LRA=11:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  const jsonStart = stderr.lastIndexOf("{");
  const jsonEnd = stderr.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`could not parse loudnorm measurement output:\n${stderr}`);
  }
  const measured = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1));
  return measured;
}

// Pass 2: apply loudnorm with the pass-1 measurements (linear mode — single-pass,
// no dynamic re-measurement gain riding), explicit 48k output.
async function applyLoudnorm(inputPath, outputPath, targetI, measured) {
  const filter =
    `loudnorm=I=${targetI}:TP=-1:LRA=11:linear=true:` +
    `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
    `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
    `offset=${measured.target_offset}`;
  await run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-af",
    filter,
    "-ar",
    "48000",
    outputPath,
  ]);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const sfxCues = parseSfxArg(args.sfx);
  const targetI = PLATFORM_TARGETS[args.platform];

  for (const p of [args.vo, args.music, ...sfxCues.map((c) => c.filePath)]) {
    if (p && !fs.existsSync(p)) throw new Error(`file not found: ${p}`);
  }

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });

  const premasterPath = args.keepPremaster
    ? args.out.replace(/(\.\w+)?$/, "-premaster.wav")
    : path.join(os.tmpdir(), `motionagent-premaster-${process.pid}-${Date.now()}.wav`);

  console.log(`[audio-master] mixing premaster (VO=0dB${args.music ? ", music=-8dB sidechain-ducked" : ""}${
    sfxCues.length ? `, ${sfxCues.length} sfx=-4dB` : ""
  }) -> ${premasterPath}`);
  await mixPremaster({
    vo: args.vo,
    music: args.music,
    sfxCues,
    debugDuck: args.debugDuck,
    premasterPath,
  });

  console.log(`[audio-master] loudnorm pass 1 (measure, target I=${targetI} LUFS, platform=${args.platform})`);
  const measured = await measureLoudness(premasterPath, targetI);
  console.log(
    `[audio-master]   measured input_i=${measured.input_i} input_tp=${measured.input_tp} ` +
      `input_lra=${measured.input_lra} input_thresh=${measured.input_thresh}`
  );

  console.log(`[audio-master] loudnorm pass 2 (apply, linear, -ar 48000) -> ${args.out}`);
  await applyLoudnorm(premasterPath, args.out, targetI, measured);

  if (!args.keepPremaster) {
    fs.rmSync(premasterPath, { force: true });
  }

  console.log(`[audio-master] done -> ${args.out}`);
}

main().catch((err) => {
  console.error(`[audio-master] ERROR: ${err.message}`);
  process.exit(1);
});
