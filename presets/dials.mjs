// PRESET DIALS — the single mapping table from a preset's {motion,density,variance}
// (each 1-10, ARCHITECTURE.md §7's "taste-skill model") to the concrete lint thresholds
// R2/R3/R6/R7 actually check against. This is the piece that was missing: lint() has
// accepted a `preset` parameter since the Phase 0 refactor, but every caller (cli/lint.mjs,
// mcp/server.mjs) always passed undefined, and the parameter itself was a `void preset;`
// no-op — see lint/lint.mjs's own JSDoc, which said as much honestly rather than pretending
// presets were wired.
//
// Plain .mjs, not .ts: every real consumer (lint/lint.mjs, cli/lint.mjs, mcp/server.mjs) is
// plain Node with no bundler/type-stripping flag — same "plain JS can't import .ts" reason
// lint.mjs already duplicates ICON_NAMES/SAFE_W_PX/etc. rather than importing their .tsx
// source. Nothing here needs Zod or the engine/tokens bundle, so there's no TypeScript
// upside to importing from a .ts file and then having to duplicate this logic anyway —
// this file just IS the canonical, runtime-importable version.
//
// WHY discrete lookup tables, not a continuous formula: a formula invites an off-by-one
// mismatch between "no preset" and "the balanced preset" — the whole point of this file is
// that BALANCED_DIALS resolves to exactly today's hardcoded literals (hookMaxMs 4000,
// maxGapMs 4000, dwellCharsPerSec 17, maxAlertScenes 2, payoffStartPct 0.8,
// minComponentVariety 4), so shipping this doesn't silently change behavior for any plan
// that doesn't opt into a preset. A lookup table makes that guarantee visible by inspection
// (dial 6/6/5 -> the literal old numbers) rather than trusting a formula to land exactly
// on them.
//
// Dial semantics:
//   motion   (pacing/energy) -> hookMaxMs, maxGapMs. Higher = faster, less patient, tighter
//            caps. Drives R2.
//   density  (content-per-second) -> dwellCharsPerSec. Higher = the gate assumes a FASTER
//            reading speed, so it accepts MORE text in the same visible window (a
//            deliberately dense, information-heavy reel). Lower = slower assumed reading
//            speed, forcing roomier/more patient pacing. Drives R3.
//   variance (heterogeneity/drama) -> maxAlertScenes, payoffStartPct, minComponentVariety.
//            Higher = more "slam" beats allowed, payoff can land earlier, more distinct
//            component types required (reads as more varied/dramatic). Lower = more
//            restrained, disciplined, payoff held later. Drives R6 and R7.
//
// NOT wired here (honest scoping, not fabricated): ARCHITECTURE.md §7 also describes
// `sceneMinMs`/`sceneMaxMs` as part of the beat envelope — there is no existing lint rule
// enforcing a generic per-scene min/max duration (R2 only caps the hook specifically and
// checks inter-event gaps), so there is nothing here for a preset to tune yet. Adding that
// rule is future scope, not silently assumed to exist.

/** @typedef {1|2|3|4|5|6|7|8|9|10} DialValue */
/** @typedef {{motion: DialValue, density: DialValue, variance: DialValue}} Dials */
/** @typedef {{hookMaxMs: number, maxGapMs: number, dwellCharsPerSec: number, maxAlertScenes: number, payoffStartPct: number, minComponentVariety: number}} ResolvedThresholds */

// motion 1 (patient) -> 10 (frantic). motion=6 -> 4000, today's hardcoded R2 literal.
const MOTION_MS = {
  1: 6000, 2: 5600, 3: 5200, 4: 4800, 5: 4400,
  6: 4000, 7: 3600, 8: 3200, 9: 2800, 10: 2400,
};

// density 1 (sparse, slow assumed reading speed) -> 10 (dense, fast assumed reading
// speed). density=6 -> 17 chars/sec, today's hardcoded R3 literal.
const DENSITY_CHARS_PER_SEC = {
  1: 12, 2: 13, 3: 14, 4: 15, 5: 16,
  6: 17, 7: 18, 8: 19, 9: 20, 10: 22,
};

// variance 1 (restrained/disciplined) -> 10 (maximally varied/dramatic). variance=5 ->
// maxAlertScenes 2, payoffStartPct 0.80, minComponentVariety 4 — all 3 of today's
// hardcoded R6/R7 literals, from the same dial value.
const VARIANCE_MAX_ALERT = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4 };
const VARIANCE_PAYOFF_START_PCT = {
  1: 0.85, 2: 0.83, 3: 0.82, 4: 0.81, 5: 0.8,
  6: 0.79, 7: 0.77, 8: 0.75, 9: 0.7, 10: 0.65,
};
const VARIANCE_MIN_COMPONENT_VARIETY = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5, 9: 6, 10: 6 };

// The preset whose dials resolve to exactly today's pre-preset-system hardcoded lint
// literals — used as the fallback when a plan names no preset, and as the "balanced"
// shipped preset (presets/balanced.json). Existing behavior for every plan that doesn't
// opt into a different preset is byte-for-byte unchanged.
export const BALANCED_DIALS = { motion: 6, density: 6, variance: 5 };

/** @param {Dials} dials @returns {ResolvedThresholds} */
export function resolveDials(dials) {
  return {
    hookMaxMs: MOTION_MS[dials.motion],
    maxGapMs: MOTION_MS[dials.motion],
    dwellCharsPerSec: DENSITY_CHARS_PER_SEC[dials.density],
    maxAlertScenes: VARIANCE_MAX_ALERT[dials.variance],
    payoffStartPct: VARIANCE_PAYOFF_START_PCT[dials.variance],
    minComponentVariety: VARIANCE_MIN_COMPONENT_VARIETY[dials.variance],
  };
}

// The exact thresholds lint/lint.mjs hardcoded before this file existed — every rule body
// falls back to these when no preset is supplied, so "no preset" and "the balanced preset"
// are identical by construction (resolveDials(BALANCED_DIALS) equals this literally).
export const DEFAULT_THRESHOLDS = resolveDials(BALANCED_DIALS);
