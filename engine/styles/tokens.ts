// COMPAT BRIDGE — legacy flat exports, now DERIVED from the 3-tier token system.
// Existing components import COLOR/TYPE/SAFE/CANVAS from here unchanged, so the Signal
// reel renders byte-identical. New/migrated components use useTokens() from
// ../../tokens/TokenProvider instead. This file exists only until migration completes.
import { signal } from "../../tokens/families/signal";
import { SAFE as PLATFORM_SAFE, CANVAS as PLATFORM_CANVAS } from "../../tokens/platform";

export const FONT = signal.fonts;

// Legacy flat COLOR shape ← Signal semantic tokens (same values as before).
export const COLOR = {
  ink: signal.color.bg,
  surface: signal.color.surface,
  line: signal.color.line,
  paper: signal.color.text,
  muted: signal.color.muted,
  faint: signal.color.faint,
  accent: signal.color.accent,
  accentSoft: signal.color.accentSoft,
  alert: signal.color.alert,
  payoff: signal.color.payoff,
} as const;

export const TYPE = signal.type;
export const SAFE = PLATFORM_SAFE;
export const CANVAS = PLATFORM_CANVAS;

// Migration bridge: map any Family's semantic tokens to the legacy flat COLOR shape.
import type { Family } from "../../tokens/types";
import { useTokens } from "../../tokens/TokenProvider";

export const legacyColors = (f: Family) =>
  ({
    ink: f.color.bg,
    surface: f.color.surface,
    line: f.color.line,
    paper: f.color.text,
    muted: f.color.muted,
    faint: f.color.faint,
    accent: f.color.accent,
    accentSoft: f.color.accentSoft,
    alert: f.color.alert,
    payoff: f.color.payoff,
  }) as const;

/** Active-family tokens in the legacy { COLOR, TYPE } shape. Components call this.
 *  BACKDROP is passed through raw (not part of the flat COLOR shape) for Background. */
export const useReelTokens = () => {
  const f = useTokens();
  return { COLOR: legacyColors(f), TYPE: f.type, BACKDROP: f.backdrop };
};
