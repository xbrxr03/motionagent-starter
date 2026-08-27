// visual-density.mjs — the "visualize every word" density contract.
//
// MotionAgent's premise is that anything sayable that can be shown, IS shown. A reel that
// technically lints clean can still play as a slideshow: long stretches where the VO keeps
// talking and nothing on screen changes. This module defines, measures, and enforces the
// density floor that prevents that.
//
// TWO INDEPENDENT CONTRACTS
//
//   1. VISUAL BEATS — a distinct visual moment (a scene entrance, a card/metric/step
//      reveal, a stat flip, a chip landing). Default contract: one every 2000ms.
//   2. ASSET BEATS — a beat that puts a real ASSET on screen (a generated object PNG, a
//      supplied screenshot/clip, a media-slot fill), as opposed to pure type/shape motion.
//      Default contract: one every 3000ms, and only for packs that declare an
//      assetIntervalMs (a pure-typography pack has no business faking asset beats).
//
// Each contract is checked TWO ways, because they fail differently:
//
//   COUNT floor  — total beats >= ceil(durationMs / intervalMs) + 1.
//                  (20s at 2000ms => 10 + 1 = 11 visual beats; 30s at 3000ms => 11 assets.)
//   GAP  ceiling — no interval anywhere on the timeline longer than intervalMs.
//
// The GAP check is the one that actually bites, and it is the whole point. Measured across
// the repo's 104 plans when this module was written: 88/92 passed a naive count floor, but
// only 7/104 also held the 2s gap ceiling. A plan can hit its total by front-loading beats
// into a dense opener and then coasting — the count says "fine", the viewer sees dead air.
// Abrar's Day 7 talking-head reel is the canonical example: 63 beats against a floor of 49
// (count comfortably passed) with a 3.7s hole at 52.2s, which is exactly the stretch that
// read as "not enough relevance to the audio".
//
// WHY CAPTION WORDS DO NOT COUNT AS VISUAL BEATS
//
// lint.mjs's sceneEvents() deliberately mines every KaraokeCaption word onset as an R2
// pacing event — correct for R2, whose question is "is SOMETHING moving". It is wrong here.
// A karaoke caption highlighting successive words is the audio being transcribed on screen,
// not the audio being VISUALIZED, and counting it makes the metric self-satisfying: the
// talking-head plans scored the corpus's highest raw density (4.01 events/sec) while being
// the ones that actually looked sparse. Caption components therefore contribute their scene
// entrance and nothing else. This single exclusion is what makes the number mean what a
// viewer would say it means.

import { sceneEvents } from "./lint.mjs";

/** Components whose per-word/per-line beats are transcription, not visualization. There are
 *  THREE separate caption implementations in this repo — KaraokeCaption, CaptionOverlay
 *  (every fly-motion/ui-mate plan), and TalkingHeadCaption (every talking-head plan) — each
 *  its own component name, so listing fewer than all three left that one's word-onsets
 *  counting as real visual beats. Enumerated exhaustively this time by scanning every
 *  plan's overlays[] for every distinct component name actually in use, rather than
 *  guessing from memory (which is exactly how CaptionOverlay got missed originally, and
 *  then how TalkingHeadCaption almost got missed too — a manual transcript audit of
 *  ui-mate caught the first gap, but this list should be re-verified against
 *  `overlays[].component` across demo/*.json if a new pack/caption variant is ever added). */
export const CAPTION_COMPONENTS = new Set(["KaraokeCaption", "CaptionOverlay", "TalkingHeadCaption"]);

/** Props that, when present on a scene, mean that scene puts a real asset on screen. */
const ASSET_PROPS = ["assetId", "imageSrc", "logoSrc", "iconSrc"];

export const DEFAULT_DENSITY = {
  beatIntervalMs: 2000,
  assetIntervalMs: null, // null => pack does not carry an asset contract
};

/** Resolve a pack's density contract from its preset, falling back to the defaults. */
export function resolveDensity(preset) {
  const d = preset?.visualDensity ?? {};
  return {
    beatIntervalMs: typeof d.beatIntervalMs === "number" ? d.beatIntervalMs : DEFAULT_DENSITY.beatIntervalMs,
    assetIntervalMs: typeof d.assetIntervalMs === "number" ? d.assetIntervalMs : DEFAULT_DENSITY.assetIntervalMs,
  };
}

/** The count floor for a duration: "a 20s video needs at least 10 (+1) visuals". */
export const floorFor = (durationMs, intervalMs) => Math.ceil(durationMs / intervalMs) + 1;

/**
 * Every visual beat in a plan, deduped and sorted. Caption components contribute only their
 * scene entrance (see header). Overlays are mined identically to scenes — an overlay beat is
 * a real on-screen change, and is what legitimately carries a long, slow-cut scene.
 */
export function visualBeats(plan) {
  const fps = typeof plan.fps === "number" ? plan.fps : 30;
  const out = [];
  for (const s of [...(plan.scenes ?? []), ...(plan.overlays ?? [])]) {
    if (CAPTION_COMPONENTS.has(s.component)) out.push(s.startMs);
    else out.push(...sceneEvents(s, fps));
  }
  return [...new Set(out.filter((n) => typeof n === "number" && Number.isFinite(n)))].sort((a, b) => a - b);
}

/**
 * Beats that put a real asset on screen. A scene qualifies if it names a generated asset,
 * an image/logo/icon source, a sourceClip with a src, or a mediaSlotId resolving to a slot
 * that actually HAS a src (an unfilled customer drop-zone is a promise, not an asset — it
 * renders as a placeholder box, so counting it would let an empty plan claim asset density).
 *
 * A qualifying scene contributes its own beats (entrance + internal reveals), so a single
 * long asset scene with staggered reveals can legitimately carry its own span.
 */
export function assetBeats(plan) {
  const fps = typeof plan.fps === "number" ? plan.fps : 30;
  const filledSlots = new Set(
    (plan.mediaSlots ?? []).filter((m) => typeof m?.src === "string" && m.src.length > 0).map((m) => m.id),
  );

  // A scene almost never carries its clip inline. PlanReel.tsx resolves it at render time
  // through one of two indirections (see its resolveSceneProps): `sourceClipId` -> the
  // plan's sourceClips[], or `editDecisionId` -> editDecisions[] -> that decision's
  // sourceClip -> sourceClips[]. Resolving the same way here is mandatory, not a nicety:
  // checking only inline props reported Abrar's Day 7 talking-head reel as having ZERO
  // assets across 94s when in fact all 13 of its scenes render his real camera clip via
  // editDecisionId. The metric has to model what actually reaches the screen.
  const clipsById = new Map((plan.sourceClips ?? []).map((c) => [c.id, c]));
  const clipHasSrc = (id) => typeof clipsById.get(id)?.src === "string" && clipsById.get(id).src.length > 0;
  const decisionResolvesClip = new Map(
    (plan.editDecisions ?? []).map((d) => [d.id, typeof d?.sourceClip === "string" && clipHasSrc(d.sourceClip)]),
  );

  const out = [];
  for (const s of [...(plan.scenes ?? []), ...(plan.overlays ?? [])]) {
    const p = s.props ?? {};
    const hasAssetProp = ASSET_PROPS.some((k) => typeof p[k] === "string" && p[k].length > 0);
    const hasFilledSlot = typeof p.mediaSlotId === "string" && filledSlots.has(p.mediaSlotId);
    const hasInlineClip = typeof p.sourceClip?.src === "string" || typeof p.media?.src === "string";
    const hasRefClip = typeof p.sourceClipId === "string" && clipHasSrc(p.sourceClipId);
    const hasDecisionClip = typeof p.editDecisionId === "string" && decisionResolvesClip.get(p.editDecisionId) === true;
    if (!hasAssetProp && !hasFilledSlot && !hasInlineClip && !hasRefClip && !hasDecisionClip) continue;
    if (CAPTION_COMPONENTS.has(s.component)) out.push(s.startMs);
    else out.push(...sceneEvents(s, fps));
  }
  return [...new Set(out.filter((n) => typeof n === "number" && Number.isFinite(n)))].sort((a, b) => a - b);
}

/**
 * Largest uncovered span, treating 0 and durationMs as hard bookends — a reel that opens or
 * ends on dead air is exactly as broken as one that stalls in the middle, and only bookending
 * catches those two cases.
 */
export function gaps(beats, durationMs, ceilingMs) {
  const pts = [0, ...beats.filter((b) => b > 0 && b < durationMs), durationMs];
  const over = [];
  let worst = { ms: 0, fromMs: 0, toMs: 0 };
  for (let i = 1; i < pts.length; i++) {
    const ms = pts[i] - pts[i - 1];
    const span = { ms, fromMs: pts[i - 1], toMs: pts[i] };
    if (ms > worst.ms) worst = span;
    if (ms > ceilingMs) over.push(span);
  }
  return { worst, over };
}

/** Full density report for one plan against one pack's contract. */
export function analyzeDensity(plan, preset) {
  const { beatIntervalMs, assetIntervalMs } = resolveDensity(preset);
  const durationMs = plan.durationMs ?? 0;

  const beats = visualBeats(plan);
  const beatFloor = floorFor(durationMs, beatIntervalMs);
  const beatGaps = gaps(beats, durationMs, beatIntervalMs);

  const visual = {
    intervalMs: beatIntervalMs,
    count: beats.length,
    floor: beatFloor,
    countOk: beats.length >= beatFloor,
    gapsOver: beatGaps.over,
    worstGap: beatGaps.worst,
    gapOk: beatGaps.over.length === 0,
    perSec: durationMs ? +(beats.length / (durationMs / 1000)).toFixed(2) : 0,
  };

  let asset = null;
  if (assetIntervalMs) {
    const ab = assetBeats(plan);
    const aFloor = floorFor(durationMs, assetIntervalMs);
    const aGaps = gaps(ab, durationMs, assetIntervalMs);
    asset = {
      intervalMs: assetIntervalMs,
      count: ab.length,
      floor: aFloor,
      countOk: ab.length >= aFloor,
      gapsOver: aGaps.over,
      worstGap: aGaps.worst,
      gapOk: aGaps.over.length === 0,
    };
  }

  return {
    durationMs,
    visual,
    asset,
    ok: visual.countOk && visual.gapOk && (!asset || (asset.countOk && asset.gapOk)),
  };
}
