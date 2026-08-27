// MotionAgent lint — deterministic quality gate on the scene plan. The exported `lint()`
// function is pure and does no I/O in its body: takes parsed JSON in, returns structured
// results out, same output for the same input every time. Used identically by the CLI
// (scripts/lint.mjs), the MCP `lint_plan` tool (mcp/server.mjs), and src/edit/edit.mjs's
// applyEdit() re-lint. The MODULE itself does one synchronous, one-time local read of a
// static, version-controlled data file at import time (FONT_METRICS below) — the same
// category of one-time-per-process cost as importing any other JS module, not a runtime
// I/O call inside lint()'s execution. See FONT_METRICS's own comment.
// Rules from SPEC.md: audio-lock, pacing, dwell time, line budgets, coverage, color
// discipline, entrance variety.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDials, DEFAULT_THRESHOLDS } from "../presets/dials.mjs";
import { scanKeywords, DEFAULT_WINDOW_MS as KEYWORD_WINDOW_MS } from "./keyword-scan-core.mjs";
import { analyzeDensity } from "./visual-density.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// R4 fit — real rendered pixel width, from the actual font files this product renders
// with (fonts/*.woff2 — the same assets @remotion/google-fonts fetches at render time,
// confirmed by URL/hash), precomputed into a plain-JSON glyph-advance-width artifact by
// scripts/compile-font-metrics.mjs (npm run compile:font-metrics). This mirrors
// compile-tokens.mjs's existing pattern: a devDependency (fontkit — Node-native, no
// browser/DOM) does the real font-parsing work ONCE, offline; lint.mjs only ever does
// array lookups + arithmetic against the resulting JSON, at both module-load and call
// time — no fontkit import here, no font-file I/O, no async, in the hot path.
//
// WHY this replaced the old character-count-only approach: true font-metric measurement
// via @remotion/layout-utils' measureText() only runs in a browser DOM and throws in
// plain Node, so a live-browser measurement was never an option for this headless lint
// (CLI, MCP tool, CI). But character count alone was proven wrong twice in independent
// dogfood passes (HARDENING.md, "R4 char-budgets... REPRODUCED A SECOND TIME"): legal-
// under-budget Headline lines visibly clipped their trailing letter at render, because
// different letters have very different advance widths at the same character count (a
// run of "W"s is far wider than a run of "i"s). Falls back to the LINE_BUDGETS character
// check below when pixel data isn't available for a role/font/weight (metrics artifact
// missing, or a future component role added before compile-font-metrics.mjs is re-run) —
// see the R4 rule body for exactly how the two combine.
// ---------------------------------------------------------------------------
let FONT_METRICS = {};
try {
  FONT_METRICS = JSON.parse(fs.readFileSync(path.join(__dirname, "../tokens/compiled/font-metrics.json"), "utf8"));
} catch {
  // Artifact missing (compile-font-metrics.mjs not yet run this checkout) — R4's pixel
  // check no-ops and the rule falls back entirely to the LINE_BUDGETS character check.
}

// ---------------------------------------------------------------------------
// R17 keyword suggestion — the animation-keywords registry loaded once at module
// import time, same pattern as FONT_METRICS above. If engine/animation-keywords.json
// is missing, R17 simply no-ops (the `if (KEYWORD_REGISTRY)` guard in the rule body
// skips it entirely rather than false-failing).
// ---------------------------------------------------------------------------
const KEYWORD_REGISTRY_PATH = path.join(__dirname, "../engine/animation-keywords.json");
let KEYWORD_REGISTRY = null;
try {
  KEYWORD_REGISTRY = JSON.parse(fs.readFileSync(KEYWORD_REGISTRY_PATH, "utf8"));
} catch {
  // Registry missing — R17 no-ops rather than false-failing.
}

// Mirrors src/tokens/platform.ts SAFE.w / FONT_FLOOR.display — duplicated (not imported)
// for the same reason as CAPTION_BAND_PX below: lint.mjs is plain JS run by plain `node`
// with no bundler/type-stripping flag, while platform.ts is TypeScript.
const SAFE_W_PX = 900;
const FONT_FLOOR_DISPLAY_PX = 96;

// Per-role actual render spec: which family font slot ("display" vs "mono"), the real
// fontSize actually used at render, and the real available width in px. Sizes are cross-
// checked against each component's own JSX (src/components/*.tsx), NOT assumed from the
// family type scale — several components override the token's nominal size inline (e.g.
// Payoff hardcodes 150px, WordCycle hardcodes 138px — both diverge from TYPE.display's
// 118px; FeatureCard/Listicle/Comparison/KenBurns/DeviceFrame/Terminal all override their
// TYPE.body/TYPE.mono/TYPE.kicker font-size too). `weight` below is a cross-checked
// DEFAULT, not a literal override: every one of these components spreads
// `...TYPE.<trackingRole>` with no fontWeight override (verified across every component's
// JSX — the ones that DO hardcode a numeric fontWeight, e.g. CountUp/PricingCard's ghost
// numerals, aren't roles this table checks), so the R4 rule body reads the ACTIVE family's
// real fontWeight for that role at call time and only falls back to this literal if
// familyTokens is somehow incomplete. maxWidthPx is derived from each component's real CSS
// layout (AbsoluteFill padding, column widths, icon+gap reservations) — see PROGRESS.md's
// dated entry for this rework for the per-role derivation math. trackingRole names which
// familyTokens.type[role].letterSpacing (and, per the above, fontWeight) to read (tracking
// differs slightly per family — e.g. kicker is 0.28em for signal/voltage/hearth but 0.3em
// for abrxr/redline).
// logoText is intentionally absent: LogoReveal auto-fits its own fontSize from text
// length, so it's handled specially in the R4 rule body, not via this static table.
const ROLE_RENDER = {
  // Headline.tsx renders each WORD as its own inline-block flex-item span, with a fixed
  // `gap:34` (px, hardcoded in Headline.tsx) between them — NOT a single continuous string
  // with the font's natural space-glyph advance. wordGapPx tells measureTextPx to split on
  // spaces and use this fixed gap instead of the space character's own (narrower) advance
  // width — confirmed the two differ meaningfully: Sora 700's space glyph is ~0.21em
  // (~24.8px at 118px) vs. the real 34px flex gap, a ~9px/gap underestimate if left as a
  // plain string sum. Headline.tsx was the ONLY role rendered this way until this port —
  // StatCard.tsx's label now does too (its own fixed-columnGap word cascade, see that
  // file); every other multi-word role (FeatureCard/Listicle titles, Terminal lines,
  // Comparison items, etc.) still renders its text as a single continuous string in one
  // span/div, where the natural space-glyph width is the correct model.
  displayLine: { fontRole: "display", weight: 700, fontSize: 118, trackingRole: "display", maxWidthPx: 880, wordGapPx: 34 },
  headline: { fontRole: "display", weight: 700, fontSize: 96, trackingRole: "headline", maxWidthPx: 880 },
  bullet: { fontRole: "display", weight: 500, fontSize: 52, trackingRole: "body", maxWidthPx: 826 },
  // Terminal lines reserve a 2-char mono prefix width ("→ "/"✓ ", kind "out"/"ok") even
  // though sceneTexts() doesn't currently mine `l.kind` to know per-line whether one
  // applies — a conservative universal reservation rather than a false pass on a cmd/note
  // line's true available width. Threading `kind` through sceneTexts()/R3/R4 would let
  // this tighten later.
  terminal: { fontRole: "mono", weight: 400, fontSize: 34, trackingRole: "mono", maxWidthPx: 771 },
  payoffWord: { fontRole: "display", weight: 700, fontSize: 150, trackingRole: "display", maxWidthPx: SAFE_W_PX },
  cycleWord: { fontRole: "display", weight: 700, fontSize: 138, trackingRole: "display", maxWidthPx: 802 },
  // Comparison's column div sets BOTH an explicit `width: colW` AND its own `padding:
  // "44px 36px"` — content-box (this codebase sets no box-sizing override anywhere), so
  // padding ADDS to the box rather than carving into the explicit width; colW=402 (=(900-
  // 96)/2) IS the children's available content width, not colW-72. (Contrast with the
  // AbsoluteFill padding pattern used by displayLine/headline/bullet/listItem, where
  // padding is on a width:auto/100%-inset element and DOES reduce content width — verified
  // against remotion's own AbsoluteFill source, position:absolute+inset:0+width:100%.)
  compareLabel: { fontRole: "mono", weight: 700, fontSize: 26, trackingRole: "kicker", maxWidthPx: 346 }, // 402 - 40(rule) - 16(gap)
  compareItem: { fontRole: "display", weight: 500, fontSize: 44, trackingRole: "body", maxWidthPx: 361 }, // 402 - 20.4(mono mark) - 20(gap)
  tagline: { fontRole: "mono", weight: 700, fontSize: 30, trackingRole: "kicker", maxWidthPx: SAFE_W_PX },
  listItem: { fontRole: "display", weight: 500, fontSize: 52, trackingRole: "body", maxWidthPx: 754 },
  // KenBurns.tsx (and HFAsset.tsx's "cover" mode) explicitly ignore SAFE for their
  // full-bleed background media, but the overlaid caption text is still the kind of thing
  // IG/TikTok UI chrome most wants clear of — held to the same safe width as everything
  // else, not the component's own unconstrained full-bleed layout.
  caption: { fontRole: "mono", weight: 700, fontSize: 40, trackingRole: "kicker", maxWidthPx: SAFE_W_PX },
  deviceUrl: { fontRole: "mono", weight: 400, fontSize: 20, trackingRole: "mono", maxWidthPx: 757 },
  statLabel: { fontRole: "mono", weight: 700, fontSize: 30, trackingRole: "kicker", maxWidthPx: SAFE_W_PX },
  terminalTitle: { fontRole: "mono", weight: 400, fontSize: 28, trackingRole: "mono", maxWidthPx: 743 },
  // --- Onda-ported components (jarvis reel pipeline resources/02-components/onda-
  // components, MIT) — cross-checked against each component's real JSX, same discipline
  // as every entry above. ---
  // BarChart.tsx: label column is a fixed 240px div, no padding, default whiteSpace
  // (wraps, doesn't clip) at TYPE.body's display font/500 weight, fontSize overridden to 32.
  barLabel: { fontRole: "display", weight: 500, fontSize: 32, trackingRole: "body", maxWidthPx: 240 },
  // Timeline.tsx: dot label is `whiteSpace:"nowrap"` with NO clipping ancestor (position:
  // absolute, centered on its dot) — bleeds past its slot rather than clipping, same
  // category as payoffWord/cycleWord/logoText (see HARD_CLIP_ROLES comment below). 150px
  // is the worst-case even-spacing slot for up to 6 points across SAFE.w — conservative,
  // not exact, since real slot width depends on `points.length` (a per-scene value R4's
  // static role table can't express; see PricingCard's identical tradeoff below).
  timelineLabel: { fontRole: "display", weight: 500, fontSize: 24, trackingRole: "body", maxWidthPx: 150 },
  // PricingCard.tsx: only `features[]` gets a real pixel check (free-form text is the
  // actual overflow risk); `tier`/`price`/`cta` are short-by-convention labels covered by
  // LINE_BUDGETS' character ceiling only, not registered here — calibrating the pixel
  // check to where the real risk is, not applying it uniformly (AGENTS.md: "tune the
  // threshold, don't dumb it down"). Card width is fixed at the narrowest 3-up column
  // (COL_W in PricingCard.tsx) regardless of how many tiers a scene actually renders — see
  // that file's own comment for why a static maxWidthPx can't track a dynamic layout, and
  // why the conservative (narrowest) constant is the safe direction. 219 = COL_W(281) -
  // card padding(40) - checkmark+gap(22), default whiteSpace (wraps).
  tierFeature: { fontRole: "display", weight: 500, fontSize: 20, trackingRole: "body", maxWidthPx: 219 },
  // QuoteCard.tsx: `author`/`role` share this role — both spread TYPE.kicker verbatim
  // (mono/700/kicker-tracking) with only fontSize overridden to 24, centered, default
  // whiteSpace (wraps, doesn't clip). `quote` itself is intentionally NOT given a
  // ROLE_RENDER entry — it's a wrapping paragraph by design (a pull-quote is expected to
  // run 2-4 lines), not a single line that happens to overflow, so R4's single-line pixel
  // model doesn't fit it; LINE_BUDGETS' character ceiling is the only check for `quote`,
  // matching R4's own documented fallback (no ROLE_RENDER entry → char-count only).
  attribution: { fontRole: "mono", weight: 700, fontSize: 24, trackingRole: "kicker", maxWidthPx: SAFE_W_PX },
  // CodeDiff.tsx: unlike Terminal's own lines (default whiteSpace, wraps), CodeDiff's
  // lines are `whiteSpace:"pre"` (preserve code formatting/indentation — matches Onda's
  // original, deliberately not wrapped) inside the window's `overflow:"hidden"` — a real
  // hard clip on overflow, not a wrap (see HARD_CLIP_ROLES below). 808 = SAFE.w(900) -
  // borderLeft(4) - line padding(18+28) - gutter span(1.4em @ 30px = 42).
  codeDiffLine: { fontRole: "mono", weight: 400, fontSize: 30, trackingRole: "mono", maxWidthPx: 808 },
  // --- Second Onda-porting wave (lower-third, chapter-card, stat-card, pie-reveal,
  // count-up, kanban-board, MIT) — same cross-checked-against-real-JSX discipline.
  // PieChart renders no Director-authored text at all (its center label is a bounded
  // 0-100% derived value, always ≤4 chars, fixed small size — never at real risk),
  // matching LineChart's "no text" precedent, so it contributes no entry here. CountUp's
  // and StatCard's counted numbers DO get real entries below (countUpValue/
  // statCardValue) even though they're formatted numbers, not prose — both auto-fit an
  // unbounded-length string like LogoReveal's wordmark, so they get logoText's special-
  // case R4 treatment (see the R4 rule body) instead of a static ROLE_RENDER row. ---
  // LowerThird.tsx: name/role sit in a plain flex column inside an AbsoluteFill padded
  // SAFE.x each side (no extra +20, unlike Headline/FeatureCard/Listicle's asymmetric
  // padding) — available width = CANVAS.w - SAFE.x*2 = SAFE.w exactly. Both wrap by
  // default (no overflow:hidden ancestor) — soft overflow, not HARD_CLIP.
  lowerThirdName: { fontRole: "display", weight: 700, fontSize: 52, trackingRole: "headline", maxWidthPx: SAFE_W_PX },
  lowerThirdRole: { fontRole: "display", weight: 500, fontSize: 28, trackingRole: "body", maxWidthPx: SAFE_W_PX },
  // ChapterCard.tsx: `chapter` spreads TYPE.headline UNMODIFIED (fontSize 96 — matches the
  // existing "headline" role's font spec exactly) but centers within the full SAFE.w=900
  // box, not headline/FeatureCard/Listicle's asymmetric SAFE.x+20/SAFE.x padding that
  // yields 880 — that one real width difference is why this is its own entry rather than
  // sharing "headline" (same rigor as Terminal/CodeDiff only sharing terminalTitle because
  // their real CSS truly matched). Default whiteSpace (wraps, no overflow:hidden) — soft
  // overflow. `number` (the eyebrow) is short-by-convention, char-budget only, same
  // tradeoff as PricingCard's tier/price/cta.
  chapterTitle: { fontRole: "display", weight: 700, fontSize: 96, trackingRole: "headline", maxWidthPx: SAFE_W_PX },
  // StatCard.tsx: `label` renders as per-word spans (TYPE.kicker spread, fontSize
  // overridden to 26) joined by a fixed 10px columnGap — NOT a continuous string, so this
  // needs wordGapPx like displayLine does (see that entry's updated comment). flexWrap
  // allows a 2nd line — soft overflow, not HARD_CLIP. `value` (the counted number) is not
  // text-budgeted, same "rendered as-is" class as BarChart's `value`.
  statCardLabel: { fontRole: "mono", weight: 700, fontSize: 26, trackingRole: "kicker", maxWidthPx: SAFE_W_PX, wordGapPx: 10 },
  // KanbanBoard.tsx: fixed 3-up column width COL_W=286.67 (same static-budget tradeoff as
  // PricingCard's COL_W — see that file's own comment), column padding 20 each side.
  // Title row: dot(10) + gap(8) + title(flex:1) + gap(8) + count badge (reserved ~30px for
  // up to 2 digits at 18px mono — a real digit-count ceiling, same tradeoff class as
  // Timeline's points.length-dependent slot width). 190 = 286.67 - 40(padding) - 10(dot) -
  // 8(gap) - 8(gap) - 30(badge). Deliberately NOT ellipsis-truncated (see KanbanBoard.tsx's
  // own comment) — default wrap, soft overflow.
  kanbanColumnTitle: { fontRole: "display", weight: 700, fontSize: 24, trackingRole: "headline", maxWidthPx: 190 },
  // Ticket card: padding 14 each side, 3px left accent bar + 8px gap. Icon wiring (icon-set
  // integration wave) added an OPTIONAL per-card icon (20px + 8px gap) between the bar and
  // the text — reserving that slot UNCONDITIONALLY here (219 = 286.67 - 28(padding) -
  // 3(bar) - 8(gap) - 20(icon) - 8(gap), down from the pre-icon 247) is the same
  // conservative-worst-case tradeoff this file already applies to Timeline's
  // timelineLabel/PricingCard's tierFeature: a static per-role width can't see whether THIS
  // particular card actually carries an icon, so it assumes the narrower (icon-present)
  // case for every card rather than under-measuring the ones that do. A non-icon card that
  // would have fit in the old 247px window but not this one only WARNs (soft overflow,
  // wraps to a 2nd line — see HARD_CLIP_ROLES above), never fails. Default whiteSpace
  // (wraps) — soft overflow either way.
  kanbanCardText: { fontRole: "display", weight: 500, fontSize: 22, trackingRole: "body", maxWidthPx: 219 },
  // --- RadarChart.tsx (vetted follow-up library wave, Recharts, MIT) ---
  // Axis tick labels sit radially around the polygon (RadarChart.tsx's own custom
  // PolarAngleAxis `tick` renderer, mono 700/20px). Side-positioned ticks (textAnchor
  // "start"/"end") grow in ONE direction only and have the least room: CHART_SIZE(760)/2 -
  // OUTER_RADIUS(210) = 170px margin to the chart box's own edge. 150px is that worst-case
  // slot minus a small safety margin — same conservative-single-direction-slot tradeoff as
  // Timeline's timelineLabel (150px there too, same reasoning, coincidentally the same
  // number). Top/bottom ticks (textAnchor "middle") have roughly double this in practice
  // but the static per-role budget can't distinguish tick position, so it uses the
  // tightest real case uniformly, matching this file's established pattern.
  radarAxisLabel: { fontRole: "mono", weight: 700, fontSize: 20, trackingRole: "kicker", maxWidthPx: 150 },
  // Series legend entries (RadarChart.tsx's own hand-built legend row, NOT Recharts'
  // <Legend>) sit in one horizontal row, swatch(14) + gap(10) before the text, 36px gap
  // between entries. Assumes up to 3 series share the SAFE.w(900) row (the realistic case
  // per director/02-component-catalog.md is exactly 2 — "us vs. competitor" — 3 is
  // headroom, not the design target): (900 - 2*36)/3 - 24(swatch+gap) ~= 242px, rounded
  // down for margin. Same static-conservative-slot tradeoff as kanbanCardText/PricingCard's
  // tierFeature above (real width depends on `series.length`, which a per-role table can't
  // see).
  radarSeriesName: { fontRole: "mono", weight: 700, fontSize: 22, trackingRole: "kicker", maxWidthPx: 240 },
  // --- hub-diagram-style labels (component not present in this starter repo). Both render Fraunces 700 (which
  // HAS compiled metrics), so both get a real pixel check. Neither HARD-clips → both WARN. ---
  // Center pill: nominal 46px, whiteSpace:"nowrap". The component now AUTO-SHRINKS the font
  // so the pill never exits the frame (director friction #3), so an over-budget label doesn't
  // clip — it renders smaller. maxWidthPx is the horizontal (tightest) pill budget: pill left
  // edge at pillX=690, right frame margin 40, padding 44*2 → 1080-690-40-88 = 262px. A label
  // wider than this at 46px will be shrunk below nominal; WARN so the director can verify it's
  // still legible.
  //
  // v1.3 fix (blind-test #3 confirmed false positive): this budget was ALSO being applied to
  // vertical-orientation hubs, whose pill geometry is completely different — the pill is
  // top-centered over the FULL frame width, not right-anchored in the narrow horizontal slot.
  // The yahoo reel's "THE PATTERN" (11ch) WARNed against the horizontal 262px budget while
  // rendering fine (verified via `remotion still`). Real vertical geometry, from the
  // component's own layout constants (that hub-diagram component's orientation==="vertical"
  // branch): sideMargin=60 each side, PILL_PAD_X=44 each side → 1080 - 2*60 - 2*44 = 872px.
  // Given its own role below (hubCenterLabelVertical) instead of overloading this one.
  hubCenterLabel: { fontRole: "display", weight: 700, fontSize: 46, trackingRole: "display", maxWidthPx: 262 },
  // Vertical-orientation twin of hubCenterLabel above — see that entry's v1.3 comment for the
  // 872px derivation. Same font/weight/size (the component doesn't vary those by orientation).
  hubCenterLabelVertical: { fontRole: "display", weight: 700, fontSize: 46, trackingRole: "display", maxWidthPx: 872 },
  // Node label: 40px, default whiteSpace → WRAPS (soft, no clip). Wrap is acceptable (the card
  // has room for two lines), so the budget is generous — a single-line measure over ~420px
  // (≈ the icon-present 210px column wrapped to two lines) flags only EXTREME labels, not the
  // normal 1–2 word node names that wrap fine.
  hubNodeLabel: { fontRole: "display", weight: 700, fontSize: 40, trackingRole: "display", maxWidthPx: 420 },
};

// CSS letter-spacing values are "0.28em"/"-0.02em"/"0" strings; parseFloat stops at the
// first non-numeric char so this handles all three shapes with no unit-stripping needed.
const parseTrackingEm = (letterSpacing) => {
  const n = parseFloat(letterSpacing);
  return Number.isFinite(n) ? n : 0;
};

// Real OpenType kerning (GPOS pair adjustments — e.g. "T" pulled slightly closer to "o")
// is NOT applied: compile-font-metrics.mjs precomputes per-GLYPH advance widths, not
// per-PAIR kerning tables, so summing raw advances is a naive (context-free) model. Kern
// pairs in a well-designed font are overwhelmingly negative (tightening), essentially
// never positive by more than a rounding error — so this is a systematic, one-directional
// SLIGHT OVERESTIMATE of real rendered width, not a random error. Confirmed empirically:
// rendering HARDENING.md's own documented true-negative control line ("a few seconds.",
// 14 chars, abrxr/Sora — confirmed via `remotion still` to render with the trailing period
// fully visible, no clip) scores 883px raw against displayLine's 880px budget, a 3px/0.34%
// overestimate purely from the missing kerning. KERNING_SLACK is a small, empirically-
// calibrated discount (comfortably larger than that 0.34% gap, so it doesn't just barely
// paper over one data point) that compensates — verified it still leaves real overflows
// (the reconstructed "Cloud reviewers"/"Warden reviews" bug cases, ~950-965px raw) failing
// by a wide margin after the discount, so it doesn't mask the actual defect this rework
// exists to catch. See PROGRESS.md's dated entry for this rework for the calibration run.
const KERNING_SLACK = 0.985;

// Sum real per-glyph advance widths (precomputed ratio × fontSize) for ONE contiguous
// span of text, plus letter-spacing applied BETWEEN characters (text.length - 1 gaps —
// the dominant real rendering behavior; a documented simplification, not a claim of
// pixel-perfect CSS-spec fidelity). Iterates by Unicode code point (`for...of`), not
// `.split("")`, so multi-byte characters aren't torn across surrogate pairs.
const measureSpanPx = (text, fm, fontSize, trackingEm) => {
  let sumRatio = 0;
  let count = 0;
  for (const ch of text) {
    sumRatio += fm.glyphWidths[ch] ?? fm.fallbackWidth;
    count++;
  }
  const trackingPx = Math.max(count - 1, 0) * trackingEm * fontSize;
  return sumRatio * fontSize + trackingPx;
};

// Measures `text` as it actually renders: either one continuous string (the default —
// correct for every role except displayLine), or, when `wordGapPx` is set (displayLine
// only — see ROLE_RENDER's comment), as separate per-word spans joined by a fixed flex
// gap instead of the font's natural space-glyph advance. Applies KERNING_SLACK once to
// the total (not per-word) since it's compensating for a per-glyph-pair effect that scales
// with total glyph count either way. Returns null if this exact (family, weight) has no
// compiled metrics — callers fall back to the LINE_BUDGETS character check in that case.
const measureTextPx = (text, { family, weight, fontSize, trackingEm, wordGapPx }) => {
  const fm = FONT_METRICS[family]?.[String(weight)];
  if (!fm) return null;
  if (wordGapPx === undefined) return measureSpanPx(text, fm, fontSize, trackingEm) * KERNING_SLACK;
  const words = text.split(" ").filter((w) => w.length > 0);
  const wordsPx = words.reduce((sum, w) => sum + measureSpanPx(w, fm, fontSize, trackingEm), 0);
  return (wordsPx + Math.max(words.length - 1, 0) * wordGapPx) * KERNING_SLACK;
};

// Pixel-overflow severity: not every role's overflow is the same defect. Checked against
// each component's real CSS (overflow/whiteSpace/flex-wrap) AND cross-checked with real
// `remotion still` renders (see PROGRESS.md's dated entry for this rework for the full
// per-component audit and the exact `--gl=angle --frame=N` commands used):
//   - HARD CLIP (→ fail): a flex row with the (default) `flexWrap:"nowrap"` plus
//     `overflow:"hidden"` (displayLine — Headline.tsx's per-line row, the exact documented
//     bug), or `whiteSpace:"nowrap"` PLUS an `overflow:"hidden"` ancestor with no wrap
//     fallback (deviceUrl — DeviceFrame's address bar, doubly clipped: the outer frame div
//     AND the address-bar div both set overflow:hidden). A character is silently lost.
//   - SOFT OVERFLOW (→ warn): everything else that can overflow but doesn't lose a
//     character. Two different real mechanisms land here, both confirmed by rendering
//     actual frames, not just reading CSS:
//       (a) plain block/inline text, default `whiteSpace:"normal"`, no clipping ancestor —
//           WRAPS to a 2nd line. Confirmed on plan3.json's "tools" Listicle scene ("Runs
//           real commands.", 20 chars, legal under the old char budget): the real render
//           wraps to "Runs real" / "commands." — breaks the single-line layout some
//           components assume (e.g. Listicle's spine-height math) but nothing is lost.
//       (b) `whiteSpace:"nowrap"` with NO clipping ancestor (logoText, payoffWord,
//           cycleWord) — doesn't wrap, doesn't clip, just bleeds toward/past the safe
//           margin. Confirmed on plan3.json's "reveal" LogoReveal scene ("CLAUDE CODE",
//           all-caps — wider per-glyph than the auto-fit formula's assumed average):
//           the real render shows the full wordmark intact, extending almost edge-to-edge
//           on the 1080px canvas — a genuine, previously-undiscovered safe-zone finding
//           (escaped both the old char-count lint AND QUALITY-REVIEW.md's visual pass),
//           but not a clip; every letter is still there. Originally modeled this as FAIL
//           (reasoning: "no fallback = same risk as a clip") before rendering it — the
//           render corrected that: no characters are actually lost, so it belongs with the
//           wrap cases, not with displayLine/deviceUrl. Real, worth surfacing — not worth
//           failing an otherwise-good, already-shipped reel over, mirroring R12's existing
//           "real risk, best-effort WARN, not a hard fail" precedent below. See HARDENING.md
//           for this specific finding (plan3.json's LogoReveal wordmark).
const HARD_CLIP_ROLES = new Set(["displayLine", "deviceUrl", "codeDiffLine"]);

// ---------------------------------------------------------------------------
// R4 line budgets — centralized here (was inline in the rule before an earlier refactor).
//
// Character budgets — kept as (a) a fast pre-check that needs no font-metrics lookup at
// all (catches egregiously-long text immediately) and (b) the fallback enforcement path
// when a role/font/weight combo has no compiled pixel metrics, so the gate degrades to
// this real-but-coarser heuristic instead of silently skipping the check. No longer the
// sole or authoritative signal — see ROLE_RENDER/measureTextPx above and the R4 rule body
// below for the pixel-width check that now decides the roles it has data for. Values are
// otherwise unchanged from the pre-pixel-width budgets (still useful as a coarse floor).
// ---------------------------------------------------------------------------
export const LINE_BUDGETS = {
  displayLine: 15,
  headline: 20,
  bullet: 24,
  terminal: 40,
  payoffWord: 8,
  cycleWord: 10,
  // Comparison columns are ~half the safe box wide at 44px body type.
  compareLabel: 14,
  compareItem: 18,
  // LogoReveal auto-fits the wordmark, but below ~15 chars it would drop under the
  // 96px display legibility floor (FONT_FLOOR.display).
  logoText: 15,
  tagline: 34,
  // Listicle rows: safe box minus the 90px chip + gap at 52px body type.
  listItem: 24,
  // KenBurns caption: full-bleed image, centered kicker-weight line near the bottom.
  caption: 46,
  // DeviceFrame browser chrome: fake address bar, narrower than the SAFE box.
  deviceUrl: 40,
  // StatFlip label — kicker-weight mono with 0.28em tracking under the giant numeral.
  statLabel: 20,
  // Countdown label — same kicker-weight treatment as StatFlip's label (Countdown reuses
  // StatFlip's exact giant-numeral/gradient-glow visual language, generalized to N items).
  countdownLabel: 20,
  // Terminal window title — mono 28px chrome text, NOT the 20-char headline budget
  // (HARDENING.md Gap #3: a legal terminal title was falsely rejected under the shared
  // "headline" role). Same numeric ceiling as body `terminal` lines since it renders at
  // a similar (slightly smaller) mono size in the same window chrome.
  terminalTitle: 40,
  // --- Onda-ported components — see the matching ROLE_RENDER comments above for the
  // real-CSS derivation of each. ---
  barLabel: 15,
  timelineLabel: 11,
  // PricingCard: tier/price/cta are short-by-convention (name, "$29", "Get started") and
  // deliberately char-budget-only — see ROLE_RENDER's tierFeature comment for why only
  // the feature list gets a real pixel check.
  tierName: 16,
  tierPrice: 12,
  tierFeature: 26,
  tierCta: 20,
  // QuoteCard: `quote` wraps by design (see ROLE_RENDER comment — no pixel entry, this
  // char ceiling is its only R4 signal); `attribution` (author/role, shared) is pixel-
  // checked above. 56, not a rounder number, because it's load-bearing: QuoteCard's own
  // fixed word-stagger choreography (QuoteCard.tsx) needs the LAST word of a
  // budget-maximum quote to finish revealing before the divider beat starts, and the
  // whole 3-beat sequence (quote → divider → attribution) has to resolve inside the
  // ~4000ms ceiling R2 imposes on a single-beat component's scene — see QuoteCard.tsx's
  // own comment for the frame math this budget was picked to satisfy.
  quote: 56,
  attribution: 24,
  codeDiffLine: 40,
  // --- Second Onda-porting wave (lower-third, chapter-card, stat-card, kanban-board) —
  // see the matching ROLE_RENDER comments above for the real-CSS derivation of each.
  // PieChart/CountUp render no text at all (see their own file comments), so neither
  // contributes an entry here.
  lowerThirdName: 26,
  lowerThirdRole: 34,
  // ChapterCard eyebrow number ("01", "Ch. 3") is short-by-convention, char-budget only —
  // same tradeoff as PricingCard's tier/price/cta (no ROLE_RENDER pixel entry).
  chapterNumber: 6,
  chapterTitle: 20,
  statCardLabel: 40,
  kanbanColumnTitle: 14,
  kanbanCardText: 30,
  // --- RadarChart.tsx (vetted follow-up library wave, Recharts) — see the matching
  // ROLE_RENDER comments above for the real derivation of each.
  radarAxisLabel: 12,
  radarSeriesName: 20,
  // --- ref2 recreation cohort — see the sceneTexts() recreate block for the real-render
  // derivation of each. ---
  kineticLine: 14,
  refTerminal: 60,
  refChip: 40,
  // --- grove-editorial pack v1.2 roles ---
  // NumberedCard step lines. Previously routed to kineticLine (14ch) — WRONG geometry: the
  // hook's StackBlock words are 88px CENTERED (share the frame midline), while NumberedCard
  // lines are 84px serif (Fraunces 900) / 96px script (Lobster), LEFT-anchored in a ~900px
  // column (left:100/right:80) that WRAPS on overflow (default whiteSpace, no clip). Measured
  // (font-metrics artifact, Fraunces 700 proxy — 900/Lobster have no compiled metrics, so this
  // is a char-only role like `quote`): avg advance ≈44px/char at 84px → ~20ch fits 900px;
  // discounted to 18 for the heavier 900 weight actually rendered. The README's old example
  // line "every customer call using" (25ch ≈ 1019px) genuinely overflows → still fails; the
  // real corpus-style short lines ("Build an", "MCP server", "Skip ahead,") all pass.
  numberedCardLine: 18,
  // HubDiagram center pill (46px Fraunces 700, whiteSpace:nowrap). The component auto-shrinks
  // the label so the pill never exits the frame (v1.2), but a label long enough to trigger a
  // big shrink reads as chrome, not a hub anchor — cap chars at the pill's real geometry:
  // horizontal pillX=690 → 262px content ≈ 9ch at full 46px; 12 allows modest shrink before
  // failing ("Direct channel", 14ch — the blind-test escape — fails).
  hubCenterLabel: 12,
  // Vertical-orientation twin (v1.3) — see ROLE_RENDER's hubCenterLabelVertical comment for
  // the 872px real-geometry derivation (vs horizontal's 262px). Same char-to-budget ratio as
  // hubCenterLabel (12/9.19 ≈ 1.3× the naive full-size fit) applied to the vertical implied
  // fit (872/28.52 ≈ 30.6ch) → ~40, allowing modest shrink before failing. "THE PATTERN"
  // (11ch) — the blind-test #3 false positive — now passes cleanly under this budget.
  hubCenterLabelVertical: 40,
  // HubDiagram node label (40px Fraunces 700, wraps — soft). Wrap is acceptable (the card has
  // room for 2 lines); the char ceiling only catches extreme labels.
  hubNodeLabel: 20,
  // IconReveal.label (v1.3.1) — the cursive name under the reveal tile (see sceneTexts()'s own
  // comment on the `p.label` mining block above for the exact geometry). 118px GROVE_SCRIPT_FONT
  // (Lobster), centered, no explicit maxWidth — treated like every other centered full-bleed
  // role in this file (caption/tagline/statLabel budget against a safe box, not the raw 1080px
  // canvas): ~960px usable (modest ~60px margin each side, tighter than SAFE_W_PX's 900 since
  // this label has no surrounding chrome to absorb a stray wide glyph). Lobster has no compiled
  // metrics (see ROLE_RENDER — it only measures the family's `display`/`mono` slots), so this is
  // char-budget-only, same tradeoff/precedent as `quote` and `numberedCardLine` above: avg
  // advance estimated at a conservative (errs toward SHRINKING the budget, since there's no
  // pixel check backstop to catch what the char count misses) 0.6em — 960 / (118*0.6) ≈ 13.6ch.
  // Existing shipped labels ("Claude Code" 11ch, "Memory layer" 12ch) fit comfortably under this;
  // "Model Context Protocol" (23ch) — the class of label this role exists to catch — fails.
  iconRevealLabel: 13,
};

// Caption band (bottom px kept clear for burned-in captions on IG/TikTok). Mirrors
// src/tokens/platform.ts CAPTION_BAND.bottom — duplicated here (not imported) because
// lint.mjs is plain JS run by plain `node` with no bundler/type-stripping flag, while
// platform.ts is TypeScript; see LINE_BUDGETS header above for the same tradeoff on R4.
const CAPTION_BAND_PX = 220;

// ---------------------------------------------------------------------------
// COMPONENT_MANIFEST — the single declarative registration table for every
// recreate/grove cohort component (ref2 + designmd + grove-editorial). Each
// entry declares, IN ONE PLACE, everything the lint miners need to know about a
// component:
//
//   cohort        — which recreation cohort it belongs to (docs only; groups
//                   the table visually the way the old inline comments did).
//   mineArrays    — the flat/nested prop paths whose elements carry an `atMs`
//                   the R2 pacing miner (sceneEvents) turns into visual events.
//                   Dotted paths ("chips.items", "terminal.rows") read nested.
//   minableBeats  — scalar `*AtMs` props on the component that are themselves a
//                   single visual event (sceneEvents).
//   textRoles     — the per-component on-screen TEXT this component contributes
//                   to the R3 dwell / R4 fit gates (sceneTexts). This is the
//                   drift-prone part three separate review rounds each caught a
//                   silently-missed registration in (HubDiagram labels,
//                   IconReveal.label, NumberedCard mis-routing) — unregistered
//                   text ESCAPES the fit gate, so centralizing it here is the
//                   whole point of this table. Each role is one of two shapes:
//                     { prop, role, from(p,s), routeBy? } — a scalar text prop;
//                       routeBy re-routes the role when a sibling prop matches
//                       (HubDiagram's orientation → vertical pill budget).
//                     { array, textKey, role, fromEach(el,i,p,s) } — a per-
//                       element text field on an array prop.
//
// Everything downstream derives from this table: KNOWN_COMPONENTS membership,
// RECREATE_COMPONENTS, and the generic sceneEvents/sceneTexts cohort loops. The
// SHARED cohort mining (kineticLine from `stack`, refTerminal from
// `terminal.rows`, refChip from `chips.items`/`patches`, and the pill/bar/keycap
// nested-beat shapes) stays in the miners themselves — it applies uniformly to
// EVERY manifest component, so it isn't per-component data. LINE_BUDGETS /
// ROLE_RENDER above stay as the role-DEFINITION tables (this manifest maps
// props → roles; those define what each role's budget/geometry is).
//
// The mineArrays/minableBeats are unioned across all entries (RECREATE_MINE_*
// below) and the sceneEvents cohort scan uses that union for every manifest
// component — byte-identical to the old fixed-union scan (proven by the
// module-load union-set === old-hardcoded-set assertion in the migration's
// throwaway equality script). The per-entry lists therefore document intent;
// the runtime behavior is the union, exactly as before.
// ---------------------------------------------------------------------------
const COMPONENT_MANIFEST = {
  UiSwipeThreshold: { cohort: "uiMate", mineArrays: ["markers"], minableBeats: ["atMs"] },
  UiFormValidation: { cohort: "uiMate", mineArrays: ["fields"], minableBeats: ["atMs"] },
  UiOptimisticAction: { cohort: "uiMate", mineArrays: ["items"], minableBeats: ["atMs"] },
  UiInteractionSurface: { cohort: "uiMate", mineArrays: ["items"], minableBeats: ["atMs"] },
  UiMateCTA: { cohort: "uiMate", mineArrays: ["items", "beats"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiColorSwatchPanel: { cohort: "uiMate", mineArrays: ["beats"], minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiCommandList: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiConfirmDialog: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiCompareCards: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiCursorPresenceGrid: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiIdentityFlow: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiLatencyGauge: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiDropZonePair: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiHoldProgressRing: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiFormStateCard: { cohort: "uiMate", mineArrays: ["fields"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiFormLiveErrorCard: { cohort: "uiMate", mineArrays: ["fields"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiFormBlurCheckCard: { cohort: "uiMate", mineArrays: ["fields"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiFormEscalateCard: { cohort: "uiMate", mineArrays: ["fields"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiFormSuccessCard: { cohort: "uiMate", mineArrays: ["fields"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiFormatTabsCard: { cohort: "uiMate", mineArrays: ["formats", "swatches"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiOklchSliderCard: { cohort: "uiMate", mineArrays: ["palette"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiContrastCheckCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiLightDarkPreviewCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiScaleGenerationCard: { cohort: "uiMate", mineArrays: ["steps"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiPaletteTriggerCard: { cohort: "uiMate", mineArrays: ["results"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiFuzzyMatchCard: { cohort: "uiMate", mineArrays: ["fuzzyResults"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiKeyboardNavList: { cohort: "uiMate", mineArrays: ["items"], minableBeats: ["atMs", "secondaryAtMs", "tertiaryAtMs"] },
  UiAsyncSpinnerRow: { cohort: "uiMate", mineArrays: ["items"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiNestedCommandCard: { cohort: "uiMate", mineArrays: ["items"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiUploadProgressCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiUploadErrorRetryCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiFilePreviewCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiMultiFileListCard: { cohort: "uiMate", mineArrays: ["files"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiCountdownUndoRing: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiSettingsDangerCard: { cohort: "uiMate", mineArrays: ["rows"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiCooldownDeleteCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiRaceCompareCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiSplitCompareCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiSyncFlowDiagram: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiRollbackToastCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiSafeUnsafeListCard: { cohort: "uiMate", mineArrays: ["safe", "unsafe"], minableBeats: ["atMs", "secondaryAtMs"] },
  UiCanvasCursorHero: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiInterpolationCompareCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiPresenceAvatarStackCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiSelectionLockCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  UiFollowModeCard: { cohort: "uiMate", minableBeats: ["atMs", "secondaryAtMs"] },
  TalkingHeadClaim: { cohort: "talkingHead", mineArrays: ["items"], minableBeats: ["atMs"] },
  TalkingHeadProofSplit: { cohort: "talkingHead", mineArrays: ["items"], minableBeats: ["atMs"] },
  TalkingHeadToolProof: { cohort: "talkingHead", mineArrays: ["rows"], minableBeats: ["atMs"] },
  TalkingHeadBrollStack: { cohort: "talkingHead", mineArrays: ["cards"], minableBeats: ["atMs"] },
  TalkingHeadSocialCTA: { cohort: "talkingHead", mineArrays: ["items"], minableBeats: ["atMs"] },
  TalkingHeadCaption: { cohort: "talkingHead", overlay: true, mineArrays: ["words"], minableBeats: [] },
  TalkingHeadPhoneMockStage: { cohort: "talkingHead", mineArrays: ["rows"], minableBeats: ["atMs"] },
  TalkingHeadAppHeroReveal: { cohort: "talkingHead", mineArrays: [], minableBeats: ["atMs"] },
  TalkingHeadPillButtonCallout: { cohort: "talkingHead", mineArrays: [], minableBeats: ["atMs"] },
  TalkingHeadCommentCard: { cohort: "talkingHead", mineArrays: [], minableBeats: ["atMs"] },
  TalkingHeadFilterAppCard: { cohort: "talkingHead", mineArrays: ["tagAtMs"], minableBeats: ["atMs", "subtitleAtMs"] },
  TalkingHeadFunctionModalCard: { cohort: "talkingHead", mineArrays: ["fields"], minableBeats: ["atMs"] },
  TalkingHeadTerminalCard: { cohort: "talkingHead", mineArrays: ["lines"], minableBeats: ["atMs"] },
  TalkingHeadFeatureChecklist: { cohort: "talkingHead", mineArrays: ["items"], minableBeats: ["atMs"] },
  TalkingHeadGradientSwatchCard: { cohort: "talkingHead", mineArrays: ["slopLabels"], minableBeats: ["atMs"] },
  TalkingHeadSeriesCard: { cohort: "talkingHead", mineArrays: [], minableBeats: ["atMs", "noteAtMs"] },
  TalkingHeadStepTimeline: { cohort: "talkingHead", mineArrays: ["steps"], minableBeats: ["atMs"] },
  TalkingHeadCompetitorWatchCard: { cohort: "talkingHead", mineArrays: ["competitors"], minableBeats: ["atMs"] },
  TalkingHeadSplitCompareCard: { cohort: "talkingHead", minableBeats: ["atMs", "secondaryAtMs"] },
  TalkingHeadZeroCostCard: { cohort: "talkingHead", mineArrays: [], minableBeats: ["atMs"] },
  TalkingHeadPluginRankCard: { cohort: "talkingHead", mineArrays: ["plugins"], minableBeats: ["atMs", "noteAtMs"] },
  TalkingHeadPlatformTwinPhones: { cohort: "talkingHead", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  TalkingHeadBrowserLogoReveal: { cohort: "talkingHead", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  VoiceOrb: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  WaveformPanel: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  EditorTimelinePanel: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  AdsDashboard: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  ApprovalShield: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  InboxTaskList: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  StoryboardGrid: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  BodyAnalyticsMap: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  RecoveryChart: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  BrowserAgentPanel: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  OddsBoard: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  CtaPlate: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  ProductStage: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  MetricDashboard: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  ComparisonBoard: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  ProcessTimeline: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  InteractionSurface: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  PricingProof: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  SocialProof: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  MediaCollage: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  TechnicalSurface: { cohort: "shared", mineArrays: ["metrics", "cards", "items"], minableBeats: ["atMs"] },
  StarRatingFill: { cohort: "iosmate", mineArrays: [], minableBeats: ["atMs", "secondaryAtMs"] },
  HeartBurstReaction: { cohort: "iosmate", mineArrays: [], minableBeats: ["atMs"] },
  CommentPopIn: { cohort: "iosmate", mineArrays: [], minableBeats: ["atMs", "secondaryAtMs"] },
  ReceiptPrintLines: { cohort: "iosmate", mineArrays: [], minableBeats: ["atMs"] },
  QrCodeAssemble: { cohort: "iosmate", mineArrays: [], minableBeats: ["atMs", "secondaryAtMs"] },
};

// Canonical registry keys for the two free-tier packs shipped in this starter
// (UI Mate, Talking Head) plus the shared visual-primitive/app-native cohorts they use.
// A scene naming a component outside this set passes schema (props aren't deep-
// validated) but crashes the render, so the lint gate catches it first (R8). Every
// registered component in this starter lives in COMPONENT_MANIFEST below (mining
// metadata is uniform across the two packs), so CORE_COMPONENTS is empty here.
const CORE_COMPONENTS = [];
export const KNOWN_COMPONENTS = [...CORE_COMPONENTS, ...Object.keys(COMPONENT_MANIFEST)];

// ---------------------------------------------------------------------------
// R15 — registry parity: KNOWN_COMPONENTS above (CORE_COMPONENTS + COMPONENT_MANIFEST) is
// this file's OWN registration table. R8 below validates every plan's scene.component
// against it — but until this rule existed, nothing checked that KNOWN_COMPONENTS itself
// matches engine/PlanReel.tsx's actual runtime REGISTRY (the object PlanReel.tsx really
// renders scenes from). A component present in one but not the other used to pass
// `npm run verify` green while crashing the render with "Unknown component" (or the
// reverse: silently dead, un-lintable code) — exactly what happened to 10 components
// in another pack, added to this manifest and to that pack's component file but never
// wired into PlanReel.tsx's REGISTRY.
//
// lint.mjs is plain Node with no TSX/bundler step (see this file's header comment), so it
// can't `import` PlanReel.tsx directly. This does a narrow, honest TEXT extraction of the
// REGISTRY object literal's key list at module load (once, same one-time-read pattern as
// FONT_METRICS above) — not a THIRD hand-maintained copy of the component list, which
// would only relocate the drift risk, not remove it. REGISTRY's entries are 100% ES2015
// shorthand properties (`Foo,` — the same-name import binding used directly as the key,
// never a `key: value` rename — true for every entry as of this rule's introduction and
// enforced structurally: PlanReel.tsx's imports and REGISTRY keys must already refer to
// the same identifiers for the module to compile), so a plain identifier-per-line scan is
// exact, not a heuristic. If the object literal's shape ever changes so this stops
// matching, the extraction below intentionally yields an EMPTY set rather than a partial
// one — a "some/every known component is missing from the registry" failure that's loud
// and obviously wrong, never a silently-stale parse that looks like a clean pass.
let PLAN_REEL_REGISTRY_COMPONENTS = null;
try {
  const planReelSrc = fs.readFileSync(path.join(__dirname, "../engine/PlanReel.tsx"), "utf8");
  const registryMatch = planReelSrc.match(/const REGISTRY:[^{]*\{([\s\S]*?)\n\};/);
  if (registryMatch) {
    const names = new Set();
    for (const rawLine of registryMatch[1].split("\n")) {
      const line = rawLine.split("//")[0].trim(); // strip trailing/full-line `//` comments
      if (!line) continue;
      for (const token of line.split(",")) {
        const id = token.trim();
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id)) names.add(id);
      }
    }
    PLAN_REEL_REGISTRY_COMPONENTS = names;
  }
} catch {
  // engine/PlanReel.tsx missing/unreadable in this checkout — leave null; the R15 rule
  // body below no-ops rather than false-failing every plan (mirrors FONT_METRICS's own
  // try/catch fallback above).
}
const REGISTRY_PARITY_MISSING_FROM_REGISTRY = PLAN_REEL_REGISTRY_COMPONENTS
  ? KNOWN_COMPONENTS.filter((name) => !PLAN_REEL_REGISTRY_COMPONENTS.has(name))
  : [];
const REGISTRY_PARITY_MISSING_FROM_MANIFEST = PLAN_REEL_REGISTRY_COMPONENTS
  ? [...PLAN_REEL_REGISTRY_COMPONENTS].filter((name) => !KNOWN_COMPONENTS.includes(name))
  : [];

// ---------------------------------------------------------------------------
// R16 — prop-signature validation: KNOWN_COMPONENTS (R15 above) closes "does this component
// exist"; this closes a different, previously-open hole — "does this component actually
// RENDER every prop the plan gives it". A React functional component silently drops any
// prop it doesn't destructure — no error, no warning, no visual sign at render time — so a
// plan can pass a real, schema-valid prop (with real content, real `atMs` beats) to a
// component whose function signature never reads it, and the content just never appears.
// This is exactly the grove-editorial 3-ways-100-customers blind-grade regression: `stack`
// beats scheduled on `HubDiagram`/`FlowHub`/`BranchFlow` (none of which destructured a
// `stack` prop at the time) rendered nothing, dropping 48% of the reel's scripted content —
// invisibly, through TWO grading passes, because nothing in the plan/schema/lint/render
// pipeline ever checked "does this component's signature actually declare this key".
//
// Same "read the real source text once at module load, don't hand-maintain a third copy"
// discipline as R15's PLAN_REEL_REGISTRY_COMPONENTS extraction above — but this time the
// object of the scan is each component's own TypeScript prop TYPE, not its registration.
// `extractPropSignatures()` walks every engine/components/*.tsx file, finds each
// `export const Name: React.FC<{ ...props... }> = (...) => {` declaration (brace-depth
// matched, so nested inline object/array prop types — e.g. HubDiagram's
// `nodes: { label: string; icon?: string }[]` — don't truncate the scan early), strips
// comments, and lists the top-level prop names declared inside the `<{ }>` block.
//
// Deliberately conservative: a component whose props aren't declared in this exact inline
// `React.FC<{...}>` shape (a separately-declared `type Props = {...}` / `interface`, a
// generic, anything this narrow text scan doesn't recognize) is simply ABSENT from the
// resulting map — R16's rule body below skips any component with no entry, so a parsing
// miss can only under-report (silently skip a component), never mis-report (never invents a
// false "unknown prop" for a component it didn't understand). Calibrated against the full
// plan suite (`npm run verify`) and a hand-crafted bad plan before shipping as a hard FAIL —
// see this rule's body for the calibration note.
export const extractPropSignatures = (sourceText) => {
  const map = new Map();
  const declRe = /export const ([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*React\.FC<\{/g;
  let m;
  while ((m = declRe.exec(sourceText))) {
    const name = m[1];
    const blockStart = declRe.lastIndex; // just past the opening "{"
    let depth = 1;
    let i = blockStart;
    while (i < sourceText.length && depth > 0) {
      const ch = sourceText[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    if (depth !== 0) continue; // unterminated (shouldn't happen on valid TSX) — skip, don't guess
    const block = sourceText.slice(blockStart, i);
    map.set(name, extractTopLevelPropNames(block));
  }
  return map;
};

// Given the text INSIDE a `React.FC<{ ... }>` block, return the set of top-level prop names
// it declares. Strips `/** ... */` JSDoc blocks and trailing `//` line comments first (this
// codebase documents props heavily — see HubDiagram/GroveOutroCTA for real examples), then
// splits on `;` at brace/paren/bracket depth 0 so a nested inline type
// (`nodes: { label: string }[]`, `heads?: { text: string; atMs: number }[]`) counts as ONE
// top-level prop, not several. `<`/`>` are intentionally NOT depth-tracked (generics are rare
// in this file's prop shapes and a miscount there is lower-risk than one in `{}/[]/()`).
const extractTopLevelPropNames = (blockText) => {
  let text = blockText.replace(/\/\*\*[\s\S]*?\*\//g, " ");
  text = text
    .split("\n")
    .map((line) => line.split("//")[0])
    .join("\n");
  const names = new Set();
  let depth = 0;
  let cur = "";
  const flush = () => {
    const seg = cur.trim();
    const mm = seg.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*\??\s*:/);
    if (mm) names.add(mm[1]);
    cur = "";
  };
  for (const ch of text) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (ch === ";" && depth === 0) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush(); // last prop before the closing brace may have no trailing ";"
  return names;
};

// One-time read of every engine/components/*.tsx file (same process-start-cost category as
// FONT_METRICS/PLAN_REEL_REGISTRY_COMPONENTS above — not per-lint-call I/O). Missing/
// unreadable directory: leave null, R16's body below no-ops rather than false-failing.
let PROP_SIGNATURES = null;
try {
  const componentsDir = path.join(__dirname, "../engine/components");
  const files = fs.readdirSync(componentsDir).filter((f) => f.endsWith(".tsx"));
  PROP_SIGNATURES = new Map();
  for (const file of files) {
    const src = fs.readFileSync(path.join(componentsDir, file), "utf8");
    for (const [name, props] of extractPropSignatures(src)) {
      PROP_SIGNATURES.set(name, props);
    }
  }
} catch {
  PROP_SIGNATURES = null;
}

// Keys engine/PlanReel.tsx's resolveSceneProps() consumes itself (media/edit-decision ID
// lookups) rather than passing through for the component to destructure — see R16's rule
// body for the full explanation. Kept as a named export so it stays a single source of
// truth if resolveSceneProps ever grows another resolver key.
export const R16_ALWAYS_ALLOWED_PROPS = new Set(["mediaSlotId", "editDecisionId", "sourceClipId"]);

// The recreate cohort — every COMPONENT_MANIFEST key. Shared by the sceneEvents/sceneTexts
// cohort mining blocks below (kineticLine/refTerminal/refChip text + the union beat/array scan).
const RECREATE_COMPONENTS = new Set(Object.keys(COMPONENT_MANIFEST));

// Unioned array-paths and scalar beats mined for the R2 pacing check on every manifest
// component (derived from COMPONENT_MANIFEST — see the table's header for why the union, not
// the per-entry lists, is the runtime contract). Dedup preserves first-seen order; order is
// irrelevant anyway since sceneEvents sorts its event list before returning.
const RECREATE_MINE_ARRAYS = [...new Set(Object.values(COMPONENT_MANIFEST).flatMap((m) => m.mineArrays ?? []))];
const RECREATE_MINE_BEATS = [...new Set(Object.values(COMPONENT_MANIFEST).flatMap((m) => m.minableBeats ?? []))];

// Read a possibly-dotted prop path ("chips.items", "terminal.rows") off a scene's props.
const readPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Icon primitive's curated allowlist, duplicated from src/components/Icon.tsx's own
// ICON_NAMES export — same "lint.mjs is plain JS, no bundler/JSX-stripping" duplication
// reason as SAFE_W_PX/FONT_FLOOR_DISPLAY_PX/CAPTION_BAND_PX above (Icon.tsx is a .tsx
// module that imports React/lucide-react; plain `node` can't load it directly). MUST stay
// in sync with Icon.tsx's own list — a drift here only produces a stale/wrong WARN (see
// the KanbanBoard icon-name check below), never a crash, since Icon.tsx's own runtime
// fallback is the actual safety net; this is the earlier, cheaper warning layer.
const ICON_NAMES = [
  "claude",
  "code", "terminal", "rocket", "check", "x", "warning", "database", "cloud",
  "lock", "unlock", "settings", "chart", "clock", "arrow-right", "arrow-left",
  "arrow-up", "arrow-down", "zap", "star", "shield", "cpu", "git-branch",
  "package", "layers", "globe", "sparkles", "trending-up", "trending-down",
  "users", "play", "pause", "refresh", "send", "server", "bot", "eye",
  "search", "filter", "wrench", "target", "flag", "message", "mail",
  "calendar", "smartphone", "monitor", "link", "plus", "minus", "help",
  "folder", "music", "camera", "wind", "cloud-upload", "file-text",
  "robot", "lightbulb", "doc", "plug", "brain", "credit-card", "mic",
  "skull", "box", "magnify", "megaphone", "dollar", "crown", "shield-off",
  "message-circle", "image", "pen-tool", "repeat", "book-open", "user",
  "key", "gift",
];

export const RULE_NAMES = {
  R0: "shape", // top-level plan/transcript shape guard — see lint()'s header comment
  R1: "audio-lock",
  R2: "pacing",
  R3: "dwell",
  R4: "fit",
  R5: "coverage",
  R6: "color",
  R7: "variety",
  R8: "component",
  R9: "anti-lockstep", // consecutive entrance/component sameness (QUALITY-REVIEW.md)
  // R10 — background/energy variety: NOT implemented. Every family currently renders one
  // backdrop treatment (mesh+aurora) with no per-scene intensity/params in the plan to
  // read, so there is no structural proxy — this is a render/VLM-only check per
  // QUALITY-REVIEW.md. Number reserved, not faked.
  R10: "background-variety", // render/VLM-only — see comment above; no rule body
  R11: "impact-budget", // combined alert/StatFlip/LogoReveal "slam" beat cap
  R12: "caption-band", // best-effort WARN on KenBurns caption vs CAPTION_BAND
  // R13 — per-family brand rule (e.g. abrxr watermark/@handle end card): NOT implemented.
  // familyTokens is threaded into lint() (see JSDoc below) but brand tokens
  // (familyTokens.brand.*) don't exist yet in src/tokens — pending HARDENING.md's
  // "ship a token artifact" item. Number reserved, not faked.
  R13: "brand-rule", // pending brand tokens — see comment above; no rule body
  R14: "overlay-zone", // overlays[] zone collisions + overlay-capability (ARCHITECTURE-V2 §4)
  R15: "registry-parity", // KNOWN_COMPONENTS (this file) vs PlanReel.tsx's runtime REGISTRY
  R16: "prop-signature", // plan scene props vs the target component's own TS prop type
  R17: "keyword-suggestion", // advisory WARN-only: transcript keyword matches → reusable components
  R18: "placeholder-content", // best-effort WARN: literal placeholder tokens in on-screen text
  R19: "media-existence", // FAIL: mediaSlot has a baked-in src that doesn't exist under public/
  R20: "visual-density", // WARN: visual beats per interval + uncovered gaps (lint/visual-density.mjs)
  R21: "asset-density", // WARN: asset beats per interval, for packs declaring an asset contract
  R22: "generic-placeholder", // FAIL: literal Lorem ipsum / John Doe / Acme Corp / placeholder text
  R23: "motion-floor", // WARN: distinct visual beats per scene below the pack motion floor
  // R24 — IG/TikTok chrome safe-zone: NOT implemented. No component exposes rendered pixel
  // Y-position as a plan-level prop (layout insets are hardcoded per-component, not
  // plan-authored), so there is no structural proxy lint can check from plan JSON alone —
  // would need a render-and-measure still-frame step, not a static lint check. Number
  // reserved, not faked, same posture as R10/R13 above.
  R24: "safe-zone",
};

// Collect every timed visual event (ms offsets) a scene declares.
//
// `fps` (default 30, the repo's single source of truth — engine/generated/beats*.ts's
// `export const FPS = 30` and every Root.tsx composition; plan.json carries it as `plan.fps`)
// converts the WebGL tier's SCENE-LOCAL FRAME timing props into absolute-ms events. The four
// Wave 3 components (PlanScenes.tsx: Text3DHero, GlassHero, ParticleText, Attractor) animate on
// frames, not ms (a scene renders inside a <Sequence>, so frame 0 = scene start), so without
// this every 3D scene declares only startMs and any 3D beat > maxGapMs trips R2 with no fixable
// path. We mine the REAL entrance/reveal spans each component exposes and place them on the
// global timeline at `s.startMs + frameToMs(frame)` — the same absolute scale as startMs/atMs/
// durationMs — so R2 stays a genuine pacing check on 3D scenes, not an exemption.
export const sceneEvents = (s, fps = 30) => {
  const ev = [s.startMs];
  const p = s.props ?? {};
  // frames → absolute ms: inverse of beats*.ts's msToFrame = round(ms*fps/1000).
  const frameToMs = (f) => s.startMs + Math.round((f * 1000) / fps);
  // p.points (Timeline) and p.data (BarChart; LineChart's p.data is plain numbers, whose
  // `.atMs` access is just `undefined` — safe, not mined) join the generic atMs-array scan.
  for (const arr of [p.items, p.lines, p.bullets, p.words, p.points, p.data]) {
    if (Array.isArray(arr)) for (const x of arr) if (typeof x?.atMs === "number") ev.push(x.atMs);
  }
  if (typeof p.flipAtMs === "number") ev.push(p.flipAtMs);
  if (typeof p.titleAtMs === "number") ev.push(p.titleAtMs);
  if (typeof p.punchMs === "number") ev.push(p.punchMs);
  if (typeof p.revealAtMs === "number") ev.push(p.revealAtMs); // Comparison, BarChart, LineChart, PieChart, RadarChart
  if (typeof p.atMs === "number") ev.push(p.atMs); // LogoReveal
  if (typeof p.entamAtMs === "number") ev.push(p.entamAtMs); // DeviceFrame, HFAsset, PricingCard
  if (typeof p.captionAtMs === "number") ev.push(p.captionAtMs); // KenBurns
  if (typeof p.quoteAtMs === "number") ev.push(p.quoteAtMs); // QuoteCard

  // WebGL tier (PlanScenes.tsx wrappers): mine the raw components' scene-local FRAME timing
  // props and convert to absolute ms. Defaults below mirror the raw components exactly so an
  // unconfigured 3D scene mines the same span it actually renders.
  if (s.component === "Text3DHero") {
    // Text3D.tsx: per-char entrance starts at startFrame (default 0), each glyph delayed by
    // `stagger` (default 3). Mine the first and last glyph entrance so the reveal reads as a
    // real span, not a single instant.
    const startFrame = typeof p.startFrame === "number" ? p.startFrame : 0;
    const stagger = typeof p.stagger === "number" ? p.stagger : 3;
    const chars = typeof p.text === "string" ? p.text.length : 1;
    ev.push(frameToMs(startFrame));
    ev.push(frameToMs(startFrame + Math.max(0, chars - 1) * stagger));
  } else if (s.component === "ParticleText") {
    // ParticleText.tsx: a static `progress` number overrides the enter/exit timeline (the
    // scene is then frame-static — nothing to mine beyond startMs). Otherwise mine the
    // enter (default {at:0,duration:45}) and optional exit scatter spans.
    if (typeof p.progress !== "number") {
      const enter = p.enter && typeof p.enter.at === "number" ? p.enter : { at: 0, duration: 45 };
      ev.push(frameToMs(enter.at));
      if (typeof enter.duration === "number") ev.push(frameToMs(enter.at + enter.duration));
      if (p.exit && typeof p.exit.at === "number") {
        ev.push(frameToMs(p.exit.at));
        if (typeof p.exit.duration === "number") ev.push(frameToMs(p.exit.at + p.exit.duration));
      }
    }
  } else if (s.component === "Attractor") {
    // Attractor.tsx: the sculpture draws in over [revealStart, revealEnd] (defaults 0 → 120
    // frames). Mine both ends so the draw-in is a real, extendable R2 span.
    const revealStart = typeof p.revealStart === "number" ? p.revealStart : 0;
    const revealEnd = typeof p.revealEnd === "number" ? p.revealEnd : 120;
    ev.push(frameToMs(revealStart));
    ev.push(frameToMs(revealEnd));
  } else if (s.component === "GlassHero") {
    // GlassHero's raw object only spins/floats continuously — nothing discrete. PlanScenes.tsx's
    // wrapper adds a frame-valued entrance scale-in over [revealStart, revealEnd] (defaults 0 → 30
    // frames, = 0 → 1000ms at fps 30), matched here so an unconfigured GlassHero mines its true
    // reveal span. NOTE: that 1000ms reveal is the scene's ONLY R2 event, so a GlassHero beat
    // longer than maxGapMs STILL fails R2 — correctly, and now FIXABLY: the author extends
    // revealEnd to cover the beat, or splits it, instead of the scene being unpaceable.
    const revealStart = typeof p.revealStart === "number" ? p.revealStart : 0;
    const revealEnd = typeof p.revealEnd === "number" ? p.revealEnd : 30;
    ev.push(frameToMs(revealStart));
    ev.push(frameToMs(revealEnd));
  }

  // --- Reference-cohort primitives (2026-07-16). ---
  // KaraokeCaption: its `words[]` are `{text, startMs, endMs}` (whisper shape, plan-ABSOLUTE
  // ms) — NOT the `{atMs}` shape the generic array scan above mines, so those onsets would
  // otherwise be invisible to R2 and a multi-word caption scene (naturally 3-8s to let the
  // VO run) would trip the gap check with only startMs as an event. Each spoken word's onset
  // is a genuine visual event (a new word lights up in the band), so mine every `startMs`.
  // The scan is component-guarded so Payoff's own `p.words` (which DO carry `atMs`, already
  // mined above) can't be double-counted or misread here.
  if (s.component === "KaraokeCaption") {
    for (const w of p.words ?? []) if (typeof w?.startMs === "number") ev.push(w.startMs);
  } else if (s.component === "CTAEndPlate") {
    // CTAEndPlate choreographs a scrim → headline → staggered action-cards → brand → nudge
    // entrance whose timings are SCENE-LOCAL ms props (CTAEndPlate.tsx converts them via
    // msToFrame the same way every beat-driven component does). Convert each to an absolute
    // event (s.startMs + localMs) so the plate's own reveal beats pace the scene — without
    // this, a CTA plate held longer than maxGapMs (comment-bait closers want to breathe for
    // 5-8s) declares only startMs and trips R2 with no fixable in-component beat. Defaults
    // mirror CTAEndPlate.tsx exactly so an unconfigured plate mines the span it actually plays.
    const scrimMs = typeof p.scrimMs === "number" ? p.scrimMs : 0;
    const headlineMs = typeof p.headlineMs === "number" ? p.headlineMs : 260;
    const cardsMs = typeof p.cardsMs === "number" ? p.cardsMs : 720;
    const cardStaggerMs = typeof p.cardStaggerMs === "number" ? p.cardStaggerMs : 95;
    const brandMs = typeof p.brandMs === "number" ? p.brandMs : 1180;
    const nudgeMs = typeof p.nudgeMs === "number" ? p.nudgeMs : 1420;
    const nCards = Array.isArray(p.actions) ? p.actions.length : 3;
    ev.push(s.startMs + scrimMs, s.startMs + headlineMs, s.startMs + brandMs, s.startMs + nudgeMs);
    for (let i = 0; i < Math.max(1, nCards); i++) ev.push(s.startMs + cardsMs + i * cardStaggerMs);
  } else if (s.component === "CtaPlate") {
    // CtaPlate (SharedVisualPrimitives.tsx, 2026-08-03 rewrite) stages kicker -> headline ->
    // rule -> subline at fixed ms offsets off its own `atMs`, THEN reveals `cards` as chips
    // (already mined by the generic mineArrays pass above via the KNOWN_COMPONENTS manifest
    // entry). Without this the plate's real internal choreography — the exact fix that closed
    // this component's density-audit gap — would be invisible to R2/the density audit despite
    // genuinely being on screen. Offsets mirror the component exactly; keep them in sync.
    const base = typeof p.atMs === "number" ? p.atMs : s.startMs;
    ev.push(base, base + 220, base + 520, base + 760);
  } else if (s.component === "SaasKineticTypeSweep") {
    // SaasKineticTypeSweep (SaasLaunchFilmScenes.tsx) staggers each `lines[]` entry's spring
    // reveal by `i * 8` frames off the scene's own start. `lines` is a bare string[] (no
    // {atMs} shape), so the generic mineArrays pass above can't see these beats at all — the
    // scene otherwise mines only its own startMs, understating a real, fast 3-word reveal as
    // a single static beat.
    const lineCount = Array.isArray(p.lines) ? p.lines.length : 0;
    for (let i = 0; i < lineCount; i++) ev.push(s.startMs + Math.round((i * 8 * 1000) / fps));
  }

  // --- ref2 recreation cohort. Every timed prop these components render is mined so R2
  // stays a genuine pacing check on recreate scenes: flat arrays carrying atMs (`stack`
  // kinetic words, `tiles` icon drop-ins, `patches` checkmark chips), the nested
  // `chips.items` badge grid and `terminal.rows` content rows, the scalar beat props
  // (connectors/tile/label/keycap/sketch/dim/glyph/handle/slide), and the pill/bar
  // sub-objects' own beats. Shapes mirror RecreateScenes.tsx's props exactly.
  if (RECREATE_COMPONENTS.has(s.component)) {
    // Array-carried beats and scalar beats derive from COMPONENT_MANIFEST (RECREATE_MINE_ARRAYS/
    // RECREATE_MINE_BEATS — the union across every entry, see the manifest header). Array paths
    // may be dotted ("chips.items", "terminal.rows"). p.lines (NumberedCard's step lines) is
    // among the array paths so a long NumberedCard paced ONLY by its line reveals stays R2-legal;
    // the generic atMs-array scan above ALSO covers it, harmless belt-and-suspenders (duplicate
    // events sort to a 0ms gap). The pill/bar/keycap/terminal.slide nested-beat shapes below are
    // structurally distinct (nested objects, a computed end span) and stay as an explicit shared
    // block rather than manifest data.
    for (const path of RECREATE_MINE_ARRAYS) {
      const arr = readPath(p, path);
      if (Array.isArray(arr)) for (const x of arr) if (typeof x?.atMs === "number") ev.push(x.atMs);
    }
    for (const k of RECREATE_MINE_BEATS) {
      if (typeof p[k] === "number") ev.push(p[k]);
    }
    if (typeof p.terminal?.slideAtMs === "number") ev.push(p.terminal.slideAtMs);
    if (typeof p.keycap?.atMs === "number") ev.push(p.keycap.atMs);
    if (typeof p.pill?.atMs === "number") {
      ev.push(p.pill.atMs);
      // the pill's tick is a continuous count over durMs (default 2400 in CostPill) —
      // mine its end too so a long tick reads as the span it actually animates.
      ev.push(p.pill.atMs + (typeof p.pill.durMs === "number" ? p.pill.durMs : 2400));
    }
    if (typeof p.bar?.atMs === "number") ev.push(p.bar.atMs);
    if (typeof p.bar?.flipAtMs === "number") ev.push(p.bar.flipAtMs);
    // TrajectoryMap's optional trajectory arc has its own scalar beat, nested one level down
    // (not a top-level *AtMs prop, so RECREATE_MINE_BEATS above can't see it).
    if (typeof p.trajectory?.atMs === "number") ev.push(p.trajectory.atMs);
  }

  return ev.sort((a, b) => a - b);
};

// Collect every piece of on-screen text a scene shows, with the ms it appears from.
export const sceneTexts = (s) => {
  const p = s.props ?? {};
  const out = [];
  if (Array.isArray(p.lines) && s.component === "Headline") {
    // Guard each line: a malformed plan (weak LLM) may give non-array/null lines; the lint
    // gate must report that as a structured failure (R8 below), never crash on line.join.
    const wordLines = p.lines.filter((line) => Array.isArray(line));
    out.push({ text: wordLines.flat().join(" "), fromMs: s.startMs, role: "display" });
    for (const line of wordLines) out.push({ text: line.join(" "), fromMs: s.startMs, role: "displayLine" });
  }
  for (const b of p.bullets ?? []) {
    // typeof-guard like every other text field below: a malformed plan (weak LLM) may give
    // a bullet with a missing/non-string `text`; without this, R3's `t.text.length` throws
    // on undefined/null and R4's measureSpanPx `for..of` throws "not iterable" on a number/
    // object — a raw crash out of lint() instead of the structured result every caller expects.
    if (typeof b?.text === "string") out.push({ text: b.text, fromMs: b.atMs, role: "bullet" });
  }
  if (!COMPONENT_MANIFEST[s.component]) {
    for (const l of p.lines ?? []) {
      // Terminal and CodeDiff share the exact `lines[].text/atMs` shape but render at
      // different sizes inside different widths (CodeDiff reserves a gutter+border) — route
      // by component so each gets its own real ROLE_RENDER entry instead of silently
      // measuring CodeDiff's lines against Terminal's spec (or vice versa). Manifest cohort
      // components that carry `lines[].text/atMs` (NumberedCard) are handled by their own
      // COMPONENT_MANIFEST textRole below (numberedCardLine — see that entry's comment for why
      // the hook's centered kineticLine geometry was the wrong budget), so this generic loop
      // skips every manifest component to avoid routing their lines through the wrong role.
      if (typeof l?.text === "string") {
        const lineRole = s.component === "CodeDiff" ? "codeDiffLine" : "terminal";
        out.push({ text: l.text, fromMs: l.atMs, role: lineRole });
      }
    }
  }
  for (const w of p.words ?? []) {
    // same typeof guard as bullets above — Payoff words with a missing/non-string `text`
    // must be skipped, not crash R3/R4.
    if (typeof w?.text === "string") out.push({ text: w.text, fromMs: w.atMs, role: "payoffWord" });
  }
  // p.items is shared by WordCycle ({word}) and Listicle ({n,text}) — mine by shape.
  for (const it of p.items ?? []) {
    if (typeof it?.word === "string") out.push({ text: it.word, fromMs: it.atMs, role: "cycleWord" });
    if (typeof it?.text === "string") out.push({ text: it.text, fromMs: it.atMs, role: "listItem" });
  }
  // Comparison: left column shows from scene start, right column from the reveal beat.
  for (const [side, fromMs] of [
    [p.left, s.startMs],
    [p.right, p.revealAtMs ?? s.startMs],
  ]) {
    if (!side || !Array.isArray(side.items)) continue;
    if (typeof side.label === "string") out.push({ text: side.label, fromMs, role: "compareLabel" });
    for (const item of side.items) {
      if (typeof item === "string") out.push({ text: item, fromMs, role: "compareItem" });
    }
  }
  // LogoReveal: the wordmark wipes in from scene start; tagline lands on the beat.
  if (s.component === "LogoReveal" && typeof p.text === "string") {
    out.push({ text: p.text, fromMs: s.startMs, role: "logoText" });
    if (typeof p.tagline === "string") out.push({ text: p.tagline, fromMs: p.atMs ?? s.startMs, role: "tagline" });
  }
  // StatFlip: the label renders kicker-weight below the numeral, from scene start.
  // Mined so R3/R4 catch an overflowing label instead of it escaping the gate entirely.
  if (s.component === "StatFlip" && typeof p.label === "string") {
    out.push({ text: p.label, fromMs: s.startMs, role: "statLabel" });
  }
  // StatFlip: the giant `from`/`to` values are the hero numeral. StatFlip.tsx auto-fits each
  // to the safe box (fontSize = min(340, floor(SAFE.w*1.3/len)), per-string), the same
  // LogoReveal/CountUp-shaped formula — so both get the statFlipValue auto-fit R4 treatment
  // (below), NOT a static ROLE_RENDER row. Added after a real render caught "$3.50" running
  // off BOTH frame edges at the old fixed 340px (QA showcase defect). `from` shows from scene
  // start; `to` lands on the flip beat.
  if (s.component === "StatFlip") {
    if (typeof p.from === "string") out.push({ text: p.from, fromMs: s.startMs, role: "statFlipValue" });
    if (typeof p.to === "string") out.push({ text: p.to, fromMs: p.flipAtMs ?? s.startMs, role: "statFlipValue" });
  }
  // Countdown: same "optional kicker label below the numeral" shape as StatFlip.
  if (s.component === "Countdown" && typeof p.label === "string") {
    out.push({ text: p.label, fromMs: s.startMs, role: "countdownLabel" });
  }
  // p.title role collision (HARDENING.md Gap #3): Terminal's window title is mono 28px
  // window chrome, not a headline — give it its own budget instead of the shared 20-char
  // headline ceiling, which would falsely reject a legal (but longer) terminal title.
  if (typeof p.title === "string") {
    // typeof-guard (was a bare truthy `if (p.title)`, which let a non-string title — e.g. a
    // number from a malformed plan — through to measureSpanPx's `for..of` and crash lint()).
    // CodeDiff's title bar deliberately mirrors Terminal.tsx's chrome layout exactly (see
    // CodeDiff.tsx's own header comment) so it can legitimately share terminalTitle here.
    const titleRole = s.component === "Terminal" || s.component === "CodeDiff" ? "terminalTitle" : "headline";
    out.push({ text: p.title, fromMs: p.titleAtMs ?? s.startMs, role: titleRole });
  }
  // KenBurns/HFAsset: optional caption lands on its own beat (defaults to scene start).
  // Same role/budget for both — both are full-bleed media with an optional overlay line.
  if ((s.component === "KenBurns" || s.component === "HFAsset") && typeof p.caption === "string") {
    out.push({ text: p.caption, fromMs: p.captionAtMs ?? s.startMs, role: "caption" });
  }
  // DeviceFrame: fake address-bar text is visible from the scene's entrance beat.
  if (s.component === "DeviceFrame" && typeof p.url === "string") {
    out.push({ text: p.url, fromMs: p.entamAtMs ?? s.startMs, role: "deviceUrl" });
  }
  // --- Onda-ported components ---
  // BarChart: each bar's label lands on its own atMs beat (see BarChart.tsx — adapted to
  // per-bar VO beats rather than Onda's single auto-staggered reveal).
  if (s.component === "BarChart") {
    for (const d of p.data ?? []) {
      if (typeof d?.label === "string") out.push({ text: d.label, fromMs: d.atMs, role: "barLabel" });
    }
  }
  // Timeline: each point's label lands on its own atMs beat (mirrors Listicle's items).
  if (s.component === "Timeline") {
    for (const pt of p.points ?? []) {
      if (typeof pt?.label === "string") out.push({ text: pt.label, fromMs: pt.atMs, role: "timelineLabel" });
    }
  }
  // PricingCard: all tiers land together on the one entamAtMs beat (defaults to scene
  // start) — matches Comparison's single-trigger-beat-for-a-column-group precedent.
  if (s.component === "PricingCard") {
    const tiersFrom = p.entamAtMs ?? s.startMs;
    for (const t of p.tiers ?? []) {
      if (!t) continue;
      if (typeof t.tier === "string") out.push({ text: t.tier, fromMs: tiersFrom, role: "tierName" });
      if (typeof t.price === "string") out.push({ text: t.price, fromMs: tiersFrom, role: "tierPrice" });
      if (typeof t.cta === "string") out.push({ text: t.cta, fromMs: tiersFrom, role: "tierCta" });
      for (const f of t.features ?? []) {
        if (typeof f === "string") out.push({ text: f, fromMs: tiersFrom, role: "tierFeature" });
      }
    }
  }
  // QuoteCard: quote reveals from quoteAtMs (defaults to scene start); attribution
  // (author/role) trails it by QuoteCard.tsx's fixed ATTRIBUTION_DELAY (65+13+4=82
  // frames @ 30fps ≈ 2733ms) — a real, matching constant, not a guess, so R3's dwell
  // check for author/role isn't measuring from a beat earlier than they actually appear.
  if (s.component === "QuoteCard") {
    const quoteFrom = p.quoteAtMs ?? s.startMs;
    if (typeof p.quote === "string") out.push({ text: p.quote, fromMs: quoteFrom, role: "quote" });
    const QUOTE_ATTRIBUTION_DELAY_MS = Math.round((82 * 1000) / 30);
    const attributionFrom = quoteFrom + QUOTE_ATTRIBUTION_DELAY_MS;
    if (typeof p.author === "string") out.push({ text: p.author, fromMs: attributionFrom, role: "attribution" });
    if (typeof p.role === "string") out.push({ text: p.role, fromMs: attributionFrom, role: "attribution" });
  }
  // --- Second Onda-porting wave (lower-third, chapter-card, stat-card, pie-reveal,
  // count-up, kanban-board). PieChart renders no Director-authored text at all (see
  // ROLE_RENDER's comment above), so it's the one of the six not mined here. ---
  // LowerThird: name reveals at entamAtMs (defaults to scene start); role trails it by
  // LowerThird.tsx's fixed ROLE_OFFSET (4 frames @ 30fps ≈ 133ms) — a real, matching
  // constant, not a guess (same convention QuoteCard's ATTRIBUTION_DELAY uses above). Note:
  // `p.role` here is LowerThird's own "job title" prop — an English-word coincidence with
  // this function's `role:` output tag, not a code collision (see LowerThird.tsx's comment).
  if (s.component === "LowerThird") {
    const nameFrom = p.entamAtMs ?? s.startMs;
    if (typeof p.name === "string") out.push({ text: p.name, fromMs: nameFrom, role: "lowerThirdName" });
    const ROLE_OFFSET_MS = Math.round((4 * 1000) / 30);
    if (typeof p.role === "string") out.push({ text: p.role, fromMs: nameFrom + ROLE_OFFSET_MS, role: "lowerThirdRole" });
  }
  // ChapterCard: number (eyebrow) reveals at entamAtMs (defaults to scene start); chapter
  // title trails it by ChapterCard.tsx's fixed TITLE_OFFSET (10 frames @ 30fps ≈ 333ms).
  if (s.component === "ChapterCard") {
    const numberFrom = p.entamAtMs ?? s.startMs;
    if (typeof p.number === "string") out.push({ text: p.number, fromMs: numberFrom, role: "chapterNumber" });
    const TITLE_OFFSET_MS = Math.round((10 * 1000) / 30);
    if (typeof p.chapter === "string") out.push({ text: p.chapter, fromMs: numberFrom + TITLE_OFFSET_MS, role: "chapterTitle" });
  }
  // StatCard: label cascades in starting LABEL_OFFSET frames after entamAtMs (defaults to
  // scene start) — StatCard.tsx's COUNT_DURATION(24) - STAGGER*2(4) = 20 frames ≈ 667ms, a
  // real, matching constant.
  if (s.component === "StatCard") {
    const LABEL_OFFSET_MS = Math.round((20 * 1000) / 30);
    if (typeof p.label === "string") {
      out.push({ text: p.label, fromMs: (p.entamAtMs ?? s.startMs) + LABEL_OFFSET_MS, role: "statCardLabel" });
    }
    // The counted number itself: auto-fit like LogoReveal's wordmark, not "rendered as-is"
    // (see the countUpValue/statCardValue R4 special-case above — a real render caught a
    // fixed-size version of this overflowing off-canvas). Mined from `value` (the TARGET),
    // matching StatCard.tsx's own fontSize computation exactly.
    if (typeof p.value === "number") {
      const prefix = typeof p.prefix === "string" ? p.prefix : "";
      const suffix = typeof p.suffix === "string" ? p.suffix : "";
      const text = `${prefix}${p.value.toLocaleString("en-US")}${suffix}`;
      out.push({ text, fromMs: p.entamAtMs ?? s.startMs, role: "statCardValue" });
    }
  }
  // CountUp: the counted number is auto-fit like LogoReveal's wordmark, not "rendered
  // as-is" — see the countUpValue R4 special-case above. Mined from `to` (the TARGET
  // value), matching CountUp.tsx's own fontSize computation exactly.
  if (s.component === "CountUp" && typeof p.to === "number") {
    const prefix = typeof p.prefix === "string" ? p.prefix : "";
    const suffix = typeof p.suffix === "string" ? p.suffix : "";
    const text = `${prefix}${p.to.toLocaleString("en-US")}${suffix}`;
    out.push({ text, fromMs: p.revealAtMs ?? s.startMs, role: "countUpValue" });
  }
  // KanbanBoard: all column titles and ticket cards land together on the one entamAtMs
  // beat (defaults to scene start) — matches PricingCard's single-trigger-beat-for-a-
  // group precedent (the internal per-card stagger is a sub-beat cascade, not a separate
  // R2/R3 event, same simplification PricingCard's own tiersFrom already makes).
  // Icon wiring (icon-set integration wave): a card is either a plain string (pre-icon
  // shape) or `{text, icon?}` (KanbanBoard.tsx's own `Card` union / `cardOf()`) — mine the
  // text out of either shape so an icon-carrying card's text still gets R3/R4 coverage,
  // matching KanbanBoard.tsx's own normalization exactly.
  if (s.component === "KanbanBoard") {
    const boardFrom = p.entamAtMs ?? s.startMs;
    for (const col of p.columns ?? []) {
      if (!col) continue;
      if (typeof col.title === "string") out.push({ text: col.title, fromMs: boardFrom, role: "kanbanColumnTitle" });
      for (const c of col.cards ?? []) {
        const cardText = typeof c === "string" ? c : typeof c?.text === "string" ? c.text : undefined;
        if (typeof cardText === "string") out.push({ text: cardText, fromMs: boardFrom, role: "kanbanCardText" });
      }
    }
  }
  // RadarChart: axis labels and series legend names all land together on the one
  // revealAtMs beat (defaults to scene start) — matches LineChart/PieChart's own "read as
  // one shape, not narrated point-by-point" single-beat precedent (see RadarChart.tsx's
  // own header comment).
  if (s.component === "RadarChart") {
    const revealFrom = p.revealAtMs ?? s.startMs;
    for (const ax of p.axes ?? []) {
      if (typeof ax?.label === "string") out.push({ text: ax.label, fromMs: revealFrom, role: "radarAxisLabel" });
    }
    for (const sr of p.series ?? []) {
      if (typeof sr?.name === "string") out.push({ text: sr.name, fromMs: revealFrom, role: "radarSeriesName" });
    }
  }
  // --- ref2 recreation cohort. Three text roles, each budgeted against the component's
  // real render (RecreateKit.tsx): kineticLine (StackBlock words, 88-96px display/script,
  // one short line each — char-budget only, no compiled metrics for Lobster), refTerminal
  // (TerminalCard rows at 28px mono inside the 940px card — long rows WRAP by design,
  // matching the reference's own wrapped command chip, so the budget caps runaway prose
  // rather than modeling a hard clip), refChip (badge-grid/patch-chip labels, 27-31px
  // bold mono, single line). `tag` rows use segs (short bracketed status text) and carry
  // no free-form text worth budgeting.
  if (RECREATE_COMPONENTS.has(s.component)) {
    // Shared cohort text mining — applies uniformly to EVERY manifest component (it isn't
    // per-component data, so it stays here rather than in COMPONENT_MANIFEST): kineticLine
    // (StackBlock words), refTerminal (TerminalCard rows, text + text2), refChip (badge-grid
    // and patch-chip labels). See LINE_BUDGETS for each role's real-render geometry.
    for (const w of p.stack ?? []) {
      if (typeof w?.text === "string") out.push({ text: w.text, fromMs: w.atMs ?? s.startMs, role: "kineticLine" });
    }
    for (const r of p.terminal?.rows ?? []) {
      if (typeof r?.text === "string") out.push({ text: r.text, fromMs: r.atMs ?? s.startMs, role: "refTerminal" });
      if (typeof r?.text2 === "string") out.push({ text: r.text2, fromMs: r.atMs ?? s.startMs, role: "refTerminal" });
    }
    for (const c of p.chips?.items ?? []) {
      if (typeof c?.text === "string") out.push({ text: c.text, fromMs: c.atMs ?? s.startMs, role: "refChip" });
    }
    for (const c of p.patches ?? []) {
      if (typeof c?.text === "string") out.push({ text: c.text, fromMs: c.atMs ?? s.startMs, role: "refChip" });
    }
    // Per-component text roles declared in COMPONENT_MANIFEST (the drift-prone registrations
    // three review rounds each caught a miss in — HubDiagram center/node labels, IconReveal's
    // cursive name, NumberedCard's step lines). Applied AFTER the shared block so array order
    // matches the pre-manifest per-component blocks exactly (e.g. IconReveal: kineticLine from
    // `stack` first, then iconRevealLabel). Two entry shapes: a scalar `prop` (with optional
    // `routeBy` re-routing, e.g. HubDiagram vertical pill) or an `array` of per-element text.
    for (const tr of COMPONENT_MANIFEST[s.component]?.textRoles ?? []) {
      if (tr.array) {
        const arr = Array.isArray(p[tr.array]) ? p[tr.array] : [];
        arr.forEach((el, i) => {
          const text = el?.[tr.textKey];
          if (typeof text === "string") out.push({ text, fromMs: tr.fromEach(el, i, p, s), role: tr.role });
        });
      } else if (tr.prop) {
        const text = p[tr.prop];
        if (typeof text === "string") {
          const role = tr.routeBy && p[tr.routeBy.prop] === tr.routeBy.value ? tr.routeBy.role : tr.role;
          out.push({ text, fromMs: tr.from(p, s), role });
        }
      }
    }
  }
  return out;
};

/**
 * Run the full deterministic lint rule set against a scene plan.
 *
 * @param {object} plan - parsed plan.json (see src/schema/plan.ts)
 * @param {object} transcript - parsed transcript.json (whisper-style word timestamps)
 * @param {object} [familyTokens] - active Family tokens (src/tokens/types.ts shape, or the
 *   plain-JSON shape from src/tokens/compiled/families.json). First real consumer: R4's
 *   pixel-width fit check reads familyTokens.fonts.{display,mono} (which font to measure
 *   against — Space Grotesk vs Sora) and familyTokens.type.*.letterSpacing (tracking
 *   differs slightly signal vs abrxr). Still not consulted by R1-R3/R5-R9 — threaded
 *   through so more family-aware rules (e.g. the ARCHITECTURE.md §9 R10 "brand rules, per
 *   family" such as the abrxr watermark) can land later without another signature change.
 * @param {object} [preset] - active preset (presets/<id>.json shape, schema/preset.ts) —
 *   `preset.dials.{motion,density,variance}` resolves via presets/dials.mjs's
 *   resolveDials() to the concrete R2/R3/R6/R7 thresholds below. Omitted or missing
 *   `.dials` falls back to DEFAULT_THRESHOLDS, which equals resolveDials(BALANCED_DIALS)
 *   exactly — so "no preset" and "the balanced preset" always behave identically, and
 *   every plan that predates the preset system lints exactly as it did before.
 * @returns {{failures: Array<{ruleId:string,sceneId?:string,message:string,fixHint?:string}>,
 *            warnings: Array<{ruleId:string,sceneId?:string,message:string,fixHint?:string}>}}
 */
export function lint(plan, transcript, familyTokens, preset) {
  const thresholds = preset?.dials ? resolveDials(preset.dials) : DEFAULT_THRESHOLDS;

  const failures = [];
  const warnings = [];
  const fail = (ruleId, message, extra) => failures.push({ ruleId, message, ...extra });
  const warn = (ruleId, message, extra) => warnings.push({ ruleId, message, ...extra });

  // R0 — shape guard: a malformed top-level plan/transcript (null, an array, a scalar, or
  // an object missing .scenes/.transcription) used to throw a raw TypeError deep inside a
  // rule ("plan.scenes is not iterable", "Cannot read properties of null") instead of the
  // structured {failures,warnings} every caller (CLI, MCP, edit.mjs) expects and handles.
  // Every rule below assumes plan.scenes and transcript.transcription are non-empty
  // arrays; fail fast and return before any of them run if that's not true.
  const describeShape = (x) => (Array.isArray(x) ? "an array" : x === null ? "null" : typeof x);
  if (plan === null || typeof plan !== "object" || Array.isArray(plan) || !Array.isArray(plan.scenes)) {
    fail("R0", `plan is not a valid plan object (expected {scenes: [...], ...}), got ${describeShape(plan)}`);
    return { failures, warnings };
  }
  if (
    transcript === null ||
    typeof transcript !== "object" ||
    Array.isArray(transcript) ||
    !Array.isArray(transcript.transcription)
  ) {
    fail(
      "R0",
      `transcript is not a valid transcript object (expected {transcription: [...]}), got ${describeShape(transcript)}`,
    );
    return { failures, warnings };
  }
  if (plan.scenes.length === 0) {
    fail("R0", "plan.scenes is empty — at least one scene is required");
    return { failures, warnings };
  }

  const mediaSlotIds = new Set((Array.isArray(plan.mediaSlots) ? plan.mediaSlots : []).map((slot) => slot?.id).filter((id) => typeof id === "string"));
  const sourceClipIds = new Set((Array.isArray(plan.sourceClips) ? plan.sourceClips : []).map((clip) => clip?.id).filter((id) => typeof id === "string"));
  const editDecisionIds = new Set((Array.isArray(plan.editDecisions) ? plan.editDecisions : []).map((decision) => decision?.id).filter((id) => typeof id === "string"));

  for (const [kind, ids] of [
    ["mediaSlots", mediaSlotIds],
    ["sourceClips", sourceClipIds],
    ["editDecisions", editDecisionIds],
  ]) {
    const arr = Array.isArray(plan[kind]) ? plan[kind] : [];
    if (arr.length !== ids.size) fail("R0", `${kind} contains duplicate or invalid ids`);
  }

  for (const decision of Array.isArray(plan.editDecisions) ? plan.editDecisions : []) {
    if (typeof decision?.sourceClip === "string" && !sourceClipIds.has(decision.sourceClip)) {
      fail("R0", `editDecision "${decision.id}" references unknown sourceClip "${decision.sourceClip}"`);
    }
  }

  for (const s of plan.scenes) {
    if (typeof s.startMs === "number" && typeof s.endMs === "number" && s.endMs <= s.startMs) {
      fail("R0", `scene "${s.id}" has zero or negative duration (startMs=${s.startMs}, endMs=${s.endMs}) — Remotion crashes on this at render time`, { sceneId: s.id });
    }
  }

  for (const s of plan.scenes) {
    const p = s.props ?? {};
    if (typeof p.mediaSlotId === "string" && !mediaSlotIds.has(p.mediaSlotId)) {
      fail("R0", `scene "${s.id}" references unknown mediaSlotId "${p.mediaSlotId}"`, { sceneId: s.id });
    }
    if (typeof p.sourceClipId === "string" && !sourceClipIds.has(p.sourceClipId)) {
      fail("R0", `scene "${s.id}" references unknown sourceClipId "${p.sourceClipId}"`, { sceneId: s.id });
    }
    if (typeof p.editDecisionId === "string" && !editDecisionIds.has(p.editDecisionId)) {
      fail("R0", `scene "${s.id}" references unknown editDecisionId "${p.editDecisionId}"`, { sceneId: s.id });
    }
  }
  if (failures.length > 0) return { failures, warnings };

  const wordStarts = transcript.transcription
    .filter((w) => w.text.trim().length > 0)
    .map((w) => w.offsets.from);

  // R1 — audio lock: every scene boundary (after the first) sits on a word start (±80ms)
  for (const s of plan.scenes) {
    if (s.startMs === 0) continue;
    const nearest = wordStarts.reduce((best, w) => (Math.abs(w - s.startMs) < Math.abs(best - s.startMs) ? w : best));
    if (Math.abs(nearest - s.startMs) > 80) {
      fail("R1", `scene "${s.id}" starts at ${s.startMs}ms, nearest word start is ${nearest}ms`, {
        sceneId: s.id,
        fixHint: `set startMs to ${nearest} (nearest word start)`,
      });
    }
  }

  // R2 — pacing: hook ≤ thresholds.hookMaxMs (default 4s); no visual gap >
  // thresholds.maxGapMs (default 4s) anywhere. Both driven by the active preset's
  // `motion` dial — see presets/dials.mjs.
  const hook = plan.scenes[0];
  if (hook.endMs - hook.startMs > thresholds.hookMaxMs) {
    fail("R2", `hook is ${hook.endMs - hook.startMs}ms (> ${thresholds.hookMaxMs}ms)`, {
      sceneId: hook.id,
      fixHint: `trim the hook scene to ${thresholds.hookMaxMs}ms or less`,
    });
  }
  // fps: plan.json's own field (all Root.tsx compositions + beats*.ts agree on 30). Threaded
  // into sceneEvents so the WebGL tier's frame-valued timing props convert to real ms events.
  const fps = typeof plan.fps === "number" ? plan.fps : 30;
  // overlays[] (ARCHITECTURE-V2.md §4 point 3): an Overlay has the exact same
  // {component, startMs, props} shape sceneEvents() reads off a Scene, so it mines
  // directly with no adapter. Merged into the SAME sorted event list the R2 gap check
  // walks below — this is the literal mechanism by which "overlay beats... ARE mined as
  // R2 events... precisely what makes ref1-style slow-cut reels legal": a long gap
  // between hard scene cuts is legal exactly when a persistent overlay's own beat (e.g.
  // TelemetryFrame's bootAtMs, or a future ProgressHUD's checkpoint/score-tick array)
  // falls inside it.
  const overlays = plan.overlays ?? [];
  const allEvents = [...plan.scenes.flatMap((s) => sceneEvents(s, fps)), ...overlays.flatMap((o) => sceneEvents(o, fps))].sort(
    (a, b) => a - b,
  );
  allEvents.push(plan.durationMs);
  for (let i = 1; i < allEvents.length; i++) {
    const gap = allEvents[i] - allEvents[i - 1];
    if (gap > thresholds.maxGapMs) {
      // HARDENING.md Gap #2: Comparison items have no per-item atMs — revealAtMs is the
      // scene's ONLY internal R2 event — so a Comparison scene over ~8s trips this gap
      // with no in-component fix available. Name it in the hint instead of leaving the
      // author to rediscover it.
      const spanning = plan.scenes.find(
        (s) => s.component === "Comparison" && s.startMs <= allEvents[i - 1] && s.endMs >= allEvents[i],
      );
      const comparisonNote =
        spanning && spanning.endMs - spanning.startMs > 8000
          ? ` — "${spanning.id}" is a Comparison scene >8s with only revealAtMs as an internal event; add an earlier revealAtMs or split it into two scenes`
          : "";
      fail("R2", `${gap}ms with no visual event between ${allEvents[i - 1]}ms and ${allEvents[i]}ms${comparisonNote}`, {
        fixHint: `add a visual event between ${allEvents[i - 1]}ms and ${allEvents[i]}ms${comparisonNote}`,
      });
    }
  }

  // Precompute each scene's on-screen text ONCE — R3 (dwell) and R4 (fit) both walk it, and
  // sceneTexts() is non-trivial (per-component mining + the manifest textRole loop). Keyed by
  // the scene object so both rules read the identical array instead of recomputing per rule.
  const textsByScene = new Map(plan.scenes.map((s) => [s, sceneTexts(s)]));

  // R3 — dwell: VO-synced text needs (visibleMs/1000) ≥ chars/thresholds.dwellCharsPerSec
  // (default 17). Driven by the active preset's `density` dial — see presets/dials.mjs.
  for (const s of plan.scenes) {
    for (const t of textsByScene.get(s)) {
      if (t.role === "displayLine") continue;
      const visible = (s.endMs - t.fromMs) / 1000;
      const need = t.text.length / thresholds.dwellCharsPerSec;
      if (visible < need) {
        fail("R3", `"${t.text}" in "${s.id}" visible ${visible.toFixed(2)}s, needs ${need.toFixed(2)}s`, {
          sceneId: s.id,
          fixHint: `extend "${s.id}".endMs by ≥${((need - visible) * 1000).toFixed(0)}ms or shorten the text`,
        });
      }
    }
  }

  // R4 — line fit: character-count pre-check, then real pixel-width measurement (see the
  // long comment above ROLE_RENDER/measureTextPx for why pixel width is now the
  // authoritative signal). If the character budget already fails, that's a real problem
  // on its own — report it and don't also run the pixel check on the same text (avoids
  // double-reporting one bad line as two separate R4 failures). Pixel check only runs
  // when familyTokens carries real font names AND this exact (family,weight) has compiled
  // metrics; otherwise it's a no-op and the character check is the only signal for that
  // text, exactly matching pre-rework behavior.
  const fonts = familyTokens?.fonts;
  for (const s of plan.scenes) {
    for (const t of sceneTexts(s)) {
      const max = LINE_BUDGETS[t.role];
      if (max && t.text.length > max) {
        fail("R4", `"${t.text}" (${t.text.length} chars) exceeds ${t.role} budget of ${max} in "${s.id}"`, {
          sceneId: s.id,
          fixHint: `shorten "${t.text}" to ≤${max} chars (or split across another line/scene)`,
        });
        continue;
      }
      if (!fonts?.display || !fonts?.mono) continue;

      if (t.role === "logoText") {
        // LogoReveal auto-fits its own fontSize from text length (component formula
        // duplicated here so lint can predict what actually renders — see LogoReveal.tsx
        // fontSize computation): fontSize = min(168, floor(SAFE.w*1.7/length)). Two
        // distinct failure modes share this role: the auto-fit size can drop below the
        // display legibility floor (the ORIGINAL rationale for the old 15-char budget,
        // now checked directly instead of approximated via char count), and — the new
        // check — even at whatever size it picks, a wide-glyph word can still overflow
        // the safe box the auto-fit formula assumes a flat average width for.
        const fontSize = Math.min(168, Math.floor((SAFE_W_PX * 1.7) / Math.max(t.text.length, 1)));
        if (fontSize < FONT_FLOOR_DISPLAY_PX) {
          fail(
            "R4",
            `"${t.text}" (${t.text.length} chars) auto-fits to ${fontSize}px in "${s.id}" — below the ${FONT_FLOOR_DISPLAY_PX}px display legibility floor`,
            {
              sceneId: s.id,
              fixHint: `shorten "${t.text}" so LogoReveal's auto-fit (SAFE.w*1.7/length) stays ≥${FONT_FLOOR_DISPLAY_PX}px`,
            },
          );
          continue;
        }
        const trackingEm = parseTrackingEm(familyTokens.type?.display?.letterSpacing);
        // LogoReveal spreads ...TYPE.display with no fontWeight override (see LogoReveal.tsx)
        // — the real render uses whatever weight the ACTIVE family's display role sets
        // (Signal/abrxr both happen to be 700, but voltage/redline are 800/900), not a
        // fixed literal. Falls back to 700 only if familyTokens is somehow incomplete.
        const weight = familyTokens.type?.display?.fontWeight ?? 700;
        const widthPx = measureTextPx(t.text, { family: fonts.display, weight, fontSize, trackingEm });
        if (widthPx !== null && widthPx > SAFE_W_PX) {
          // WARN, not fail: logoText is whiteSpace:"nowrap" with no overflow:hidden
          // ancestor, so an overflow doesn't clip a character — it bleeds toward/past the
          // safe margin intact (confirmed by rendering plan3.json's "reveal" scene; see
          // HARD_CLIP_ROLES' comment for the real "CLAUDE CODE" finding this caught).
          warn(
            "R4",
            `"${t.text}" renders ~${Math.round(widthPx)}px wide at its auto-fit ${fontSize}px in "${s.id}" — exceeds the ${SAFE_W_PX}px safe width (bleeds toward/past the safe margin rather than clipping, but LogoReveal's auto-fit assumes an average glyph width that wide letters exceed)`,
            {
              sceneId: s.id,
              fixHint: `shorten "${t.text}" (currently ~${Math.round(widthPx)}px, ${Math.round(widthPx - SAFE_W_PX)}px over) or reduce all-caps/wide-glyph usage`,
            },
          );
        }
        continue;
      }

      // CountUp/StatCard: BOTH auto-fit their own fontSize from the TARGET value's
      // formatted length (CountUp.tsx/StatCard.tsx — the same LogoReveal-shaped formula,
      // just a different cap/K each). Added after a real render caught a fixed-size
      // version of CountUp running a 6-char formatted number clean off the right edge of
      // the canvas (see CountUp.tsx's own comment) — these two roles get the identical
      // fail/warn treatment logoText gets above (kept as separate blocks rather than
      // refactoring logoText's own into a shared helper, since that's outside this
      // addition's scope), not the "rendered as-is" treatment BarChart's `value`/
      // PieChart's `%` get (those stay small/bounded in a fixed-size context and were
      // never at risk). No LINE_BUDGETS entry for either — unlike logoText's legacy
      // 15-char holdover from before the pixel rework, these are new roles with no prior
      // char-only regime to preserve; the auto-fit formula + pixel check are the real
      // (and only) R4 signal for both.
      // statFlipValue joins this block (2026-07-16): StatFlip.tsx's giant `from`/`to`
      // numeral used to render at a FIXED 340px with no width constraint, so a multi-glyph
      // value ("$3.50") ran off BOTH frame edges in the QA showcase render and this gate
      // did not catch it — StatFlip's values weren't mined at all. StatFlip.tsx now auto-fits
      // each value with the identical min(340, floor(SAFE.w*1.3/len)) formula CountUp uses
      // (same cap 340, same K 1.3), so it gets the same fail-below-floor / warn-over-safe-
      // width treatment here. An absurdly long value (≥13 chars) auto-fits below the 96px
      // display floor and FAILS — exactly the class the fixed-size version silently shipped.
      if (t.role === "countUpValue" || t.role === "statCardValue" || t.role === "statFlipValue") {
        const cap = t.role === "statCardValue" ? 220 : 340;
        const k = 1.3;
        const fontSize = Math.min(cap, Math.floor((SAFE_W_PX * k) / Math.max(t.text.length, 1)));
        if (fontSize < FONT_FLOOR_DISPLAY_PX) {
          fail(
            "R4",
            `"${t.text}" (${t.text.length} chars) auto-fits to ${fontSize}px in "${s.id}" — below the ${FONT_FLOOR_DISPLAY_PX}px display legibility floor`,
            {
              sceneId: s.id,
              fixHint: `shorten "${t.text}" (fewer digits, or drop prefix/suffix) so the auto-fit (SAFE.w*${k}/length, capped ${cap}px) stays ≥${FONT_FLOOR_DISPLAY_PX}px`,
            },
          );
          continue;
        }
        const trackingEm = parseTrackingEm(familyTokens.type?.stat?.letterSpacing);
        // Same real-weight derivation as logoText above — CountUp/StatCard spread
        // ...TYPE.stat with no fontWeight override, so the active family's stat weight is
        // what actually renders (700 for Signal/abrxr/hearth, 800 voltage, 900 redline).
        const weight = familyTokens.type?.stat?.fontWeight ?? 700;
        const widthPx = measureTextPx(t.text, { family: fonts.display, weight, fontSize, trackingEm });
        if (widthPx !== null && widthPx > SAFE_W_PX) {
          // WARN, not fail: whiteSpace:"nowrap" with no overflow:hidden ancestor (see
          // CountUp.tsx/StatCard.tsx) — an overflow bleeds toward/past the safe margin
          // intact rather than clipping a character, same category as logoText.
          warn(
            "R4",
            `"${t.text}" renders ~${Math.round(widthPx)}px wide at its auto-fit ${fontSize}px in "${s.id}" — exceeds the ${SAFE_W_PX}px safe width (bleeds toward/past the safe margin rather than clipping, but the auto-fit formula assumes an average glyph width that wide characters like "%" exceed)`,
            {
              sceneId: s.id,
              fixHint: `shorten "${t.text}" (currently ~${Math.round(widthPx)}px, ${Math.round(widthPx - SAFE_W_PX)}px over) or drop prefix/suffix`,
            },
          );
        }
        continue;
      }

      const spec = ROLE_RENDER[t.role];
      if (!spec) continue;
      const family = spec.fontRole === "mono" ? fonts.mono : fonts.display;
      const trackingEm = parseTrackingEm(familyTokens.type?.[spec.trackingRole]?.letterSpacing);
      // spec.weight is a cross-checked DEFAULT (every ROLE_RENDER component spreads
      // ...TYPE.<trackingRole> with no fontWeight override — verified across every
      // component's JSX), not a literal override: the real render uses whichever weight
      // the ACTIVE family sets for that type role. Signal/abrxr both happen to use 700/500
      // everywhere, which is why a hardcoded literal was invisible until voltage (800),
      // hearth (700), and redline (900) started actually differing per role.
      const weight = familyTokens.type?.[spec.trackingRole]?.fontWeight ?? spec.weight;
      const widthPx = measureTextPx(t.text, {
        family,
        weight,
        fontSize: spec.fontSize,
        trackingEm,
        wordGapPx: spec.wordGapPx,
      });
      if (widthPx === null) continue; // no compiled metrics for this (family,weight) — fall back to char-count only
      if (widthPx > spec.maxWidthPx) {
        // HARD_CLIP_ROLES fail (real character loss or off-canvas runoff, no fallback);
        // every other role warns (the real render wraps to a second line instead — a real
        // but lesser defect, see HARD_CLIP_ROLES' comment for the empirical basis).
        const report = HARD_CLIP_ROLES.has(t.role) ? fail : warn;
        report(
          "R4",
          `"${t.text}" renders ~${Math.round(widthPx)}px wide at ${spec.fontSize}px ${family} ${weight} in "${s.id}" — exceeds the ${spec.maxWidthPx}px ${t.role} safe width${HARD_CLIP_ROLES.has(t.role) ? "" : " (wraps to a 2nd line rather than clipping, but breaks the intended single-line layout)"}`,
          {
            sceneId: s.id,
            fixHint: `shorten "${t.text}" (currently ~${Math.round(widthPx)}px, ${Math.round(widthPx - spec.maxWidthPx)}px over ${t.role}'s ${spec.maxWidthPx}px safe width) or split across another line/scene`,
          },
        );
      }
    }
  }

  // R5 — coverage: contiguous scenes, full audio covered, ≥350ms tail after last word
  for (let i = 1; i < plan.scenes.length; i++) {
    if (plan.scenes[i].startMs !== plan.scenes[i - 1].endMs) {
      fail("R5", `gap/overlap between "${plan.scenes[i - 1].id}" and "${plan.scenes[i].id}"`, {
        sceneId: plan.scenes[i].id,
        fixHint: `set "${plan.scenes[i].id}".startMs to "${plan.scenes[i - 1].id}".endMs`,
      });
    }
  }
  if (plan.scenes.at(-1).endMs < plan.audioDurationMs + 350) {
    warn("R5", `plan ends ${plan.scenes.at(-1).endMs}ms, thin tail after audio (${plan.audioDurationMs}ms)`, {
      sceneId: plan.scenes.at(-1).id,
      fixHint: `extend the final scene's endMs to ≥${plan.audioDurationMs + 350}ms`,
    });
  }

  // R6 — color discipline: alert in ≤thresholds.maxAlertScenes (default 2) scenes;
  // payoff component only in the final (1-thresholds.payoffStartPct) (default 20%). Both
  // driven by the active preset's `variance` dial — see presets/dials.mjs. Structural
  // check on the tone field (a scene-level tone, or any item/word/line with
  // tone:"alert") — not a substring scan of the whole props blob, which false-positived
  // on any copy text that merely contained the word "alert".
  const hasAlertTone = (s) => {
    const p = s.props ?? {};
    if (p.tone === "alert") return true;
    for (const arr of [p.items, p.words, p.lines, p.bullets]) {
      if (Array.isArray(arr) && arr.some((x) => x && x.tone === "alert")) return true;
    }
    return false;
  };
  const alertScenes = plan.scenes.filter(hasAlertTone);
  if (alertScenes.length > thresholds.maxAlertScenes) {
    fail("R6", `alert tone used in ${alertScenes.length} scenes (max ${thresholds.maxAlertScenes})`, {
      fixHint: `drop tone/mark:"alert" from ${alertScenes.length - thresholds.maxAlertScenes} scene(s)`,
    });
  }
  const payoff = plan.scenes.find((s) => s.component === "Payoff");
  if (payoff && payoff.startMs < plan.durationMs * thresholds.payoffStartPct) {
    const pct = Math.round((1 - thresholds.payoffStartPct) * 100);
    fail("R6", `Payoff starts at ${payoff.startMs}ms — before final ${pct}% of the video`, {
      sceneId: payoff.id,
      fixHint: `move "${payoff.id}".startMs to ≥${Math.ceil(plan.durationMs * thresholds.payoffStartPct)}ms`,
    });
  }

  // R11 — glitch/impact budget. QUALITY-REVIEW.md's literal spec ("≤2 scenes may carry
  // glitch/impact... extends R6") fully duplicates R6 above, which already caps alert-tone
  // scenes at ≤2 — so per that doc's own fallback instruction, R11 instead caps the
  // COMBINED count of "slam" beats across the reel: alert-tone scenes (R6's signal) PLUS
  // StatFlip scenes PLUS LogoReveal scenes. Both StatFlip and LogoReveal render
  // styles/fx.tsx's <ImpactFlash> unconditionally on their beat (StatFlip.tsx:35,
  // LogoReveal.tsx:54) — a giant-numeral flip or a wordmark kick each already reads as an
  // "impact" moment even with tone:"default", and stacking several back-to-back is what
  // reads as gimmicky, not any single one. (Comparison.tsx:139 and Payoff.tsx:45 also
  // render ImpactFlash, but Payoff is the mandatory single finale beat — always in the
  // final 20% per R6 — and Comparison's reveal-flash is the one-per-reel "thesis kill"
  // moment the catalog reserves; both are excluded from this budget rather than folded in
  // uncritically. Revisit if render spot-checks show either is also a tell.)
  //
  // Threshold calibrated against the 3 shipped, quality-reviewed reels (QUALITY-REVIEW.md):
  // plan.json combined=3, plan2.json=3, plan3.json=4 (2 alert-tone + 1 StatFlip +
  // 1 LogoReveal — the "Claude Code" reel, scored 7/10, still shippable at $7). Capping at
  // ≤3 per the doc's literal wording would fail that genuinely-good reel, so — per
  // HARDENING.md's calibration instruction ("tune the threshold, don't dumb it down") —
  // the budget is tuned to ≤4, not removed.
  const impactCount =
    alertScenes.length +
    plan.scenes.filter((s) => s.component === "StatFlip").length +
    plan.scenes.filter((s) => s.component === "LogoReveal").length;
  if (impactCount > 4) {
    fail(
      "R11",
      `${impactCount} scenes carry an impact beat (alert-tone + StatFlip + LogoReveal combined, max 4)`,
      {
        fixHint: `drop tone:"alert" from a scene, or swap a StatFlip/LogoReveal scene for something calmer, to bring the combined count to ≤4`,
      },
    );
  }

  // R7 — entrance variety (anti-slop): ≥thresholds.minComponentVariety (default 4)
  // distinct component types across the reel. Driven by the active preset's `variance`
  // dial — see presets/dials.mjs.
  const varietyKey = (s) =>
    s.component === "MotionAsset" && typeof s.props?.assetId === "string" ? `MotionAsset:${s.props.assetId}` : s.component;

  const kinds = new Set(plan.scenes.map(varietyKey));
  if (kinds.size < thresholds.minComponentVariety) {
    fail("R7", `only ${kinds.size} component types — uniform motion reads as AI slop`, {
      fixHint: `use ≥${thresholds.minComponentVariety} distinct component types across the reel`,
    });
  }

  // R8 — component validity: every scene.component must be a real registry key, else the
  // render dies mid-way with an opaque React error. Catch it here as a structured failure.
  for (const s of plan.scenes) {
    if (!KNOWN_COMPONENTS.includes(s.component)) {
      fail("R8", `scene "${s.id}" uses unknown component "${s.component}"`, {
        sceneId: s.id,
        fixHint: `use one of: ${KNOWN_COMPONENTS.join(", ")}`,
      });
    }
  }

  // R15 — registry parity: this file's KNOWN_COMPONENTS (CORE_COMPONENTS +
  // COMPONENT_MANIFEST) must exactly match engine/PlanReel.tsx's actual runtime REGISTRY,
  // in BOTH directions. Plan-independent (a repo-wide structural fact, not something a
  // specific plan can cause or fix), so it fires identically on every plan — the same
  // "shows up loudly on the very next `npm run verify`" behavior R0 relies on, deliberately
  // redundant across all 78 plans rather than a single easy-to-miss global check. See the
  // PLAN_REEL_REGISTRY_COMPONENTS extraction above (module load) for how the registry list
  // itself is obtained.
  if (PLAN_REEL_REGISTRY_COMPONENTS === null) {
    warn("R15", "could not read engine/PlanReel.tsx to verify its REGISTRY matches this file's COMPONENT_MANIFEST — registry-parity check skipped");
  } else {
    for (const name of REGISTRY_PARITY_MISSING_FROM_REGISTRY) {
      fail("R15", `"${name}" is registered in lint/lint.mjs's COMPONENT_MANIFEST (or CORE_COMPONENTS) but missing from engine/PlanReel.tsx's REGISTRY — any plan naming it will pass lint but crash the render with "Unknown component"`, {
        fixHint: `add "${name}" to PlanReel.tsx's import block and REGISTRY map`,
      });
    }
    for (const name of REGISTRY_PARITY_MISSING_FROM_MANIFEST) {
      fail("R15", `"${name}" is registered in engine/PlanReel.tsx's REGISTRY but missing from lint/lint.mjs's KNOWN_COMPONENTS (CORE_COMPONENTS/COMPONENT_MANIFEST) — a plan naming it renders fine but R8/R2/R3/R4 can never validate it`, {
        fixHint: `add "${name}" to lint/lint.mjs's COMPONENT_MANIFEST (or CORE_COMPONENTS if it takes no recreate-cohort mining)`,
      });
    }
  }

  // R16 — prop-signature validation (see PROP_SIGNATURES/extractPropSignatures above for the
  // extraction and why it's conservative-by-construction). Plan-independent same as R15
  // above (fires identically across every plan using an extraction-covered component) but
  // scoped per scene: a component with no successful extraction is silently skipped (never
  // false-fails), so this only ever flags a prop key that a SUCCESSFULLY-parsed component's
  // own signature demonstrably does not declare — the exact grove-editorial `stack`-on-
  // `HubDiagram`/`FlowHub`/`BranchFlow` bug class, generalized to every component this text
  // scan can read. Hard FAIL (not WARN): a dropped prop is invisible at render time with no
  // fallback and no console signal (unlike, say, R8's icon-name WARN, which has a real
  // runtime fallback glyph) — calibrated clean (zero false positives) against the full
  // `npm run verify` plan suite before shipping as a hard gate.
  if (PROP_SIGNATURES) {
    for (const s of plan.scenes) {
      const sig = PROP_SIGNATURES.get(s.component);
      if (!sig || sig.size === 0) continue; // extraction unavailable for this component — skip
      const p = s.props ?? {};
      // R16_ALWAYS_ALLOWED_PROPS: keys engine/PlanReel.tsx's resolveSceneProps() itself reads
      // as a RESOLVER input (mediaSlotId → props.media, editDecisionId → props.editDecision +
      // props.sourceClip, sourceClipId → props.sourceClip) rather than something the target
      // component is expected to destructure directly — a component only needs to declare the
      // RESOLVED key (`media`/`editDecision`/`sourceClip`), never the `*Id` lookup key itself.
      // Confirmed real during calibration: FunMoneyProductCard/FunMoneyDeviceSignal/
      // FunMoneyProofStack all correctly declare `media` but never `mediaSlotId` — flagging
      // `mediaSlotId` there would have been a false positive on a working, intentional pattern.
      const unknown = Object.keys(p).filter((k) => !sig.has(k) && !R16_ALWAYS_ALLOWED_PROPS.has(k));
      if (unknown.length) {
        fail(
          "R16",
          `scene "${s.id}" (${s.component}) sets prop(s) [${unknown.join(", ")}] that ${s.component}'s own React.FC<{...}> signature does not declare — React silently drops any prop a component doesn't destructure (no error, no visual sign), so this content will never render`,
          { sceneId: s.id, fixHint: `remove the prop from the plan, or add it to ${s.component}'s prop type in its engine/components/*.tsx source` },
        );
      }
    }
  }

  // R8 (icon-name validity, WARN only) — KanbanBoard's per-card `icon` is a free string a
  // Director LLM authors against Icon.tsx's curated ICON_NAMES allowlist (duplicated above
  // — see its own comment). Unlike an unknown top-level `component` (a hard FAIL: the
  // render crashes with no fallback), Icon.tsx has a real runtime fallback for a bad name
  // (renders a neutral "help" glyph + console.warn — never crashes), so this is a WARN,
  // matching R12's "real risk, best-effort WARN, not a hard fail" precedent rather than
  // R8's own hard-fail treatment above.
  for (const s of plan.scenes) {
    if (s.component !== "KanbanBoard") continue;
    const p = s.props ?? {};
    for (const col of p.columns ?? []) {
      if (!col) continue;
      for (const c of col.cards ?? []) {
        const icon = c && typeof c === "object" ? c.icon : undefined;
        if (typeof icon === "string" && !ICON_NAMES.includes(icon)) {
          warn("R8", `"${s.id}" KanbanBoard card icon "${icon}" is not in Icon.tsx's curated allowlist`, {
            sceneId: s.id,
            fixHint: `use one of: ${ICON_NAMES.join(", ")} (or omit icon)`,
          });
        }
      }
    }
  }

  // R9 — entrance/component anti-lockstep. Distinct from R7 (total variety across the
  // WHOLE reel): this catches CONSECUTIVE sameness — "everything rises the same way,"
  // beat after beat. Key per scene = props.entrance where the component exposes one (only
  // Headline does today — director/02-component-catalog.md); components without an
  // entrance prop fall back to their own component identity as the comparison key, per
  // QUALITY-REVIEW.md's spec.
  //
  // The threshold is NOT uniform, and that's a deliberate calibration call (not a literal
  // read of the spec): a run of 3 consecutive Headlines sharing the same EXPLICIT entrance
  // value (rise/rise/rise) is real lockstep and fails at 3+, matching "everything rises
  // the same way" exactly. But a run of the same NON-entrance component (e.g. 3 consecutive
  // FeatureCard "numbered reason" scenes) is, taken literally, indistinguishable from "same
  // component 3x" — and plan.json's context/tools/memory FeatureCard trio is exactly that:
  // a deliberate, quality-reviewed numbered-build device (not flagged as a tell in
  // QUALITY-REVIEW.md), not slop. Failing it would violate this task's calibration mandate
  // ("MUST NOT fail a genuinely-good reel — tune the threshold, don't dumb it down to
  // nothing"). So the component-identity fallback only fires at 4+ in a row; real entrance
  // values still fire at 3+.
  {
    let i = 0;
    while (i < plan.scenes.length) {
      const s = plan.scenes[i];
      const p = s.props ?? {};
      const explicit = typeof p.entrance === "string";
      const key = explicit ? p.entrance : varietyKey(s);
      let j = i;
      while (j + 1 < plan.scenes.length) {
        const next = plan.scenes[j + 1];
        const nextP = next.props ?? {};
        const nextExplicit = typeof nextP.entrance === "string";
        if (varietyKey(next) !== varietyKey(s)) break;
        if (explicit !== nextExplicit) break;
        if (explicit && nextP.entrance !== key) break;
        j++;
      }
      const runLen = j - i + 1;
      const threshold = explicit ? 3 : 4;
      if (runLen >= threshold) {
        const ids = plan.scenes.slice(i, j + 1).map((x) => x.id);
        fail(
          "R9",
          `${runLen} consecutive "${key}" scenes share ${explicit ? `entrance "${key}"` : "no entrance (component default)"} — scenes ${ids.join(", ")}`,
          {
            sceneId: plan.scenes[j].id,
            fixHint: `vary scene "${plan.scenes[j].id}"'s entrance/component`,
          },
        );
      }
      i = j + 1;
    }
  }

  // R12 — caption safe band. Best-effort WARNING (never a fail): KenBurns.tsx hardcodes
  // its caption at `paddingBottom: 190` on the 1920px-tall frame, ~30px clear of
  // CAPTION_BAND_PX (220px) — but that's the component's fixed layout, not something
  // authored per-scene in the plan; there is no y-position field in KenBurns' props to
  // check per-scene, so an exact "does THIS caption enter the band" computation isn't
  // possible from plan data alone. Rather than fake that precision, this warns on every
  // KenBurns scene that renders a caption at all, flagging it for the render spot-check
  // QUALITY-REVIEW.md already calls for (framing sameness / composition) — honest about
  // the limitation instead of a no-op stub, since the component's fixed anchor DOES sit
  // close enough to the band to be worth a human glance every time.
  for (const s of plan.scenes) {
    // HFAsset uses the identical `paddingBottom: 190` caption anchor as KenBurns (see
    // src/components/HFAsset.tsx) — same fixed-anchor limitation, same warning.
    if ((s.component === "KenBurns" || s.component === "HFAsset") && typeof (s.props ?? {}).caption === "string") {
      warn(
        "R12",
        `"${s.id}" ${s.component} caption sits near the bottom ${CAPTION_BAND_PX}px caption-safe band (component-fixed anchor, not computed per-scene) — verify on a render spot-check`,
        {
          sceneId: s.id,
          fixHint: `confirm "${s.id}"'s caption clears the bottom ${CAPTION_BAND_PX}px safe band on a rendered still`,
        },
      );
    }
  }

  // R14 — overlay zone (ARCHITECTURE-V2.md §4 point 2). Three checks, all hard fails
  // (unlike R12's best-effort WARN above: an overlay collision is computed exactly from
  // plan data — zone + start/end spans are both authored, not a component-fixed-anchor
  // guess — so there's no reason to soften it to a warning).
  //
  // (c) component validity, extended to overlays[]: "unknown component" reuses R8 (same
  // failure mode as an unknown scene component — the render crashes with no fallback);
  // "known component but not overlay-capable" is R14's own concern — a plan naming e.g.
  // "Headline" inside overlays[] would render FINE (REGISTRY doesn't distinguish scene
  // vs. overlay components — see PlanReel.tsx's REGISTRY comment) but is a semantic
  // mistake the manifest's `overlay: true` flag exists specifically to catch.
  for (const o of overlays) {
    if (!KNOWN_COMPONENTS.includes(o.component)) {
      fail("R8", `overlay "${o.id}" uses unknown component "${o.component}"`, {
        sceneId: o.id,
        fixHint: `use one of: ${KNOWN_COMPONENTS.join(", ")}`,
      });
    } else if (!COMPONENT_MANIFEST[o.component]?.overlay) {
      fail(
        "R14",
        `overlay "${o.id}" names "${o.component}", which is not overlay-capable (no manifest "overlay: true")`,
        {
          sceneId: o.id,
          fixHint: `give "${o.component}" \`overlay: true\` in lint/lint.mjs's COMPONENT_MANIFEST, or move "${o.id}" into plan.scenes instead of overlays`,
        },
      );
    }
  }

  // Resolve each overlay's effective span the same way PlanReel.tsx does at render time
  // (engine/PlanReel.tsx: `overlay.startMs ?? 0`, `overlay.endMs ?? plan.durationMs`) —
  // lint must agree with the renderer on what "the same span" means, or R14 could pass a
  // plan that visibly collides on screen.
  const overlayStart = (o) => (typeof o.startMs === "number" ? o.startMs : 0);
  const overlayEnd = (o) => (typeof o.endMs === "number" ? o.endMs : plan.durationMs);
  const spansOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

  // (a) zone collision: two overlays may not claim the same reserved zone in overlapping
  // spans. "free" claims neither band, so it never collides with anything — skipped on
  // both sides of the comparison, not just when equal.
  for (let i = 0; i < overlays.length; i++) {
    for (let j = i + 1; j < overlays.length; j++) {
      const a = overlays[i];
      const b = overlays[j];
      if (a.zone === "free" || b.zone === "free" || a.zone !== b.zone) continue;
      if (spansOverlap(overlayStart(a), overlayEnd(a), overlayStart(b), overlayEnd(b))) {
        fail("R14", `overlays "${a.id}" and "${b.id}" both claim zone "${a.zone}" over an overlapping span`, {
          sceneId: b.id,
          fixHint: `give one of "${a.id}"/"${b.id}" a different zone, or stagger their startMs/endMs so the spans no longer overlap`,
        });
      }
    }
  }

  // (b) bottom-zone overlay vs. scene-level caption-band usage: a bottom overlay active
  // during a scene that renders its own bottom caption (the exact KenBurns/HFAsset
  // `caption` prop R12 above already detects) is a genuine band collision, not a
  // heuristic — two things claiming the same 220px strip at the same time.
  for (const o of overlays) {
    if (o.zone !== "bottom") continue;
    const oStart = overlayStart(o);
    const oEnd = overlayEnd(o);
    for (const s of plan.scenes) {
      if ((s.component !== "KenBurns" && s.component !== "HFAsset") || typeof (s.props ?? {}).caption !== "string") continue;
      if (spansOverlap(oStart, oEnd, s.startMs, s.endMs)) {
        fail(
          "R14",
          `overlay "${o.id}" (zone "bottom") is active during "${s.id}", which renders its own bottom-band caption — the two collide`,
          {
            sceneId: s.id,
            fixHint: `move "${o.id}" outside "${s.id}"'s span, change "${o.id}".zone, or drop "${s.id}".props.caption`,
          },
        );
      }
    }
  }

  // R17 — keyword suggestion (advisory WARN-only, never a fail). Runs the same matching
  // logic as cli/keyword-scan.mjs (imported directly — no shell-out, no reimplementation):
  // for each transcript word that matches a registered keyword, check whether a scene or
  // overlay already using that component sits within ±windowMs of that word's timestamp.
  // If no covering scene/overlay is found, surface a WARN pointing the author at the
  // existing reusable component — exactly matching R12's "flag for a human glance" posture.
  // Choosing not to use a suggested component is a legitimate creative decision, not a bug.
  // The CLI wrapper (cli/lint.mjs) prints these findings as their own labeled section,
  // visually distinct from the R1–R16 rule output, and they never affect the exit code.
  if (KEYWORD_REGISTRY) {
    const keywordFindings = scanKeywords(plan, transcript, KEYWORD_REGISTRY, KEYWORD_WINDOW_MS);
    for (const f of keywordFindings) {
      if (f.covered) continue; // already have a scene using this component nearby — no gap
      warn(
        "R17",
        `"${f.matchedText}" @ ${f.wordMs}ms → ${f.component} (${f.category}) — no nearby scene found — ${f.description}`,
        { sceneId: null },
      );
    }
  }

  // R18 — placeholder content (best-effort WARN, never a fail). Detects literal placeholder
  // tokens in on-screen text that should have been replaced with real content before a plan
  // is used as a finished reel. These are structural descriptions of what the component
  // slot should contain, not real written content — a sign the plan was generated as a
  // template and never filled in.
  //
  // Heuristic 1 (shipped): known literal placeholder patterns. Matches any text-bearing
  // prop that contains a whole-word occurrence of: "slot", "placeholder", "TODO", or
  // "lorem ipsum" (all case-insensitive, word-bounded). These are unambiguous scaffolding
  // tokens — no legitimate finished reel text needs them.
  //
  // Heuristic 2 (NOT shipped): structural-description detection (e.g. "show the X" /
  // "turn Y into Z" where X/Y are component-type nouns rather than real content). Tested
  // against the three real sales-demo plans and found to false-positive on legitimate
  // short imperative copy like "show the receipt" (Fun Money sales demo) and "show the
  // drop" (Workflow Poster sales demo). Deliberately skipped — the false-positive rate
  // on real stylistic copy is too high.
  //
  // @YOURBRAND is intentionally NOT flagged: it's a legitimate "fill in your brand here"
  // pattern used in neutral sales-demo plans, not a structural description.
  {
    const PLACEHOLDER_PATTERNS = [
      { re: /\bslot\b/i, label: "slot" },
      { re: /\bplaceholder\b/i, label: "placeholder" },
      { re: /\bTODO\b/, label: "TODO" },
      { re: /\blorem ipsum\b/i, label: "lorem ipsum" },
    ];

    // Props that hold IDs/references, not on-screen text — never flag these.
    const ID_PROPS = new Set([
      "mediaSlotId", "sourceClipId", "editDecisionId", "id",
    ]);

    // Recursively walk scene.props for all string values, skipping known ID props.
    // Dedup by (sceneId, value, propName) so the same text in the same scene doesn't
    // fire twice (once via sceneTexts and once via the recursive walk).
    const flagged = new Set();
    for (const s of plan.scenes) {
      // Walk all string props recursively, skipping ID keys
      const checkString = (val, path, parentKey) => {
        if (typeof val === "string") {
          // Skip values inside known ID props — they're references, not on-screen text
          if (ID_PROPS.has(parentKey)) return;
          for (const { re, label } of PLACEHOLDER_PATTERNS) {
            if (re.test(val)) {
              const key = `${s.id}|${val}|${path}`;
              if (!flagged.has(key)) {
                flagged.add(key);
                warn(
                  "R18",
                  `"${val}" in "${s.id}" (${path}) contains placeholder token "${label}" — replace with real content`,
                  { sceneId: s.id },
                );
              }
            }
          }
        } else if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) checkString(val[i], `${path}[${i}]`, null);
        } else if (val && typeof val === "object") {
          for (const [k, v] of Object.entries(val)) checkString(v, `${path}.${k}`, k);
        }
      };
      checkString(s.props, "props", null);
    }

    // mediaSlots caption/alt are visible on-screen text (rendered by MediaStage/ScreenshotStage)
    for (const slot of Array.isArray(plan.mediaSlots) ? plan.mediaSlots : []) {
      for (const key of ["caption", "alt"]) {
        const val = slot?.[key];
        if (typeof val === "string") {
          for (const { re, label } of PLACEHOLDER_PATTERNS) {
            if (re.test(val)) {
              warn(
                "R18",
                `"${val}" in mediaSlot "${slot.id}" (${key}) contains placeholder token "${label}" — replace with real content`,
                { sceneId: null },
              );
            }
          }
        }
      }
    }
  }

  // R19 — media existence (FAIL). A mediaSlot with a baked-in `src` (in-house/generated
  // assets shipped with the pack, as opposed to a customer drop-zone slot left with no
  // `src`) must resolve to a real file under public/, since Remotion's `staticFile()`
  // resolves it the same way at render time. Unlike R18's content-quality WARN, a missing
  // asset isn't a matter of taste — the render either fails outright or silently renders a
  // blank/broken frame, and either way the render cycle that surfaced it was wasted. Only
  // slots with a non-empty `src` are checked; a slot with no `src` is a legitimate
  // customer-supplied drop zone, not a bug.
  {
    const PUBLIC_DIR = path.join(__dirname, "../public");
    for (const slot of Array.isArray(plan.mediaSlots) ? plan.mediaSlots : []) {
      const src = slot?.src;
      if (typeof src !== "string" || src.length === 0) continue;
      const resolved = path.join(PUBLIC_DIR, src);
      if (!fs.existsSync(resolved)) {
        fail(
          "R19",
          `mediaSlot "${slot.id}" has src "${src}" but no file exists at public/${src} — this will fail or silently render blank at render time`,
          { sceneId: null },
        );
      }
    }
  }

  // R20/R21 — visual + asset density (WARN). The contract and its rationale live in
  // lint/visual-density.mjs; this is just the reporting surface.
  //
  // WARN, not FAIL, deliberately: when this shipped, 0 of the 7 customer sales demos met the
  // gap ceiling, so failing here would have turned `npm run verify` red across the whole
  // corpus and forced either a mass rewrite in one commit or an immediate exemption list —
  // both worse than a loud warning. Same precedent as R12/R17/R18. The enforcing gate is
  // `node cli/audit-visual-density.mjs --packs --strict`, opt-in per run, and is what a pack
  // should be held to before it ships.
  //
  // Gap warnings name the exact uncovered window, because that is the Director's fill list —
  // "add more visuals" is not actionable, "nothing between 52.2s and 55.9s" is.
  {
    const density = analyzeDensity(plan, preset);
    const asSec = (ms) => `${(ms / 1000).toFixed(1)}s`;
    const v = density.visual;
    if (!v.countOk) {
      warn(
        "R20",
        `${v.count} visual beats over ${asSec(density.durationMs)} — contract is one per ${asSec(v.intervalMs)} (floor ${v.floor})`,
        { sceneId: null },
      );
    }
    for (const g of v.gapsOver.slice(0, 6)) {
      warn("R20", `no visual beat between ${asSec(g.fromMs)} and ${asSec(g.toMs)} (${asSec(g.ms)} of dead air)`, { sceneId: null });
    }
    if (v.gapsOver.length > 6) {
      warn("R20", `…and ${v.gapsOver.length - 6} more uncovered visual span(s) — run cli/audit-visual-density.mjs --gaps`, { sceneId: null });
    }
    if (density.asset) {
      const a = density.asset;
      if (!a.countOk) {
        warn(
          "R21",
          `${a.count} asset beats over ${asSec(density.durationMs)} — this pack's contract is one per ${asSec(a.intervalMs)} (floor ${a.floor})`,
          { sceneId: null },
        );
      }
      for (const g of a.gapsOver.slice(0, 4)) {
        warn("R21", `no asset on screen between ${asSec(g.fromMs)} and ${asSec(g.toMs)} (${asSec(g.ms)})`, { sceneId: null });
      }
      if (a.gapsOver.length > 4) {
        warn("R21", `…and ${a.gapsOver.length - 4} more asset-free span(s) — run cli/audit-visual-density.mjs --gaps`, { sceneId: null });
      }
    }
  }

  {
    const GENERIC_PLACEHOLDER_PATTERNS = [
      { re: /lorem ipsum/i, label: "Lorem ipsum" },
      { re: /john doe/i, label: "John Doe" },
      { re: /acme corp/i, label: "Acme Corp" },
      { re: /placeholder text/i, label: "placeholder text" },
    ];
    const ID_PROPS = new Set(["mediaSlotId", "sourceClipId", "editDecisionId", "id"]);
    const flagged = new Set();
    const scanForPlaceholders = (val, path, parentKey, sceneId) => {
      if (typeof val === "string") {
        if (ID_PROPS.has(parentKey)) return;
        for (const { re, label } of GENERIC_PLACEHOLDER_PATTERNS) {
          if (re.test(val)) {
            const key = `${sceneId}|${path}|${val}`;
            if (!flagged.has(key)) {
              flagged.add(key);
              fail(
                "R22",
                `"${val}" in "${sceneId}" (${path}) is generic placeholder content (${label}) — replace with real content`,
                { sceneId },
              );
            }
          }
        }
      } else if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) scanForPlaceholders(val[i], `${path}[${i}]`, null, sceneId);
      } else if (val && typeof val === "object") {
        for (const [k, v] of Object.entries(val)) scanForPlaceholders(v, `${path}.${k}`, k, sceneId);
      }
    };
    for (const s of plan.scenes) scanForPlaceholders(s.props, "props", null, s.id);
    for (const o of Array.isArray(plan.overlays) ? plan.overlays : []) scanForPlaceholders(o.props, "props", null, o.id);
    for (const slot of Array.isArray(plan.mediaSlots) ? plan.mediaSlots : []) {
      for (const key of ["caption", "alt"]) {
        const val = slot?.[key];
        if (typeof val !== "string") continue;
        for (const { re, label } of GENERIC_PLACEHOLDER_PATTERNS) {
          if (re.test(val)) {
            fail(
              "R22",
              `"${val}" in mediaSlot "${slot.id}" (${key}) is generic placeholder content (${label}) — replace with real content`,
              { sceneId: null },
            );
          }
        }
      }
    }
  }

  {
    plan.scenes.forEach((s, i) => {
      const distinctBeats = new Set(sceneEvents(s));
      const floor = i === 0 ? 3 : 2;
      if (distinctBeats.size < floor) {
        warn(
          "R23",
          `"${s.id}" has ${distinctBeats.size} distinct visual beat(s), motion floor is ${floor}${i === 0 ? " for the opening scene" : ""}`,
          { sceneId: s.id },
        );
      }
    });
  }

  return { failures, warnings };
}
