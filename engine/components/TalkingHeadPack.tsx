import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditDecision, MediaSlot, SourceClip } from "../../schema/plan";
import { DUR, EASE, SPRING, STAGGER } from "../styles/motion";
import { glow, rgba } from "../styles/fx";
import { useReelTokens } from "../styles/tokens";
import { AmbientDetailLayer } from "./SharedVisualPrimitives";

type MsProps = { sceneStartMs: number };
type BeatItem = { label: string; detail?: string; atMs?: number };
type ClipLike = Partial<SourceClip> & { src?: string };
type DecisionLike = Partial<EditDecision>;
type MediaLike = Partial<MediaSlot> & { src?: string; label?: string };

const localFrame = (ms: number | undefined, sceneStartMs: number, fps: number) =>
  ms === undefined ? 0 : Math.round(((ms - sceneStartMs) * fps) / 1000);

const assetSrc = (src: string | undefined) => {
  if (!src) return undefined;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) return src;
  return staticFile(src);
};

const mediaLabel = (media: MediaLike | undefined, fallback: string) =>
  media?.caption ?? media?.alt ?? media?.label ?? media?.id ?? fallback;

const clipLabel = (clip: ClipLike | undefined, decision: DecisionLike | undefined, fallback: string) =>
  decision?.role ?? clip?.id ?? fallback;

// COLOR.ink/COLOR.paper inversion trap (see engine/styles/tokens.ts's legacyColors bridge
// and AGENTS.md/packs/STATUS.md): the legacy names read as "ink=dark, paper=light", but the
// bridge actually maps ink -> family.color.bg and paper -> family.color.text. Signal's own
// bg happens to be dark, so that family reads correctly by coincidence — but talkingHead's
// bg is warmWhite (light) and its text is near-black ink (dark), the literal *opposite* of
// what the field names suggest. Every "dark scene"/"light scene" branch in this file used to
// assume COLOR.ink was always dark and COLOR.paper always light, which for this family
// silently swapped every dark portrait/CTA scene to a light background with dark text (and
// every "neutral/off-white proof scene" to a near-black background), and produced literal
// dark-ink-on-charcoal invisible text in TalkingHeadToolProof's rows. Fixed by computing
// which of the two tokens is actually darker at render time (luminance, not the field name)
// instead of assuming — this stays correct even if a future talkingHead palette swap flips
// which one is darker again.
const relLuma = (hex: string) => {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const darkLight = (a: string, b: string) => (relLuma(a) <= relLuma(b) ? { dark: a, light: b } : { dark: b, light: a });

// Bug fix (2026-07-27 QA pass): the darkLight() fix above only ever covered COLOR.ink/
// COLOR.paper. TalkingHeadCompetitorWatchCard and TalkingHeadPluginRankCard both paint text
// directly on COLOR.surface (a THIRD, independent token — talkingHead's own charcoal panel
// color, unrelated to whichever of ink/paper is darker) but picked their text color from the
// same DARK/LIGHT pair computed for the page background, not from COLOR.surface's own
// luminance. For this family COLOR.surface is genuinely dark, and both components used DARK
// (near-black) text on it — dark-on-dark, unreadable ("Code Review"/"Growth Lab" confirmed
// invisible in a rendered still). TalkingHeadToolProof's row background (COLOR.surface, LIGHT
// text) happened to be correct only because this family's LIGHT token is the one that also
// contrasts against COLOR.surface — not a rule, a coincidence. This computes contrast against
// COLOR.surface directly so the same bug class can't recur a third time under a palette where
// that coincidence doesn't hold.
const colorOnSurface = (surface: string, dark: string, light: string) => (relLuma(surface) <= 0.5 ? light : dark);
const hasRealClip = (clip: ClipLike | undefined) => typeof clip?.src === "string" && clip.src.length > 0;

const PortraitPlaceholder: React.FC<{ label?: string; dark?: boolean }> = ({ label = "SOURCE CLIP", dark = false }) => {
  const frame = useCurrentFrame();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  return (
    <div style={{ position: "absolute", inset: 0, background: dark ? DARK : `linear-gradient(180deg, ${rgba(COLOR.faint, 0.22)}, ${rgba(COLOR.accent, 0.08)})`, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: "31%", width: 330, height: 330, borderRadius: 999, transform: "translate(-50%, -50%)", background: rgba(dark ? LIGHT : DARK, 0.18), border: `3px solid ${rgba(COLOR.accent, 0.42)}` }} />
      <div style={{ position: "absolute", left: "50%", top: "66%", width: 600, height: 740, borderRadius: "300px 300px 64px 64px", transform: `translate(-50%, -50%) scale(${1 + Math.sin(frame / 48) * 0.012})`, background: `linear-gradient(145deg, ${rgba(COLOR.accent, 0.26)}, ${rgba(COLOR.surface, 0.58)})`, border: `3px solid ${rgba(COLOR.line, 0.42)}` }} />
      <div style={{ position: "absolute", left: 54, right: 54, bottom: 110, borderRadius: 32, padding: "24px 28px", background: rgba(dark ? LIGHT : DARK, 0.2), border: `1px solid ${rgba(COLOR.line, 0.36)}` }}>
        <div style={{ ...TYPE.mono, color: dark ? COLOR.accent : DARK, fontSize: 22, fontWeight: 800, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>
          {label}
        </div>
      </div>
    </div>
  );
};

const ClipSurface: React.FC<{ sourceClip?: ClipLike; editDecision?: DecisionLike; fit?: "cover" | "contain" | "crop"; muted?: boolean; dark?: boolean }> = ({
  sourceClip,
  editDecision,
  fit = "cover",
  muted,
  dark,
}) => {
  const { fps } = useVideoConfig();
  const src = assetSrc(sourceClip?.src);
  const startMs = editDecision?.inMs ?? 0;
  const endMs = editDecision?.outMs;
  const startFrom = Math.max(0, Math.round((startMs * fps) / 1000));
  const endAt = endMs === undefined ? undefined : Math.max(startFrom + 1, Math.round((endMs * fps) / 1000));
  const objectFit = fit === "contain" ? "contain" : "cover";
  return src ? (
    <OffthreadVideo src={src} muted={muted ?? editDecision?.audio === "muted"} startFrom={startFrom} endAt={endAt} style={{ width: "100%", height: "100%", objectFit }} />
  ) : (
    <PortraitPlaceholder label={clipLabel(sourceClip, editDecision, "SOURCE CLIP")} dark={dark} />
  );
};

const MediaSurface: React.FC<{ media?: MediaLike; fit?: "cover" | "contain" | "crop"; label?: string }> = ({ media, fit = "contain", label }) => {
  const frame = useCurrentFrame();
  const { COLOR, TYPE } = useReelTokens();
  const src = assetSrc(media?.src);
  const objectFit = fit === "cover" ? "cover" : "contain";
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", background: COLOR.paper, border: `1px solid ${rgba(COLOR.line, 0.9)}`, boxShadow: `0 28px 80px ${rgba(COLOR.ink, 0.22)}` }}>
      {src && media?.kind === "video" ? (
        <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit, backgroundColor: COLOR.paper }} />
      ) : src ? (
        <Img src={src} style={{ width: "100%", height: "100%", objectFit, backgroundColor: COLOR.paper }} />
      ) : (
        <div style={{ position: "absolute", inset: 30, display: "grid", gridTemplateRows: "62px 1fr 54px", gap: 18 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ width: 18, height: 18, borderRadius: 18, background: i === 0 ? COLOR.alert : i === 1 ? COLOR.accent : COLOR.payoff }} />)}
            <div style={{ marginLeft: 14, height: 14, width: 260, borderRadius: 999, background: rgba(COLOR.ink, 0.12) }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 22 }}>
            <div style={{ borderRadius: 26, background: rgba(COLOR.ink, 0.06), padding: 24 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ height: i === 0 ? 42 : 18, width: `${82 - i * 8}%`, borderRadius: 999, background: rgba(i === 0 ? COLOR.accent : COLOR.ink, i === 0 ? 0.3 : 0.12), marginBottom: 18 + i * 2, opacity: 0.72 + Math.sin(frame / 30 + i) * 0.1 }} />
              ))}
            </div>
            <div style={{ borderRadius: 26, background: rgba(COLOR.accent, 0.12), border: `1px solid ${rgba(COLOR.accent, 0.32)}` }} />
          </div>
          <div style={{ ...TYPE.mono, color: COLOR.muted, fontSize: 16, fontWeight: 800, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>
            {mediaLabel(media, label ?? "PROOF SLOT")}
          </div>
        </div>
      )}
    </div>
  );
};

export const TalkingHeadClaim: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; headline?: string; kicker?: string; items?: BeatItem[]; fit?: "cover" | "contain" | "crop"; atMs?: number }
> = ({ sourceClip, editDecision, headline = "Talk over the proof", kicker = "Creator clip", items = [], fit = "cover", atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} fit={fit} dark />
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${rgba(DARK, 0.08)}, transparent 34%, ${rgba(DARK, 0.78)})` }} />
      <div style={{ position: "absolute", left: 64, right: 64, bottom: hasRealClip(sourceClip) ? 230 : 270, transform: `translateY(${(1 - p) * 36}px)`, opacity: p }}>
        <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 28, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{kicker}</div>
        <div style={{ ...TYPE.display, color: LIGHT, fontSize: hasRealClip(sourceClip) ? 94 : 110, lineHeight: 0.94, marginTop: 18, textShadow: `0 16px 38px ${rgba(DARK, 0.6)}` }}>{headline}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 30 }}>
          {items.map((item, i) => {
            const t = interpolate(frame, [localFrame(item.atMs, sceneStartMs, fps), localFrame(item.atMs, sceneStartMs, fps) + STAGGER], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
            return <div key={`${item.label}-${i}`} style={{ ...TYPE.mono, color: LIGHT, fontSize: 44, fontWeight: 800, borderRadius: 999, padding: "14px 20px", background: rgba(COLOR.accent, 0.26), border: `1px solid ${rgba(COLOR.accent, 0.44)}`, opacity: t }}>{item.label}</div>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const TalkingHeadProofSplit: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; media?: MediaLike; headline?: string; proofLabel?: string; items?: BeatItem[]; atMs?: number }
> = ({ sourceClip, editDecision, media, headline = "Show the tool, keep the person", proofLabel = "proof", items = [], atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(DARK, 0.045)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(DARK, 0.04)} 1px, transparent 1px)`, backgroundSize: "58px 58px" }} />
      <div style={{ position: "absolute", left: 64, right: 64, top: 100, ...TYPE.display, color: DARK, fontSize: 82, lineHeight: 0.96 }}>{headline}</div>
      <div style={{ position: "absolute", left: 64, right: 64, top: 330, height: 675, transform: `translateY(${(1 - p) * 40}px)`, opacity: p }}>
        <MediaSurface media={media} label={proofLabel} />
      </div>
      <div style={{ position: "absolute", left: 104, right: 104, bottom: 100, height: hasRealClip(sourceClip) ? 620 : 690, borderRadius: 46, overflow: "hidden", background: DARK, border: `2px solid ${rgba(DARK, 0.16)}`, boxShadow: glow(DARK, 0.16) }}>
        <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
        {/* Same caption-safe-band bug already fixed elsewhere in this file (see
            TalkingHeadFeatureChecklist's 2026-07-27 QA-pass comment): this box's own
            bottom:100 is viewport-relative, so this row's bottom:80 was nested on top of
            that (effective ~180px from the true screen edge) -- inside the 220px band,
            just not caught earlier because this component isn't used by the flagship
            plan (found instead by checking every plan that reaches TalkingHeadProofSplit,
            since 5 other talking-head plans do and all have TalkingHeadCaption active).
            170 clears the band with the same margin as the other fixes (100+170=270). */}
        <div style={{ position: "absolute", left: 26, right: 26, bottom: 170, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {items.map((item, i) => {
            const t = interpolate(frame, [localFrame(item.atMs, sceneStartMs, fps), localFrame(item.atMs, sceneStartMs, fps) + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return <div key={`${item.label}-${i}`} style={{ ...TYPE.mono, color: LIGHT, fontSize: 30, fontWeight: 900, padding: "12px 16px", borderRadius: 999, background: rgba(i % 2 ? COLOR.alert : COLOR.accent, 0.42), opacity: t }}>{item.label}</div>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const TalkingHeadToolProof: React.FC<
  MsProps & { media?: MediaLike; headline?: string; rows?: BeatItem[]; badge?: string; atMs?: number }
> = ({ media, headline = "Make the proof concrete", rows = [], badge = "TOOL PROOF", atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 90, right: 90, top: 150 }}>
        <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 28, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{badge}</div>
        <div style={{ ...TYPE.display, color: DARK, fontSize: 88, lineHeight: 0.94, marginTop: 16 }}>{headline}</div>
      </div>
      <div style={{ position: "absolute", left: 64, right: 64, top: 500, height: 610, transform: `scale(${0.94 + p * 0.06})`, transformOrigin: "center" }}>
        <MediaSurface media={media} fit="contain" />
      </div>
      {/* Same caption-safe-band bug already fixed in this file's TalkingHeadFeatureChecklist
          (see that component's own 2026-07-27 QA-pass comment) -- bottom:120 sat inside
          lint/lint.mjs's 220px CAPTION_BAND_PX, so the burned-in caption occluded this row
          (confirmed via a rendered still: "project and" overlapping "Claude Mem / remembers
          every session"). 260 matches the sibling component's already-verified safe value. */}
      <div style={{ position: "absolute", left: 88, right: 88, bottom: 260, display: "grid", gap: 18 }}>
        {rows.map((row, i) => {
          const t = interpolate(frame, [localFrame(row.atMs, sceneStartMs, fps), localFrame(row.atMs, sceneStartMs, fps) + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
          return (
            <div key={`${row.label}-${i}`} style={{ display: "grid", gridTemplateColumns: "42px 1fr", alignItems: "center", gap: 14, borderRadius: 22, padding: "15px 18px", background: COLOR.surface, color: LIGHT, boxShadow: `0 16px 44px ${rgba(DARK, 0.18)}`, opacity: t, transform: `translateX(${(1 - t) * -26}px)` }}>
              <div style={{ width: 52, height: 52, borderRadius: 52, display: "grid", placeItems: "center", background: i === rows.length - 1 ? COLOR.payoff : COLOR.accent, ...TYPE.mono, fontSize: 24, fontWeight: 900 }}>{i + 1}</div>
              <div>
                <div style={{ ...TYPE.headline, fontSize: 44, lineHeight: 1.05 }}>{row.label}</div>
                <div style={{ ...TYPE.body, color: COLOR.faint, fontSize: 34, marginTop: 5 }}>{row.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const TalkingHeadBrollStack: React.FC<MsProps & { headline?: string; cards?: BeatItem[]; media?: MediaLike; atMs?: number }> = ({
  headline = "Stack the receipts around the clip",
  cards = [],
  media,
  atMs,
  sceneStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 46, borderRadius: 56, overflow: "hidden", transform: `rotate(${(1 - p) * -2.5}deg) scale(${0.95 + p * 0.05})` }}>
        <MediaSurface media={media} fit="cover" />
      </div>
      <div style={{ position: "absolute", left: 64, right: 64, top: 126, ...TYPE.display, color: LIGHT, fontSize: 88, lineHeight: 0.94, textShadow: `0 18px 44px ${rgba(DARK, 0.5)}` }}>{headline}</div>
      {cards.map((card, i) => {
        const t = interpolate(frame, [localFrame(card.atMs, sceneStartMs, fps), localFrame(card.atMs, sceneStartMs, fps) + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
        const top = 470 + i * 210;
        const left = i % 2 === 0 ? 90 : 220;
        return (
          <div key={`${card.label}-${i}`} style={{ position: "absolute", top, left, width: 730, borderRadius: 34, padding: 32, background: rgba(COLOR.paper, 0.96), color: COLOR.ink, border: `1px solid ${rgba(COLOR.line, 0.9)}`, boxShadow: `0 24px 70px ${rgba(COLOR.ink, 0.32)}`, opacity: t, transform: `translateY(${(1 - t) * 28}px) rotate(${i % 2 === 0 ? -2 : 2}deg)` }}>
            <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 28, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{card.detail ?? `proof ${i + 1}`}</div>
            <div style={{ ...TYPE.headline, fontSize: 52, lineHeight: 1.02, marginTop: 8 }}>{card.label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const TalkingHeadSocialCTA: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; handle?: string; keyword?: string; subline?: string; atMs?: number; items?: BeatItem[] }
> = ({ sourceClip, editDecision, handle = "@YOURBRAND", keyword = "BUILD", subline = "comment for the workflow", atMs, items = [], sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark muted />
      <div style={{ position: "absolute", inset: 0, background: rgba(DARK, 0.58) }} />
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div style={{ transform: `translateY(${(1 - p) * 34}px) scale(${0.9 + p * 0.1})`, opacity: p }}>
          <div style={{ width: 190, height: 190, borderRadius: 54, margin: "0 auto 36px", display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${COLOR.accent}, ${COLOR.alert})`, color: LIGHT, boxShadow: glow(COLOR.accent, 0.34), ...TYPE.display, fontSize: 104 }}>↗</div>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 98, lineHeight: 0.92 }}>{handle}</div>
          <div style={{ ...TYPE.headline, color: COLOR.accent, fontSize: 64, marginTop: 26 }}>comment “{keyword}”</div>
          <div style={{ ...TYPE.body, color: COLOR.faint, fontSize: 44, marginTop: 16 }}>{subline}</div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 34 }}>
            {items.map((item, i) => {
              const t = interpolate(frame, [localFrame(item.atMs, sceneStartMs, fps), localFrame(item.atMs, sceneStartMs, fps) + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              return <div key={`${item.label}-${i}`} style={{ ...TYPE.mono, color: LIGHT, fontSize: 34, fontWeight: 900, padding: "12px 18px", borderRadius: 999, background: rgba(i % 2 ? COLOR.alert : COLOR.accent, 0.28), opacity: t }}>{item.label}</div>;
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Split proof canvas for dense talking-head references: lower half keeps the speaker clip
// as the trust anchor, upper half is a code-native motion/proof canvas. The canvas is
// palette-driven through tokens, but accepts an accent override for private recreation
// passes where the reference uses one hue and Abrar wants the same layout retinted.
export const TalkingHeadSplitProofCanvas: React.FC<
  MsProps & {
    sourceClip?: ClipLike;
    editDecision?: DecisionLike;
    variant?:
      | "orb"
      | "editor"
      | "dashboard"
      | "waveform"
      | "grid"
      | "folder"
      | "chat"
      | "body"
      | "bars"
      | "phone"
      | "media"
      | "cta";
    headline?: string;
    subline?: string;
    kicker?: string;
    accent?: string;
    media?: MediaLike;
    mediaFit?: "cover" | "contain" | "crop";
    labels?: string[];
    metrics?: BeatItem[];
    cards?: BeatItem[];
    atMs?: number;
  }
> = ({
  sourceClip,
  editDecision,
  variant = "dashboard",
  headline = "Proof canvas",
  subline,
  kicker,
  accent,
  media,
  mediaFit = "contain",
  labels = [],
  metrics = [],
  cards = [],
  atMs,
  sceneStartMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const ACCENT = accent ?? COLOR.accent;
  const src = assetSrc(sourceClip?.src);
  const startMs = editDecision?.inMs ?? 0;
  const endMs = editDecision?.outMs;
  const startFrom = Math.max(0, Math.round((startMs * fps) / 1000));
  const endAt = endMs === undefined ? undefined : Math.max(startFrom + 1, Math.round((endMs * fps) / 1000));
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const wave = Array.from({ length: 28 }, (_, i) => 18 + Math.sin(frame / 10 + i * 0.8) * 14 + (i % 5) * 4);
  const revealFor = (itemAtMs: number | undefined, i: number) =>
    interpolate(frame, [localFrame(itemAtMs ?? atMs, sceneStartMs, fps) + i * 4, localFrame(itemAtMs ?? atMs, sceneStartMs, fps) + i * 4 + 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE.emphasized,
    });

  const metricItems: BeatItem[] = metrics.length ? metrics : labels.map((label, i) => ({ label, detail: i === 0 ? "LIVE" : undefined }));
  const cardItems: BeatItem[] = cards.length ? cards : labels.map((label, i) => ({ label, detail: `step ${i + 1}` }));

  const Orb = () => (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
      <div style={{ position: "absolute", width: 410, height: 410, borderRadius: 999, background: `radial-gradient(circle, ${rgba(ACCENT, 0.95)} 0%, ${rgba(ACCENT, 0.3)} 34%, transparent 68%)`, filter: "blur(1px)", boxShadow: `0 0 70px ${rgba(ACCENT, 0.75)}`, transform: `scale(${0.94 + Math.sin(frame / 18) * 0.04})` }} />
      <div style={{ position: "absolute", width: 530, height: 530, borderRadius: 999, border: `2px solid ${rgba(ACCENT, 0.28)}`, boxShadow: `inset 0 0 60px ${rgba(ACCENT, 0.22)}` }} />
      <div style={{ position: "absolute", top: 620, ...TYPE.display, color: LIGHT, fontSize: 78, letterSpacing: 10 }}>{headline}</div>
      {subline && <div style={{ position: "absolute", top: 718, ...TYPE.mono, color: rgba(LIGHT, 0.78), fontSize: 24, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>{subline}</div>}
    </div>
  );

  const Editor = () => (
    <div style={{ position: "absolute", left: 108, right: 108, top: 120, borderRadius: 24, overflow: "hidden", background: "#080A12", border: `1px solid ${rgba(ACCENT, 0.38)}`, boxShadow: `0 34px 110px ${rgba(ACCENT, 0.2)}`, transform: `translateY(${(1 - p) * 26}px) scale(${0.965 + p * 0.035})` }}>
      <div style={{ height: 46, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", background: "#121426", borderBottom: `1px solid ${rgba(LIGHT, 0.08)}` }}>
        {[COLOR.alert, ACCENT, COLOR.payoff].map((c, i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 12, background: c }} />)}
        <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.58), fontSize: 15, marginLeft: 10, letterSpacing: 1.2, textTransform: "uppercase" }}>{kicker ?? "motion editor"}</div>
        <div style={{ marginLeft: "auto", ...TYPE.mono, color: rgba(LIGHT, 0.4), fontSize: 13 }}>00:{String(Math.floor((frame / fps) % 60)).padStart(2, "0")}</div>
      </div>
      <div style={{ height: 438, padding: 18, display: "grid", gridTemplateRows: "1fr 132px", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "132px 1fr 155px", gap: 16, minHeight: 0 }}>
          <div style={{ display: "grid", gap: 9 }}>
            {["media", "captions", "effects", "exports"].map((label, i) => (
              <div key={label} style={{ borderRadius: 10, background: i === 1 ? rgba(ACCENT, 0.18) : rgba(LIGHT, 0.045), border: `1px solid ${rgba(i === 1 ? ACCENT : LIGHT, i === 1 ? 0.28 : 0.07)}`, padding: "10px 12px" }}>
                <div style={{ width: 20 + i * 7, height: 5, borderRadius: 999, background: i === 1 ? ACCENT : rgba(LIGHT, 0.28), marginBottom: 8 }} />
                <div style={{ ...TYPE.mono, color: i === 1 ? rgba(LIGHT, 0.9) : rgba(LIGHT, 0.45), fontSize: 11, textTransform: "uppercase" }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ borderRadius: 16, background: "#02040A", border: `1px solid ${rgba(LIGHT, 0.08)}`, overflow: "hidden", position: "relative", display: "grid", placeItems: "center" }}>
            {src ? (
              <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ width: "54%", height: "100%", objectFit: "cover", borderLeft: `1px solid ${rgba(LIGHT, 0.08)}`, borderRight: `1px solid ${rgba(LIGHT, 0.08)}` }} />
            ) : (
              <div style={{ width: "52%", height: "100%", background: `linear-gradient(180deg, ${rgba(ACCENT, 0.16)}, ${rgba(LIGHT, 0.05)})` }} />
            )}
            <div style={{ position: "absolute", left: 28, top: 24, right: 28, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.62), fontSize: 13, textTransform: "uppercase" }}>preview</div>
              <div style={{ width: 22, height: 22, borderRadius: 999, border: `1px solid ${rgba(ACCENT, 0.7)}` }} />
            </div>
            <div style={{ position: "absolute", left: "50%", bottom: 28, transform: "translateX(-50%)", borderRadius: 999, padding: "8px 14px", background: rgba(DARK, 0.7), border: `1px solid ${rgba(ACCENT, 0.32)}`, ...TYPE.mono, color: LIGHT, fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>{headline}</div>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {(cardItems.length ? cardItems : [{ label: "script" }, { label: "captions" }, { label: "clips" }] satisfies BeatItem[]).slice(0, 4).map((c, i) => (
              <div key={i} style={{ borderRadius: 11, background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.14 : 0.045), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.24 : 0.07)}`, padding: 10, opacity: revealFor(c.atMs, i) }}>
                <div style={{ ...TYPE.mono, color: i === 0 ? ACCENT : rgba(LIGHT, 0.52), fontSize: 10, textTransform: "uppercase" }}>{c.detail ?? `task ${i + 1}`}</div>
                <div style={{ ...TYPE.mono, color: LIGHT, fontSize: 13, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {[ACCENT, "#62D58B", COLOR.alert, "#5B6CFF"].map((c, i) => <div key={i} style={{ height: 18, width: `${95 - i * 10}%`, borderRadius: 999, background: c, marginLeft: i * 22, opacity: 0.9, boxShadow: i === 0 ? glow(ACCENT, 0.16) : undefined }} />)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 6, marginTop: 8 }}>
            {Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ height: 28, borderRadius: 5, background: rgba(i % 4 === 0 ? ACCENT : LIGHT, i % 4 === 0 ? 0.5 : 0.095) }} />)}
          </div>
        </div>
      </div>
    </div>
  );

  const Dashboard = () => (
    <div style={{ position: "absolute", inset: "105px 54px 78px", display: "grid", gridTemplateRows: "auto 1fr", gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end" }}>
        <div>
          <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 22, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>{kicker ?? "dashboard"}</div>
          <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 46, lineHeight: 1.02 }}>{headline}</div>
        </div>
        <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.7), fontSize: 18 }}>{subline ?? "LIVE"}</div>
      </div>
      <div style={{ display: "grid", gridTemplateRows: "96px 1fr", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, metricItems.length || 4))}, 1fr)`, gap: 12 }}>
          {(metricItems.length ? metricItems : [{ label: "$24,850" }, { label: "4.2x" }, { label: "91.2%" }, { label: "live" }] satisfies BeatItem[]).slice(0, 4).map((m, i) => (
            <div key={i} style={{ borderRadius: 18, background: rgba(LIGHT, 0.06), border: `1px solid ${rgba(LIGHT, 0.09)}`, padding: 16, opacity: revealFor(m.atMs, i) }}>
              <div style={{ ...TYPE.headline, color: i === 0 ? ACCENT : LIGHT, fontSize: 30 }}>{m.label}</div>
              <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.46), fontSize: 14, marginTop: 5, textTransform: "uppercase" }}>{m.detail ?? "metric"}</div>
            </div>
          ))}
        </div>
        <div style={{ borderRadius: 26, background: rgba(LIGHT, 0.05), border: `1px solid ${rgba(LIGHT, 0.09)}`, padding: 28, position: "relative", overflow: "hidden" }}>
          {media ? (
            <MediaSurface media={media} fit={mediaFit} />
          ) : (
            <svg width="100%" height="100%" viewBox="0 0 760 300" preserveAspectRatio="none">
              <path d="M0 230 C90 190 120 240 205 175 C300 100 365 160 430 100 C525 24 610 100 760 58" fill="none" stroke={ACCENT} strokeWidth="10" strokeLinecap="round" />
              <path d="M0 250 C90 220 120 250 205 205 C300 155 365 200 430 150 C525 80 610 138 760 94" fill="none" stroke={rgba(LIGHT, 0.24)} strokeWidth="4" strokeLinecap="round" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );

  const Waveform = () => (
    <div style={{ position: "absolute", inset: "150px 74px 120px", display: "grid", placeItems: "center", textAlign: "center" }}>
      <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.46), fontSize: 18, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase" }}>{kicker ?? "finds silent bars"}</div>
      <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 42, marginTop: 10, letterSpacing: 1 }}>{headline}</div>
      <div style={{ marginTop: 58, display: "flex", gap: 5, alignItems: "center", height: 150, padding: "0 34px" }}>
        {Array.from({ length: 74 }, (_, i) => {
          const h = 20 + Math.sin(frame / 8 + i * 0.68) * 24 + (i % 9) * 3;
          const silent = i % 13 === 2 || i % 13 === 3;
          return <div key={i} style={{ width: silent ? 3 : 5, height: silent ? 16 : h, borderRadius: 999, background: silent ? rgba(LIGHT, 0.25) : (i % 5 === 0 ? ACCENT : rgba(ACCENT, 0.68)) }} />;
        })}
      </div>
      {subline && <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.56), fontSize: 18, marginTop: 42, letterSpacing: 1.4 }}>{subline}</div>}
    </div>
  );

  const Grid = () => (
    <div style={{ position: "absolute", inset: "92px 218px 86px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 18 }}>
      {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ borderRadius: 12, background: "#05060B", border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.5 : 0.12)}`, boxShadow: i === 0 ? `0 18px 50px ${rgba(ACCENT, 0.18)}` : undefined, opacity: revealFor(undefined, i), padding: 10, position: "relative", overflow: "hidden" }}>
        {src ? (
          <OffthreadVideo src={src} muted startFrom={startFrom + i * 12} endAt={endAt} style={{ width: "100%", height: 130, borderRadius: 8, objectFit: "cover", objectPosition: "50% 72%", filter: "brightness(0.78)" }} />
        ) : (
          <div style={{ height: 130, borderRadius: 8, background: `linear-gradient(135deg, ${rgba(ACCENT, 0.18)}, ${rgba(LIGHT, 0.08)})` }} />
        )}
        <div style={{ position: "absolute", inset: 10, borderRadius: 8, background: `linear-gradient(180deg, transparent 45%, ${rgba(DARK, 0.78)})` }} />
        <div style={{ position: "absolute", left: 20, right: 20, bottom: 18, ...TYPE.mono, color: LIGHT, fontSize: 15, fontWeight: 900 }}>{labels[i] ?? `shot ${i + 1}`}</div>
      </div>)}
    </div>
  );

  const Folder = () => (
    <div style={{ position: "absolute", inset: "170px 92px 130px", display: "grid", placeItems: "center" }}>
      <div style={{ width: "82%", borderRadius: 18, background: rgba("#171323", 0.82), border: `1px solid ${rgba(LIGHT, 0.1)}`, padding: 34, boxShadow: `0 26px 80px ${rgba(DARK, 0.36)}`, transform: `scale(${0.92 + p * 0.08})`, display: "grid", gridTemplateColumns: "130px 1fr", gap: 30, alignItems: "center" }}>
        <div style={{ position: "relative", width: 116, height: 82 }}>
          <div style={{ position: "absolute", left: 0, top: 14, width: 108, height: 64, borderRadius: 12, border: `3px solid ${ACCENT}`, boxShadow: glow(ACCENT, 0.2) }} />
          <div style={{ position: "absolute", left: 8, top: 0, width: 58, height: 22, borderRadius: "12px 12px 0 0", borderTop: `3px solid ${ACCENT}`, borderLeft: `3px solid ${ACCENT}`, borderRight: `3px solid ${ACCENT}` }} />
        </div>
        <div>
          <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.42), fontSize: 15, letterSpacing: 1.8, textTransform: "uppercase" }}>drop recording</div>
          <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 39, lineHeight: 1.05, marginTop: 6 }}>{headline}</div>
          {subline && <div style={{ ...TYPE.body, color: rgba(LIGHT, 0.58), fontSize: 21, marginTop: 10 }}>{subline}</div>}
        </div>
      </div>
    </div>
  );

  const Chat = () => (
    <div style={{ position: "absolute", inset: "105px 58px 90px", display: "grid", gap: 16 }}>
      {(cardItems.length ? cardItems : [{ label: "Prompt" }, { label: "Agent response" }, { label: "Action queued" }] satisfies BeatItem[]).slice(0, 4).map((c, i) => (
        <div key={i} style={{ alignSelf: i % 2 ? "start" : "end", width: i % 2 ? "78%" : "86%", borderRadius: 22, padding: "22px 24px", background: i % 2 ? rgba(LIGHT, 0.07) : rgba(ACCENT, 0.18), border: `1px solid ${rgba(i % 2 ? LIGHT : ACCENT, 0.16)}`, opacity: revealFor(c.atMs, i) }}>
          <div style={{ ...TYPE.mono, color: i % 2 ? rgba(LIGHT, 0.58) : ACCENT, fontSize: 18, fontWeight: 900, textTransform: "uppercase" }}>{c.detail ?? (i % 2 ? "system" : "user")}</div>
          <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 34, marginTop: 8 }}>{c.label}</div>
        </div>
      ))}
    </div>
  );

  const Body = () => (
    <div style={{ position: "absolute", inset: "75px 80px 70px", textAlign: "center" }}>
      <div style={{ position: "absolute", left: "50%", top: 70, width: 220, height: 610, transform: "translateX(-50%)", borderRadius: "120px 120px 58px 58px", background: `linear-gradient(180deg, ${rgba("#00D3FF", 0.34)}, ${rgba(ACCENT, 0.15)})`, border: `2px solid ${rgba("#00D3FF", 0.45)}`, boxShadow: `0 0 70px ${rgba("#00D3FF", 0.22)}` }} />
      <div style={{ position: "absolute", left: "50%", top: 255, width: 110, height: 160, transform: "translateX(-50%)", borderRadius: 80, background: rgba(ACCENT, 0.46), filter: "blur(2px)" }} />
      <div style={{ position: "absolute", left: "50%", top: 310, transform: "translateX(-50%)", ...TYPE.display, color: LIGHT, fontSize: 86 }}>{labels[0] ?? "82"}</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 24, ...TYPE.headline, color: LIGHT, fontSize: 42 }}>{headline}</div>
    </div>
  );

  const Bars = () => (
    <div style={{ position: "absolute", inset: "125px 82px 96px", display: "grid", alignItems: "end", gridTemplateColumns: "repeat(8, 1fr)", gap: 18 }}>
      {Array.from({ length: 8 }).map((_, i) => {
        const hot = i > 4;
        return <div key={i} style={{ height: 90 + i * 42 + Math.sin(i) * 34, borderRadius: "16px 16px 5px 5px", background: hot ? ACCENT : rgba("#7D66FF", 0.9), boxShadow: hot ? glow(ACCENT, 0.2) : undefined, opacity: revealFor(undefined, i) }} />;
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, ...TYPE.headline, color: LIGHT, fontSize: 44 }}>{headline}</div>
    </div>
  );

  const Phone = () => (
    <div style={{ position: "absolute", left: "50%", top: 74, width: 345, height: 710, marginLeft: -172, borderRadius: 42, padding: 16, background: "#05060B", border: `2px solid ${rgba(LIGHT, 0.2)}`, boxShadow: `0 34px 100px ${rgba(ACCENT, 0.24)}`, transform: `translateY(${(1 - p) * 34}px)` }}>
      <div style={{ height: 30, display: "grid", placeItems: "center" }}><div style={{ width: 92, height: 10, borderRadius: 999, background: "#151A27" }} /></div>
      <div style={{ height: 610, borderRadius: 30, background: `linear-gradient(180deg, #090D18, ${rgba(ACCENT, 0.14)})`, padding: 22 }}>
        <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 16, fontWeight: 900 }}>{kicker ?? "APP"}</div>
        <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 30, marginTop: 16 }}>{headline}</div>
        <div style={{ display: "grid", gap: 12, marginTop: 32 }}>{(cardItems.length ? cardItems : [{ label: "Action queued" }] satisfies BeatItem[]).slice(0, 5).map((c, i) => <div key={i} style={{ borderRadius: 14, padding: 14, background: rgba(LIGHT, 0.07), color: LIGHT, ...TYPE.mono, fontSize: 16, opacity: revealFor(c.atMs, i) }}>{c.label}</div>)}</div>
      </div>
    </div>
  );

  const Cta = () => (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
      <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.58), fontSize: 22, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase" }}>{kicker ?? "comment"}</div>
      <div style={{ ...TYPE.display, color: LIGHT, fontSize: 112, lineHeight: 0.9, textShadow: `0 12px 36px ${rgba(DARK, 0.7)}` }}>{headline}</div>
      {subline && <div style={{ ...TYPE.body, color: ACCENT, fontSize: 34, marginTop: 24 }}>{subline}</div>}
    </div>
  );

  const Media = () => (
    <div style={{ position: "absolute", inset: "115px 70px 95px", borderRadius: 30, overflow: "hidden", background: rgba(LIGHT, 0.08), border: `1px solid ${rgba(ACCENT, 0.28)}`, display: "grid", placeItems: "center" }}>
      {media ? <MediaSurface media={media} fit={mediaFit} /> : <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 46, textAlign: "center", padding: 40 }}>{headline}</div>}
    </div>
  );

  const renderTop = () => {
    switch (variant) {
      case "orb":
        return <Orb />;
      case "editor":
        return <Editor />;
      case "waveform":
        return <Waveform />;
      case "grid":
        return <Grid />;
      case "folder":
        return <Folder />;
      case "chat":
        return <Chat />;
      case "body":
        return <Body />;
      case "bars":
        return <Bars />;
      case "phone":
        return <Phone />;
      case "media":
        return <Media />;
      case "cta":
        return <Cta />;
      case "dashboard":
      default:
        return <Dashboard />;
    }
  };

  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 960, overflow: "hidden", background: `radial-gradient(circle at 50% 40%, ${rgba(ACCENT, 0.18)}, transparent 42%), linear-gradient(180deg, #161229, #0A0813)` }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(LIGHT, 0.035)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(LIGHT, 0.028)} 1px, transparent 1px)`, backgroundSize: "46px 46px" }} />
        {renderTop()}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 960, overflow: "hidden", background: DARK }}>
        {src ? (
          <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ position: "absolute", left: 0, top: -960, width: 1080, height: 1920, objectFit: "cover" }} />
        ) : (
          <PortraitPlaceholder label={clipLabel(sourceClip, editDecision, "SOURCE CLIP")} dark />
        )}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: rgba(ACCENT, 0.8), boxShadow: glow(ACCENT, 0.2) }} />
      </div>
    </AbsoluteFill>
  );
};

type SplitProofProps = React.ComponentProps<typeof TalkingHeadSplitProofCanvas>;
export const TalkingHeadSplitOrb: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="orb" />;
export const TalkingHeadSplitEditor: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="editor" />;
export const TalkingHeadSplitDashboard: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="dashboard" />;
export const TalkingHeadSplitWaveform: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="waveform" />;
export const TalkingHeadSplitGrid: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="grid" />;
export const TalkingHeadSplitFolder: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="folder" />;
export const TalkingHeadSplitChat: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="chat" />;
export const TalkingHeadSplitBodyAnalytics: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="body" />;
export const TalkingHeadSplitBars: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="bars" />;
export const TalkingHeadSplitPhone: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="phone" />;
export const TalkingHeadSplitMedia: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="media" />;
export const TalkingHeadSplitCTA: React.FC<Omit<SplitProofProps, "variant">> = (props) => <TalkingHeadSplitProofCanvas {...props} variant="cta" />;

type LiteralSplitProps = Omit<SplitProofProps, "variant"> & {
  items?: BeatItem[];
};

const LiteralSplitShell: React.FC<
  LiteralSplitProps & {
    renderTop: (ctx: {
      COLOR: ReturnType<typeof useReelTokens>["COLOR"];
      TYPE: ReturnType<typeof useReelTokens>["TYPE"];
      DARK: string;
      LIGHT: string;
      ACCENT: string;
      frame: number;
      fps: number;
      p: number;
      revealFor: (itemAtMs: number | undefined, i: number) => number;
      metricItems: BeatItem[];
      cardItems: BeatItem[];
      labelItems: string[];
      src?: string;
      startFrom: number;
      endAt?: number;
    }) => React.ReactNode;
  }
> = ({
  sourceClip,
  editDecision,
  headline = "Proof",
  subline,
  kicker,
  accent,
  labels = [],
  metrics = [],
  cards = [],
  items = [],
  atMs,
  sceneStartMs,
  renderTop,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const ACCENT = accent ?? COLOR.accent;
  const src = assetSrc(sourceClip?.src);
  const startMs = editDecision?.inMs ?? 0;
  const endMs = editDecision?.outMs;
  const startFrom = Math.max(0, Math.round((startMs * fps) / 1000));
  const endAt = endMs === undefined ? undefined : Math.max(startFrom + 1, Math.round((endMs * fps) / 1000));
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const revealFor = (itemAtMs: number | undefined, i: number) =>
    interpolate(frame, [localFrame(itemAtMs ?? atMs, sceneStartMs, fps) + i * 4, localFrame(itemAtMs ?? atMs, sceneStartMs, fps) + i * 4 + 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE.emphasized,
    });
  const metricItems = metrics.length ? metrics : (items.length ? items : labels.map((label, i) => ({ label, detail: i === 0 ? kicker : subline })));
  const cardItems = cards.length ? cards : (items.length ? items : labels.map((label, i) => ({ label, detail: `beat ${i + 1}` })));
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 960, overflow: "hidden", background: `radial-gradient(circle at 50% 36%, ${rgba(ACCENT, 0.2)}, transparent 43%), linear-gradient(180deg, #171229, #080711)` }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(LIGHT, 0.028)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(LIGHT, 0.022)} 1px, transparent 1px)`, backgroundSize: "44px 44px" }} />
        {renderTop({ COLOR, TYPE, DARK, LIGHT, ACCENT, frame, fps, p, revealFor, metricItems, cardItems, labelItems: labels, src, startFrom, endAt })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 960, overflow: "hidden", background: DARK }}>
        {src ? (
          <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ position: "absolute", left: 0, top: -960, width: 1080, height: 1920, objectFit: "cover" }} />
        ) : (
          <PortraitPlaceholder label={clipLabel(sourceClip, editDecision, "SOURCE CLIP")} dark />
        )}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: rgba(ACCENT, 0.8), boxShadow: glow(ACCENT, 0.2) }} />
      </div>
    </AbsoluteFill>
  );
};

const MiniChrome: React.FC<{ color: string; label?: string }> = ({ color, label }) => (
  <div style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: `1px solid ${rgba("#ffffff", 0.08)}`, background: rgba("#ffffff", 0.035) }}>
    {["#FF5F57", "#FFBD2E", "#28C840"].map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: 999, background: c }} />)}
    <span style={{ marginLeft: 8, color: rgba("#ffffff", 0.5), fontFamily: "monospace", fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}>{label ?? "system"}</span>
    <span style={{ marginLeft: "auto", width: 12, height: 12, borderRadius: 999, background: color, boxShadow: glow(color, 0.18) }} />
  </div>
);

export const TalkingHeadJarvisConsole: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, frame, p, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "76px 80px 86px", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 32, transform: `translateY(${(1 - p) * 24}px)` }}>
        <div style={{ display: "grid", placeItems: "center", position: "relative" }}>
          <div style={{ position: "absolute", width: 390, height: 390, borderRadius: 999, background: `radial-gradient(circle, ${rgba(ACCENT, 0.92)}, ${rgba(ACCENT, 0.22)} 42%, transparent 70%)`, filter: "blur(1px)", transform: `scale(${0.95 + Math.sin(frame / 18) * 0.035})`, boxShadow: `0 0 90px ${rgba(ACCENT, 0.6)}` }} />
          <div style={{ position: "absolute", width: 515, height: 515, borderRadius: 999, border: `2px solid ${rgba(ACCENT, 0.24)}` }} />
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 74, letterSpacing: 9 }}>JARVIS</div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "center" }}>
          {cardItems.slice(0, 5).map((item, i) => (
            <div key={i} style={{ borderRadius: 20, padding: "18px 22px", background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.16 : 0.055), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.38 : 0.1)}`, opacity: revealFor(item.atMs, i) }}>
              <div style={{ ...TYPE.mono, color: i === 0 ? ACCENT : rgba(LIGHT, 0.5), fontSize: 15, textTransform: "uppercase" }}>{item.detail ?? `input ${i + 1}`}</div>
              <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 31, marginTop: 6 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    )}
  />
);

export const TalkingHeadVoiceClonePanel: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, frame, p, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "112px 110px 110px", display: "grid", gridTemplateColumns: "1fr 0.78fr", gap: 28, transform: `scale(${0.96 + p * 0.04})` }}>
        <div style={{ borderRadius: 30, overflow: "hidden", background: "#0B0D16", border: `1px solid ${rgba(ACCENT, 0.32)}`, boxShadow: `0 30px 90px ${rgba(ACCENT, 0.18)}` }}>
          <MiniChrome color={ACCENT} label="voice lab" />
          <div style={{ padding: 30 }}>
            <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 16, textTransform: "uppercase", letterSpacing: 2 }}>upload sample</div>
            <div style={{ marginTop: 22, height: 148, borderRadius: 22, background: rgba(ACCENT, 0.13), border: `1px dashed ${rgba(ACCENT, 0.55)}`, display: "grid", placeItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, height: 96 }}>
                {Array.from({ length: 42 }, (_, i) => <div key={i} style={{ width: 5, height: 20 + Math.sin(frame / 8 + i * 0.7) * 22 + (i % 4) * 4, borderRadius: 999, background: i % 5 === 0 ? ACCENT : rgba(LIGHT, 0.55) }} />)}
              </div>
            </div>
            <div style={{ display: "grid", gap: 14, marginTop: 24 }}>
              {cardItems.slice(0, 3).map((item, i) => <div key={i} style={{ borderRadius: 16, padding: 16, background: rgba(LIGHT, 0.055), color: LIGHT, ...TYPE.mono, fontSize: 18, opacity: revealFor(item.atMs, i) }}>{item.label}</div>)}
            </div>
          </div>
        </div>
        <div style={{ borderRadius: 28, background: `linear-gradient(180deg, ${rgba(ACCENT, 0.22)}, ${rgba(LIGHT, 0.05)})`, border: `1px solid ${rgba(LIGHT, 0.1)}`, padding: 26, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 82, lineHeight: 0.92 }}>{props.headline ?? "VOICE"}</div>
          <div style={{ ...TYPE.body, color: rgba(LIGHT, 0.62), fontSize: 24, marginTop: 18 }}>{props.subline ?? "clone → agent"}</div>
        </div>
      </div>
    )}
  />
);

export const TalkingHeadMetaAdsBoard: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, metricItems, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "84px 66px 74px", display: "grid", gridTemplateRows: "90px 1fr", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>ads manager</div>
            <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 48 }}>{props.headline ?? "Meta Ads Dashboard"}</div>
          </div>
          <div style={{ borderRadius: 999, padding: "10px 16px", background: rgba(ACCENT, 0.16), color: ACCENT, ...TYPE.mono, fontSize: 16, fontWeight: 900 }}>LIVE SPEND</div>
        </div>
        <div style={{ borderRadius: 28, background: rgba("#F7F1EA", 0.94), padding: 26, color: "#111827", boxShadow: `0 35px 100px ${rgba(ACCENT, 0.18)}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {(metricItems.length ? metricItems : [{ label: "$14.2k", detail: "spend" }, { label: "2.8x", detail: "ROAS" }, { label: "$22", detail: "CPM" }, { label: "41%", detail: "hold" }]).slice(0, 4).map((m, i) => (
              <div key={i} style={{ borderRadius: 18, background: i === 0 ? rgba(ACCENT, 0.18) : "#FFFFFF", padding: 16, border: `1px solid ${rgba("#111827", 0.08)}`, opacity: revealFor(m.atMs, i) }}>
                <div style={{ ...TYPE.headline, color: i === 0 ? ACCENT : "#111827", fontSize: 30 }}>{m.label}</div>
                <div style={{ ...TYPE.mono, color: "#6B7280", fontSize: 12, marginTop: 5, textTransform: "uppercase" }}>{m.detail ?? "metric"}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr", gap: 18, marginTop: 20 }}>
            <div style={{ borderRadius: 20, background: "#FFFFFF", padding: 20, border: `1px solid ${rgba("#111827", 0.08)}` }}>
              {cardItems.slice(0, 5).map((c, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 88px 88px", gap: 10, padding: "13px 0", borderBottom: i < 4 ? `1px solid ${rgba("#111827", 0.07)}` : undefined, opacity: revealFor(c.atMs, i) }}>
                <div style={{ ...TYPE.mono, color: "#111827", fontSize: 17, fontWeight: 900 }}>{c.label}</div>
                <div style={{ color: ACCENT, ...TYPE.mono, fontSize: 15 }}>{c.detail ?? "active"}</div>
                <div style={{ color: "#16A34A", ...TYPE.mono, fontSize: 15 }}>{i % 2 ? "scale" : "hold"}</div>
              </div>)}
            </div>
            <div style={{ borderRadius: 20, background: `linear-gradient(180deg, ${rgba(ACCENT, 0.18)}, #fff)`, padding: 22, display: "grid", alignItems: "end", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {Array.from({ length: 5 }, (_, i) => <div key={i} style={{ height: 64 + i * 34, borderRadius: "10px 10px 4px 4px", background: i > 2 ? ACCENT : "#111827" }} />)}
            </div>
          </div>
        </div>
      </div>
    )}
  />
);

export const TalkingHeadApprovalShield: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, cardItems, revealFor, p }) => (
      <div style={{ position: "absolute", inset: "110px 96px 96px", display: "grid", gridTemplateColumns: "0.82fr 1.18fr", gap: 34, alignItems: "center" }}>
        <div style={{ height: 430, borderRadius: 34, background: rgba(ACCENT, 0.12), border: `1px solid ${rgba(ACCENT, 0.32)}`, display: "grid", placeItems: "center", transform: `scale(${0.9 + p * 0.1})` }}>
          <svg width="260" height="310" viewBox="0 0 260 310">
            <path d="M130 14 236 54v78c0 72-38 124-106 164C62 256 24 204 24 132V54Z" fill={rgba(ACCENT, 0.18)} stroke={ACCENT} strokeWidth="8" />
            <path d="M76 150l34 36 78-88" fill="none" stroke={LIGHT} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>approval flow</div>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 70, lineHeight: 0.94 }}>{props.headline ?? "approved data only"}</div>
          <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
            {cardItems.slice(0, 4).map((item, i) => <div key={i} style={{ borderRadius: 18, padding: "16px 18px", background: rgba(LIGHT, 0.06), border: `1px solid ${rgba(LIGHT, 0.1)}`, opacity: revealFor(item.atMs, i), display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, background: i % 2 ? "#16A34A" : ACCENT }} />
              <span style={{ ...TYPE.headline, color: LIGHT, fontSize: 27 }}>{item.label}</span>
            </div>)}
          </div>
        </div>
      </div>
    )}
  />
);

export const TalkingHeadVoiceAgentInbox: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "92px 92px 86px", display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 28 }}>
        <div style={{ borderRadius: 30, overflow: "hidden", background: "#080A12", border: `1px solid ${rgba(ACCENT, 0.28)}` }}>
          <MiniChrome color={ACCENT} label="voice agent inbox" />
          <div style={{ padding: 24, display: "grid", gap: 14 }}>
            {cardItems.slice(0, 6).map((item, i) => <div key={i} style={{ borderRadius: 18, padding: "17px 18px", background: i === 0 ? rgba(ACCENT, 0.17) : rgba(LIGHT, 0.055), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.34 : 0.08)}`, opacity: revealFor(item.atMs, i) }}>
              <div style={{ ...TYPE.mono, color: i === 0 ? ACCENT : rgba(LIGHT, 0.48), fontSize: 13, textTransform: "uppercase" }}>{item.detail ?? `task ${i + 1}`}</div>
              <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 29, marginTop: 5 }}>{item.label}</div>
            </div>)}
          </div>
        </div>
        <div style={{ borderRadius: 32, background: rgba(ACCENT, 0.12), border: `1px solid ${rgba(ACCENT, 0.28)}`, padding: 30, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.48), fontSize: 18, letterSpacing: 2, textTransform: "uppercase" }}>sentiment</div>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 118, lineHeight: 0.9 }}>{props.labels?.[0] ?? "82"}</div>
          <div style={{ height: 12, width: "88%", borderRadius: 999, background: rgba(LIGHT, 0.12), overflow: "hidden" }}><div style={{ height: "100%", width: "82%", borderRadius: 999, background: ACCENT }} /></div>
        </div>
      </div>
    )}
  />
);

export const TalkingHeadMeetingMemoryStoryboard: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, src, startFrom, endAt, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "84px 74px 82px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {Array.from({ length: 6 }, (_, i) => {
          const item = cardItems[i] ?? { label: `memory ${i + 1}` };
          return <div key={i} style={{ borderRadius: 24, overflow: "hidden", background: rgba(LIGHT, 0.06), border: `1px solid ${rgba(i % 3 === 0 ? ACCENT : LIGHT, i % 3 === 0 ? 0.35 : 0.1)}`, opacity: revealFor(item.atMs, i), position: "relative" }}>
            {src && i % 2 === 0 ? <OffthreadVideo src={src} muted startFrom={startFrom + i * 8} endAt={endAt} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.72)" }} /> : null}
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${rgba("#000", 0.1)}, ${rgba("#000", 0.72)})` }} />
            <div style={{ position: "absolute", left: 18, right: 18, bottom: 18 }}>
              <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>{item.detail ?? "captured"}</div>
              <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 26, marginTop: 4 }}>{item.label}</div>
            </div>
          </div>;
        })}
      </div>
    )}
  />
);

export const TalkingHeadWearableBodyMap: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, frame, metricItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "72px 74px 72px", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 34 }}>
        <div style={{ position: "relative", borderRadius: 34, background: rgba("#0EA5E9", 0.08), border: `1px solid ${rgba("#38BDF8", 0.28)}`, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: "50%", top: 74, width: 210, height: 600, transform: "translateX(-50%)", borderRadius: "110px 110px 56px 56px", background: `linear-gradient(180deg, ${rgba("#38BDF8", 0.28)}, ${rgba(ACCENT, 0.15)})`, border: `2px solid ${rgba("#38BDF8", 0.42)}` }} />
          <div style={{ position: "absolute", left: "50%", top: 270, transform: "translateX(-50%)", ...TYPE.display, color: LIGHT, fontSize: 116 }}>{props.labels?.[0] ?? "82"}</div>
          <div style={{ position: "absolute", left: 70, right: 70, bottom: 50, display: "flex", justifyContent: "space-between" }}>
            {["watch", "ring", "app"].map((l, i) => <div key={l} style={{ width: 74, height: 74, borderRadius: 24, background: i === 1 ? ACCENT : rgba(LIGHT, 0.08), display: "grid", placeItems: "center", color: LIGHT, ...TYPE.mono, fontSize: 12, boxShadow: i === 1 ? glow(ACCENT, 0.18) : undefined }}>{l}</div>)}
          </div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "center" }}>
          {metricItems.slice(0, 5).map((m, i) => <div key={i} style={{ borderRadius: 20, padding: "18px 22px", background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.15 : 0.055), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.36 : 0.1)}`, opacity: revealFor(m.atMs, i) }}>
            <div style={{ ...TYPE.headline, color: i === 0 ? ACCENT : LIGHT, fontSize: 34 }}>{m.label}</div>
            <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.52), fontSize: 15, textTransform: "uppercase" }}>{m.detail ?? "signal"}</div>
          </div>)}
          <svg width="100%" height="120" viewBox="0 0 480 120">
            <path d={`M0 72 C80 ${40 + Math.sin(frame / 12) * 12} 120 98 188 54 C266 6 318 82 480 28`} fill="none" stroke={ACCENT} strokeWidth="8" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    )}
  />
);

export const TalkingHeadRecoveryChart: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "96px 80px 84px", borderRadius: 34, background: rgba(LIGHT, 0.055), border: `1px solid ${rgba(LIGHT, 0.1)}`, padding: 34 }}>
        <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: 2 }}>recovery timeline</div>
        <div style={{ ...TYPE.display, color: LIGHT, fontSize: 70, lineHeight: 0.94, marginTop: 8 }}>{props.headline ?? "deep sleep lift"}</div>
        <div style={{ position: "absolute", left: 46, right: 46, bottom: 52, height: 310, display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 14, alignItems: "end" }}>
          {Array.from({ length: 9 }, (_, i) => <div key={i} style={{ height: 70 + i * 24 + (i % 3) * 32, borderRadius: "16px 16px 5px 5px", background: i > 5 ? ACCENT : rgba("#38BDF8", 0.72), opacity: revealFor(cardItems[i]?.atMs, i) }} />)}
        </div>
      </div>
    )}
  />
);

export const TalkingHeadAgentBrowserPanel: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "94px 88px 86px", display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 26 }}>
        <div style={{ borderRadius: 30, overflow: "hidden", background: "#090B12", border: `1px solid ${rgba(ACCENT, 0.32)}` }}>
          <MiniChrome color={ACCENT} label="browser agent" />
          <div style={{ padding: 26 }}>
            <div style={{ borderRadius: 18, padding: 18, background: rgba(LIGHT, 0.06), border: `1px solid ${rgba(LIGHT, 0.1)}`, ...TYPE.mono, color: LIGHT, fontSize: 20 }}>How can I help?</div>
            <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
              {cardItems.slice(0, 5).map((c, i) => <div key={i} style={{ borderRadius: 16, padding: "15px 16px", background: i % 2 ? rgba(ACCENT, 0.15) : rgba(LIGHT, 0.055), color: LIGHT, ...TYPE.mono, fontSize: 17, opacity: revealFor(c.atMs, i) }}>{c.label}</div>)}
            </div>
          </div>
        </div>
        {/* alignContent:"start" is load-bearing here, not decorative -- same CSS Grid
            default-stretch bug fixed in SharedVisualPrimitives.tsx's BrowserAgentPanel
            (this component's near-identical sibling): without it, these 4 "auto"-height
            rows stretch to fill the whole "1fr" row of the outer grid instead of packing
            at natural height. Missed when that fix was made because this is a separate
            copy in a different file. */}
        <div style={{ borderRadius: 34, background: rgba(ACCENT, 0.12), border: `1px solid ${rgba(ACCENT, 0.28)}`, padding: 28, display: "grid", gridTemplateRows: "auto 1fr", gap: 20 }}>
          <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 38 }}>{props.headline ?? "agent session"}</div>
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            {["search", "compare", "rerun", "notify"].map((x, i) => <div key={x} style={{ borderRadius: 16, background: rgba(LIGHT, 0.08), padding: 16, display: "flex", justifyContent: "space-between", color: LIGHT, ...TYPE.mono, fontSize: 16 }}><span>{x}</span><span style={{ color: ACCENT }}>✓</span></div>)}
          </div>
        </div>
      </div>
    )}
  />
);

// Round-3 blind-convergence fix (build-mobile-app-claude-code): source shows two phone
// mockups side by side — a blue "App Store" icon on the left, a green Android icon on the
// right — under a "One Stack. Both Platforms." headline, proving the same codebase ships to
// both. The plan previously pointed process.fastest-stack at the generic AdsDashboard
// primitive (a tabbed Fastest/iOS/Android card + bar chart), which reads as an ads/metrics
// panel, not a "one codebase, two native apps" proof. This is a genuine component gap: no
// existing component draws twin phone shells with platform-store icons.
export const TalkingHeadPlatformTwinPhones: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, cardItems, revealFor, p }) => {
      const platforms: { name: string; bg: string; kind: "store" | "android" }[] = [
        { name: "App Store", bg: "#0A84FF", kind: "store" },
        { name: "Google Play", bg: "#3DDC84", kind: "android" },
      ];
      return (
        <div style={{ position: "absolute", inset: "78px 66px 76px", display: "grid", gridTemplateRows: "auto 1fr auto", gap: 22 }}>
          <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 38, textAlign: "center", lineHeight: 1.05 }}>{props.headline ?? "One codebase, two platforms"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26, alignItems: "center", transform: `scale(${0.92 + p * 0.08})` }}>
            {platforms.map((plat) => (
              <div key={plat.name} style={{ borderRadius: 40, background: "#0B0D16", border: `2px solid ${rgba(LIGHT, 0.14)}`, padding: 12, boxShadow: `0 26px 60px ${rgba("#000", 0.35)}` }}>
                <div style={{ borderRadius: 30, background: "#fff", height: 360, position: "relative", overflow: "hidden", display: "grid", placeItems: "center" }}>
                  <div style={{ width: 116, height: 116, borderRadius: 30, background: plat.bg, display: "grid", placeItems: "center", boxShadow: `0 14px 26px ${rgba(plat.bg, 0.4)}` }}>
                    {plat.kind === "store" ? (
                      <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
                        <path d="M32 8 L48 44 L38 44 L32 30 L26 44 L16 44 Z" fill="#fff" />
                        <circle cx="32" cy="20" r="4" fill="#fff" />
                      </svg>
                    ) : (
                      <svg width="52" height="52" viewBox="0 0 60 60" fill="none">
                        <rect x="18" y="22" width="24" height="26" rx="10" fill="#fff" />
                        <circle cx="24" cy="33" r="2.6" fill={plat.bg} />
                        <circle cx="36" cy="33" r="2.6" fill={plat.bg} />
                        <line x1="20" y1="18" x2="24" y2="24" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                        <line x1="40" y1="18" x2="36" y2="24" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <div style={{ position: "absolute", bottom: 14, ...TYPE.mono, fontSize: 12, color: "#00000088", textTransform: "uppercase", letterSpacing: 1 }}>{plat.name}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            {cardItems.slice(0, 3).map((item, i) => (
              <div key={i} style={{ borderRadius: 999, padding: "9px 18px", background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.2 : 0.08), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.4 : 0.14)}`, opacity: revealFor(item.atMs, i), ...TYPE.mono, color: LIGHT, fontSize: 14 }}>{item.label}</div>
            ))}
          </div>
        </div>
      );
    }}
  />
);

// Round-3 blind-convergence fix (build-mobile-app-claude-code): source cuts to a full-bleed,
// isolated Chrome browser logo (the classic red/yellow/green pinwheel with a blue center) at
// "test it in Chrome" -- a single beat, no UI chrome, no cards, just the brand mark and a
// caption word. The plan previously pointed test.chrome at the generic BrowserAgentPanel
// primitive (an "agent session" checklist card), which is a real UI panel, not a logo beat.
// Real gap: no existing component draws an isolated brand-logo reveal.
export const TalkingHeadBrowserLogoReveal: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, p, cardItems, revealFor }) => (
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div style={{ display: "grid", placeItems: "center", gap: 24, transform: `scale(${0.85 + p * 0.15})` }}>
          <div
            style={{
              width: 280,
              height: 280,
              borderRadius: 999,
              background: "conic-gradient(from 0deg, #EA4335 0deg 120deg, #FBBC05 120deg 240deg, #34A853 240deg 360deg)",
              boxShadow: `0 26px 60px ${rgba("#000", 0.35)}`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <div style={{ width: 112, height: 112, borderRadius: 999, background: "#fff", display: "grid", placeItems: "center" }}>
              <div style={{ width: 70, height: 70, borderRadius: 999, background: "#4285F4" }} />
            </div>
          </div>
          <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 30, opacity: revealFor(cardItems[0]?.atMs, 0) }}>{cardItems[0]?.label ?? props.headline ?? "test in Chrome"}</div>
        </div>
      </div>
    )}
  />
);

export const TalkingHeadOddsBoard: React.FC<LiteralSplitProps> = (props) => (
  <LiteralSplitShell
    {...props}
    renderTop={({ TYPE, LIGHT, ACCENT, metricItems, revealFor }) => (
      <div style={{ position: "absolute", inset: "94px 78px 86px", display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 24 }}>
        <div style={{ borderRadius: 30, background: "#07100B", border: `1px solid ${rgba("#22C55E", 0.3)}`, padding: 24 }}>
          <div style={{ ...TYPE.mono, color: "#22C55E", fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>odds board</div>
          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            {(metricItems.length ? metricItems : [{ label: "Brazil", detail: "+120" }, { label: "Edge", detail: "4.8%" }, { label: "Model", detail: "live" }, { label: "Stake", detail: "$25" }]).slice(0, 6).map((m, i) => <div key={i} style={{ borderRadius: 16, padding: "15px 18px", background: rgba(i === 0 ? ACCENT : "#22C55E", i === 0 ? 0.16 : 0.08), border: `1px solid ${rgba(i === 0 ? ACCENT : "#22C55E", 0.22)}`, display: "flex", justifyContent: "space-between", opacity: revealFor(m.atMs, i) }}>
              <span style={{ ...TYPE.headline, color: LIGHT, fontSize: 26 }}>{m.label}</span>
              <span style={{ ...TYPE.mono, color: i === 0 ? ACCENT : "#22C55E", fontSize: 20 }}>{m.detail ?? "live"}</span>
            </div>)}
          </div>
        </div>
        <div style={{ borderRadius: 42, background: "#05070B", border: `2px solid ${rgba(LIGHT, 0.16)}`, padding: 18, boxShadow: `0 34px 100px ${rgba(ACCENT, 0.22)}` }}>
          <div style={{ height: 28, display: "grid", placeItems: "center" }}><div style={{ width: 88, height: 9, borderRadius: 999, background: "#171C2B" }} /></div>
          <div style={{ height: 620, borderRadius: 30, background: "#0B1118", padding: 22 }}>
            <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 15, fontWeight: 900 }}>EDGE</div>
            <div style={{ ...TYPE.display, color: LIGHT, fontSize: 86, lineHeight: 0.9, marginTop: 42 }}>{props.headline ?? "EDGE"}</div>
            <div style={{ position: "absolute", left: 48, right: 48, bottom: 46, height: 52, borderRadius: 999, background: ACCENT, color: "#121212", display: "grid", placeItems: "center", ...TYPE.mono, fontSize: 18, fontWeight: 900 }}>PLACE BET</div>
          </div>
        </div>
      </div>
    )}
  />
);

// --- Selected-target literal-fidelity additions (2026-07-27) -------------------------------
// Every one of the 7 selected ref4 targets is a real person talking to camera. Per
// AGENTS.md/packs/STATUS.md's privacy rule and the precedent set by UI Mate/Fly Motion's
// passes, none of these components render a real person's face/likeness: portrait footage
// always goes through ClipSurface, which already falls back to PortraitPlaceholder (a
// generic silhouette, not a real photo) whenever a plan omits sourceClip.src — exactly the
// pack's existing media-slot mechanism, never a fabricated face. What IS reproduced
// literally is the surrounding real visual grammar each source actually shows: caption
// style/timing, app/terminal/modal UI chrome, PIP framing, floating UI callouts.

type CaptionWord = { text: string; atMs: number; endMs: number };

// Real-word-onset caption overlay — every one of the 7 ref4 sources burns in a bold,
// black-stroked, white-fill 1-3 word caption timed to speech (see
// research/talking-head-recreation-notes.md). Chunks a real transcript word list and shows
// exactly one chunk at a time, each word popping in on its own real onset.
export const TalkingHeadCaption: React.FC<{ sceneStartMs: number; words?: CaptionWord[]; position?: "mid" | "low"; chunk?: number; fontSize?: number }> = ({
  sceneStartMs,
  words = [],
  position = "low",
  chunk = 2,
  fontSize = 54,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  if (!words.length) return null;
  const nowMs = sceneStartMs + (frame * 1000) / fps;
  const groups: CaptionWord[][] = [];
  for (let i = 0; i < words.length; i += chunk) groups.push(words.slice(i, i + chunk));
  const active = groups.find((g) => nowMs >= g[0].atMs && nowMs < (g[g.length - 1].endMs ?? g[g.length - 1].atMs + 400));
  if (!active) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top: position === "mid" ? "44%" : undefined,
        bottom: position === "low" ? 92 : undefined,
        transform: position === "mid" ? "translateY(-50%)" : undefined,
        textAlign: "center",
        zIndex: 5,
      }}
    >
      <div style={{ ...TYPE.headline, display: "inline-flex", gap: 10, flexWrap: "wrap", justifyContent: "center", fontSize, lineHeight: 1.05, color: LIGHT, WebkitTextStroke: `2px ${DARK}`, textShadow: `0 5px 0 ${rgba(DARK, 0.85)}` }}>
        {active.map((w, i) => {
          const wordFrame = Math.round(((w.atMs - sceneStartMs) * fps) / 1000);
          const s = spring({ frame: frame - wordFrame, fps, config: SPRING.settle, durationInFrames: 8 });
          return (
            <span key={`${w.text}-${i}`} style={{ display: "inline-block", transform: `scale(${0.82 + s * 0.18})`, opacity: Math.min(1, s + 0.4) }}>
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// Target: build-mobile-app-claude-code. Real source shows a literal iPhone frame (status
// bar, notch, app UI) hovering above a bottom-anchored PIP with a rounded-top "hood" — the
// one target of the 7 where real iOS chrome is actually applicable (see pack-status notes).
export const TalkingHeadPhoneMockStage: React.FC<
  MsProps & {
    sourceClip?: ClipLike;
    editDecision?: DecisionLike;
    appName?: string;
    headerLine?: string;
    stat?: { value: string; label: string };
    rows?: BeatItem[];
    caption?: string;
    atMs?: number;
  }
> = ({ sourceClip, editDecision, appName = "App", headerLine = "Good morning", stat, rows = [], caption = "build", atMs, sceneStartMs }) => {
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 70,
          width: 470,
          height: 640,
          marginLeft: -235,
          borderRadius: 58,
          background: DARK,
          padding: 14,
          transform: `scale(${0.92 + p * 0.08}) translateY(${(1 - p) * -24}px)`,
          boxShadow: `0 40px 90px ${rgba(DARK, 0.28)}`,
        }}
      >
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 44, overflow: "hidden", background: LIGHT }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 26px 6px" }}>
            <div style={{ ...TYPE.mono, fontSize: 15, fontWeight: 800, color: DARK }}>9:41</div>
            <div style={{ display: "flex", gap: 5, alignItems: "flex-end" }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ width: 4, height: 6 + i * 3, borderRadius: 1, background: DARK }} />
              ))}
              <div style={{ width: 22, height: 11, borderRadius: 3, border: `1.5px solid ${DARK}`, marginLeft: 4, position: "relative" }}>
                <div style={{ position: "absolute", top: 2, bottom: 2, left: 2, right: 4, background: DARK, borderRadius: 1 }} />
              </div>
            </div>
          </div>
          <div style={{ position: "absolute", left: "50%", top: 0, width: 150, height: 26, marginLeft: -75, borderRadius: "0 0 18px 18px", background: DARK }} />
          <div style={{ padding: "18px 26px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 10, background: COLOR.accent }} />
              <div style={{ ...TYPE.mono, fontSize: 16, fontWeight: 900, color: COLOR.accent, textTransform: "uppercase", letterSpacing: 1 }}>{appName}</div>
            </div>
            <div style={{ ...TYPE.headline, fontSize: 26, color: DARK, marginTop: 10 }}>{headerLine}</div>
            {stat ? (
              <div style={{ marginTop: 18, borderRadius: 26, background: rgba(DARK, 0.05), padding: 20, display: "flex", alignItems: "center", gap: 20 }}>
                <div
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 96,
                    border: `10px solid ${rgba(COLOR.accent, 0.24)}`,
                    borderTopColor: COLOR.accent,
                    borderRightColor: COLOR.accent,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <div style={{ ...TYPE.headline, fontSize: 20, color: DARK }}>{stat.value}</div>
                </div>
                <div style={{ ...TYPE.mono, fontSize: 13, color: COLOR.muted, textTransform: "uppercase", letterSpacing: 1 }}>{stat.label}</div>
              </div>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(rows.length, 1)}, 1fr)`, gap: 10, marginTop: 16 }}>
              {rows.map((row, i) => (
                <div key={`${row.label}-${i}`} style={{ borderRadius: 18, background: rgba(DARK, 0.05), padding: "12px 10px" }}>
                  <div style={{ ...TYPE.mono, fontSize: 11, color: COLOR.muted, textTransform: "uppercase" }}>{row.label}</div>
                  <div style={{ ...TYPE.headline, fontSize: 17, color: DARK, marginTop: 4 }}>{row.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 78, right: 78, top: 760, textAlign: "center", ...TYPE.display, fontSize: 60, color: DARK }}>{caption}</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 600, borderRadius: "120px 120px 0 0", overflow: "hidden", boxShadow: `0 -20px 60px ${rgba(DARK, 0.22)}` }}>
        <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      </div>
    </AbsoluteFill>
  );
};

// Target: plugin-resource-cta. Real source: light dotted-grid backdrop, a mixed-weight/
// mixed-style headline (serif italic word mixed with bold sans), an app-icon hero inside a
// radial burst, a short caption line, then a bottom PIP clip.
export const TalkingHeadAppHeroReveal: React.FC<
  MsProps & {
    sourceClip?: ClipLike;
    editDecision?: DecisionLike;
    titleLines?: { text: string; italic?: boolean; accent?: boolean }[][];
    icon?: string;
    caption?: string;
    atMs?: number;
  }
> = ({ sourceClip, editDecision, titleLines = [], icon = "◎", caption = "how to", atMs, sceneStartMs }) => {
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: `linear-gradient(${rgba(DARK, 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(DARK, 0.05)} 1px, transparent 1px)`, backgroundSize: "40px 40px" }} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 110, textAlign: "center" }}>
        {titleLines.map((line, li) => (
          <div key={li} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
            {line.map((tok, ti) => (
              <span key={ti} style={{ ...TYPE.display, fontSize: 54, lineHeight: 1.05, fontStyle: tok.italic ? "italic" : "normal", color: tok.accent ? COLOR.alert : DARK }}>
                {tok.text}
              </span>
            ))}
          </div>
        ))}
        <div style={{ width: 130, height: 3, background: COLOR.alert, margin: "14px auto 0" }} />
      </div>
      <div style={{ position: "absolute", left: "50%", top: 430, width: 260, height: 260, marginLeft: -130, transform: `scale(${0.85 + p * 0.15}) rotate(${(1 - p) * -20}deg)` }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 22,
              height: 96,
              marginLeft: -11,
              marginTop: -160,
              borderRadius: 20,
              background: rgba(COLOR.accent, 0.28),
              transformOrigin: "50% 160px",
              transform: `rotate(${i * 36}deg)`,
            }}
          />
        ))}
        <div style={{ position: "absolute", inset: 46, borderRadius: 40, background: COLOR.accent, display: "grid", placeItems: "center", boxShadow: glow(COLOR.accent, 0.3) }}>
          <div style={{ ...TYPE.display, fontSize: 64, color: LIGHT }}>{icon}</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 820, textAlign: "center", ...TYPE.headline, fontSize: 40, color: DARK }}>{caption}</div>
      <div style={{ position: "absolute", left: 40, right: 40, bottom: 0, height: 560, borderRadius: "80px 80px 0 0", overflow: "hidden", boxShadow: `0 -16px 50px ${rgba(DARK, 0.2)}` }}>
        <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      </div>
    </AbsoluteFill>
  );
};

// Target: alternate-overlay-format. Real source: full-bleed video with a floating black
// pill "callout" button (checkbox + label + cursor) hovering above the speaker.
export const TalkingHeadPillButtonCallout: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; label?: string; atMs?: number; cursor?: boolean }
> = ({ sourceClip, editDecision, label = "Testing editors", atMs, cursor = true, sceneStartMs }) => {
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 210,
          transform: `translateX(-50%) translateY(${(1 - p) * -20}px) scale(${0.9 + p * 0.1})`,
          opacity: p,
          display: "flex",
          alignItems: "center",
          gap: 14,
          borderRadius: 999,
          padding: "20px 30px",
          background: DARK,
          border: `1px solid ${rgba(LIGHT, 0.16)}`,
          boxShadow: `0 20px 50px ${rgba(DARK, 0.5)}`,
        }}
      >
        <div style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${LIGHT}` }} />
        <div style={{ ...TYPE.headline, fontSize: 30, color: LIGHT }}>{label}</div>
        {cursor ? <div style={{ ...TYPE.mono, fontSize: 22, color: LIGHT, marginLeft: 2 }}>☝</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// Target: ai-slop-comment-interaction. Real source: full-bleed video with a floating
// Instagram-style comment/reply card near the top.
export const TalkingHeadCommentCard: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; handle?: string; comment?: string; atMs?: number }
> = ({ sourceClip, editDecision, handle = "yourhandle", comment = "edit", atMs, sceneStartMs }) => {
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 180,
          transform: `translateY(${(1 - p) * -24}px)`,
          opacity: p,
          borderRadius: 26,
          background: LIGHT,
          padding: "18px 22px",
          boxShadow: `0 22px 60px ${rgba(DARK, 0.45)}`,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: 44, background: `linear-gradient(135deg, ${COLOR.accent}, ${COLOR.alert})`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TYPE.mono, fontSize: 34, fontWeight: 900, color: DARK }}>{handle}</div>
          <div style={{ ...TYPE.body, fontSize: 44, color: COLOR.muted, marginTop: 4 }}>{comment}</div>
          <div style={{ ...TYPE.mono, fontSize: 32, color: COLOR.faint, marginTop: 8, fontWeight: 800 }}>Reply</div>
        </div>
        <div style={{ ...TYPE.display, fontSize: 46, color: COLOR.alert }}>♡</div>
      </div>
    </AbsoluteFill>
  );
};

// Target: 1000-nanobanana-prompts-library. Real source: a red-themed app UI with a filter
// panel of pill-shaped subject/style tag buttons.
export const TalkingHeadFilterAppCard: React.FC<
  MsProps & {
    title?: string;
    badge?: string;
    tags?: string[];
    /** Optional per-tag reveal beat, parallel array to `tags` (each entry `{atMs}`, matching
     *  every other array-of-beats shape this manifest's mineArrays scan already knows how to
     *  read — see lint.mjs's COMPONENT_MANIFEST) — when provided for a given index, that tag
     *  reveals on its own real word onset instead of the default fixed `i*3`-frame
     *  auto-stagger (all tags landing within ~0.3s of `atMs`, which reads fine for a short
     *  hold but left nothing else happening for the rest of a long scene when the VO's own
     *  mentions of each tag are spread across several real seconds). Falls back to the
     *  auto-stagger for any index without an entry, so existing plans are unaffected. */
    tagAtMs?: ({ atMs?: number } | undefined)[];
    highlightTag?: string;
    /** Optional line under the title/badge row, own delayed reveal (subtitleAtMs) — for a
     *  VO clause that names no real filter-tag category (so it can't become a `tags[]`
     *  entry without inventing a fake filter that isn't in the real app being recreated). */
    subtitle?: string;
    subtitleAtMs?: number;
    atMs?: number;
  }
> = ({ title = "Fresh Prompts", badge = "393", tags = [], tagAtMs = [], highlightTag, subtitle, subtitleAtMs, atMs, sceneStartMs }) => {
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const sp = spring({ frame: frame - localFrame(subtitleAtMs ?? atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: COLOR.alert, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 160,
          bottom: 260,
          borderRadius: 30,
          background: rgba(LIGHT, 0.95),
          border: `2px solid ${DARK}`,
          boxShadow: `0 30px 80px ${rgba(DARK, 0.4)}`,
          overflow: "hidden",
          transform: `scale(${0.94 + p * 0.06}) translateY(${(1 - p) * 20}px)`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 26px 10px" }}>
          <div style={{ ...TYPE.headline, fontSize: 48, color: DARK, fontWeight: 900 }}>{title}</div>
          <div style={{ ...TYPE.mono, fontSize: 28, fontWeight: 900, padding: "8px 16px", borderRadius: 12, border: `2px solid ${DARK}`, background: rgba(COLOR.payoff, 0.5) }}>{badge}</div>
        </div>
        {subtitle && (
          <div style={{ padding: "0 26px 10px", ...TYPE.body, fontSize: 28, color: rgba(DARK, 0.6), opacity: sp, transform: `translateY(${(1 - sp) * 10}px)` }}>{subtitle}</div>
        )}
        <div style={{ padding: "6px 26px", display: "flex", flexWrap: "wrap", gap: 10 }}>
          {tags.map((tag, i) => {
            const base = localFrame(atMs, sceneStartMs, fps);
            const override = tagAtMs[i]?.atMs;
            const start = typeof override === "number" ? localFrame(override, sceneStartMs, fps) : base + i * 3;
            const t = interpolate(frame, [start, start + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const active = tag === highlightTag;
            return (
              <div key={tag} style={{ ...TYPE.mono, fontSize: 26, fontWeight: 800, padding: "12px 18px", borderRadius: 14, border: `2px solid ${DARK}`, background: active ? DARK : "transparent", color: active ? LIGHT : DARK, opacity: t }}>
                {tag}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Target: retriever-ai-subroutines-free. Real source cycles through several dark tool-UI
// moments; the most ownable/distinctive is a function-execute modal (name, description,
// argument fields, Close/Execute buttons).
export const TalkingHeadFunctionModalCard: React.FC<
  MsProps & { funcName?: string; description?: string; fields?: BeatItem[]; atMs?: number }
> = ({ funcName = "executeTask", description = "Runs the configured task.", fields = [], atMs, sceneStartMs }) => {
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: COLOR.alert, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 44, right: 44, top: 240, borderRadius: 34, background: LIGHT, padding: 38, boxShadow: `0 30px 80px ${rgba(DARK, 0.4)}`, transform: `scale(${0.92 + p * 0.08})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 54, height: 54, borderRadius: 14, background: rgba(COLOR.accent, 0.18), display: "grid", placeItems: "center", color: COLOR.accent, ...TYPE.mono, fontSize: 28, fontWeight: 900 }}>▶</div>
          <div style={{ ...TYPE.headline, fontSize: 46, color: DARK }}>Execute {funcName}</div>
        </div>
        <div style={{ ...TYPE.body, fontSize: 34, color: COLOR.muted, marginTop: 14 }}>{description}</div>
        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          {fields.map((f) => (
            <div key={f.label}>
              <div style={{ ...TYPE.mono, fontSize: 28, fontWeight: 800, color: DARK }}>{f.label}</div>
              <div style={{ marginTop: 8, borderRadius: 12, border: `1px solid ${rgba(DARK, 0.2)}`, padding: "14px 16px", ...TYPE.body, fontSize: 30, color: COLOR.muted }}>{f.detail}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 22 }}>
          <div style={{ ...TYPE.mono, fontSize: 30, fontWeight: 800, color: COLOR.muted, padding: "12px 20px" }}>Close</div>
          <div style={{ ...TYPE.mono, fontSize: 30, fontWeight: 900, color: LIGHT, background: COLOR.accent, borderRadius: 12, padding: "12px 22px" }}>Execute</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Target: ai-slop-comment — "captions, cuts, motion graphics" feature checklist.
// Animated checklist of 3-4 features, each appearing with stagger timing.
// Uses ClipSurface for face portrait.
export const TalkingHeadFeatureChecklist: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; headline?: string; items?: BeatItem[]; atMs?: number }
> = ({ sourceClip, editDecision, headline = "What it handles", items = [], atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${rgba(DARK, 0.12)}, transparent 30%, ${rgba(DARK, 0.82)})` }} />
      {/* Bug fix (2026-07-27 QA pass): was bottom: 140 — inside lint/lint.mjs's 220px
          CAPTION_BAND_PX caption-safe band, so the burned-in caption overlay occluded this
          block's detail text in a rendered still. 260 clears the band with margin. */}
      <div style={{ position: "absolute", left: 72, right: 72, bottom: 260, transform: `translateY(${(1 - p) * 36}px)`, opacity: p }}>
        <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 30, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{headline}</div>
        <div style={{ display: "grid", gap: 22, marginTop: 28 }}>
          {items.map((item, i) => {
            const t = interpolate(frame, [localFrame(item.atMs, sceneStartMs, fps), localFrame(item.atMs, sceneStartMs, fps) + STAGGER], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
            return (
              <div key={`${item.label}-${i}`} style={{ display: "grid", gridTemplateColumns: "42px 1fr", alignItems: "center", gap: 16, opacity: t, transform: `translateX(${(1 - t) * -24}px)` }}>
                <div style={{ width: 56, height: 56, borderRadius: 56, display: "grid", placeItems: "center", background: i === items.length - 1 ? COLOR.payoff : COLOR.accent, ...TYPE.mono, fontSize: 28, fontWeight: 900, color: LIGHT }}>✓</div>
                <div>
                  <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 44, lineHeight: 1.1 }}>{item.label}</div>
                  {item.detail && <div style={{ ...TYPE.body, color: COLOR.faint, fontSize: 34, marginTop: 5 }}>{item.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Target: ai-slop-comment — "purple, gradient, ugly stuff" slop example.
// A deliberately garish gradient card showing what NOT to do. The pack itself
// looks clean while showing the antipattern. Uses ClipSurface for face.
export const TalkingHeadGradientSwatchCard: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; headline?: string; slopLabels?: string[]; atMs?: number }
> = ({ sourceClip, editDecision, headline = "This is AI slop", slopLabels = ["Purple", "Gradient", "Ugly"], atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  // Deliberately ugly gradient — the point is showing what bad AI design looks like
  const garishGrad = `linear-gradient(135deg, #9b59b6, #8e44ad, #c0392b, #e74c3c, #2c3e50)`;
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      <div style={{ position: "absolute", inset: 0, background: rgba(DARK, 0.7) }} />
      <div style={{ position: "absolute", left: 80, right: 80, top: "50%", transform: `translateY(-50%) scale(${0.88 + p * 0.12})`, opacity: p }}>
        <div style={{ borderRadius: 30, overflow: "hidden", background: garishGrad, padding: 40, boxShadow: `0 32px 80px ${rgba(DARK, 0.5)}` }}>
          <div style={{ ...TYPE.display, color: "#fff", fontSize: 52, lineHeight: 0.95, textShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>{headline}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
            {slopLabels.map((label, i) => {
              const t = interpolate(frame, [localFrame(atMs, sceneStartMs, fps) + i * 6, localFrame(atMs, sceneStartMs, fps) + i * 6 + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              return (
                <div key={label} style={{ ...TYPE.mono, fontSize: 16, fontWeight: 900, padding: "10px 16px", borderRadius: 999, background: "rgba(255,255,255,0.22)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)", opacity: t, transform: `scale(${0.85 + t * 0.15})` }}>
                  {label}
                </div>
              );
            })}
          </div>
          <div style={{ ...TYPE.body, color: "rgba(255,255,255,0.6)", fontSize: 18, marginTop: 20, fontStyle: "italic" }}>Don't let your content look like this.</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Target: alternate-overlay — "new content series" announce card.
// A series announce card with series title, episode number, and episode name.
// Uses ClipSurface for face.
export const TalkingHeadSeriesCard: React.FC<
  MsProps & {
    sourceClip?: ClipLike;
    editDecision?: DecisionLike;
    seriesTitle?: string;
    episodeNumber?: string;
    episodeName?: string;
    /** Optional trailing line under episodeName with its own delayed reveal (noteAtMs) —
     *  this card's 3 lines all fade in together at scene start, so a scene long enough for
     *  the VO to add a further clause after the card's own text runs dry (e.g. "...which is
     *  a great starting point" after naming the pack) had nothing left to visualize. Because
     *  the block is bottom-anchored (bottom:260, no top), adding this line grows the block
     *  upward — the caption-safe bottom edge never moves, so no new collision risk. */
    note?: string;
    noteAtMs?: number;
    atMs?: number;
  }
> = ({ sourceClip, editDecision, seriesTitle = "Editor Styles", episodeNumber = "Day 1", episodeName = "The Breakdown", note, noteAtMs, atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const np = spring({ frame: frame - localFrame(noteAtMs ?? atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 20%, ${rgba(DARK, 0.85)})` }} />
      {/* Bug fix (2026-07-27 QA pass): was bottom: 160 — inside the 220px caption-safe band
          (lint/lint.mjs's CAPTION_BAND_PX). 260 clears it with margin. */}
      <div style={{ position: "absolute", left: 72, right: 72, bottom: 260, transform: `translateY(${(1 - p) * 30}px)`, opacity: p }}>
        <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 28, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{episodeNumber}</div>
        <div style={{ position: "relative", display: "inline-block", marginTop: 14 }}>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 74, lineHeight: 0.94, textShadow: `0 16px 40px ${rgba(DARK, 0.6)}` }}>{seriesTitle}</div>
        </div>
        <div style={{ ...TYPE.headline, color: COLOR.faint, fontSize: 44, marginTop: 18 }}>{episodeName}</div>
        {note && (
          <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 32, fontWeight: 800, marginTop: 16, opacity: np, transform: `translateY(${(1 - np) * 14}px)` }}>
            {note}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// Target: build-mobile-app — "here's the full process" step timeline.
// A horizontal step timeline showing 3-4 process steps, each with number,
// title, and brief description. Steps appear with stagger animation.
// Uses ClipSurface for face.
export const TalkingHeadStepTimeline: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; headline?: string; steps?: BeatItem[]; atMs?: number }
> = ({ sourceClip, editDecision, headline = "The process", steps = [], atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${rgba(DARK, 0.1)}, transparent 25%, ${rgba(DARK, 0.88)})` }} />
      {/* Bug fix (2026-07-27 QA pass): was bottom: 130 — well inside the 220px caption-safe
          band (lint/lint.mjs's CAPTION_BAND_PX); a rendered still showed the caption literally
          occluding step 2/3 detail text. 260 clears the band with margin. */}
      <div style={{ position: "absolute", left: 72, right: 72, bottom: 260, transform: `translateY(${(1 - p) * 34}px)`, opacity: p }}>
        <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 30, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{headline}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 22 }}>
          {steps.map((step, i) => {
            const t = interpolate(frame, [localFrame(step.atMs, sceneStartMs, fps), localFrame(step.atMs, sceneStartMs, fps) + STAGGER], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
            const isLast = i === steps.length - 1;
            return (
              <div key={`${step.label}-${i}`} style={{ flex: 1, opacity: t, transform: `translateY(${(1 - t) * 20}px)` }}>
                <div style={{ width: 58, height: 58, borderRadius: 58, display: "grid", placeItems: "center", background: isLast ? COLOR.payoff : COLOR.accent, ...TYPE.mono, fontSize: 28, fontWeight: 900, color: LIGHT, marginBottom: 14 }}>{i + 1}</div>
                <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 36, lineHeight: 1.1 }}>{step.label}</div>
                {step.detail && <div style={{ ...TYPE.body, color: COLOR.faint, fontSize: 28, marginTop: 6 }}>{step.detail}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Target: plugin-resource-cta — competitor monitoring visualization.
// A list of competitor entries with status indicators (like a live leaderboard). Renders as
// a full-screen data card (no face slot) — neither plan that uses this component passes
// sourceClip/editDecision, so both props are accepted (kept for a future caller that wants a
// face) but currently unused; corrected 2026-07-27 (previously claimed "Uses ClipSurface for
// face", which was never actually true — the component never rendered ClipSurface).
export const TalkingHeadCompetitorWatchCard: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; headline?: string; competitors?: BeatItem[]; atMs?: number }
> = ({ headline = "Competitor Watch", competitors = [], atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  // Bug fix (2026-07-27 QA pass): non-highlighted rows sit on COLOR.surface (this family's
  // dark charcoal panel), but used DARK text — dark-on-dark, confirmed invisible in a
  // rendered still ("Growth Lab"). Compute the row's text/badge color from COLOR.surface's
  // own luminance instead (see colorOnSurface above).
  const SURFACE_TEXT = colorOnSurface(COLOR.surface, DARK, LIGHT);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(DARK, 0.04)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(DARK, 0.04)} 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
      <AmbientDetailLayer light={DARK} accent={COLOR.accent} frame={frame} />
      <div style={{ position: "absolute", left: 78, right: 78, top: 140 }}>
        <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 30, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{headline}</div>
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 260, bottom: 220, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28, transform: `translateY(${(1 - p) * 30}px)`, opacity: p }}>
        {competitors.map((comp, i) => {
          const t = interpolate(frame, [localFrame(comp.atMs, sceneStartMs, fps), localFrame(comp.atMs, sceneStartMs, fps) + STAGGER], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
          const isHot = comp.detail === "hot" || comp.detail === "viral";
          return (
            <div key={`${comp.label}-${i}`} style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", alignItems: "center", gap: 24, borderRadius: 30, padding: "34px 34px", background: isHot ? rgba(COLOR.alert, 0.1) : COLOR.surface, border: isHot ? `1px solid ${rgba(COLOR.alert, 0.3)}` : `1px solid ${rgba(COLOR.line, 0.5)}`, opacity: t, transform: `translateX(${(1 - t) * -20}px)` }}>
              <div style={{ width: 74, height: 74, borderRadius: 74, display: "grid", placeItems: "center", background: isHot ? COLOR.alert : rgba(SURFACE_TEXT, 0.14), ...TYPE.mono, fontSize: 32, fontWeight: 900, color: isHot ? LIGHT : SURFACE_TEXT }}>{i + 1}</div>
              <div>
                <div style={{ ...TYPE.headline, fontSize: 56, color: isHot ? DARK : SURFACE_TEXT, lineHeight: 1.1 }}>{comp.label}</div>
              </div>
              <div style={{ ...TYPE.mono, fontSize: 28, fontWeight: 900, padding: "10px 18px", borderRadius: 999, background: isHot ? rgba(COLOR.alert, 0.18) : rgba(SURFACE_TEXT, 0.12), color: isHot ? COLOR.alert : COLOR.muted, letterSpacing: 1, textTransform: "uppercase" }}>
                {comp.detail ?? "watching"}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// TalkingHeadCompetitorWatchCard's vertical numbered list reads as "compare 2 things" via
// its hot/normal row contrast, but that's a stack, not a real split -- and this pack's other
// "split" components (TalkingHeadSplitOrb/Editor/Dashboard/etc., TalkingHeadProofSplit) each
// need a real sourceClip/media prop to render, so they can't hold a plain label pair. This
// is the true side-by-side split this pack was missing for generic A/B content.
export const TalkingHeadSplitCompareCard: React.FC<
  MsProps & { headline?: string; leftLabel?: string; leftDetail?: string; rightLabel?: string; rightDetail?: string; atMs?: number; secondaryAtMs?: number }
> = ({ headline, leftLabel = "OPTION A", leftDetail, rightLabel = "OPTION B", rightDetail, atMs, secondaryAtMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const rightP = spring({ frame: frame - localFrame(secondaryAtMs ?? atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const arrowP = interpolate(frame, [localFrame(secondaryAtMs ?? atMs, sceneStartMs, fps) - 6, localFrame(secondaryAtMs ?? atMs, sceneStartMs, fps) + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(DARK, 0.04)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(DARK, 0.04)} 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
      <AmbientDetailLayer light={DARK} accent={COLOR.accent} frame={frame} />
      {headline ? <div style={{ position: "absolute", left: 64, right: 64, top: 150, ...TYPE.display, color: DARK, fontSize: 78, lineHeight: 0.98 }}>{headline}</div> : null}
      <div style={{ position: "absolute", left: 64, right: 64, top: 400, bottom: 150, display: "flex", flexDirection: "column", justifyContent: "center", gap: 0 }}>
        <div style={{ borderRadius: 30, padding: 44, minHeight: 380, background: rgba(DARK, 0.05), border: `1px solid ${rgba(DARK, 0.14)}`, opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>
          <div style={{ ...TYPE.mono, color: COLOR.muted, fontSize: 32, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" }}>{leftLabel}</div>
          {leftDetail ? <div style={{ ...TYPE.headline, color: DARK, fontSize: 52, marginTop: 22, lineHeight: 1.15 }}>{leftDetail}</div> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0", opacity: arrowP }}>
          <div style={{ width: 4, height: 60, background: `linear-gradient(180deg, ${rgba(DARK, 0.3)}, ${COLOR.accent})`, transform: `scaleY(${arrowP})`, transformOrigin: "top" }} />
        </div>
        <div style={{ borderRadius: 30, padding: 44, minHeight: 380, background: rgba(COLOR.accent, 0.12), border: `1px solid ${rgba(COLOR.accent, 0.5)}`, opacity: 0.4 + rightP * 0.6, transform: `translateY(${(1 - rightP) * 24}px)`, boxShadow: glow(COLOR.accent, 0.1) }}>
          <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 32, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" }}>{rightLabel}</div>
          {rightDetail ? <div style={{ ...TYPE.headline, color: DARK, fontSize: 52, marginTop: 22, lineHeight: 1.15 }}>{rightDetail}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Target: retriever-subroutines — "0 tokens" / zero cost card.
// Prominently shows a large zero-cost figure with context line.
// Uses ClipSurface for face.
export const TalkingHeadZeroCostCard: React.FC<
  MsProps & { sourceClip?: ClipLike; editDecision?: DecisionLike; headline?: string; costLabel?: string; contextLine?: string; atMs?: number }
> = ({ sourceClip, editDecision, headline = "ZERO COST", costLabel = "0", contextLine = "No tokens. No inference. Just replay.", atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      <ClipSurface sourceClip={sourceClip} editDecision={editDecision} dark />
      <div style={{ position: "absolute", inset: 0, background: rgba(DARK, 0.72) }} />
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div style={{ transform: `scale(${0.85 + p * 0.15})`, opacity: p }}>
          <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 22, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{headline}</div>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 140, lineHeight: 0.9, marginTop: 20, textShadow: glow(COLOR.payoff, 0.3) }}>{costLabel}</div>
        <div style={{ ...TYPE.headline, color: COLOR.faint, fontSize: 44, marginTop: 24, maxWidth: 760 }}>{contextLine}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Target: top-5-claude-code-plugins — ranked plugin card.
// Shows position number (#1, #2, etc.), plugin name, and brief description. Renders as a
// full-screen data card (no face slot) — the one plan that uses this component never passes
// sourceClip/editDecision, so both props are accepted (kept for a future caller that wants a
// face) but currently unused; corrected 2026-07-27 (previously claimed "Uses ClipSurface for
// face", which was never actually true — the component never rendered ClipSurface).
export const TalkingHeadPluginRankCard: React.FC<
  MsProps & {
    sourceClip?: ClipLike;
    editDecision?: DecisionLike;
    headline?: string;
    plugins?: BeatItem[];
    /** Optional late-scene callout under the ranked cards (own delayed reveal via
     *  noteAtMs) — a scene showing exactly 2 ranked plugins can't take a 3rd `plugins[]`
     *  entry without corrupting the #1/#2 badge numbering, so a real trailing claim from
     *  the VO (e.g. an accuracy/quality caveat spoken after both names) gets this instead
     *  of a fake rank card. */
    note?: string;
    noteAtMs?: number;
    /** Optional supplied/generated image filling the large empty band this 2-card layout
     *  otherwise leaves between the plugins grid (ends ~y440) and the note (bottom:260,
     *  starts ~y1600) — same MediaSurface pattern as TalkingHeadToolProof. */
    media?: MediaLike;
    atMs?: number;
  }
> = ({ headline = "Top 5 Plugins", plugins = [], note, noteAtMs, media, atMs, sceneStartMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  // Bug fix (2026-07-27 QA pass): same COLOR.surface bug as CompetitorWatchCard above — see
  // colorOnSurface's comment. Non-top rows sit on COLOR.surface but used DARK text
  // (dark-on-dark, confirmed invisible in a rendered still — "Code Review").
  const SURFACE_TEXT = colorOnSurface(COLOR.surface, DARK, LIGHT);
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const np = spring({ frame: frame - localFrame(noteAtMs ?? atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const gridStyle: React.CSSProperties = media
    ? { position: "absolute", left: 60, right: 60, top: 205, display: "grid", gap: 16, transform: `translateY(${(1 - p) * 24}px)`, opacity: p }
    : { position: "absolute", left: 60, right: 60, top: 260, bottom: note ? 420 : 220, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28, transform: `translateY(${(1 - p) * 24}px)`, opacity: p };
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(DARK, 0.04)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(DARK, 0.04)} 1px, transparent 1px)`, backgroundSize: "44px 44px" }} />
      {!media && <AmbientDetailLayer light={DARK} accent={COLOR.accent} frame={frame} />}
      <div style={{ position: "absolute", left: 78, right: 78, top: 130 }}>
        <div style={{ ...TYPE.mono, color: COLOR.accent, fontSize: 30, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase" }}>{headline}</div>
      </div>
      <div style={gridStyle}>
        {plugins.map((plug, i) => {
          const t = interpolate(frame, [localFrame(plug.atMs, sceneStartMs, fps), localFrame(plug.atMs, sceneStartMs, fps) + STAGGER], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE.emphasized });
          const isTop = i === 0;
          return (
            <div key={`${plug.label}-${i}`} style={{ display: "grid", gridTemplateColumns: media ? "72px 1fr" : "88px 1fr", alignItems: "center", gap: media ? 20 : 26, borderRadius: 26, padding: media ? "20px 24px" : "32px 32px", background: isTop ? rgba(COLOR.payoff, 0.1) : COLOR.surface, border: isTop ? `2px solid ${rgba(COLOR.payoff, 0.4)}` : `1px solid ${rgba(COLOR.line, 0.6)}`, boxShadow: isTop ? `0 16px 48px ${rgba(DARK, 0.14)}` : `0 8px 32px ${rgba(DARK, 0.08)}`, opacity: t, transform: `translateX(${(1 - t) * -22}px)` }}>
              <div style={{ width: media ? 68 : 84, height: media ? 68 : 84, borderRadius: media ? 68 : 84, display: "grid", placeItems: "center", background: isTop ? COLOR.payoff : COLOR.accent, ...TYPE.display, fontSize: media ? 30 : 36, color: LIGHT }}>#{i + 1}</div>
              <div>
                <div style={{ ...TYPE.headline, fontSize: media ? 44 : 56, color: isTop ? DARK : SURFACE_TEXT, lineHeight: 1.1 }}>{plug.label}</div>
                {plug.detail && <div style={{ ...TYPE.body, color: COLOR.muted, fontSize: media ? 32 : 38, marginTop: 5 }}>{plug.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {media && (
        <div style={{ position: "absolute", left: 90, right: 90, top: 490, height: 980 }}>
          <MediaSurface media={media} fit="contain" />
        </div>
      )}
      {note && (
        <div style={{ position: "absolute", left: 60, right: 60, bottom: 260, textAlign: "center", ...TYPE.mono, color: COLOR.payoff, fontSize: 34, fontWeight: 900, letterSpacing: TYPE.kicker.letterSpacing, textTransform: "uppercase", opacity: np, transform: `translateY(${(1 - np) * 16}px)` }}>
          {note}
        </div>
      )}
    </AbsoluteFill>
  );
};

// Target: top-5-claude-code-plugins. Real source: a macOS-chrome terminal window running
// Claude Code, with a small pixel-art mascot glyph floating above it.
export const TalkingHeadTerminalCard: React.FC<
  MsProps & { title?: string; lines?: BeatItem[]; caption?: string; atMs?: number }
> = ({ title = "Claude Code", lines = [], caption = "IF YOU ARE NEW TO", atMs, sceneStartMs }) => {
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - localFrame(atMs, sceneStartMs, fps), fps, config: SPRING.settle, durationInFrames: DUR.reveal });
  const cursorOn = Math.floor(frame / 15) % 2 === 0;
  return (
    <AbsoluteFill style={{ background: LIGHT, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(DARK, 0.035)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(DARK, 0.035)} 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
      <AmbientDetailLayer light={DARK} accent={COLOR.accent} frame={frame} />
      <div style={{ position: "absolute", left: 54, right: 54, top: 80, textAlign: "center", ...TYPE.display, fontSize: 64, color: DARK, fontStyle: "italic" }}>{caption}</div>
      <div style={{ position: "absolute", left: "50%", top: 230, width: 112, height: 112, marginLeft: -56, borderRadius: 24, background: COLOR.accent, transform: `scale(${0.8 + p * 0.2})`, boxShadow: glow(COLOR.accent, 0.3) }} />
      <div style={{ position: "absolute", left: 42, right: 42, top: 400, bottom: 220, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            borderRadius: 18,
            overflow: "hidden",
            background: DARK,
            boxShadow: `0 30px 70px ${rgba(DARK, 0.4)}`,
            transform: `translateY(${(1 - p) * 20}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 26px", borderBottom: `1px solid ${rgba(LIGHT, 0.12)}` }}>
            {[COLOR.alert, COLOR.accent, COLOR.payoff].map((c, i) => (
              <div key={i} style={{ width: 14, height: 14, borderRadius: 14, background: c }} />
            ))}
            <div style={{ ...TYPE.mono, fontSize: 32, color: rgba(LIGHT, 0.72), marginLeft: 14 }}>{title}</div>
          </div>
          <div style={{ padding: "40px 32px 46px", display: "grid", gap: 30 }}>
            {lines.map((l, i) => {
              const base = localFrame(l.atMs, sceneStartMs, fps);
              const t = interpolate(frame, [base, base + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              return (
                <div key={i} style={{ ...TYPE.mono, fontSize: 46, lineHeight: 1.26, color: LIGHT, opacity: t }}>
                  {l.label}
                </div>
              );
            })}
            <div style={{ ...TYPE.mono, fontSize: 46, lineHeight: 1.26, color: LIGHT, opacity: lines.length ? interpolate(frame, [localFrame(lines[lines.length - 1]?.atMs, sceneStartMs, fps) + 10, localFrame(lines[lines.length - 1]?.atMs, sceneStartMs, fps) + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0 }}>
              <span style={{ color: rgba(LIGHT, 0.5) }}>$</span> <span style={{ opacity: cursorOn ? 1 : 0 }}>▍</span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
