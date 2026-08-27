---
description: Scaffold a UI Mate reel using the real MotionAgent CLI.
argument-hint: "--name=<slug> --vo=<path.wav> [--brief=\"...\"]"
allowed-tools:
  - Bash
---

# /motionagent-ui-mate

Use for UI/UX micro-interaction reels: gestures, validation, optimistic states, command palettes, uploads, destructive confirmations, latency, and multiplayer cursor presence. Keep UI elements large, high-contrast, and specific to the interaction state.

Run:

```bash
node cli/motionagent.mjs scaffold --pack=ui-mate --name=<slug> --vo=<path.wav> [--brief="<one-line brief>"]
```

After ingest, follow the outline/compile/lint next-steps the CLI prints.
