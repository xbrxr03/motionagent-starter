// THE SEMANTIC CONTRACT — what every family must provide and every component reads.
// Components depend on THIS shape, never on a concrete family. This is the decoupling.

export type SemanticColors = {
  bg: string;
  surface: string;
  line: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  alert: string;
  payoff: string;
};

export type TypeRole = { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number; letterSpacing: string };

export type SemanticType = {
  display: TypeRole;
  headline: TypeRole;
  stat: TypeRole;
  body: TypeRole;
  mono: TypeRole;
  kicker: TypeRole;
};

// The cinematic backdrop's family-specific hues. Kept OUT of SemanticColors because
// components read individual color roles from there, whereas Background consumes these
// as a set: a 4-stop shader mesh ramp (bg → accent, hand-tuned per family so it stays
// cinematic rather than a naive lerp) and two drifting aurora hues. Each family ships
// its own so the whole backdrop re-themes — this is why Background no longer hardcodes
// Signal's blue/violet mesh and aurora.
export type Backdrop = {
  mesh: [string, string, string, string];
  aurora: [string, string];
  // The color a vignette/letterbox/full-bleed-media-edge darkens TOWARD — deliberately
  // separate from `color.bg`. For every dark-theme family so far these happen to be the
  // same value (their bg IS already near-black), but a light-theme family's bg is
  // near-white: fading a vignette toward `bg` there is a visual no-op (transparent →
  // near-white is imperceptible), which is exactly the gap that blocked Glass/Paper
  // before this field existed (see HARDENING.md's 2026-07-14 "families #3-5" entry). This
  // is always a real dark neutral, independent of theme, so the vignette/depth effect
  // reads correctly in both a dark and a light family.
  vignette: string;
};

export type Family = {
  id: string;
  label: string;
  fonts: { display: string; mono: string };
  color: SemanticColors;
  type: SemanticType;
  backdrop: Backdrop;
};
