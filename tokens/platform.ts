// PLATFORM INVARIANTS — facts, not taste. No family may override these.
// Safe box, font legibility floors, canvas. Sourced from research (IG/TikTok safe
// zones, video legibility minimums). Lint reads these; families cannot touch them.

export const CANVAS = { w: 1080, h: 1920, fps: 30 } as const;

// IG/TikTok-safe content box on a 1080×1920 frame (900×1400 centered).
export const SAFE = { x: 90, y: 260, w: 900, h: 1400 } as const;

// Video legibility floors (px on a 1080×1920 frame): enforced by lint R4.
export const FONT_FLOOR = { body: 44, caption: 40, display: 96 } as const;

// Caption band kept clear at the bottom for burned-in captions.
export const CAPTION_BAND = { bottom: 220 } as const;
