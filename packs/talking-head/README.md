# Talking Head - Style Pack (v1.3)

Talking Head is for creator-led AI-tool/demo reels where the speaker never disappears.
The pack's default format is a half-screen split: the lower half keeps the speaker on
screen as the trust anchor, while the upper half renders relevant proof visuals — app UI,
dashboards, screenshots, screen recordings, waveform/audio moments, prompt cards, B-roll,
recaps, and CTA plates.

It is built around editable clip references. Buyers should supply their own clips through
`sourceClips[]` and `editDecisions[]`; the pack does not ship raw creator footage.


## Shared visual vocabulary

This pack has access to MotionAgent's shared visual primitives: `VoiceOrb`,
`WaveformPanel`, `EditorTimelinePanel`, `AdsDashboard`, `ApprovalShield`,
`InboxTaskList`, `StoryboardGrid`, `BodyAnalyticsMap`, `RecoveryChart`,
`BrowserAgentPanel`, `OddsBoard`, and `CtaPlate`. These are token-driven
and render in this pack's palette/type/motion personality. Use the same plan with
`node cli/motionagent.mjs render <plan.json> --preset=<pack>` to generate a different
pack-skinned version without rewriting the plan.

## What it ships

- Token family: `talkingHead`
- Preset file: `presets/talking-head.json`
- Demo plan: `demo/plan-talking-head.json`
- Root composition: `TalkingHeadDemo`
- Native Remotion components: the legacy creator/proof primitives remain available, but
  v1.3 moves the split-screen proof vocabulary onto shared primitives:
  `VoiceOrb`, `AdsDashboard`, `EditorTimelinePanel`, `WaveformPanel`, `StoryboardGrid`,
  `InboxTaskList`, `BodyAnalyticsMap`, `RecoveryChart`, `BrowserAgentPanel`,
  `ApprovalShield`, `OddsBoard`, and `CtaPlate`. Talking Head uses these with
  `props.layout: "split-speaker"`; other packs can use the same primitives full-frame.
- Current demo density: 8 split-screen scenes / 58.4s (`demo/plan-talking-head.json`),
  exercising `sourceClips[]`, `editDecisions[]`, screenshot placeholders, screen-recording
  placeholders, B-roll/video placeholders, proof rows, grids, waveforms, and CTA tags.
- Selected-target recreations (2026-07-27): all seven ref4 targets rebuilt on their own
  original reference audio at true source length —
  `demo/plan-talking-head-{nanobanana-prompts,plugin-resource-cta,alternate-overlay,
  ai-slop-comment,build-mobile-app,retriever-subroutines,top5-plugins}.json`, rendered to
  `out/renders/commercial/talking-head/recreations/`. Every real person's face in these targets is
  routed through `ClipSurface`'s existing media-slot placeholder (no real likeness is ever
  reproduced) — see `packs/STATUS.md`'s "Resolved for Talking Head" note for the full
  writeup, including a real `COLOR.ink`/`COLOR.paper` inversion bug found and fixed across
  every existing scene component.

## v1.3 Director-facing beat grammars

- `split-proof-demo`: `VoiceOrb` hook → `AdsDashboard` screenshot → `EditorTimelinePanel`
  screen recording → `InboxTaskList` context → `StoryboardGrid` proof/B-roll →
  `StoryboardGrid` recap → `CtaPlate`.
- `app-or-tool-walkthrough`: `VoiceOrb` hook → `EditorTimelinePanel` screen recording →
  `InboxTaskList` prompt/action cards → `BrowserAgentPanel` app surface →
  `AdsDashboard` proof → `CtaPlate`.
- `data-story`: `AdsDashboard` → `RecoveryChart` → `BodyAnalyticsMap` →
  `WaveformPanel` → `StoryboardGrid` → `CtaPlate`.

These are not Talking Head-only visual assets. They are shared primitives; the split-screen
layout is a prop, not a component ownership boundary.

Reference recreations are QA fixtures. Customer videos should map fresh user clips and
proof assets into this editable vocabulary; the pack never ships private creator footage.

## Private orange-reference QA layer

Local-only QA artifacts from the seven orange-accent references live outside the shipped
pack surface:

- Pixel/timing plates: `out/renders/commercial/talking-head/qa/orange-pixelplates/`
- Code-native Remotion drafts: `out/renders/plan-orange-talk-*.local.mp4`
- Private draft plans/audio/source crops: `demo/private/orange-talking/`,
  `demo/input/orange-talking/`, and `public/private/orange-talking/`

The plates are the closest visual target because they preserve the source frame counts and
timing with a warm orange accent conversion. The code-native drafts are the reusable-pack
work: they exercise split editor, waveform, grid, folder, chat, dashboard, phone, media,
body analytics, bars, orb, and CTA primitives. They are useful enrichment, but still need a
deeper per-target blind-test pass before being called pixel-perfect.

## Visual rules

- Speaker stays visible in the lower half unless the user explicitly chooses a full-frame
  montage exception.
- Top half must directly visualize what the audio is saying; no generic filler proof cards.
- Use `mediaSlotId` for screenshots, screen recordings, product footage, B-roll, and proof
  footage in the upper canvas.
- Dark proof canvas with one warm accent; product screenshots may carry secondary color.
- Neutral/off-white product proof scenes are now secondary/legacy options, not the default.
- Dark portrait and CTA scenes remain available as legacy variants.
- One warm accent per beat; let product screenshots bring any secondary color.
- Blunt oversized sans headlines; mono labels for proof/status/CTA chips.
- Use creator footage as credibility, not decoration.
- Screenshots/videos enter through `mediaSlotId`; portrait clips enter through
  `editDecisionId`.
- Product-facing docs and demo copy do not expose private inspiration names, handles, or
  folder tags.

## Next improvements

- Continue migrating legacy pack-prefixed visuals into shared token-driven primitives where
  they are broadly useful across packs.
- Real source-clip render fixtures still cannot ship for private reference targets (the
  people in them are real, unlicensed creators). The public demo keeps placeholders; local
  private recreations can point to user-supplied/source material.
- Build a neutral free-starter sales demo with licensed or user-supplied sample footage.
- Blind-test convergence loop, matching the other packs' remaining item.

~~Add word-level subtitle emphasis tied to source clip transcript spans.~~ Done
2026-07-27 — see `TalkingHeadCaption` above.
