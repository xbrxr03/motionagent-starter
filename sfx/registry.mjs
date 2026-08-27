// sfx/registry.mjs — the shared SFX cue resolver (event-name indirection layer).
//
// Source of truth is sfx/sfx-registry.json (a small committed lookup, mirroring how
// tokens/ keeps compiled family DATA as plain JSON that a bundler-free `node` process can
// read). This module is the render-pipeline's read side: cli/render-core.mjs imports it to
// turn a plan's sfxCues[] into the `path:atMs,...` string cli/audio-master.mjs already
// consumes. schema/plan.ts validates the SAME registry independently (it imports the JSON
// directly for its Zod refinement), so the two never drift: both key off cues in this file.
//
// DEFAULT OFF: nothing here runs unless a plan sets meta.sfxEnabled=true AND carries a
// non-empty sfxCues[]. render-core only calls resolvePlanSfxCues() behind that guard, so a
// plan without the flag produces the exact same audio-master invocation as before SFX
// existed (byte-identical output — see cli/render-core.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SFX_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SFX_DIR, "..");
export const REGISTRY_PATH = path.join(SFX_DIR, "sfx-registry.json");

let cache = null;

/** Parsed registry object ({version, note, cues}). Cached (the file is immutable data). */
export function loadRegistry() {
  if (!cache) cache = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  return cache;
}

/** All registered cue names (the valid `sfxCues[].cue` vocabulary). */
export function listCueNames() {
  return Object.keys(loadRegistry().cues);
}

/**
 * Resolve a cue name to an ABSOLUTE audio-file path, verifying both that the cue exists in
 * the registry and that its backing asset is present on disk. Throws a clear, actionable
 * error otherwise (this is the render-time "cue must exist in registry" gate).
 */
export function resolveCueFile(cue) {
  const { cues } = loadRegistry();
  const entry = cues[cue];
  if (!entry) {
    throw new Error(
      `unknown sfx cue "${cue}" — not in sfx/sfx-registry.json. Valid cues: ${listCueNames().join(", ")}`,
    );
  }
  const abs = path.isAbsolute(entry.file) ? entry.file : path.join(REPO_ROOT, entry.file);
  if (!fs.existsSync(abs)) {
    throw new Error(`sfx cue "${cue}" -> asset missing on disk: ${abs} (re-run sfx/fetch-kenney.sh?)`);
  }
  return abs;
}

/**
 * Validate + resolve a plan's sfxCues[] into a list of {id, cue, atMs, file(abs)}.
 * Enforces the two basic rules (no COMPONENT_MANIFEST needed, so this stays out of
 * lint/lint.mjs — schema/plan.ts's Zod refinement enforces the same two independently):
 *   1. every cue exists in the registry (via resolveCueFile)
 *   2. every atMs is a finite number within [0, plan.durationMs]
 * Throws on the first violation. Returns [] when SFX is not enabled or no cues are present,
 * so callers can treat "off" as a no-op.
 */
export function resolvePlanSfxCues(plan) {
  if (!plan || plan.meta?.sfxEnabled !== true) return [];
  const cues = Array.isArray(plan.sfxCues) ? plan.sfxCues : [];
  if (cues.length === 0) return [];
  const durationMs = Number(plan.durationMs);
  return cues.map((c, i) => {
    const where = `sfxCues[${i}]${c?.id ? ` (id="${c.id}")` : ""}`;
    if (!c || typeof c.cue !== "string") {
      throw new Error(`${where}: missing string "cue"`);
    }
    const atMs = Number(c.atMs);
    if (!Number.isFinite(atMs) || atMs < 0 || (Number.isFinite(durationMs) && atMs > durationMs)) {
      throw new Error(
        `${where}: atMs=${c.atMs} out of range [0, ${Number.isFinite(durationMs) ? durationMs : "durationMs"}]`,
      );
    }
    const file = resolveCueFile(c.cue); // throws if the cue isn't registered
    return { id: c.id, cue: c.cue, atMs, file };
  });
}

/**
 * Build the `--sfx "path:atMs,path:atMs,..."` argument string cli/audio-master.mjs expects
 * from a plan's sfxCues[]. Returns "" when SFX is off / empty (caller then passes nothing,
 * preserving byte-identical behavior). Absolute macOS paths carry no ':' so audio-master's
 * lastIndexOf(":") atMs-split stays unambiguous.
 */
export function planSfxToArg(plan) {
  return resolvePlanSfxCues(plan)
    .map((c) => `${c.file}:${Math.round(c.atMs)}`)
    .join(",");
}
