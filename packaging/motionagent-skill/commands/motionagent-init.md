---
description: Check local MotionAgent dependencies and list the two free-starter packs.
argument-hint: ""
allowed-tools:
  - Bash
---

# /motionagent-init

Run the companion MotionAgent CLI from the project root:

```bash
node cli/motionagent.mjs init
```

Expected behavior comes from the CLI scaffolder: check Node >=20, `ffmpeg`, and
`whisper-cli`; run a fast pipeline smoke test (renders frame 0 of the UI Mate capability
showcase plan and confirms it's not blank); and print the two free-starter packs, UI Mate
and Talking Head. This starter has no license gate — do not describe network license
checks, Stripe/payment gating, or a production license backend as implemented.
