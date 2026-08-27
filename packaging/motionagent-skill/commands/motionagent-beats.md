---
description: Create MotionAgent transcript/beats files from a voiceover through the companion CLI.
argument-hint: "<vo.wav> --slug=<slug>"
allowed-tools:
  - Bash
---

# /motionagent-beats

Run:

```bash
node cli/motionagent.mjs beats <vo.wav> --slug=<slug>
```

This is a thin wrapper around the real ingest/word-timestamp mechanism. The transcript output is the source for audio-lock; every later scene boundary and `atMs` event should use real word starts from it.
