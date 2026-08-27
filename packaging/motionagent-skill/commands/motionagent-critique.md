---
description: Critique an existing MotionAgent render using the real blind-recreation grading rubric.
argument-hint: "<pack> <target slug or render path>"
allowed-tools:
  - Read
  - Bash
---

# /motionagent-critique

Use `research/motionagent-grading-rubric.md` as the grading contract. Open with the findings table; do not start with prose.

Required table:

| Timestamp | Severity | Category | Finding | Source shows | Recreation shows | Fix guidance |
|-----------|----------|----------|---------|--------------|------------------|--------------|

Severity tiers:

- 1 Content/Substance missing - hard failure, blocks convergence.
- 2 Motion/Pacing - timing, curve, entrance/exit, or scene-duration mismatch.
- 3 Contrast/Legibility - unreadable text, foreground/background blend, `COLOR.ink`/`COLOR.paper` inversion.
- 4 Polish - spacing, font-size/weight, minor hue/detail misses.

Close with Score, Hard failures, Convergence verdict, and a per-target summary. The convergence bar is average >=8.5, zero hard failures, across 3 consecutive blind cycles.

If frame pairs are available, use:

```bash
node cli/compare-report.mjs <pack> <slug>
```

If frame pairs or source video are unavailable, say what could not be verified instead of guessing.
