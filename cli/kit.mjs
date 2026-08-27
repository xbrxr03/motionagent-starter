#!/usr/bin/env node
// cli/kit.mjs — shared CLI plumbing used by every script under cli/ (and mcp/server.mjs).
// Extracted from 9 near-identical switch-loop arg parsers + 5 near-identical subprocess
// `run()` wrappers + a handful of copy-pasted readJson/writeJson pairs (reviewed findings,
// 2026-07). Nothing in here changes any script's CLI surface: flag names, required-arg
// semantics, and output/summary text are all preserved exactly at each call site — this
// module only centralizes the boilerplate around them.
//
// One deliberate, documented behavior UNIFICATION: before this file existed, some scripts
// threw a bare `Error` on an unknown flag or a missing required flag (render-final.mjs,
// audio-master.mjs, generate-variants.mjs — caught by a top-level `main().catch` and
// printed as "ERROR: <message>"), while others `console.error`'d a usage block and called
// `process.exit(1)` directly (ingest.mjs, ingest-url.mjs, ingest-pdf.mjs, tts.mjs,
// hf-render.mjs). Both were already "print something to stderr, exit 1" in practice —
// parseArgs() below unifies on the print-usage+exit(1) form for both cases. No script's
// SUCCESSFUL behavior (valid flags, valid required args) changes at all.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// paths / JSON
// ---------------------------------------------------------------------------

// Caller-supplied paths resolve against the caller's cwd — the convention every script in
// this repo already used ad hoc (cli/render-core.mjs, mcp/server.mjs, cli/lint.mjs, ...).
export const resolveCallerPath = (p, cwd = process.cwd()) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));

export function readJson(p, cwd = process.cwd()) {
  const resolved = resolveCallerPath(p, cwd);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (e) {
    // Name the file — several callers read more than one JSON file per run (plan +
    // transcript, content + families, ...), and a bare "Unexpected token"/ENOENT gives no
    // way to tell which one is broken.
    throw new Error(`failed to read JSON at ${resolved}: ${e.message}`, { cause: e });
  }
}

// 2-space indent + trailing newline — the shape every hand-rolled writeJson in this repo
// already used (mcp/server.mjs, generate-variants.mjs, ingest-brief.mjs, font3d.mjs, ...).
// Creates the parent directory if needed. Returns the resolved absolute path.
export function writeJson(p, data, cwd = process.cwd()) {
  const full = resolveCallerPath(p, cwd);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
  return full;
}

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

// "debug-duck" -> "debugDuck". Every flag in this repo's scripts already follows this
// hyphen-case-CLI-flag / camelCase-dest convention, so no per-script alias table is needed.
function toCamel(name) {
  return name.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

// parseArgs(argv, spec) — a single shared switch-loop replacement.
//
// spec:
//   string:         flag names (no "--"), e.g. ["audio", "slug", "model"] — consumes the
//                    next argv element as the value, dest = camelCase(name).
//   boolean:        flag names that take no value and set dest = true.
//   negatedBoolean: flag names whose CLI form is "--no-<name>" and set dest = false
//                    (dest defaults to true unless overridden via `defaults`) — mirrors
//                    ingest-url.mjs's original --no-capture.
//   required:       dest names (camelCase) that must be present after parsing, else this
//                    prints `usage` and exits 1. Skip this and validate manually for
//                    conditionally-required flags (e.g. tts.mjs's --list-voices short-
//                    circuits its own required-arg check).
//   defaults:       initial values merged in before parsing (dest name -> value).
//   usage:          usage text printed to stderr on any parse failure.
//
// On success returns the parsed { ...dest: value } object. Never throws — unknown flags
// and missing required flags both print `usage` (if given) and call process.exit(1), same
// as every script's original usageAndExit()/throw did at the point of failure.
export function parseArgs(argv, spec = {}) {
  const { string = [], boolean = [], negatedBoolean = [], required = [], defaults = {}, usage = "" } = spec;

  const args = { ...defaults };
  const stringFlags = new Map(string.map((name) => [`--${name}`, toCamel(name)]));
  const booleanFlags = new Map(boolean.map((name) => [`--${name}`, toCamel(name)]));
  const negatedFlags = new Map(negatedBoolean.map((name) => [`--no-${name}`, toCamel(name)]));

  const fail = (message) => {
    if (message) console.error(`✕ ${message}`);
    if (usage) console.error(usage);
    process.exit(1);
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (stringFlags.has(a)) {
      args[stringFlags.get(a)] = argv[++i];
    } else if (booleanFlags.has(a)) {
      args[booleanFlags.get(a)] = true;
    } else if (negatedFlags.has(a)) {
      args[negatedFlags.get(a)] = false;
    } else {
      fail(`unknown argument: ${a}`);
    }
  }

  for (const dest of required) {
    if (args[dest] === undefined) fail(); // usage block alone names what's required
  }

  return args;
}

// ---------------------------------------------------------------------------
// subprocess running
// ---------------------------------------------------------------------------

// run(cmd, args, opts) — synchronous subprocess wrapper. NEVER throws and NEVER exits the
// process itself; it always returns { ok, stdout, stderr, status }, so every caller decides
// for itself whether a failure is fatal (most CLI scripts: print + exit 1) or tolerable
// (ingest-url.mjs's screenshot step: log a warning, keep going).
//
// opts.label names the command in nothing this function prints itself (kept for callers'
// own error text, matching each script's original wording); opts.onLog(line), if given, is
// called once with the invoked command line before it runs (mirrors render-core.mjs's onLog
// convention, safe to use from mcp/server.mjs where inheriting stdio would corrupt the
// stdio JSON-RPC channel — this function always captures, never inherits).
export function run(cmd, args, opts = {}) {
  const { cwd = process.cwd(), onLog } = opts;
  if (onLog) onLog(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (result.error) {
    return { ok: false, stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: null, error: result.error };
  }
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

// runAsync(cmd, args, opts) — same contract as run(), for callers that need the
// non-blocking `spawn` form (cli/audio-master.mjs's ffmpeg calls, run concurrently with its
// own stdout/stderr accumulation). Resolves — never rejects — with { ok, stdout, stderr,
// status }, matching run()'s never-throws contract.
export function runAsync(cmd, args, opts = {}) {
  const { cwd = process.cwd(), onLog } = opts;
  if (onLog) onLog(`$ ${cmd} ${args.join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => resolve({ ok: false, stdout, stderr, status: null, error }));
    child.on("close", (status) => resolve({ ok: status === 0, stdout, stderr, status }));
  });
}
