#!/usr/bin/env node
// style-matrix.mjs — run one plan across the customer pack style matrix.
//
// Default mode is lint-only. Render mode shells through `motionagent render --preset=<id>`
// so it uses the same DynamicPlanReel style-override path as normal buyer renders.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lint } from "../lint/lint.mjs";
import { loadFamilyTokens, readJson, resolveTranscriptPath } from "./render-core.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS_DIR = path.join(REPO_ROOT, "presets");
const PACKS_DIR = path.join(REPO_ROOT, "packs");
const MOTIONAGENT = path.join(REPO_ROOT, "cli", "motionagent.mjs");
const DEFAULT_PACKS = [
  "ui-mate",
  "talking-head",
];

function usage() {
  console.log(`Usage: node cli/style-matrix.mjs <plan.json> [--mode=lint|render] [--packs=a,b,c] [--platform=ig|tiktok] [--force]

Runs one plan through the shipped pack presets (UI Mate, Talking Head). Lint mode checks
whether the same plan is structurally valid under each pack's dials/tokens. Render mode
writes one preset-suffixed MP4 per pack through motionagent render.`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = { mode: "lint", platform: "ig", force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { planPath: positional[0], flags };
}

function die(message) {
  console.error(`✕ ${message}`);
  process.exit(1);
}

function loadPreset(id) {
  const presetPath = path.join(PRESETS_DIR, `${id}.json`);
  if (!fs.existsSync(presetPath)) die(`preset not found: ${id}`);
  return JSON.parse(fs.readFileSync(presetPath, "utf8"));
}

function validatePackIds(ids) {
  for (const id of ids) {
    if (!fs.existsSync(path.join(PACKS_DIR, id, "pack.json"))) die(`pack not found: ${id}`);
    if (!fs.existsSync(path.join(PRESETS_DIR, `${id}.json`))) die(`preset not found for pack: ${id}`);
  }
}

function lintMatrix(planPath, packIds) {
  const plan = readJson(planPath, REPO_ROOT);
  const transcriptPath = resolveTranscriptPath(plan, planPath);
  const transcript = readJson(transcriptPath, REPO_ROOT);
  const rows = [];
  let failed = 0;

  for (const packId of packIds) {
    const preset = loadPreset(packId);
    const family = preset.family ?? plan.meta?.family ?? "signal";
    const styledPlan = {
      ...plan,
      meta: {
        ...(plan.meta ?? {}),
        preset: packId,
        family,
      },
    };
    const familyTokens = loadFamilyTokens(family);
    const { failures, warnings } = lint(styledPlan, transcript, familyTokens, preset);
    if (failures.length) failed++;
    rows.push({ packId, family, failures: failures.length, warnings: warnings.length, first: failures[0]?.message ?? "" });
  }

  console.log(`Style matrix lint: ${path.relative(REPO_ROOT, path.resolve(planPath))}`);
  console.log(`Transcript: ${transcriptPath}`);
  for (const row of rows) {
    const status = row.failures ? "✕" : "✓";
    const detail = row.failures ? ` — ${row.first}` : "";
    console.log(
      `  ${status} ${row.packId.padEnd(17)} family=${row.family.padEnd(18)} failures=${row.failures} warnings=${row.warnings}${detail}`,
    );
  }

  if (failed) {
    console.error(`\n✕ style matrix failed for ${failed}/${packIds.length} pack(s)`);
    process.exit(1);
  }
  console.log(`\n✓ style matrix passed for ${packIds.length}/${packIds.length} pack(s)`);
}

function renderMatrix(planPath, packIds, { platform, force }) {
  for (const packId of packIds) {
    const args = [MOTIONAGENT, "render", planPath, "--preset", packId, "--platform", platform];
    if (force) args.push("--force");
    console.log(`\n━━━ render ${packId} ━━━`);
    execFileSync(process.execPath, args, { cwd: REPO_ROOT, stdio: "inherit" });
  }
}

function main() {
  const { planPath, flags } = parseArgs(process.argv.slice(2));
  if (!planPath) {
    usage();
    process.exit(1);
  }
  const resolved = path.resolve(planPath);
  if (!fs.existsSync(resolved)) die(`plan not found: ${resolved}`);

  const mode = flags.mode;
  if (!["lint", "render"].includes(mode)) die("--mode must be lint or render");
  const packIds = flags.packs ? String(flags.packs).split(",").filter(Boolean) : DEFAULT_PACKS;
  validatePackIds(packIds);

  if (mode === "lint") {
    lintMatrix(resolved, packIds);
  } else {
    renderMatrix(resolved, packIds, { platform: flags.platform, force: Boolean(flags.force) });
  }
}

main();
