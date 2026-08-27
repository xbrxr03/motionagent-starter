import { TYPE_SCALE as T, t } from "../primitives";
import type { Family } from "../types";

export const TALKING_HEAD_DISPLAY_FONT = "Sora";
export const TALKING_HEAD_MONO_FONT = "JetBrains Mono";

export const TALKING_HEAD = {
  warmWhite: "#F7F2EA",
  softPaper: "#EFE7DC",
  ink: "#101114",
  charcoal: "#17191D",
  panel: "#24272D",
  line: "#D8CEC0",
  muted: "#6B6D73",
  faint: "#A7A19A",
  orange: "#F46F3A",
  purple: "#7B61FF",
  green: "#3B9F6A",
  red: "#E94B4F",
} as const;

export const talkingHeadData: Family = {
  id: "talkingHead",
  label: "Talking Head",
  fonts: { display: TALKING_HEAD_DISPLAY_FONT, mono: TALKING_HEAD_MONO_FONT },
  color: {
    bg: TALKING_HEAD.warmWhite,
    surface: TALKING_HEAD.charcoal,
    line: TALKING_HEAD.line,
    text: TALKING_HEAD.ink,
    muted: TALKING_HEAD.muted,
    faint: TALKING_HEAD.faint,
    accent: TALKING_HEAD.orange,
    accentSoft: "rgba(244,111,58,0.15)",
    alert: TALKING_HEAD.red,
    payoff: TALKING_HEAD.green,
  },
  backdrop: {
    mesh: [TALKING_HEAD.warmWhite, TALKING_HEAD.softPaper, "#FBE4D4", "#EAE3FF"],
    aurora: [TALKING_HEAD.orange, TALKING_HEAD.purple],
    vignette: "#000000",
  },
  type: {
    display: t(TALKING_HEAD_DISPLAY_FONT, T.display, 800, 0.96, "-0.05em"),
    headline: t(TALKING_HEAD_DISPLAY_FONT, T.headline, 800, 1.02, "-0.04em"),
    stat: t(TALKING_HEAD_DISPLAY_FONT, T.stat, 800, 0.94, "-0.05em"),
    body: t(TALKING_HEAD_DISPLAY_FONT, T.body, 600, 1.25, "-0.015em"),
    mono: t(TALKING_HEAD_MONO_FONT, T.mono, 400, 1.58, "0"),
    kicker: t(TALKING_HEAD_MONO_FONT, T.kicker, 700, 1, "0.2em"),
  },
};
