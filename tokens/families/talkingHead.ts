import { loadFont as loadDisplay } from "@remotion/google-fonts/Sora";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { talkingHeadData, TALKING_HEAD_DISPLAY_FONT, TALKING_HEAD_MONO_FONT } from "./talkingHead.data";
import type { Family } from "../types";

const loadedDisplay = loadDisplay();
const loadedMono = loadMono();

if (loadedDisplay.fontFamily !== TALKING_HEAD_DISPLAY_FONT) {
  throw new Error(`talkingHead: display font "${TALKING_HEAD_DISPLAY_FONT}" does not match loaded "${loadedDisplay.fontFamily}"`);
}

if (loadedMono.fontFamily !== TALKING_HEAD_MONO_FONT) {
  throw new Error(`talkingHead: mono font "${TALKING_HEAD_MONO_FONT}" does not match loaded "${loadedMono.fontFamily}"`);
}

export const talkingHead: Family = talkingHeadData;
