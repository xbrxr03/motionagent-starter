#!/usr/bin/env node
// Thin CLI wrapper around lint/lint.mjs — reads plan.json + transcript.json off
// disk, calls the pure `lint()` function, prints results, sets the exit code. All rule
// logic lives in lint/lint.mjs so the MCP `lint_plan` tool and CI can call the same
// function without going through a CLI process (ARCHITECTURE.md §9/§10).
//
// Transcript resolution when transcriptPath isn't given explicitly: uses render-core.mjs's
// resolveTranscriptPath() — the SAME chain cli/lint-all.mjs and render-final use (explicit
// plan.meta.transcript -> numeric plan<N>.json<->transcript<N>.json -> generalized
// "plan"->"transcript" basename swap for hyphen-suffixed plans). Before this fix, this file
// had its own THIRD, divergent default (a hardcoded "demo/input/transcript.json"), so
// `node cli/lint.mjs demo/plan-<slug>.json` with no second arg would silently lint against
// the wrong transcript and could report "lint passed" with confidently wrong R1 audio-lock
// advice on a plan that render-final then correctly refused (found 2026-07-26 during the
// Game World original-audio pass — see HARDENING.md). lint-all.mjs already resolves the
// transcript correctly itself and always passes it explicitly as the second positional arg,
// so that path was never affected — only direct/manual invocations without an explicit
// transcriptPath were.
import fs from "node:fs";
import { lint, RULE_NAMES } from "../lint/lint.mjs";
import { resolveTranscriptPath } from "./render-core.mjs";
import { scanKeywords, loadRegistry, DEFAULT_WINDOW_MS } from "./keyword-scan.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Optional argv: node cli/lint.mjs [planPath] [transcriptPath] [--preset <id>]
//   e.g. node cli/lint.mjs demo/plan2.json demo/input/transcript2.json --preset punchy
// --preset can appear anywhere; planPath/transcriptPath are the remaining positional args
// in order, same convention as cli/render-final.mjs's flag parsing.
const rawArgs = process.argv.slice(2);
let presetId;
let noKeywordScan = false;
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--preset") {
    presetId = rawArgs[++i];
  } else if (rawArgs[i] === "--no-keyword-scan") {
    noKeywordScan = true;
  } else {
    positional.push(rawArgs[i]);
  }
}
const planPath = positional[0] ?? "demo/plan.json";

// A malformed plan/transcript file is a common, expected failure mode (a hand-edited or
// LLM-generated JSON file with a syntax error) — surface it as a clear one-line error, not
// JSON.parse's raw SyntaxError + full Node stack trace.
function readJsonOrDie(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`✕ ${label} not found: ${filePath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`✕ ${label} is not valid JSON: ${filePath}\n  ${err.message}`);
    process.exit(1);
  }
}

const plan = readJsonOrDie(planPath, "plan");
const transcriptPath = positional[1] ?? resolveTranscriptPath(plan, planPath);
console.log(`  plan: ${planPath}  (transcript: ${transcriptPath})`);
const transcript = readJsonOrDie(transcriptPath, "transcript");

// Real family tokens, read from the compiled plain-JSON artifact (tokens/compiled/
// families.json, produced by `npm run compile:tokens`). This is Node-importable with no
// bundler — the whole point of splitting token DATA from the loadFont() side effect.
// Falls back to a minimal {id} stub if the artifact is missing (run compile:tokens).
const familyId = plan.meta?.family ?? "signal";
let familyTokens = { id: familyId };
try {
  const families = JSON.parse(fs.readFileSync("tokens/compiled/families.json", "utf8"));
  if (families[familyId]) familyTokens = families[familyId];
  else console.warn(`  ⚠ family "${familyId}" not in families.json — using stub`);
} catch {
  console.warn("  ⚠ tokens/compiled/families.json missing — run `npm run compile:tokens`");
}

// --preset <id> loads presets/<id>.json; omitted means "default thresholds" (equals the
// shipped "balanced" preset exactly — see presets/dials.mjs's BALANCED_DIALS).
let preset;
if (presetId) {
  try {
    preset = JSON.parse(fs.readFileSync(`presets/${presetId}.json`, "utf8"));
  } catch {
    console.error(`✕ preset "${presetId}" not found at presets/${presetId}.json`);
    process.exit(1);
  }
}

if (preset) console.log(`  preset: ${preset.id} (motion=${preset.dials.motion} density=${preset.density} variance=${preset.density})`);

const { failures, warnings } = lint(plan, transcript, familyTokens, preset);

// All rules always run unconditionally — print the same "checked" ledger the
// pre-refactor script did, independent of lint()'s pure {failures, warnings} return.
for (const ruleId of Object.keys(RULE_NAMES)) {
  console.log(`  · ${ruleId} ${RULE_NAMES[ruleId]} checked`);
}

for (const w of warnings) {
  console.log(`  ⚠ ${w.ruleId} ${RULE_NAMES[w.ruleId]}: ${w.message}`);
}

if (failures.length) {
  console.error(`\n✕ LINT FAILED (${failures.length}):`);
  for (const f of failures) {
    const hint = f.fixHint ? ` (fix: ${f.fixHint})` : "";
    console.error(`  ✕ ${f.ruleId} ${RULE_NAMES[f.ruleId]}: ${f.message}${hint}`);
  }
  // Print keyword-scan advisory even on lint failure — it's informational, not blocking.
  if (!noKeywordScan) {
    try {
      const registry = loadRegistry();
      const findings = scanKeywords(plan, transcript, registry, DEFAULT_WINDOW_MS);
      if (findings.length > 0) {
        console.log("\n  keyword-scan (advisory, non-blocking):");
        for (const f of findings) {
          const where = f.covered
            ? `already covered by scene "${f.coveringSceneId}"`
            : "no nearby scene found — consider adding one";
          console.log(`    · "${f.matchedText}" @ ${f.wordMs}ms → ${f.component} (${f.category}) — ${where}`);
        }
      }
    } catch {
      // Registry missing or scan failed — advisory only, never blocks.
    }
  }
  process.exit(1);
}

// Lint passed — print keyword-scan advisory section (separate from R1–R16 output, per
// director/05-animation-keywords.md's wiring spec: "clearly-labeled, visually distinct
// from the R1–R14 rule output above it, so it reads as a separate advisory layer").
// This section never affects the exit code.
if (!noKeywordScan) {
  try {
    const registry = loadRegistry();
    const findings = scanKeywords(plan, transcript, registry, DEFAULT_WINDOW_MS);
    if (findings.length > 0) {
      console.log("\n  keyword-scan (advisory, non-blocking):");
      for (const f of findings) {
        const where = f.covered
          ? `already covered by scene "${f.coveringSceneId}"`
          : "no nearby scene found — consider adding one";
        console.log(`    · "${f.matchedText}" @ ${f.wordMs}ms → ${f.component} (${f.category}) — ${where}`);
      }
    }
  } catch {
    // Registry missing or scan failed — advisory only, never blocks.
  }
}

console.log(`\n✓ lint passed — ${plan.scenes.length} scenes, ${(plan.durationMs / 1000).toFixed(1)}s`);