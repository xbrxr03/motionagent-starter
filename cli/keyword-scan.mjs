#!/usr/bin/env node
// keyword-scan.mjs — deterministic advisory scanner: does this plan's transcript say
// something a registered reusable animation/scene component was built for, and if so, is
// there already a scene/overlay using that component nearby on the timeline?
//
// WHY THIS EXISTS (see director/05-animation-keywords.md for the full workflow doc). This
// product has no live "Director" runtime that auto-generates plans end-to-end — plans are
// hand-authored JSON (demo/plan-*.json) written by an agent following director/** skill
// docs, then checked by cli/lint.mjs. So "automatic" here means automatic DETECTION +
// SUGGESTION, not silent auto-insertion: an unreviewed generic scene substituted for a
// real fidelity match would itself be exactly the kind of un-asked-for placeholder
// packs/STATUS.md's fidelity bar forbids. This tool's whole job is to hand whoever is
// authoring/reviewing a plan a fact ("your transcript says X at word timestamp Yms —
// PhoneRingScene exists for that, no matching scene found nearby") and let a human/agent
// decide whether/how to act on it.
//
// DETERMINISM: pure string/JSON matching only, no LLM calls, no network, no wall-clock —
// same input always produces the same findings, so this is cheap enough to run for every
// plan in cli/lint-all.mjs once it's wired in (AGENTS.md non-negotiable: no Math.random/
// Date.now/wall-clock in anything that runs as part of the quality gate).
//
// The core matching logic (scanKeywords, buildWords, findPhraseMatches, etc.) lives in
// lint/keyword-scan-core.mjs — a zero-dependency pure module that both this CLI wrapper
// and lint/lint.mjs's R17 rule import. This split breaks the ESM circular dependency
// (lint.mjs ← render-core.mjs ← keyword-scan.mjs would create a cycle if lint.mjs
// imported from keyword-scan.mjs directly; the core module has no render-core import).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTranscriptPath, readJson } from "./render-core.mjs";
import { scanKeywords, normalizeToken, keywordTokens, findPhraseMatches, findCoveringScene, buildWords, DEFAULT_WINDOW_MS } from "../lint/keyword-scan-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export { scanKeywords, buildWords, findPhraseMatches, findCoveringScene, normalizeToken, keywordTokens, DEFAULT_WINDOW_MS };

export const DEFAULT_REGISTRY_PATH = path.join(REPO_ROOT, "engine", "animation-keywords.json");

// loadRegistry reads the JSON registry from disk — I/O, so it stays in this CLI wrapper
// (not in the pure core module) matching this repo's lint/lint.mjs (pure) + cli/lint.mjs
// (thin CLI) split.
export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

function formatFinding(f) {
  const where = f.covered
    ? `already covered by scene "${f.coveringSceneId}"`
    : "no nearby scene found — consider adding one";
  return `  · "${f.matchedText}" @ ${f.wordMs}ms → ${f.component} (${f.category}) — ${where}`;
}

function main() {
  const rawArgs = process.argv.slice(2);
  let windowMs = DEFAULT_WINDOW_MS;
  let registryPath = DEFAULT_REGISTRY_PATH;
  let json = false;
  const positional = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--window") {
      windowMs = Number(rawArgs[++i]);
    } else if (rawArgs[i] === "--registry") {
      registryPath = path.resolve(process.cwd(), rawArgs[++i]);
    } else if (rawArgs[i] === "--json") {
      json = true;
    } else {
      positional.push(rawArgs[i]);
    }
  }

  const planPath = positional[0] ?? "demo/plan.json";
  const plan = readJson(planPath);
  const transcriptPath = positional[1] ?? resolveTranscriptPath(plan, planPath);
  const transcript = readJson(transcriptPath);
  const registry = loadRegistry(registryPath);

  const findings = scanKeywords(plan, transcript, registry, windowMs);

  if (json) {
    console.log(JSON.stringify({ planPath, transcriptPath, windowMs, findings }, null, 2));
    return;
  }

  console.log(`  plan: ${planPath}  (transcript: ${transcriptPath})`);
  console.log(`  registry: ${path.relative(REPO_ROOT, registryPath)} (${registry.length} entries)  window: ±${windowMs}ms`);

  if (findings.length === 0) {
    console.log("\n  (no keyword matches found in this transcript)");
    return;
  }

  const uncovered = findings.filter((f) => !f.covered).length;
  console.log(`\n  keyword-scan findings (${findings.length}):`);
  for (const f of findings) console.log(formatFinding(f));
  console.log(
    `\n  ${findings.length} finding(s), ${findings.length - uncovered} already covered, ${uncovered} uncovered — advisory only, not wired into lint yet`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}