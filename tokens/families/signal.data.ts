// SIGNAL family DATA — semantic aliases into primitives ONLY. No raw hexes here except
// via COLOR_RAMP. Deliberately has ZERO dependency on @remotion/google-fonts: font
// *names* are plain string literals (the exact `fontFamily` that
// @remotion/google-fonts/SpaceGrotesk + JetBrainsMono resolve to — asserted against the
// live loadFont() call in signal.ts, the bundler/render-path binding). That keeps this
// file importable by a plain Node process (lint CLI, MCP `lint_plan` tool, CI,
// scripts/compile-tokens.mjs) with no webpack/bundler resolution required — see
// HARDENING.md "ship a token artifact consumable outside the bundler".
import { COLOR_RAMP as C, TYPE_SCALE as T, t } from "../primitives";
import type { Family } from "../types";

export const SIGNAL_DISPLAY_FONT = "Space Grotesk";
export const SIGNAL_MONO_FONT = "JetBrains Mono";

export const signalData: Family = {
  id: "signal",
  label: "Signal",
  fonts: { display: SIGNAL_DISPLAY_FONT, mono: SIGNAL_MONO_FONT },
  color: {
    bg: C.ink900,
    surface: C.ink800,
    line: C.paper10,
    text: C.paper100,
    muted: C.slate400,
    faint: C.paper22,
    accent: C.violet500,
    accentSoft: C.violet14,
    alert: C.coral500,
    payoff: C.green500,
  },
  // Exact values Background hardcoded before the token migration — Signal renders identically.
  backdrop: {
    mesh: [C.ink900, C.navy800, C.indigo700, C.violet600],
    aurora: [C.violet500, C.blue500],
    // Dark-theme family: vignette === bg, same as the pre-vignette-field behavior.
    vignette: C.ink900,
  },
  type: {
    display: t(SIGNAL_DISPLAY_FONT, T.display, 700, 1.06, "-0.025em"),
    headline: t(SIGNAL_DISPLAY_FONT, T.headline, 700, 1.08, "-0.02em"),
    stat: t(SIGNAL_DISPLAY_FONT, T.stat, 700, 1, "-0.03em"),
    body: t(SIGNAL_DISPLAY_FONT, T.body, 500, 1.4, "0"),
    mono: t(SIGNAL_MONO_FONT, T.mono, 400, 1.75, "0"),
    kicker: t(SIGNAL_MONO_FONT, T.kicker, 700, 1, "0.28em"),
  },
};
