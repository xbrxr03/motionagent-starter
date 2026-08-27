// IosChrome — shared iOS system-chrome primitives (status bar, Dynamic Island, home
// indicator, phone bezel). This is the anchor/wrapper for every "real iOS" scene in
// IosScenes.tsx, the same role DeviceFrame.tsx plays for a plain screenshot: DeviceFrame
// wraps a static `src` image in a phone/browser bezel; IosPhoneStage below reuses
// DeviceFrame's exact phone-mode geometry (560×1180, 64px radius, the same accent-glow
// border/shadow language) but hosts live, native-drawn CHILDREN instead of one flat
// image, and adds the three pieces of real iOS chrome DeviceFrame's phone mode doesn't
// have: a populated status bar (time + signal/wifi/battery), a Dynamic Island, and a
// visible home indicator bar. Pack-agnostic on purpose (engine/components/, not nested in
// any *Pack.tsx) — every family's tokens flow through useReelTokens() for the OUTER stage
// (backdrop, eyebrow/headline copy, phone-frame glow border), while the system-chrome
// elements themselves (status bar icon color, Dynamic Island black, toggle green, iMessage
// blue, etc.) use real Apple system colors. Those are content-authentic constants, not a
// re-themeable surface — the same category as Icon.tsx's CLAUDE_MARK_COLOR (a real brand's
// fixed color) or UiColorSwatchPanel's literal hex swatches (real content being depicted),
// not the family-background/text leak HARDENING.md's history warns about.
//
// Scale derivation: DeviceFrame's phone-mode frame is 560px wide. Apple's own reference
// point-space for this class of device (iPhone 14/15, non-Pro-Max) is 390pt wide
// (research/ios-ui-component-specs-batch1.md's "Reference device" note). SCALE = 560/390
// ≈ 1.436 converts every pt figure in the batch1/2/3 research specs into px for this
// canvas; every geometry constant below cites its source pt value in a comment so the
// conversion is auditable, not a guess.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Battery, Signal, Wifi } from "lucide-react";
import { DUR, EASE, SPRING } from "../styles/motion";
import { glow, rgba } from "../styles/fx";
import { useReelTokens } from "../styles/tokens";

export type MsProps = { sceneStartMs: number };
export type BeatItem = { label?: string; atMs?: number };

export const localFrame = (ms: number | undefined, sceneStartMs: number, fps: number) =>
  ms === undefined ? 0 : Math.round(((ms - sceneStartMs) * fps) / 1000);

// Phone bezel — IDENTICAL to DeviceFrame.tsx's phone-mode constants (frameW/frameH/radius),
// reused rather than reinvented per this task's brief.
export const IOS_PHONE = { w: 560, h: 1180, radius: 64 } as const;

// pt -> px for this frame's 390pt-wide reference device (batch1 "Reference device" note).
export const SCALE = IOS_PHONE.w / 390;
const px = (pt: number) => Math.round(pt * SCALE);

// Real Apple system colors — fixed brand/content constants (see file header), not tokens.
export const IOS_SYSTEM = {
  statusLight: "#000000",
  statusDark: "#FFFFFF",
  dynamicIslandBg: "#000000",
  toggleOnGreen: "#34C759", // batch2 §1, UIColor.systemGreen
  toggleOffGray: "#E5E5EA", // batch2 §1, iOS gray-4
  faceIdGreen: "#30D158", // batch1 §4 / batch2 §5, system green (checkmark)
  imessageBlue: "#007AFF", // batch3 §1
  imessageGrayLight: "#E9E9EB", // batch3 §1
  calcNumberBg: "#333333", // batch2 §2
  calcFunctionOrange: "#FF9500", // batch2 §2, UIColor.systemOrange
  calcSpecialGray: "#A5A5A5", // batch2 §2
  appleBlue: "#007AFF", // batch2 §5 primary CTA
  starGold: "#FFC107", // batch3 §2
  starEmpty: "#E8E8EB", // batch3 §2
  heartRed: "#FF2C55", // batch3 §3
  badgeRed: "#FF3B30", // batch2 §3
} as const;

// ---------------------------------------------------------------------------
// ChromeStage — the outer, family-token-driven wrapper every new component (chrome or
// app-native) sits in: gradient backdrop from the ACTIVE family's BACKDROP + an optional
// eyebrow/headline pair in the family's own accent/paper color. Deliberately a fresh,
// neutral implementation (not an import of UiMatePack's private UiStage) so this file has
// zero dependency on any one pack, per the "universal/pack-agnostic" brief.
// ---------------------------------------------------------------------------
export const ChromeStage: React.FC<MsProps & { eyebrow?: string; headline?: string; children: React.ReactNode }> = ({
  eyebrow = "Real iOS",
  headline,
  sceneStartMs,
  children,
}) => {
  const frame = useCurrentFrame();
  const { COLOR, TYPE, BACKDROP } = useReelTokens();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 16% 12%, ${rgba(COLOR.accent, 0.16)}, transparent 32%), linear-gradient(160deg, ${BACKDROP.vignette}, ${COLOR.ink})`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(${rgba(COLOR.accent, 0.045)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(COLOR.accent, 0.038)} 1px, transparent 1px)`,
          backgroundSize: "58px 58px",
          transform: `translateY(${Math.sin((frame + sceneStartMs) / 74) * 4}px)`,
        }}
      />
      <div style={{ position: "absolute", top: 64, left: 0, right: 0, textAlign: "center", ...TYPE.mono, color: COLOR.accent, fontSize: 19, fontWeight: 700, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>
        {eyebrow}
      </div>
      {headline ? (
        <div style={{ position: "absolute", left: 90, right: 90, top: 128, textAlign: "center", ...TYPE.display, color: COLOR.paper, fontSize: 58, lineHeight: 1.02 }}>
          {headline}
        </div>
      ) : null}
      {children}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// IosStatusBar — batch1 §3. Time top-left (modern iPhones show time left-of-center, not
// centered, once Dynamic Island owns the center); signal/wifi/battery right-aligned.
// ---------------------------------------------------------------------------
export const IosStatusBar: React.FC<{ theme: "light" | "dark"; time?: string }> = ({ theme, time = "9:41" }) => {
  const ink = theme === "dark" ? IOS_SYSTEM.statusDark : IOS_SYSTEM.statusLight;
  const h = px(47); // batch1 §3: 47pt status bar height
  const pad = px(8); // batch1 §3: 8pt edge padding
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: h, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${pad}px`, zIndex: 5 }}>
      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", fontWeight: 600, fontSize: px(15), color: ink, letterSpacing: -0.2 }}>{time}</div>
      <div style={{ display: "flex", alignItems: "center", gap: px(4) }}>
        <Signal size={px(17)} color={ink} strokeWidth={2.4} />
        <Wifi size={px(15)} color={ink} strokeWidth={2.6} />
        <Battery size={px(27)} color={ink} strokeWidth={1.8} />
      </div>
    </div>
  );
};

// Dynamic Island — batch1 §3. Solid black pill, top-center.
export const IosDynamicIsland: React.FC<{ expanded?: number }> = ({ expanded = 0 }) => {
  const w = px(128) + expanded * px(150); // "expand" widens for a Live-Activity moment
  const h = px(37);
  const top = px(11);
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: "50%",
        transform: "translateX(-50%)",
        width: w,
        height: h,
        borderRadius: h / 2,
        background: IOS_SYSTEM.dynamicIslandBg,
        zIndex: 6,
      }}
    />
  );
};

// Home indicator — batch1 §3: ~135pt wide bar, bottom-center, low-opacity adaptive.
export const IosHomeIndicator: React.FC<{ theme: "light" | "dark" }> = ({ theme }) => (
  <div
    style={{
      position: "absolute",
      bottom: px(8),
      left: "50%",
      transform: "translateX(-50%)",
      width: px(135),
      height: 5,
      borderRadius: 999,
      background: theme === "dark" ? IOS_SYSTEM.statusDark : IOS_SYSTEM.statusLight,
      opacity: 0.4,
      zIndex: 6,
    }}
  />
);

// Face ID viewfinder — the four-corner-bracket "scan target" glyph every biometric moment
// (lock screen, checkout, standalone Face ID scan) reuses. Not a lucide glyph — Face ID's
// bracket square isn't in any icon set here, and it's a simple, well-documented enough
// shape (four L-corners) to hand-build deterministically. `progress` 0-1 draws the
// checkmark; below that it shows the idle bracket + pulse ring per batch1 §4's 3-phase
// sequence (rings expand 60→90pt, then dissolve into the checkmark).
export const FaceIdGlyph: React.FC<{ size: number; ringProgress: number; checkProgress: number; color?: string }> = ({
  size,
  ringProgress,
  checkProgress,
  color = "#8E8E93",
}) => {
  const bracket = size * 0.16;
  const corner = (top: boolean, left: boolean) => (
    <div
      style={{
        position: "absolute",
        top: top ? 0 : undefined,
        bottom: top ? undefined : 0,
        left: left ? 0 : undefined,
        right: left ? undefined : 0,
        width: bracket,
        height: bracket,
        borderTop: top ? `4px solid ${color}` : undefined,
        borderBottom: top ? undefined : `4px solid ${color}`,
        borderLeft: left ? `4px solid ${color}` : undefined,
        borderRight: left ? undefined : `4px solid ${color}`,
        borderRadius: top && left ? "10px 0 0 0" : top ? "0 10px 0 0" : left ? "0 0 0 10px" : "0 0 10px 0",
        opacity: 1 - checkProgress,
      }}
    />
  );
  const ringSize = size * (0.55 + 0.35 * Math.min(1, ringProgress));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {corner(true, true)}
      {corner(true, false)}
      {corner(false, true)}
      {corner(false, false)}
      {ringProgress > 0 && checkProgress < 0.15 ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: ringSize,
            height: ringSize,
            marginLeft: -ringSize / 2,
            marginTop: -ringSize / 2,
            borderRadius: "50%",
            border: `2px solid ${rgba(color, Math.max(0, 1 - ringProgress) * 0.8)}`,
          }}
        />
      ) : null}
      {checkProgress > 0 ? (
        <svg
          viewBox="0 0 24 24"
          width={size * 0.5}
          height={size * 0.5}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            // Continuous draw-in -> 1.0 -> 1.08 overshoot -> settle-back-to-1.0 pulse (batch1
            // §4). Piecewise-linear via interpolate() so there is no discontinuity at any
            // checkProgress value (the old `checkProgress > 0.9 ? 1.08 : 0.3` branch jumped).
            transform: `translate(-50%, -50%) scale(${interpolate(checkProgress, [0, 0.6, 0.85, 1], [0.7, 1, 1.08, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})`,
            opacity: checkProgress,
          }}
        >
          <circle cx="12" cy="12" r="11" fill={IOS_SYSTEM.faceIdGreen} opacity={0.16} />
          <path
            d="M6 12.5l4 4 8-8.5"
            fill="none"
            stroke={IOS_SYSTEM.faceIdGreen}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - Math.min(1, checkProgress * 1.6)}
          />
        </svg>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// IosPhoneStage — the phone bezel itself: DeviceFrame's exact w/h/radius + accent-glow
// border/shadow language, fade+scale entrance (no tilt — these need to read as a literal
// screen recording, not a stylized product shot), status bar / Dynamic Island / home
// indicator layered ABOVE `children` (children paint the full screen rect; system chrome
// overlays it, exactly like a real recording of an iPhone).
// ---------------------------------------------------------------------------
export const IosPhoneStage: React.FC<
  MsProps & {
    atMs?: number;
    theme?: "light" | "dark";
    time?: string;
    showStatusBar?: boolean;
    showDynamicIsland?: boolean;
    showHomeIndicator?: boolean;
    islandExpanded?: number;
    children: React.ReactNode;
  }
> = ({ sceneStartMs, atMs, theme = "dark", time = "9:41", showStatusBar = true, showDynamicIsland = true, showHomeIndicator = true, islandExpanded = 0, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR } = useReelTokens();
  const start = localFrame(atMs, sceneStartMs, fps);
  const p = spring({ frame: frame - start, fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const glowIn = interpolate(frame, [start, start + DUR.major], [0, 1], { easing: EASE.productive, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          position: "relative",
          width: IOS_PHONE.w,
          height: IOS_PHONE.h,
          borderRadius: IOS_PHONE.radius,
          overflow: "hidden",
          background: "#000",
          opacity: p,
          transform: `scale(${0.94 + p * 0.06})`,
          border: `1px solid ${rgba(COLOR.accent, 0.3 + 0.3 * glowIn)}`,
          boxShadow: `0 40px 120px rgba(0,0,0,0.5), ${glow(COLOR.accent, 0.5 * glowIn)}`,
        }}
      >
        <div style={{ position: "absolute", inset: 0 }}>{children}</div>
        {showStatusBar ? <IosStatusBar theme={theme} time={time} /> : null}
        {showDynamicIsland ? <IosDynamicIsland expanded={islandExpanded} /> : null}
        {showHomeIndicator ? <IosHomeIndicator theme={theme} /> : null}
      </div>
    </AbsoluteFill>
  );
};
