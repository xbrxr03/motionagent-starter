---
description: Scaffold a Talking Head reel using the real MotionAgent CLI.
argument-hint: "--name=<slug> --vo=<path.wav> [--brief=\"...\"]"
allowed-tools:
  - Bash
---

# /motionagent-talking-head

Use for creator-led AI-tool/demo reels with portrait clips, proof screenshots, b-roll receipt stacks, lower-third claims, captions, and social CTA closers. Real faces must come from buyer-supplied `sourceClips[]`/`editDecisions[]`; do not fabricate likenesses.

Run:

```bash
node cli/motionagent.mjs scaffold --pack=talking-head --name=<slug> --vo=<path.wav> [--brief="<one-line brief>"]
```

After ingest, follow the outline/compile/lint next-steps the CLI prints.
