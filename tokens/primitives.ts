// PRIMITIVES — raw ramps. No semantic meaning; families alias INTO these.
// Adding a family never edits this file; it only references these keys.
import type { TypeRole } from "./types";

export const COLOR_RAMP = {
  // neutrals (ink → paper)
  ink900: "#0A0E16",
  ink800: "#111726",
  paper100: "#EDEAE2",
  paper60: "rgba(237,234,226,0.60)",
  paper22: "rgba(237,234,226,0.22)",
  paper10: "rgba(237,234,226,0.10)",
  slate400: "#8A93A6",
  // accents
  violet500: "#8B7CFF",
  violet400: "#B9A8FF",
  violet14: "rgba(139,124,255,0.14)",
  green500: "#3ECF8E",
  coral500: "#FF6B5E",
  amber500: "#E8B44C",
  // signal backdrop ramp — the shader-mesh mid stops (bg→accent) + secondary aurora.
  // Hand-tuned blues/violets so the cinematic field stays richer than a naive bg↔accent lerp.
  navy800: "#141b3d",
  indigo700: "#2A2170",
  violet600: "#6152cf",
  blue500: "#4C68FF",
  // @abrxr / Onda ramp (family #2)
  abInk: "#08080A",
  abSurface: "#0E0E12",
  abBorder: "#1C1C22",
  abText: "#F2F2F4",
  abDim: "#8E8E98",
  abFaint: "#56565F",
  abRose: "#D96B82",
  abRoseSoft: "#E89AAB",
  abRose14: "rgba(217,107,130,0.14)",
  // abrxr backdrop ramp — wine→dusty-rose mesh mid stops + a deeper secondary aurora,
  // the rose counterpart to signal's navy/indigo/violet field.
  abWine900: "#1A0E12",
  abMaroon800: "#3A1B24",
  abRose700: "#8A3E4E",
  abRose600: "#B65066",

  // Shared dark-field base (families #3-5) — the literal '#050505' base color from the
  // ReelStack VisualFamilies source's 'dark' theme (see ROADMAP.md "Assets on hand": 5
  // original palette sets ported as new-named families, values kept 1:1, ReelStack
  // names/lineage dropped). Dark/Warm/Forbidden in the source all shared this one base —
  // voltage/hearth/redline differentiate via surface/accent, not base black.
  rsDarkBase: "#050505",
  // shared success/warning/error swatches — identical across ReelStack's Dark + Warm
  // (Forbidden's error/alert instead equals its own accent — see redlineAccent below).
  rsSuccess: "#34D399",
  rsWarning: "#FBBF24",
  rsAlert: "#EF4444",

  // voltage ramp (family #3, was ReelStack "Dark") — near-void black, orange/indigo neon.
  voltSurface: "#0E0E11",
  voltBorder: "rgba(255,255,255,0.08)",
  voltText: "#FFFFFF",
  voltMuted: "#A1A1AA",
  voltFaint: "#555555",
  voltAccent: "#FF6B35",
  voltAccentSoft: "rgba(255,107,53,0.14)",
  voltIndigo: "#6366F1",
  // voltage backdrop ramp — black → indigo-purple → warm transition → orange accent.
  voltMid1: "#1C1830",
  voltMid2: "#4A2E6B",

  // hearth ramp (family #4, was ReelStack "Warm") — cozy dark charcoal, amber glow.
  hearthSurface: "#1E1A13",
  hearthBorder: "rgba(251,191,36,0.1)",
  hearthText: "#FFF8E7",
  hearthMuted: "#B8A88A",
  hearthFaint: "#6B5F4A",
  hearthAccent: "#FBBF24",
  hearthAccentSoft: "rgba(251,191,36,0.14)",
  hearthSecondary: "#F59E0B",
  // hearth backdrop ramp — black → warm brown-black → deep amber-brown → amber accent.
  hearthMid1: "#1A140A",
  hearthMid2: "#3D2D10",

  // redline ramp (family #5, was ReelStack "Forbidden") — darkest, red danger, high drama.
  redlineSurface: "#0D0909",
  redlineBorder: "rgba(220,38,38,0.15)",
  redlineText: "#F5F5F5",
  redlineMuted: "#999999",
  redlineFaint: "#555555",
  // redlineAccent (#DC2626, the literal ReelStack pastel-for-dark red) is 4.22:1 on
  // rsDarkBase — passes WCAG AA for large/bold text (headline/display) but not the
  // stricter 4.5:1 floor for smaller text roles (kicker, mono, body-sized emphasis).
  // Kept for decorative mesh/aurora use; redlineAccentText is a slightly brighter tone
  // of the same red, used for color.accent/accentSoft/alert (the actual on-screen text).
  redlineAccent: "#DC2626",
  redlineAccentText: "#EA4444", // 5.25:1 on rsDarkBase
  redlineAccentSoft: "rgba(234,68,68,0.14)",
  redlineSecondary: "#991B1B",
  // redline backdrop ramp — black → red-tinted near-black → deep blood red → accent red.
  redlineMid1: "#1A0808",
  redlineMid2: "#4A0F0F",

  // Shared vignette-shadow color for LIGHT-theme families (families #6-7) — see
  // types.ts's Backdrop.vignette comment. A dark-theme family's vignette equals its own
  // `bg` (already near-black); a light family needs a real dark neutral independent of
  // its near-white bg, or the vignette/depth effect is a no-op. Not derived from any
  // ReelStack source value (ReelStack has no vignette concept of its own) — a genuine
  // MotionAgent addition.
  voidBlack: "#000000",

  // Shared LIGHT-theme base — from the ReelStack source's sibling BackgroundSystem.tsx
  // THEMES.light.base (the literal bg both light families share, same way rsDarkBase is
  // the dark trio's shared base).
  rsLightBase: "#F5F5F0",

  // Text-safe success/alert for LIGHT-theme families (2026-07-14 contrast fix — see the
  // long comment block below glassAccent for the full story). The ORIGINAL ReelStack
  // success/error swatches (#10B981 / #EF4444, ported as rsLightSuccess/reused rsAlert)
  // measure 2.32:1 and 3.44:1 against rsLightBase — both fail WCAG AA for text (need
  // ≥4.5:1). These are deliberately NOT 1:1 ports: darkened while staying recognizably
  // the same hue (green/red), specifically for use as TEXT/foreground color. Shared
  // across glass+paper the same way the dark trio shares rsSuccess/rsAlert.
  rsLightSuccessText: "#047857", // 5.01:1 on rsLightBase
  rsLightAlertText: "#B91C1C", // 5.92:1 on rsLightBase

  // glass ramp (family #6, was ReelStack "Glass") — clean off-white field, cyan/violet.
  glassSurface: "#FCFCFB",
  glassBorder: "rgba(0,0,0,0.05)",
  glassText: "#000000",
  glassMuted: "#6B6B6B",
  glassFaint: "#999999",
  // glassAccent (#7DD3E0, the literal ReelStack pastel) is DECORATIVE-ONLY — mesh/aurora
  // glow, never text. It measures 1.57:1 against rsLightBase, nowhere near legible as
  // foreground color; low-alpha glow doesn't care about text contrast, so it stays as-is
  // there. glassAccentText is the real fix: a deeper, more saturated tone of the SAME
  // cyan hue, used for color.accent/accentSoft (actual on-screen text/UI) — this is a
  // deliberate deviation from "palette values kept 1:1" (see ROADMAP.md's clean-room
  // note), made on direct user instruction after the initial 1:1 port shipped genuinely
  // illegible cyan-on-white text in a real render. A proper palette needs both a light
  // tone for glow and a dark tone for text — one flat value can't do both jobs.
  glassAccent: "#7DD3E0",
  glassAccentText: "#0A7285", // 5.11:1 on rsLightBase — color.accent/accentSoft use this
  glassAccentSoft: "rgba(10,114,133,0.14)",
  glassSecondary: "#A78BFA",
  // glass backdrop ramp — off-white → pale cyan tint → pale violet tint → cyan accent.
  glassMid1: "#E8F5F3",
  glassMid2: "#E5DFF7",

  // paper ramp (family #7, was ReelStack "Paper") — warm cream field, amber/pink.
  paperSurface: "#FEFEFD",
  paperBorder: "rgba(200,180,160,0.15)",
  paperText: "#2D2216",
  // Darkened from the literal ReelStack tan (#8B7355, 4.10:1 on rsLightBase — just under
  // WCAG AA's 4.5:1 floor for text) — same 2026-07-14 contrast pass as accent/alert/payoff
  // above, but muted has no decorative use to preserve, so this one just changes in place.
  paperMuted: "#6E5940", // 6.07:1 on rsLightBase
  paperFaint: "#B8A090",
  // paperAccent (#FDBA74, the literal ReelStack pastel) — same decorative-only story as
  // glassAccent above: 1.54:1 on rsLightBase, illegible as text. paperAccentText is the
  // text-safe deep-amber tone of the same hue, used for color.accent/accentSoft.
  paperAccent: "#FDBA74",
  paperAccentText: "#8A4E22", // 6.01:1 on rsLightBase
  paperAccentSoft: "rgba(138,78,34,0.14)",
  paperSecondary: "#F9A8D4",
  // paper backdrop ramp — cream → pale peach tint → pale pink tint → amber accent.
  paperMid1: "#F5E6D3",
  paperMid2: "#F5DCE8",
} as const;

// Type scale steps (px @1080×1920). Family maps roles → steps.
export const TYPE_SCALE = {
  stat: 340,
  display: 118,
  headline: 96,
  body: 46,
  mono: 34,
  kicker: 30,
} as const;

export type ColorKey = keyof typeof COLOR_RAMP;
export type TypeStep = keyof typeof TYPE_SCALE;

// Shared TypeRole builder — was byte-identical, locally redefined in all 8
// tokens/families/*.data.ts files. One SemanticType role (display/headline/stat/body/
// mono/kicker) is built from these 5 positional args; families call this instead of each
// keeping their own copy.
export const t = (
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  lineHeight: number,
  letterSpacing: string,
): TypeRole => ({ fontFamily, fontSize, fontWeight, lineHeight, letterSpacing });
