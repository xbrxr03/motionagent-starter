---
description: Run preset-aware MotionAgent lint through the companion CLI.
argument-hint: "<plan.json> --preset=<pack>"
allowed-tools:
  - Bash
---

# /motionagent-lint

Run:

```bash
node cli/motionagent.mjs lint <plan.json> --preset=<pack>
```

Use the plan's actual pack preset. `npm run verify`'s broad lint pass may not exercise a pack's stricter preset thresholds, so pack-specific lint is required before calling a plan clean.
