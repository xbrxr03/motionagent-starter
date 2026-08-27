# MotionAgent Blind-Recreation Grading Rubric

Standardized format for grading a pack recreation against its source video (e.g. when
you're recreating a specific reference reel and want a repeatable, honest self-grade
rather than a vibes check). Use it every time a grader evaluates a recreation so
criteria stay consistent across sessions.

## Convergence bar

**Average ≥ 8.5, zero hard failures, across 3 consecutive blind cycles.**

A "hard failure" is any Severity-1 finding (see below). A single Severity-1 finding
blocks convergence regardless of the average score. The cycle count resets on any
pack fix.

## Operating posture

You are a senior motion designer grading a recreation against the original. Your bias is
toward **visual fidelity to the source** — the recreation should look like it could have
come from the same creator. Default to flagging; approval is earned, not assumed.

You NEVER see the Director's reasoning. You see ONLY:
- The source video (real reference reel)
- The recreation video (rendered MP4)
- Frame-pair stills extracted at matching timestamps (from `cli/compare-report.mjs`)
- The pack's `pack.json` (for context on the pack's scope/limitations)
- The recreation's demo plan JSON (for component identification, not for excusing gaps)

You do NOT see:
- The Director's prompts or reasoning
- The grader agent's previous scores (if this is a re-grade)
- Any reference to "how hard" the recreation was to build

## Findings table format

Every grading output MUST open with a findings table. One row per issue. Never a prose
list.

| Timestamp | Severity | Category | Finding | Source shows | Recreation shows | Fix guidance |
|-----------|----------|----------|---------|--------------|------------------|---------------|
| 3.8s | 1 | Content | Missing command-palette result count | Palette footer shows "12 results, ⌘K to filter" | Footer is empty | Add the result-count line to `UiCommandList`'s footer render, matching the source's copy |
| 12.4s | 3 | Polish | Slight timing lag on word entrance | Words appear 80ms ahead of the source's rhythm | Words appear 150ms behind | Tighten `enterMs` by ~70ms for this scene's word group |

### Column definitions

- **Timestamp**: The moment in the recreation where the defect is most visible, formatted as `M:SS.s` or `S.Ss`.
- **Severity**: 1 (hard failure / content missing), 2 (motion/pacing), 3 (contrast/legibility), 4 (polish). See severity tiers below.
- **Category**: One of Content, Motion, Contrast, Polish (matching the severity tier).
- **Finding**: One-sentence factual description of what's wrong.
- **Source shows**: What the real video shows at this moment.
- **Recreation shows**: What the recreation shows at this moment.
- **Fix guidance**: Suggested component-level fix (pack fix, not video edit).

## Severity tiers

Tier 1 findings are **hard failures** — any single one blocks convergence regardless of
the overall average score. Tiers 2-4 are quality deductions that lower the average.

### Tier 1: Content / Substance missing (hard failure, blocks convergence)

- A distinct visual beat from the source is completely absent in the recreation (not
  simplified or abstracted — entirely missing).
- Text content that conveys meaning in the source is missing or replaced with
  placeholder/lorem ipsum.
- A scene transition or structural element that defines the source's visual narrative
  is absent.
- The recreation uses the same generic component 3+ times where the source shows 3+
  distinct visual moments (the "single hero moment" trap).
- Real brand names, logos, or likeness are fabricated rather than genericized. (The
  opposite is fine: genericizing a specific brand is expected.)

### Tier 2: Motion / Pacing (deduction, typically −1 per finding)

- Scene timing drifts >200ms from the source's rhythm at a structural boundary
  (scene start/end, not individual word onsets).
- An animation curve is qualitatively wrong: ease-in on something that should ease-out,
  instant appear where the source has a reveal, etc.
- Missing or wrong entrance/exit animation for a visual element that the source
  animates.
- Scene duration noticeably shorter or longer than the source's equivalent beat
  (>20% deviation).

### Tier 3: Contrast / Legibility (deduction, typically −0.5 per finding)

- Text that's legible in the source is illegible in the recreation (insufficient
  contrast, wrong color inversion, text-on-text collision).
- Foreground elements that should stand out blend into the background.
- A foreground/background color inversion — dark-on-dark or light-on-light rendering.

### Tier 4: Polish (deduction, typically −0.25 per finding)

- Subtle spacing/padding differences that don't affect readability.
- Font weight or size that's close but not pixel-matched to the source.
- Missing secondary visual detail (a subtle gradient, a shadow, a border radius)
  that doesn't affect content comprehension.
- Minor color hue shift that preserves the overall palette identity.

## Verdict format

After the findings table, close with:

1. **Score**: X/10, computed as 10 minus the sum of all deductions. Start at 10,
   subtract per-finding penalties per the severity tiers above. Round to one decimal.
2. **Hard failures**: Count of Tier-1 findings. If >0, convergence is blocked regardless
   of the average.
3. **Convergence verdict**: One of:
   - **Converged** — average ≥ 8.5, zero hard failures, across 3+ consecutive cycles
   - **Not yet** — average < 8.5, or any hard failure present, or fewer than 3 cycles
   - **Blocked** — a structural issue that no amount of pack improvement will fix
     (e.g., the pack's scope doesn't cover the source's content type at all)
4. **Per-cycle summary**: For each target in the pack, one line with the target slug,
   score, and hard-failure count.

## Per-target grading procedure

For each target in the pack's selected recreation set:

1. **Extract frame pairs** using `node cli/compare-report.mjs <pack> <slug>`. Open the
   generated `report.html` and swipe through every frame pair.
2. **Watch both videos in full** — source first, then recreation. Note structural beats
   and where they diverge.
3. **Log findings in the table** as you go. Timestamp each finding at the recreation's
   moment where the defect is most visible.
4. **Score and verdict** per the format above.
5. **If the score < 8.5 or any hard failure exists**: the Director must FIX THE PACK
   (not the video). Fix, version-bump, re-render, and re-grade. The cycle count resets
   on any pack fix.

## When to skip a target

A target may be skipped ONLY if:
- The source video is genuinely unavailable (deleted, corrupted, or irretrievable).
- The recreation fails to render at all (crash, zero-duration MP4).

In both cases, log the skip with reason in the findings table. A skipped target counts
as "not yet graded" — it cannot contribute to a convergence cycle.

## What this rubric does NOT cover

- **Pixel conformance**: automated render regression testing is a separate concern.
  This rubric is for taste-fidelity, not render-pixel regression.
- **Audio fidelity**: The harness grades visual recreation against visual source. Audio
  timing (word onsets, beat alignment) is a separate check covered by the plan's
  `atMs` timestamps and the render-freshness gate.
- **Creative direction**: Whether a scene *should* exist is the Director's call. The
  grader judges whether the recreation faithfully represents what the source shows, not
  whether the source's creative choices were good.

## Example verdict block

```
## Verdict

| Target | Score | Hard failures |
|--------|-------|---------------|
| command-palette-filter-demo | 7.5 | 1 (missing result count at 3.8s) |
| upload-retry-flow | 8.5 | 0 |
| optimistic-like-button | 6.0 | 2 (missing state transition + wrong scene structure) |
| form-validation-walkthrough | 8.0 | 0 |
| creator-tool-proof-reel | 9.0 | 0 |
| social-cta-closer | 7.0 | 1 (content gap at 18.2s) |

Pack average: 7.7/10. Hard failures: 2 total. Convergence: **Not yet**.
Fix Tier-1 findings (result-count gap, optimistic-like state transition)
before re-rendering and re-grading.
```