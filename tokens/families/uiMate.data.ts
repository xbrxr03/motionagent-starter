import { TYPE_SCALE as T, t } from "../primitives";
import type { Family } from "../types";

export const UI_MATE_DISPLAY_FONT = "Sora";
export const UI_MATE_MONO_FONT = "JetBrains Mono";

export const UI_MATE = {
  bg: "#070B10",
  surface: "#101820",
  panel: "#17232D",
  line: "#20323B",
  text: "#F5FBFF",
  muted: "#9DB0B7",
  faint: "#51646D",
  teal: "#00CDB8",
  red: "#F0525F",
  yellow: "#FFCE5C",
  pink: "#FF6A9A",
  green: "#47D678",
} as const;

export const uiMateData: Family = {
  id: "uiMate",
  label: "UI Mate",
  fonts: { display: UI_MATE_DISPLAY_FONT, mono: UI_MATE_MONO_FONT },
  color: {
    bg: UI_MATE.bg,
    surface: UI_MATE.surface,
    line: UI_MATE.line,
    text: UI_MATE.text,
    muted: UI_MATE.muted,
    faint: UI_MATE.faint,
    accent: UI_MATE.teal,
    accentSoft: "rgba(0,205,184,0.16)",
    alert: UI_MATE.red,
    payoff: UI_MATE.green,
  },
  backdrop: {
    mesh: [UI_MATE.bg, "#0B1319", "#101A22", UI_MATE.panel],
    aurora: [UI_MATE.teal, UI_MATE.pink],
    vignette: "#020406",
  },
  type: {
    display: t(UI_MATE_DISPLAY_FONT, T.display, 800, 0.98, "-0.04em"),
    headline: t(UI_MATE_DISPLAY_FONT, T.headline, 800, 1.04, "-0.03em"),
    stat: t(UI_MATE_DISPLAY_FONT, T.stat, 800, 0.96, "-0.04em"),
    body: t(UI_MATE_DISPLAY_FONT, T.body, 600, 1.28, "-0.01em"),
    mono: t(UI_MATE_MONO_FONT, T.mono, 400, 1.55, "0"),
    kicker: t(UI_MATE_MONO_FONT, T.kicker, 700, 1, "0.2em"),
  },
};
