---
description: Render a MotionAgent plan through the companion CLI.
argument-hint: "<plan.json> [--platform=ig|tiktok|shorts]"
allowed-tools:
  - Bash
---

# /motionagent-render

Run:

```bash
node cli/motionagent.mjs render <plan.json> [--platform=ig|tiktok|shorts]
```

The render path must preserve MotionAgent's normal lint-first behavior. Do not bypass lint by default.
