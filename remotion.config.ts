import fs from "node:fs";
import { Config } from "@remotion/cli/config";

// Explicit entry point (post-restructure, 2026-07-14): Remotion's CLI only
// auto-discovers src/index.ts / remotion/index.ts by convention — neither matches this
// repo's engine/ folder (ARCHITECTURE.md §2), so every `npx remotion render/still/studio`
// call (with no entry-point CLI arg) would otherwise fail to find the composition root.
// Config file is priority #2 in Remotion's own resolution order (after an explicit CLI
// arg, before the hardcoded common-paths list) — this one setting covers every call site
// (package.json scripts, cli/render-core.mjs's `npx remotion render`, ad-hoc `remotion
// still` invocations) without touching each individually.
Config.setEntryPoint("engine/index.ts");

const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE;
if (browserExecutable && fs.existsSync(browserExecutable)) {
  Config.setBrowserExecutable(browserExecutable);
}

if (process.env.REMOTION_CHROMIUM_HEADLESS === "false") {
  Config.setChromiumHeadlessMode(false);
}

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setCodec("h264");
