#!/usr/bin/env node
// cli/ingest.mjs — STT ingest pipeline (ARCHITECTURE.md §8 "Audio architecture" /
// §10 `ingest_audio` tool). Takes a raw voiceover audio file and produces the two
// artifacts the rest of the pipeline needs:
//   1. demo/input/transcript-<slug>.json — whisper-style word-level transcript, same shape as
//      the existing demo/input/transcript.json / transcript2.json / transcript3.json:
//      top-level `transcription: [{ offsets: { from, to }, text }, ...]`.
//   2. engine/generated/beats-<slug>.ts — frame-conversion module, via `node cli/beats.mjs`.
//
// Pipeline: ffmpeg (-> 16kHz mono wav, mirroring input/voiceover*-16k.wav from earlier
// ingests this session) -> whisper-cli (word-level timestamps, JSON output) ->
// cli/beats.mjs. Pure ffmpeg + whisper.cpp — no essentia/aubio/madmom anywhere
// (PACKS.md licensing landmine); both tools are already used elsewhere in this repo.
//
// CLI:
//   node cli/ingest.mjs --audio <path> --slug <name>
//                            [--model <ggml-path>] [--language <code>|auto]
//
// --language: whisper-cli's own `-l` flag (ISO 639-1-ish code, e.g. "es"/"fr"/"hi", or
// "auto" for whisper's built-in language ID). Omit it entirely (the default) to keep this
// script's original, unchanged behavior: no `-l` flag is passed to whisper-cli at all,
// which whisper.cpp itself defaults to "en", paired with the `.en` (English-only) model
// findModel() has always preferred. Passing ANY value other than "en" switches model
// selection to look for a MULTILINGUAL ggml model instead (see findModel() below) — an
// `.en`-suffixed model is English-only by construction (trained on English audio only)
// and produces garbage/silently-mistranscribed text on non-English audio. Verified for
// real, not assumed: feeding the same Spanish clip through ggml-base.en.bin (no -l) came
// back as "pro verapita ... recona seminto ... vos" (garbled); the multilingual
// ggml-base.bin with `-l es` came back "prueba rápida ... reconocimiento ... voz"
// (correct). See PROGRESS.md's multi-language ingest entry for the full comparison,
// including a same-model English-accuracy check (ggml-base.bin with `-l en` on this
// repo's own input/voiceover16k.wav reproduced all 139 canonical words, so multilingual
// is a safe explicit opt-in — it just isn't made the new default, to keep every existing
// caller's behavior byte-for-byte unchanged when --language is omitted).
//
// Known whisper-cli gotcha (this machine's homebrew whisper-cpp build, verified):
// an unrecognized --language code (e.g. "zz") makes whisper-cli print
// "whisper_lang_id: unknown language" + its own --help text and exit 0 (success) with NO
// output file written — NOT a nonzero exit run() would normally catch. The existing
// `existsSync(transcriptPath)` check a few lines below this still catches it (no
// transcript => hard failure either way), so this doesn't silently corrupt anything, but
// the exit code alone can't be trusted to mean "language code was valid."
//
// OUTPUT:
//   demo/input/<slug>-16k.wav          — intermediate mono 16kHz wav (ffmpeg)
//   demo/input/transcript-<slug>.json  — whisper-cli JSON output (word-level timestamps)
//   engine/generated/beats-<slug>.ts — via cli/beats.mjs
//
// On success, prints audio duration (ffprobe), word count, last word end time (ms), and
// the language whisper actually transcribed with (transcript.result.language — useful
// confirmation in --language auto mode, where whisper picks the language itself).
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { assertSlug } from "./ingest-brief.mjs";
import { parseArgs, run as kitRun, readJson } from "./kit.mjs";

const BEATS_SCRIPT = path.resolve("cli/beats.mjs");

const USAGE =
  "Usage: node cli/ingest.mjs --audio <path> --slug <name>\n" +
  "                        [--model <ggml-path>] [--language <code>|auto]\n" +
  "\n" +
  '--language: whisper-cli\'s spoken-language code (e.g. "es", "fr", "hi"), or "auto"\n' +
  "for whisper's own language detection. Omit for the original default: no -l flag,\n" +
  "English-only (.en) model preferred — unchanged from before this flag existed. Any\n" +
  "other value switches model selection to a MULTILINGUAL ggml model (see findModel).";

function parseCliArgs(argv) {
  return parseArgs(argv, {
    string: ["audio", "slug", "model", "language"],
    required: ["audio", "slug"],
    usage: USAGE,
  });
}

const ENGLISH_MODEL_RE = /(^|[/\\])ggml-.*\.en\.bin$/i;

// Model resolution: explicit --model wins; otherwise check the env var override, then a
// couple of common whisper.cpp cache locations, then scan those directories for any
// ggml-*.bin. Fails loudly (naming what's missing) rather than silently picking a
// wrong/absent model. No developer-machine-specific paths — this ships to other machines.
//
// `language` steers which model FAMILY gets preferred: omitted/"en" keeps the original
// behavior (prefer an English-only `.en` model, the same 2 knownPaths + 3 scanDirs this
// function always checked) — zero behavior change for any existing caller that doesn't
// pass --language. Any other value (a real language code, or "auto") requires a
// MULTILINGUAL model instead: `.en` models are English-only by construction and are
// refused outright for this case (verified for real — see this file's header comment —
// feeding non-English audio through one doesn't error, it silently mistranscribes, which
// is exactly the failure mode this whole flag exists to prevent).
function findModel(explicit, language) {
  const wantsMultilingual = Boolean(language) && language !== "en";

  if (explicit) {
    if (!existsSync(explicit)) {
      console.error(`✕ --model path not found: ${explicit}`);
      process.exit(1);
    }
    if (wantsMultilingual && ENGLISH_MODEL_RE.test(explicit)) {
      console.error(
        `✕ --model ${explicit} looks like an English-only model (filename ends "*.en.bin") ` +
          `but --language ${language} was requested. English-only whisper.cpp models were ` +
          `trained on English audio only and will garble or silently mistranscribe anything ` +
          `else. Pass a multilingual model instead (a ggml-*.bin WITHOUT the ".en" suffix, ` +
          `e.g. ggml-base.bin from https://huggingface.co/ggerganov/whisper.cpp).`,
      );
      process.exit(1);
    }
    return explicit;
  }

  const envVar = wantsMultilingual ? "MOTIONAGENT_WHISPER_MODEL_MULTI" : "MOTIONAGENT_WHISPER_MODEL";
  const knownPaths = wantsMultilingual
    ? [
        process.env.MOTIONAGENT_WHISPER_MODEL_MULTI,
        path.join(os.homedir(), ".cache/whisper/ggml-base.bin"),
        path.join(os.homedir(), ".cache/whisper.cpp/ggml-base.bin"),
      ].filter(Boolean)
    : [
        process.env.MOTIONAGENT_WHISPER_MODEL,
        path.join(os.homedir(), ".cache/whisper/ggml-base.en.bin"),
        path.join(os.homedir(), ".cache/whisper.cpp/ggml-base.en.bin"),
      ].filter(Boolean);
  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }
  const scanDirs = [
    path.join(os.homedir(), ".openclaw/tmp"),
    path.join(os.homedir(), ".cache/whisper"),
    path.join(os.homedir(), ".cache/whisper.cpp"),
  ];
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    // Multilingual mode explicitly EXCLUDES any *.en.bin match — an English-only model
    // must never be silently picked up here just because it happened to be the first
    // ggml-*.bin readdirSync returned (order isn't guaranteed to be language-aware).
    const candidates = readdirSync(dir).filter((f) => /^ggml-.*\.bin$/i.test(f));
    const hit = wantsMultilingual
      ? candidates.find((f) => !ENGLISH_MODEL_RE.test(f))
      : candidates.find((f) => ENGLISH_MODEL_RE.test(f)) ?? candidates[0];
    if (hit) return path.join(dir, hit);
  }
  console.error(
    `✕ no ${wantsMultilingual ? "multilingual " : ""}whisper ggml model found.\n` +
      `  Checked: ${knownPaths.join(", ")}\n` +
      `  Scanned: ${scanDirs.join(", ")} (for any ${wantsMultilingual ? "non-.en " : ""}ggml-*.bin)\n` +
      `  Pass --model <path-to-ggml-*.bin> explicitly, or set ${envVar}, or place a model at ` +
      `${knownPaths[knownPaths.length - 1] ?? "~/.cache/whisper.cpp/"}` +
      (wantsMultilingual
        ? " (download e.g. ggml-base.bin from https://huggingface.co/ggerganov/whisper.cpp)."
        : "."),
  );
  process.exit(1);
}

// Wraps kit.run() (cli/kit.mjs — never throws) with this script's own print+exit(1)
// contract and its original -2000-char stderr slice. Returns raw stdout on success (the
// beats.mjs call site below writes it straight to process.stdout).
function run(cmd, cmdArgs, label) {
  const result = kitRun(cmd, cmdArgs);
  if (!result.ok) {
    console.error(`✕ ${label} failed: ${result.error ? result.error.message : `exited ${result.status}`}`);
    if (result.stderr) console.error(result.stderr.slice(-2000));
    process.exit(1);
  }
  return result.stdout;
}

const args = parseCliArgs(process.argv.slice(2)); // --audio/--slug required-ness enforced here
assertSlug(args.slug); // shared with ingest-url.mjs/ingest-pdf.mjs (cli/ingest-brief.mjs)
// Loose shape check only (2+ letters, optional -REGION, or "auto") — whisper-cli owns the
// real validation of what's a recognized language, and (verified on this machine) a bad
// code doesn't even exit nonzero, so don't pretend this check is a full allowlist; it's
// just a fast, cheap catch for an obvious typo before spending a whisper-cli run on it.
if (args.language && !/^([a-z]{2,3}(-[a-z0-9]+)?|auto)$/i.test(args.language)) {
  console.error(`✕ --language doesn't look like a language code or "auto", got: "${args.language}"`);
  process.exit(1);
}

// Normalize the language code to lowercase, and drop any region suffix (e.g. "en-US" ->
// "en"), before ANY use. whisper-cli itself already accepts uppercase (verified: `-l ES`
// maps to lang=es internally, exits 0), but THIS script's English-vs-multilingual routing
// in findModel() keys on an exact-lowercase `language !== "en"` comparison — so without the
// lowercasing, `--language EN` (or "En") was (verified) treated as non-English and would
// refuse an explicit `.en` model / demand a multilingual one, and `--language AUTO` would
// slip past the "auto" summary-warning check below. The region-suffix strip matters for the
// same reason: the validator below deliberately accepts a "-REGION" suffix (e.g. "en-US",
// "zh-CN") for a natural-feeling CLI, but whisper.cpp's own language list only recognizes
// base ISO-639-1 codes with no region variants — passing "en-us" straight through would
// make findModel() wrongly conclude "non-English" (demanding a multilingual model for plain
// English audio) and, if a multilingual model IS present, "-l en-us" would hit this file's
// own documented whisper-cli gotcha (unrecognized language -> silent exit 0, no output).
// Existing lowercase, region-free callers ("es"/"fr"/"auto") are unaffected.
if (args.language) args.language = args.language.toLowerCase().split("-")[0];

const audioPath = path.resolve(args.audio);
if (!existsSync(audioPath)) {
  console.error(`✕ audio file not found: ${args.audio}`);
  process.exit(1);
}

const modelPath = findModel(args.model, args.language);

mkdirSync("demo/input", { recursive: true });
mkdirSync("engine/generated", { recursive: true });

const wavPath = path.resolve(`demo/input/${args.slug}-16k.wav`);
const transcriptBase = path.resolve(`demo/input/transcript-${args.slug}`); // whisper-cli appends .json (-oj)
const transcriptPath = `${transcriptBase}.json`;
const beatsOutPath = path.resolve(`engine/generated/beats-${args.slug}.ts`);

console.log(`→ ffmpeg: ${args.audio} → ${path.relative(".", wavPath)} (16kHz mono)`);
run("ffmpeg", ["-y", "-i", audioPath, "-ar", "16000", "-ac", "1", wavPath], "ffmpeg");

const whisperArgs = ["-m", modelPath, "-f", wavPath, "-ml", "1", "-sow", "-oj", "-of", transcriptBase];
if (args.language) whisperArgs.push("-l", args.language);

console.log(
  `→ whisper-cli: ${path.relative(".", wavPath)} → ${path.relative(".", transcriptPath)} ` +
    `(model: ${modelPath}${args.language ? `, language: ${args.language}` : ""})`,
);
run("whisper-cli", whisperArgs, "whisper-cli");

if (!existsSync(transcriptPath)) {
  console.error(
    `✕ whisper-cli did not produce the expected output: ${transcriptPath}` +
      (args.language
        ? ` (whisper-cli can exit 0 with no output on an unrecognized --language code — ` +
          `double-check "${args.language}" is a real whisper language code)`
        : ""),
  );
  process.exit(1);
}

console.log(`→ beats: ${path.relative(".", transcriptPath)} → ${path.relative(".", beatsOutPath)}`);
const beatsStdout = run("node", [BEATS_SCRIPT, transcriptPath, beatsOutPath], "beats.mjs");
process.stdout.write(beatsStdout);

// --- summary ---
const transcript = readJson(transcriptPath);
const words = transcript.transcription.filter((w) => w.text?.trim().length > 0);
const lastWordEndMs = words.length ? words.at(-1).offsets.to : 0;

let durationSec = null;
try {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath],
    { encoding: "utf8" },
  );
  durationSec = parseFloat(out.trim());
} catch {
  // non-fatal — ffprobe failure doesn't invalidate the transcript/beats already written
}

console.log(`\n✓ ingest complete for slug "${args.slug}"`);
console.log(`  audio duration: ${durationSec !== null ? `${durationSec.toFixed(3)}s` : "unknown (ffprobe failed)"}`);
console.log(`  word count:     ${words.length}`);
console.log(`  last word end:  ${lastWordEndMs}ms`);
if (transcript.result?.language) {
  console.log(
    `  language:       ${transcript.result.language}` +
      (args.language === "auto" ? " (auto-detected — verify this is right, short clips can mis-detect)" : ""),
  );
}
console.log(`  transcript:     ${path.relative(".", transcriptPath)}`);
console.log(`  beats:          ${path.relative(".", beatsOutPath)}`);
