// Impact toolkit — every effect is beat-triggered and decays. Nothing loops, nothing pulses idly.
// No family-token import here on purpose: every helper below takes color as a param so
// this file never re-introduces a hardcoded family (the leak this file used to have —
// gradientText/glow'd defaults baked in Signal's violet). Callers pass the ACTIVE
// family's token (via useReelTokens()), so the same effect re-themes for free.
import { AbsoluteFill, interpolate } from "remotion";

// Scale kick that decays after each beat, with a 4-frame anticipation dip before it.
// The dip is the classic animation "wind-up" — cheapest expensive-looking tell there is.
export const punchScale = (frame: number, beats: number[], amount = 0.045): number => {
  let kick = 0;
  let dip = 0;
  for (const b of beats) {
    const k = frame - b;
    if (k >= 0 && k < 20) kick = Math.max(kick, Math.exp(-k / 5));
    if (k >= -4 && k < 0) dip = Math.max(dip, 1 - Math.abs(k) / 4);
  }
  return 1 + amount * kick - 0.014 * dip;
};

// Single-frame flash on an audio hit (anime impact-frame convention). Max 2 frames.
// `color` is required — callers pass the active family's paper/accent/payoff token
// (useReelTokens().COLOR) rather than relying on a hardcoded fallback here.
export const ImpactFlash: React.FC<{ frame: number; beat: number; color: string }> = ({
  frame,
  beat,
  color,
}) => {
  const k = frame - beat;
  if (k < 0 || k > 1) return null;
  return (
    <AbsoluteFill
      style={{ background: color, opacity: k === 0 ? 0.55 : 0.18, mixBlendMode: "screen", pointerEvents: "none" }}
    />
  );
};

// Deterministic character scramble: text resolves left-to-right over `dur` frames after `beat`.
const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&";
export const scrambleText = (text: string, frame: number, beat: number, dur = 12): string => {
  const k = frame - beat;
  if (k >= dur) return text;
  if (k < 0) return "";
  const resolved = Math.floor((k / dur) * text.length);
  return text
    .split("")
    .map((ch, i) => {
      if (i < resolved || ch === " " || ch === "/") return ch;
      return SCRAMBLE[(i * 31 + frame * 7) % SCRAMBLE.length];
    })
    .join("");
};

// Traveling specular highlight over gradient/metallic type. One pass, beat-triggered.
export const Sheen: React.FC<{ frame: number; beat: number; children: React.ReactNode; dur?: number }> = ({
  frame,
  beat,
  children,
  dur = 22,
}) => {
  const k = frame - beat;
  const t = k < 0 || k > dur ? -1 : k / dur;
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {children}
      {t >= 0 ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `linear-gradient(105deg, transparent ${t * 140 - 25}%, rgba(255,255,255,0.85) ${t * 140 - 12}%, transparent ${t * 140}%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            pointerEvents: "none",
          }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
};

// Micro screen-shake, deterministic, decays over ~8 frames.
export const shakeOffset = (frame: number, beats: number[], amp = 7): { x: number; y: number } => {
  for (const b of beats) {
    const k = frame - b;
    if (k >= 0 && k < 10) {
      const d = Math.exp(-k / 3.2) * amp;
      return { x: Math.sin(k * 2.9) * d, y: Math.cos(k * 2.3) * d * 0.6 };
    }
  }
  return { x: 0, y: 0 };
};

export const glow = (color: string, strength = 1): string =>
  `0 0 ${24 * strength}px ${color}66, 0 0 ${72 * strength}px ${color}3d, 0 0 ${160 * strength}px ${color}1f`;

// #RRGGBB -> [r,g,b]. Every semantic color token that reaches gradientText/gradientGlow
// (accent/alert/payoff/text) is stored as plain hex in tokens/primitives.ts — same
// assumption glow() above already makes via its `${color}66` alpha-suffix trick.
// Accepts #RRGGBB, #RGB, or an rgb()/rgba() string and returns [r,g,b]. Some semantic
// tokens (accentSoft/faint/line) are stored as rgba() strings and are family-dependent
// (e.g. signal.line is rgba, abrxr.line is hex), so a hex-only parser would silently
// render black on one family and not another — this normalizes both forms.
const hexToRgb = (color: string): [number, number, number] => {
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  let hex = color.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = parseInt(hex, 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// #RRGGBB + alpha -> "rgba(r,g,b,a)". Lets a component tint the ACTIVE family's accent
// (or any hex token) at an arbitrary opacity — ghost numerals, glass borders, aurora
// blobs — without hardcoding the family's rgb triplet, which is exactly the leak that
// baked Signal's violet into backgrounds/cards/terminals.
export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Blend a hex color toward white by `amount` (0-1) — derives a gradient's mid/highlight
// stops from a single accent color so every family gets the same 3-stop shape for free.
const mixWithWhite = (hex: string, amount: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};

// Emphasis-word fill: a diagonal 3-stop gradient from the accent color to near-white.
// `color` is the ACTIVE family's accent (pass useReelTokens().COLOR.accent) — this used
// to be a hardcoded Signal-violet CSSProperties object, so every family rendered violet
// emphasis text regardless of theme.
export const gradientText = (color: string): React.CSSProperties => ({
  backgroundImage: `linear-gradient(104deg, ${color} 8%, ${mixWithWhite(color, 0.37)} 48%, ${mixWithWhite(color, 0.83)} 96%)`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
});

type GlowLayer = { px: number; alpha: number };

// Two-layer drop-shadow glow to sit behind gradientText (filter, not text-shadow —
// text-shadow doesn't read through a WebkitBackgroundClip:text transparent fill the
// way a filter does). Defaults reproduce Headline's original two layers exactly;
// pass explicit `layers` to match a different call site's original magnitude (e.g.
// StatFlip's bigger 40px/140px glow) while still taking color from the caller.
export const gradientGlow = (
  color: string,
  layers: [GlowLayer, GlowLayer] = [
    { px: 26, alpha: 0.55 },
    { px: 90, alpha: 0.3 },
  ],
): string => {
  const [r, g, b] = hexToRgb(color);
  return layers.map((l) => `drop-shadow(0 0 ${l.px}px rgba(${r},${g},${b},${l.alpha}))`).join(" ");
};

// RGB-split glitch text-shadow for k frames after a beat (alert moments only). `color`
// is required — callers pass the active family's alert token (was a hardcoded coral
// literal that happened to equal Signal's COLOR.alert exactly, paired with an unrelated
// hardcoded cyan for the second channel). The second channel is now derived as the
// passed color's RGB inverse rather than a second baked-in literal, so the classic
// chromatic-split look survives re-theming without inventing a new hardcoded hex here.
export const glitchShadow = (frame: number, beat: number, color: string): React.CSSProperties => {
  const k = frame - beat;
  if (k < 0 || k > 8) return {};
  const a = Math.exp(-k / 3) * 6;
  const [r, g, b] = hexToRgb(color);
  return {
    textShadow: `${a}px 0 rgba(${r},${g},${b},0.85), ${-a}px 0 rgba(${255 - r},${255 - g},${255 - b},0.7)`,
    transform: `translateX(${Math.sin(k * 12.9) * a * 0.8}px)`,
  };
};

// Expanding ring burst at a beat. `color` is required — callers pass the active
// family's token (was `= COLOR.accent`, a hardcoded import of Signal's accent that
// rendered violet rings even when the active family was e.g. abrxr).
export const Ring: React.FC<{ beat: number; frame: number; color: string; size?: number; x?: string; y?: string }> = ({
  beat,
  frame,
  color,
  size = 520,
  x = "50%",
  y = "50%",
}) => {
  const k = frame - beat;
  if (k < 0 || k > 26) return null;
  const t = interpolate(k, [0, 26], [0, 1], { easing: (v) => 1 - Math.pow(1 - v, 3) });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: size,
        border: `3px solid ${color}`,
        opacity: (1 - t) * 0.8,
        transform: `scale(${0.25 + t * 2.2})`,
      }}
    />
  );
};

// Traffic-light dots + adjoining label row — the "window chrome" header shared by every
// chrome-style card (Terminal, CodeDiff, DeviceFrame's browser chrome). Only the dot size
// (15 in Terminal/CodeDiff vs 13 in DeviceFrame) and the row's own box styling (padding/
// height/background) actually differ per caller, so those are the only knobs exposed:
// `style` merges over (and can override) the default flex-row box, `title` renders with
// Terminal/CodeDiff's exact shared label styling via `titleStyle`, and `children` lets
// DeviceFrame swap in its own URL pill instead of a plain title (mutually exclusive with
// `title` — children wins when both are given, matching "nothing else needed the title
// path" for that caller).
export const WindowChrome: React.FC<{
  dotColor: string;
  lineColor: string;
  dotSize?: number;
  title?: React.ReactNode;
  titleStyle?: React.CSSProperties;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ dotColor, lineColor, dotSize = 15, title, titleStyle, style, children }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "28px 36px",
      borderBottom: `1px solid ${lineColor}`,
      ...style,
    }}
  >
    {[0.35, 0.22, 0.12].map((o, i) => (
      <div key={i} style={{ width: dotSize, height: dotSize, borderRadius: dotSize, background: rgba(dotColor, o) }} />
    ))}
    {children ?? (title !== undefined ? <div style={titleStyle}>{title}</div> : null)}
  </div>
);

// Floor reflection: a flipped, masked, blurred echo of hero text (StatFlip's `to`,
// LogoReveal's wordmark, Countdown's active value). The mask/blur/scaleY(-1) shape is
// identical across all three callers — what differs (opacity curve, vertical offset,
// whether an extra `scale()` rides along with the flip, font styling) is caller-specific
// per-frame math, so it's passed through `style` (merged OVER the defaults below, same
// pattern as WindowChrome) rather than turned into more named props that would just be
// forwarded 1:1 anyway.
export const FloorReflection: React.FC<{
  opacity: number;
  blurPx?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ opacity, blurPx = 3, style, children }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      opacity,
      transform: "scaleY(-1)",
      maskImage: "linear-gradient(to top, black 0%, transparent 55%)",
      WebkitMaskImage: "linear-gradient(to top, black 0%, transparent 55%)",
      filter: `blur(${blurPx}px)`,
      ...style,
    }}
  >
    {children}
  </div>
);

// Draw-in accent rule: a short bar that grows from 0 on its own beat, shared by StatCard/
// ChapterCard/LowerThird's solid-fill version and QuoteCard's Rough.js-underlined version
// (children present -> no solid fill, matching QuoteCard's original div which never set
// `background` because RoughUnderline paints it). `mode="scaleX"` transforms a fixed-width
// bar (the 4 sites this batch actually touches); `mode="width"` interpolates the box's own
// width instead (the separate, lower-priority eyebrow-rule group in Headline/FeatureCard/
// Listicle/Comparison — left alone for now, see PLANREEL-SPEC.md, but the mode exists here
// so folding it in later doesn't require touching this component again).
export const AccentRule: React.FC<{
  progress: number;
  width: number;
  height?: number;
  mode?: "scaleX" | "width";
  color: string;
  glow?: boolean;
  transformOrigin?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({
  progress,
  width,
  height = 3,
  mode = "scaleX",
  color,
  glow: withGlow = true,
  transformOrigin = "center",
  style,
  children,
}) => (
  <div
    style={{
      width: mode === "width" ? width * progress : width,
      height,
      ...(mode === "scaleX" ? { transform: `scaleX(${progress})`, transformOrigin } : {}),
      background: children ? undefined : color,
      boxShadow: withGlow ? glow(color, 0.4 * progress) : undefined,
      ...style,
    }}
  >
    {children}
  </div>
);

// Film grain — animated SVG turbulence, very low opacity, overlay blend.
export const Grain: React.FC<{ frame: number }> = ({ frame }) => (
  <AbsoluteFill style={{ opacity: 0.055, mixBlendMode: "overlay", pointerEvents: "none" }}>
    <svg width="100%" height="100%">
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed={Math.floor(frame / 2) % 50} stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  </AbsoluteFill>
);
