# MotionAgent Starter

> This repository is the standalone two-pack free distribution. See
> [`DISTRIBUTION-ARCHITECTURE.md`](DISTRIBUTION-ARCHITECTURE.md) before porting work from the
> development repository or touching paid-pack boundaries.

MotionAgent is a plan-driven, Remotion-based engine for generating short-form (9:16)
motion-graphics video from a voiceover: transcribe it, lock scene timing to real word
onsets, pick components from a style pack, lint the plan against deterministic pacing/
legibility/registry rules, and render.

This repository is the **free starter tier**: the full CLI, the core rendering engine, and
two complete style packs —

- **UI Mate** — UI/UX micro-interaction reels: gestures, form validation, optimistic
  states, command palettes, upload/confirm/latency/cursor patterns.
- **Talking Head** — creator-led AI-tool/demo reels: portrait clips, proof screenshots,
  b-roll receipt stacks, lower-third claims, captions, social CTA endings.

Everything here is real, working code — not a trimmed-down demo. The same lint rules,
render pipeline, and component registry that back the full product back this starter.

## What's not included

MotionAgent's paid tier adds five more style packs — **Grove Editorial**, **Fun Money**,
**SaaS Motion**, **Workflow Poster**, and **Fly Motion** — covering editorial explainers,
branding/pricing scripts, SaaS product demos, technical-workflow posters, and high-contrast
motion edits. That tier is a separate product: **[PAID PRODUCT LINK]**.

## Requirements

- Node.js ≥ 20
- [ffmpeg](https://ffmpeg.org/) (`brew install ffmpeg`)
- [whisper-cli](https://github.com/ggml-org/whisper.cpp) (`brew install whisper-cpp`) — only
  needed if you want to ingest your own voiceover audio; the two example plans below already
  ship with pre-generated transcripts/beats, so you can render them without it.

## Install

```bash
npm install
node cli/motionagent.mjs init
```

`init` checks your dependencies, runs a real single-frame render as a smoke test, and lists
the two available packs. There is no license gate in this starter — it's free and
self-contained.

## Render an example

Each pack ships one complete example plan with real audio and transcript:

```bash
node cli/motionagent.mjs render demo/plan-ui-mate-capability-showcase.json --out out/ui-mate-example.mp4
node cli/motionagent.mjs render demo/plan-talking-head-capability-showcase.json --out out/talking-head-example.mp4
```

Or open the interactive Remotion Studio and scrub either composition (`UiMateCapabilityShowcase`,
`TalkingHeadCapabilityShowcase`) directly:

```bash
npx remotion studio
```

## Lint a plan

```bash
node cli/motionagent.mjs lint demo/plan-ui-mate-capability-showcase.json --preset=ui-mate
node cli/motionagent.mjs lint demo/plan-talking-head-capability-showcase.json --preset=talking-head
```

Lint enforces audio-lock (scene boundaries must sit on real transcript word onsets),
pacing/dwell time, text-fit budgets, caption/overlay-zone collisions, component-registry
parity, and prop-signature validity — the same rule set (R0–R16) the full product runs.

## Scaffold your own reel

```bash
node cli/motionagent.mjs scaffold --pack=ui-mate --name=my-reel --vo=path/to/voiceover.wav
```

This transcribes your voiceover (ffmpeg + whisper-cli), word-locks it, and prints the next
steps: outline each beat against `packs/ui-mate/pack.json`'s component vocabulary, compile
that outline into a schema-valid `plan.json` (see `schema/plan.ts` / `schema/plan.schema.json`,
and the two example plans above as worked references), then lint and render it. If you don't
have a voiceover yet, pass `--brief="<one-line idea>"` instead for idea-only next steps.

## Layout

```
cli/            The CLI (motionagent.mjs + the render/lint/ingest/beats/capture pipeline)
engine/         PlanReel (the plan → React composition renderer) + Root.tsx + components
tokens/         Design-token families (signal = neutral default, uiMate, talkingHead)
lint/           Deterministic plan linter (R0–R16)
schema/         Zod schema + JSON Schema for plan.json / preset.json
presets/        Pack dial presets (ui-mate, talking-head, plus generic balanced/calm/punchy)
packs/          Pack manifests (component list, beat grammars, palette notes)
demo/           Example plans + transcripts
public/audio/   Example plan audio
packaging/motionagent-skill/   Claude Code skill wrapping this CLI as slash commands
```

## Claude Code skill

`packaging/motionagent-skill/` is a Claude Code skill that wraps this CLI as slash commands
(`/motionagent-init`, `/motionagent-ui-mate`, `/motionagent-talking-head`, `/motionagent-lint`,
`/motionagent-render`, `/motionagent-beats`, `/motionagent-direction`, `/motionagent-critique`).
Copy or symlink it into your Claude Code skills directory to use it.

## License

[Functional Source License 1.1, MIT Future License](LICENSE.md) — free to use, modify,
self-host, and build on for your own reels, research, or internal tooling. What it excludes
is building a competing product or service with it. Converts to plain MIT two years after
each release.
