import { loadFont as loadDisplay } from "@remotion/google-fonts/Sora";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { uiMateData, UI_MATE_DISPLAY_FONT, UI_MATE_MONO_FONT } from "./uiMate.data";
import type { Family } from "../types";

const loadedDisplay = loadDisplay();
const loadedMono = loadMono();

if (loadedDisplay.fontFamily !== UI_MATE_DISPLAY_FONT) {
  throw new Error(`uiMate: display font "${UI_MATE_DISPLAY_FONT}" does not match loaded "${loadedDisplay.fontFamily}"`);
}

if (loadedMono.fontFamily !== UI_MATE_MONO_FONT) {
  throw new Error(`uiMate: mono font "${UI_MATE_MONO_FONT}" does not match loaded "${loadedMono.fontFamily}"`);
}

export const uiMate: Family = uiMateData;
