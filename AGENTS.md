# MotionAgent Starter agent guide

Read `DISTRIBUTION-ARCHITECTURE.md` before making changes.

This repository is the free, standalone customer surface. Preserve the complete CLI, core Remotion engine, lint/render pipeline, and exactly two packs: `ui-mate` and `talking-head`.

- Do not develop new paid packs here; build them in `xbrxr03/motionagent` and extract them into the paid add-on.
- Do not merge the paid add-on into this repository's committed tree.
- Do not import private references, private recreation plans, experimental packs, or dev-only render artifacts.
- When porting core changes from the dev repository, verify `npx tsc --noEmit`, both example plans, and `node cli/motionagent.mjs init`.
