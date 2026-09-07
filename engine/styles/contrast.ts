// engine/styles/contrast.ts — keep a pack's accent legible on a substrate it wasn't designed for.
//
// WHY THIS EXISTS. `SharedVisualShell` already resolves the documented ink/paper inversion
// (AGENTS.md trap #4) through `darkLight(COLOR.ink, COLOR.paper)`, so its DARK and LIGHT are
// always the right way round. Its ACCENT had no equivalent guard — it was
// `accent ?? COLOR.accent`, used raw.
//
// That is fine for a pack whose accent was designed against a dark page and wrong for one
// whose accent was designed against a light page. Fun Money is a WHITE-ground pack whose
// accent is `#111111` — near-black ink, which is exactly right as "maximum contrast" on its
// own white page. Rendered on the shared shell's dark substrate it scores **1.04:1**, i.e.
// invisible: `ApprovalShield`'s kicker, its pane border and its shield glyph all vanished in
// Fun Money's sales demo. It is not a Fun Money problem either — measured against the shell's
// dark ground, four families fall under the 3:1 floor WCAG sets for graphical objects:
//
//     funMoney   #111111   1.04:1   (invisible)
//     groveCool  #173C31   1.61:1
//     grove      #2A5540   2.31:1
//     paper      #8A4E22   2.98:1
//
// THE FIX IS LIGHTENING, NOT SUBSTITUTION. Swapping in COLOR.paper would make every failing
// pack's accent identical and throw away brand identity. Raising lightness in HSL keeps the
// hue, so Grove's dark green becomes a lighter green rather than white. For an achromatic
// accent the result is also semantically right: ink's job on a white page is "maximum
// contrast against the ground", and on a dark page that same job is done by near-white.
//
// Packs whose accent already clears the floor are returned untouched, so this changes nothing
// for the families that were already correct.

/** sRGB relative luminance per WCAG 2.x. Accepts #rgb / #rrggbb / rgb() / rgba(). */
export const relativeLuminance = (color: string): number | null => {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};

/** WCAG contrast ratio, 1..21. Returns null when either colour can't be parsed. */
export const contrastRatio = (a: string, b: string): number | null => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

function parseColor(color: string): [number, number, number] | null {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  let hex = color.trim().replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/**
 * The pack's accent if it is legible on `substrate`; otherwise the same hue lightened (or
 * darkened, on a light substrate) until it clears `minRatio`.
 *
 * `minRatio` defaults to 3.0 — the WCAG floor for graphical objects and UI components, which
 * is what an accent usually is here: a rule, a border, a dot, an uppercase kicker.
 *
 * Returns the input unchanged when either colour is unparseable, so a gradient or a CSS
 * keyword degrades to today's behaviour instead of throwing.
 */
export const legibleAccent = (accent: string, substrate: string, minRatio = 3): string => {
  const start = contrastRatio(accent, substrate);
  if (start === null || start >= minRatio) return accent;
  const rgb = parseColor(accent);
  const subLum = relativeLuminance(substrate);
  if (!rgb || subLum === null) return accent;

  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  // Move AWAY from the substrate: lighten on a dark ground, darken on a light one.
  const towardLight = subLum < 0.5;
  const [lo, hi] = towardLight ? [rgbToHsl(rgb[0], rgb[1], rgb[2])[2], 0.95] : [0.05, rgbToHsl(rgb[0], rgb[1], rgb[2])[2]];

  // 24 steps is finer than the eye resolves at these magnitudes and keeps this allocation-free
  // enough to sit in a render path; first passing value wins so we move the minimum distance
  // from the pack's real accent.
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const l = towardLight ? lo + ((hi - lo) * i) / steps : hi - ((hi - lo) * i) / steps;
    const [r, g, b] = hslToRgb(h, s, l);
    const candidate = toHex(r, g, b);
    const ratio = contrastRatio(candidate, substrate);
    if (ratio !== null && ratio >= minRatio) return candidate;
  }
  // Nothing in the hue clears the bar (a mid-grey substrate can do this) — fall back to the
  // extreme, which is still the best available contrast.
  return towardLight ? "#FFFFFF" : "#000000";
};
