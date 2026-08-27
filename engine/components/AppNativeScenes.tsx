// AppNativeScenes — five app-native (no device chrome) reaction/UI moments: star rating
// fill, heart-burst reaction, comment pop-in, receipt print line-by-line, QR code assembly.
// Pack-agnostic (engine/components/, not nested in any *Pack.tsx), built on IosChrome.tsx's
// shared ChromeStage wrapper for a consistent outer treatment with the ten iOS-chrome
// scenes in IosScenes.tsx, even though none of these five need a phone bezel. Geometry/
// timing cite research/ios-ui-component-specs-batch3.md inline; a handful of real-content
// brand constants (star gold, heart red, badge red) are shared from IosChrome.tsx's
// IOS_SYSTEM table for the same reason DeviceFrame/Icon.tsx hardcode real brand colors —
// see that file's header for the full rationale.
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { Heart, Star } from "lucide-react";
import { DUR, EASE, SPRING } from "../styles/motion";
import { glow, rgba } from "../styles/fx";
import { useReelTokens } from "../styles/tokens";
import { ChromeStage, IOS_SYSTEM, localFrame, type MsProps } from "./IosChrome";

// ===========================================================================
// 11. StarRatingFill — batch3 §2. 5 stars, sequential left-to-right fill, 200-300ms/star,
// ease-out, gold on fill.
// ===========================================================================
export const StarRatingFill: React.FC<MsProps & { headline?: string; rating?: number; label?: string; atMs?: number; secondaryAtMs?: number }> = ({
  headline = "Five stars. Earned one at a time.",
  rating = 4.5,
  label = "4.5 · 2,340 reviews",
  atMs,
  secondaryAtMs,
  sceneStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const base = atMs ?? 0;
  const size = 118;
  const labelP = spring({ frame: frame - localFrame(secondaryAtMs ?? atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <ChromeStage headline={headline} eyebrow="Rating" sceneStartMs={sceneStartMs}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 780, display: "flex", justifyContent: "center", gap: 22 }}>
        {Array.from({ length: 5 }).map((_, i) => {
          // batch3 §2: 200-300ms per star, sequential — 8 frames @30fps ≈ 267ms.
          const start = localFrame(base + i * 260, sceneStartMs, fps);
          const fill = interpolate(frame, [start, start + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.productive });
          const partial = Math.max(0, Math.min(1, rating - i));
          const target = Math.min(fill, 1) * partial; // fills toward that star's own partial value as `fill` arrives
          const bounce = interpolate(frame, [start, start + 4, start + 9], [0.7, 1.14, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ position: "relative", width: size, height: size, transform: `scale(${fill > 0 ? bounce : 0.7})` }}>
              <Star size={size} color={IOS_SYSTEM.starEmpty} fill={IOS_SYSTEM.starEmpty} strokeWidth={0} />
              <div style={{ position: "absolute", inset: 0, overflow: "hidden", width: `${target * 100}%` }}>
                <Star size={size} color={IOS_SYSTEM.starGold} fill={IOS_SYSTEM.starGold} strokeWidth={0} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 950, textAlign: "center", ...TYPE.mono, color: COLOR.muted, fontSize: 26, opacity: labelP, transform: `translateY(${(1 - labelP) * 14}px)` }}>{label}</div>
    </ChromeStage>
  );
};

// ===========================================================================
// 12. HeartBurstReaction — batch3 §3. Spring scale 0 -> ~1.2 overshoot -> 1.0 settle (main
// heart), plus deterministic radial burst particles fading over ~800-1000ms.
// ===========================================================================
export const HeartBurstReaction: React.FC<MsProps & { headline?: string; likeCount?: number; particleCount?: number; atMs?: number }> = ({
  headline = "One tap. A whole burst.",
  likeCount = 24800,
  particleCount = 10,
  atMs,
  sceneStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const start = localFrame(atMs, sceneStartMs, fps);
  const k = frame - start;
  // batch3 §3: ~1200ms total, scale 0 -> ~1.2 -> settle 1.0, spring-preferred.
  const scale = interpolate(k, [0, 8, 16, 26], [0, 1.22, 0.96, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
  const heartOpacity = interpolate(k, [0, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const countP = interpolate(k, [10, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shownCount = Math.round(likeCount - (1 - countP) * 37); // small deterministic increment reveal, not a fabricated live counter
  return (
    <ChromeStage headline={headline} eyebrow="Reaction" sceneStartMs={sceneStartMs}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 700, display: "grid", placeItems: "center" }}>
        <div style={{ position: "relative", width: 620, height: 620 }}>
          {Array.from({ length: particleCount }).map((_, i) => {
            // Deterministic angle/radius (no Math.random — see AGENTS.md determinism rule).
            const angle = (i / particleCount) * Math.PI * 2 + 0.3;
            const kk = k - 4;
            const dist = interpolate(kk, [0, 22], [0, 220 + (i % 3) * 26], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.productive });
            const op = interpolate(kk, [0, 6, 26], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const px_ = 310 + Math.cos(angle) * dist;
            const py_ = 310 + Math.sin(angle) * dist;
            const s = 20 + (i % 3) * 8;
            return kk < 0 ? null : (
              <Heart key={i} size={s} color={IOS_SYSTEM.heartRed} fill={IOS_SYSTEM.heartRed} strokeWidth={0} style={{ position: "absolute", left: px_ - s / 2, top: py_ - s / 2, opacity: op }} />
            );
          })}
          <Heart
            size={220}
            color={IOS_SYSTEM.heartRed}
            fill={IOS_SYSTEM.heartRed}
            strokeWidth={0}
            style={{ position: "absolute", left: 310 - 110, top: 310 - 110, opacity: heartOpacity, transform: `scale(${scale})`, filter: `drop-shadow(0 0 ${40 * heartOpacity}px ${rgba(IOS_SYSTEM.heartRed, 0.5)})` }}
          />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1340, textAlign: "center", ...TYPE.stat, color: COLOR.paper, fontSize: 78 }}>{shownCount.toLocaleString()}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 1430, textAlign: "center", ...TYPE.mono, color: COLOR.muted, fontSize: 24, letterSpacing: 2, textTransform: "uppercase" }}>likes</div>
    </ChromeStage>
  );
};

// ===========================================================================
// 13. CommentPopIn — spring pop-in card (avatar + name + text) with a like count that
// ticks up on its own beat — the "someone just engaged" social-proof moment.
// ===========================================================================
export const CommentPopIn: React.FC<MsProps & { headline?: string; name?: string; text?: string; avatarColor?: string; likeCount?: number; atMs?: number; secondaryAtMs?: number }> = ({
  headline = "Real replies, staged for the shot.",
  name = "jordan.codes",
  text = "okay this is actually insane, how",
  avatarColor,
  likeCount = 128,
  atMs,
  secondaryAtMs,
  sceneStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const likeStart = localFrame(secondaryAtMs ?? atMs, sceneStartMs, fps);
  const likeP = spring({ frame: frame - likeStart, fps, config: SPRING.firm, durationInFrames: DUR.minor });
  const tone = avatarColor ?? COLOR.accent;
  return (
    <ChromeStage headline={headline} eyebrow="Comment" sceneStartMs={sceneStartMs}>
      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          top: 760,
          borderRadius: 34,
          padding: 30,
          background: rgba(COLOR.surface, 0.94),
          border: `1px solid ${rgba(COLOR.line, 0.7)}`,
          boxShadow: glow(COLOR.accent, 0.08),
          opacity: p,
          transform: `translateY(${(1 - p) * 30}px) scale(${0.9 + p * 0.1})`,
          display: "flex",
          gap: 20,
        }}
      >
        <div style={{ width: 76, height: 76, borderRadius: "50%", background: `linear-gradient(135deg, ${tone}, ${COLOR.alert})`, flexShrink: 0, display: "grid", placeItems: "center", ...TYPE.headline, fontSize: 30, color: "#fff" }}>{name[0]?.toUpperCase()}</div>
        <div style={{ flex: 1 }}>
          <div style={{ ...TYPE.body, color: COLOR.paper, fontWeight: 700, fontSize: 24 }}>{name}</div>
          <div style={{ ...TYPE.body, color: COLOR.paper, fontSize: 26, marginTop: 6, lineHeight: 1.32 }}>{text}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
            <Heart size={22} color={COLOR.alert} fill={likeP > 0.4 ? COLOR.alert : "none"} strokeWidth={2} style={{ transform: `scale(${1 + Math.max(0, 1 - likeP) * 0.3})` }} />
            <span style={{ ...TYPE.mono, color: COLOR.muted, fontSize: 18 }}>{Math.round(likeCount * Math.min(1, likeP + 0.15))}</span>
          </div>
        </div>
      </div>
    </ChromeStage>
  );
};

// ===========================================================================
// 14. ReceiptPrintLines — batch3 §4. Monospace, right-aligned prices, dashed ASCII
// separators, lines revealed sequentially, torn-edge paper.
// ===========================================================================
type ReceiptItem = { name: string; price: string };
export const ReceiptPrintLines: React.FC<
  MsProps & { headline?: string; store?: string; items?: ReceiptItem[]; total?: string; atMs?: number }
> = ({
  headline = "Printed, one line at a time.",
  store = "MOTIONAGENT STUDIO",
  items = [
    { name: "Pro plan — annual", price: "$49.00" },
    { name: "Extra render credits x50", price: "$12.00" },
    { name: "Priority support", price: "$0.00" },
  ],
  total = "$61.00",
  atMs,
  sceneStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const base = atMs ?? 0;
  const lines: { kind: "header" | "item" | "sep" | "total" | "footer"; left: string; right?: string }[] = [
    { kind: "header", left: store },
    { kind: "sep", left: "" },
    ...items.map((it) => ({ kind: "item" as const, left: it.name, right: it.price })),
    { kind: "sep", left: "" },
    { kind: "total", left: "TOTAL", right: total },
    { kind: "footer", left: "THANK YOU" },
  ];
  // batch3 §4: "roughly mimics print speed" — a design choice, not a hardware spec; 6
  // frames/line (200ms @30fps) keeps every line individually readable on video.
  const lineH = 46;
  const paperTop = 340;
  const visibleLines = lines.filter((_, i) => frame >= localFrame(base + i * 200, sceneStartMs, fps));
  const paperH = 90 + visibleLines.length * lineH + 40;
  return (
    <ChromeStage headline={headline} eyebrow="Receipt" sceneStartMs={sceneStartMs}>
      <div
        style={{
          position: "absolute",
          left: 260,
          right: 260,
          top: paperTop,
          height: paperH,
          background: "#F7F4EC",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          clipPath: "polygon(0 0,100% 0,100% calc(100% - 10px),95% 100%,90% calc(100% - 10px),85% 100%,80% calc(100% - 10px),75% 100%,70% calc(100% - 10px),65% 100%,60% calc(100% - 10px),55% 100%,50% calc(100% - 10px),45% 100%,40% calc(100% - 10px),35% 100%,30% calc(100% - 10px),25% 100%,20% calc(100% - 10px),15% 100%,10% calc(100% - 10px),5% 100%,0 calc(100% - 10px))",
          padding: "36px 26px 30px",
          overflow: "hidden",
        }}
      >
        {lines.map((line, i) => {
          const start = localFrame(base + i * 200, sceneStartMs, fps);
          const on = frame >= start;
          const t = interpolate(frame, [start, start + 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          if (!on) return null;
          const isSep = line.kind === "sep";
          return (
            <div key={i} style={{ height: lineH, display: "flex", alignItems: "center", opacity: t, fontFamily: "SF Mono, Menlo, monospace", fontSize: line.kind === "header" ? 24 : 20, fontWeight: line.kind === "total" ? 800 : line.kind === "header" ? 800 : 400, color: "#2a2a26", letterSpacing: line.kind === "header" || line.kind === "footer" ? 2 : 0, textAlign: line.kind === "header" || line.kind === "footer" ? "center" : "left", justifyContent: line.kind === "header" || line.kind === "footer" ? "center" : "space-between" }}>
              {isSep ? <div style={{ width: "100%", borderBottom: "2px dashed #b8b3a0" }} /> : <><span>{line.left}</span>{line.right ? <span>{line.right}</span> : null}</>}
            </div>
          );
        })}
      </div>
    </ChromeStage>
  );
};

// ===========================================================================
// 15. QrCodeAssemble — batch3 §5 (ISO/IEC 18004 finder-pattern structure: 7×7 outer, 5×5
// inner white, 3×3 core; 4-module quiet zone). Modules reveal row-by-row, then a scan-line
// sweep pays it off. NOT a scannable real QR (deterministic decorative fill), but the
// finder-pattern geometry is structurally accurate.
// ===========================================================================
export const QrCodeAssemble: React.FC<MsProps & { headline?: string; caption?: string; atMs?: number; secondaryAtMs?: number }> = ({
  headline = "Every module lands in order.",
  caption = "SCAN TO OPEN",
  atMs,
  secondaryAtMs,
  sceneStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const base = atMs ?? 0;
  const GRID = 21; // ISO/IEC 18004 Version 1: 21x21 modules
  const cell = 22;
  const size = GRID * cell;
  const quietZone = 4 * cell; // ISO/IEC 18004 mandatory 4-module quiet zone (batch3 §5)
  const isFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= GRID - 7) || (r >= GRID - 7 && c < 7);
  const finderFill = (r: number, c: number, r0: number, c0: number) => {
    const rr = r - r0;
    const cc = c - c0;
    const outer = rr >= 0 && rr < 7 && cc >= 0 && cc < 7 && (rr === 0 || rr === 6 || cc === 0 || cc === 6);
    const core = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4;
    return outer || core;
  };
  // Deterministic pseudo-data fill (no Math.random — AGENTS.md determinism rule). This is a
  // real bit-mixing hash (Murmur3-style fmix32 finalizer), not a linear congruence — a
  // formula like `(r*A + c*B + r*c*C) % 5` looks complex but is still linear/bilinear MOD 5,
  // so its result only ever depends on (r mod 5, c mod 5): a 5x5 tile that repeats across
  // the whole grid, rendering as horizontal/vertical stripes instead of QR-like noise. The
  // shift/xor/imul avalanche below breaks that periodicity while staying a pure,
  // deterministic function of (r, c).
  const hashRC = (r: number, c: number) => {
    let h = (r * 374761393 + c * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= (r << 13) ^ (c >>> 5);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return h >>> 0;
  };
  const dataFill = (r: number, c: number) => hashRC(r, c) % 5 < 2;
  const sweepStart = localFrame(secondaryAtMs ?? atMs, sceneStartMs, fps);
  const sweepY = interpolate(frame, [sweepStart, sweepStart + 26], [0, size], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.productive });
  const sweepActive = frame >= sweepStart && frame < sweepStart + 26;
  const captionP = spring({ frame: frame - localFrame(secondaryAtMs ?? atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <ChromeStage headline={headline} eyebrow="QR assembly" sceneStartMs={sceneStartMs}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 700, display: "grid", placeItems: "center" }}>
        {/* ISO/IEC 18004 mandates a 4-module quiet zone (was 2 modules — 44px = 2 * cell). */}
        <div style={{ position: "relative", width: size + quietZone * 2, height: size + quietZone * 2, background: "#fff", borderRadius: 28, padding: quietZone, boxShadow: "0 30px 80px rgba(0,0,0,0.3)" }}>
          <div style={{ position: "relative", width: size, height: size }}>
            {Array.from({ length: GRID }).map((_, r) =>
              Array.from({ length: GRID }).map((__, c) => {
                const finder = isFinder(r, c) && (finderFill(r, c, 0, 0) || finderFill(r, c, 0, GRID - 7) || finderFill(r, c, GRID - 7, 0));
                const filled = finder || (!isFinder(r, c) && dataFill(r, c));
                if (!filled) return null;
                // Row-by-row reveal — batch3 §5 "top-to-bottom, left-to-right" pattern.
                const delay = base + r * 26 + c * 1.2;
                const start = localFrame(delay, sceneStartMs, fps);
                const t = interpolate(frame, [start, start + 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                return (
                  <div
                    key={`${r}-${c}`}
                    style={{
                      position: "absolute",
                      left: c * cell,
                      top: r * cell,
                      width: cell - 2,
                      height: cell - 2,
                      background: "#111",
                      opacity: t,
                      transform: `scale(${0.4 + t * 0.6})`,
                    }}
                  />
                );
              }),
            )}
            {sweepActive ? (
              <div style={{ position: "absolute", left: 0, right: 0, top: sweepY - 3, height: 6, background: rgba(COLOR.accent, 0.85), boxShadow: glow(COLOR.accent, 0.6) }} />
            ) : null}
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 700 + size + quietZone * 2 + 60, textAlign: "center", ...TYPE.mono, color: COLOR.muted, fontSize: 24, letterSpacing: 3, opacity: captionP, transform: `translateY(${(1 - captionP) * 12}px)` }}>{caption}</div>
    </ChromeStage>
  );
};
