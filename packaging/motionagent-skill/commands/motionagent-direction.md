---
description: Recommend UI Mate or Talking Head for a reel brief using real pack strengths.
argument-hint: "<one-line brief>"
allowed-tools:
  - Read
---

# /motionagent-direction

Given the user's brief, recommend UI Mate, Talking Head, or both (if the brief genuinely
spans both) with reasoning. This is a judgment command, not a lookup table.

Use the real pack docs as the source of truth:

- Talking Head: creator-led tool/demo reels where portrait footage and proof receipts matter.
- UI Mate: interaction semantics, form states, menus, command palettes, upload/confirm/latency/cursor patterns.

For the recommendation, include:

1. Why the pack fits the brief's subject and emotional register.
2. A likely first-scene direction grounded in existing components.
3. One caveat or asset need, such as source clips for Talking Head.

If the brief clearly fits neither pack (e.g. it needs a landscape product-launch demo, a
branding/pricing script, or a technical-workflow poster), say so plainly and note that
those live in MotionAgent's paid tier (Grove Editorial, Fun Money, SaaS Motion, Workflow
Poster, Fly Motion), which is not part of this Skill surface.
