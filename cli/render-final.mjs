#!/usr/bin/env node
// render-final.mjs — CLI wrapper around cli/render-core.mjs's renderFinal(): the
// shared lint-gate + remotion render + audio-master + ffmpeg-mux pipeline (ROADMAP Phase 1
// "wire audio master into the render pipeline" / PROGRESS.md 2026-07-12).
//
// The pipeline logic itself lives in render-core.mjs — mcp/server.mjs's `render` tool
// (when planPath is given) calls the exact same function, so lint-refusal behavior and
// transcript-path inference can't diverge between the CLI and MCP entry points again
// (see render-core.mjs's header for the bug this fixes).
//
// This script only ORCHESTRATES: it shells out to `remotion render`, `scripts/
// audio-master.mjs`, and `ffmpeg`/`ffprobe` via render-core.mjs. It does not reimplement
// any of their logic (AGENTS.md: "Render orchestration — wiring render+audio+mux").
//
// CLI:
//   node cli/render-final.mjs --composition <id> --plan <planPath> --out <finalPath>
//     [--music <path>] [--sfx <path:atMs>[,<path:atMs>...]] [--platform ig|tiktok]
//     [--transcript <path>] [--preset <id>] [--family <id>] [--props <path>] [--gl angle|swangle] [--force]
//
// --gl selects the chromium GL backend: "angle" (default, real GPU, fast — unchanged from
// before this flag existed) for user renders; "swangle" (pure-CPU SwiftShader, bit-identical
// across machines) for golden/reference renders of the WebGL tier (IMPLEMENTATION.md).
//
// --preset <id> loads presets/<id>.json and applies its motion/density/variance dials to
// the lint gate's R2/R3/R6/R7 thresholds (presets/dials.mjs). Omitted: same thresholds as
// the shipped "balanced" preset.
//
// Transcript resolution: --transcript wins if given; otherwise inferred from the plan
// filename via render-core.mjs's inferTranscriptPath() — "plan.json" -> "input/
// transcript.json", "plan2.json" -> "demo/input/transcript2.json", etc.
//
// Even with no --music/--sfx, audio-master.mjs still runs (VO-only) so loudness
// normalization always happens, per its own report that it supports a VO-only path.

import { renderFinal, firstFailureLine, PLATFORMS, GL_BACKENDS } from "./render-core.mjs";
import { parseArgs } from "./kit.mjs";

const USAGE =
  "Usage: node cli/render-final.mjs --composition <id> --plan <planPath> --out <finalPath>\n" +
  "  [--music <path>] [--sfx <path:atMs>[,<path:atMs>...]] [--platform ig|tiktok]\n" +
  "  [--transcript <path>] [--preset <id>] [--family <id>] [--props <path>] [--gl angle|swangle] [--force]";

function parseCliArgs(argv) {
  const args = parseArgs(argv, {
    string: ["composition", "plan", "out", "music", "sfx", "platform", "transcript", "preset", "family", "props", "gl"],
    boolean: ["force"],
    required: ["composition", "plan", "out"],
    defaults: { platform: "ig", gl: "angle", force: false },
    usage: USAGE,
  });
  if (!PLATFORMS.includes(args.platform)) {
    throw new Error(`--platform must be one of: ${PLATFORMS.join(", ")}`);
  }
  if (!GL_BACKENDS.includes(args.gl)) {
    throw new Error(`--gl must be one of: ${GL_BACKENDS.join(", ")}`);
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  const result = await renderFinal({
    compositionId: args.composition,
    planPath: args.plan,
    out: args.out,
    propsPath: args.props,
    music: args.music,
    sfx: args.sfx,
    platform: args.platform,
    transcriptPath: args.transcript,
    presetId: args.preset,
    familyId: args.family,
    force: args.force,
    gl: args.gl,
    cwd: process.cwd(),
    onLog: (line) => console.log(`[render-final] ${line}`),
  });

  if (!result.ok && result.refused) {
    console.error(
      `\nRENDER REFUSED — lint failed with ${result.lint.failures.length} failure(s)` +
        `${firstFailureLine(result.lint.failures)}. Pass --force to override.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[render-final] ERROR: ${err.message}`);
  process.exit(1);
});
