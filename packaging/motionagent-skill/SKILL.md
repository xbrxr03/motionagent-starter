---
name: motionagent
description: "Use for any /motionagent-* command, when asked to scaffold a reel, make a 9:16 video for Instagram/TikTok/Shorts/YouTube Shorts, or when the user names one of the two free-starter MotionAgent packs: UI Mate or Talking Head."
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
argument-hint: "<brief, pack name, plan path, render path, or voiceover path>"
user-invocable: true
---

# MotionAgent Skill

MotionAgent is a local Remotion reel system for building short-form motion videos from a brief, voiceover transcript, pack-specific scene components, and deterministic lint/render tooling. The Skill package is the buyer-facing command surface; it shells out to the companion `cli/motionagent.mjs` when that CLI is installed in the MotionAgent project. It does not invent new scenes, assets, pack content, or license infrastructure.

## Free Starter Packs

- **UI Mate** - UI/UX micro-interaction reels about gestures, validation, optimistic states, menus, feedback, and small interface patterns.
- **Talking Head** - creator-led AI-tool/demo reels with portrait footage, proof screenshots, b-roll receipts, blunt lower-third claims, captions, and centered social CTA endings.

This repository ships the thin CLI, engine, UI Mate, and Talking Head — the free tier. A
paid tier adds five more packs (Grove Editorial, Fun Money, SaaS Motion, Workflow Poster,
Fly Motion); it is a separate product and is not part of this Skill surface. See the
repository README for the paid-tier pointer.

## Command Surface

Use the command files in `commands/` for slash-command behavior. They all wrap the companion CLI surface:

```bash
node cli/motionagent.mjs init
node cli/motionagent.mjs scaffold --pack=<pack> --name=<slug> --vo=<path.wav> [--brief="<one-line brief>"]
node cli/motionagent.mjs beats <vo.wav> --slug=<slug>
node cli/motionagent.mjs render <plan.json> [--platform=ig|tiktok|shorts]
node cli/motionagent.mjs lint <plan.json> --preset=<pack>
node cli/motionagent.mjs capture <url> --slug=<slug>
node cli/motionagent.mjs --version
```

Pack commands:

- `/motionagent-talking-head`
- `/motionagent-ui-mate`

Utility commands:

- `/motionagent-init` - dependency check and free-starter pack list.
- `/motionagent-direction` - given a vague brief, choose between UI Mate and Talking Head with reasoning from the real pack docs.
- `/motionagent-critique` - use the blind-recreation grading rubric findings table and score format.
- `/motionagent-beats` - transcribe/beat-lock voiceover through the CLI wrapper.
- `/motionagent-render` - render a plan through the CLI wrapper.
- `/motionagent-lint` - run preset-aware lint through the CLI wrapper.

## House Pipeline

MotionAgent's real authoring flow is staged, not one-shot brief-to-JSON:

1. **Idea-only scaffolding** is conditional. Use it only when the user has an idea but no voiceover. It calls for a TTS-ready script; TTS and ingest are separate steps.
2. **Outline** reads the whisper transcript timeline, cleans ASR at copy level, chooses pack components per beat with reasons, and writes the per-beat outline table.
3. **Compile** translates that outline to schema-valid `plan.json` at temperature 0. It should make no editorial decisions.
4. **Lint/fix loop** runs deterministic lint, applies targeted fixes only to failing scenes, caps the loop at 3-4 iterations, and clamps mechanically if needed.

Audio-lock is real: `cli/ingest.mjs` uses `whisper-cli` output with word timestamp entries, and every scene boundary and every `atMs`-style event should sit on a real transcript word start.

The lint gate exposes rule IDs R0 through R16. The rules to care about most are:

- **R0 shape** - top-level plan/transcript shape guard, including zero-duration scene protection.
- **R1 audio-lock** - scene starts must stay within the word-onset tolerance.
- **R2 pacing** and **R3 dwell** - hooks, event gaps, and text visibility must be paced enough to read.
- **R4 fit** - registered text roles must stay within measured/budgeted line widths.
- **R7 variety** and **R9 anti-lockstep** - avoid same-component, same-entrance repetition.
- **R12 caption-band** and **R14 overlay-zone** - catch caption/media/overlay collisions.
- **R15 registry-parity** and **R16 prop-signature** - catch components missing from the runtime registry and props that the target component does not declare.

MotionAgent also has measured house standards that are not fully enforced by lint yet: most settled portrait frames should use a meaningful focal envelope of at least 30% of the full canvas for full-frame graphics, 22% for a single hero object/card, and 70% of safe width for text-led frames. Text floors are 96 px for full-screen headlines, 64 px for card/component headlines, 56 px for CTA actions, 44 px for body/UI labels, 40 px hard minimum for captions and proof code, and 32 px for nonessential annotation.

## License Status

This starter has no license gate — it is a free, self-contained tier. `motionagent init` lists local dependency status and the two shipped packs; it does not check any license.

## Source Discipline

When giving pack advice, command behavior, palette values, component names, or grading criteria, ground claims in the installed MotionAgent source files: pack READMEs, token family files, `lint/lint.mjs`, and `research/motionagent-grading-rubric.md`. Do not expose private reference folder names, creator handles, inspiration links, or unavailable third-party logos/likenesses in generated buyer-facing output.
