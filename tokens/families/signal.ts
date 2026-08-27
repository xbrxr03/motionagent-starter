// SIGNAL family — bundler/render-path binding. The plain token DATA (color, backdrop,
// type scale, font *names*) lives in signal.data.ts, which has zero dependency on
// @remotion/google-fonts and is importable by a plain Node process. This file adds back
// the one thing that only works inside a bundler: the loadFont() side effect that
// actually fetches/registers the font glyphs for render. Kept as a separate call (not
// folded into signal.data.ts) is the whole point of the split — see HARDENING.md.
import { loadFont as loadDisplay } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { signalData, SIGNAL_DISPLAY_FONT, SIGNAL_MONO_FONT } from "./signal.data";
import type { Family } from "../types";

const loadedDisplay = loadDisplay();
const loadedMono = loadMono();

// Guard against drift between the hardcoded DATA font names and what
// @remotion/google-fonts actually resolves (e.g. a version bump renaming the family).
// If this ever throws, update the *_FONT constants in signal.data.ts to match.
if (loadedDisplay.fontFamily !== SIGNAL_DISPLAY_FONT) {
  throw new Error(
    `signal: signal.data.ts SIGNAL_DISPLAY_FONT ("${SIGNAL_DISPLAY_FONT}") does not match ` +
      `@remotion/google-fonts/SpaceGrotesk fontFamily ("${loadedDisplay.fontFamily}")`,
  );
}
if (loadedMono.fontFamily !== SIGNAL_MONO_FONT) {
  throw new Error(
    `signal: signal.data.ts SIGNAL_MONO_FONT ("${SIGNAL_MONO_FONT}") does not match ` +
      `@remotion/google-fonts/JetBrainsMono fontFamily ("${loadedMono.fontFamily}")`,
  );
}

export const signal: Family = signalData;
