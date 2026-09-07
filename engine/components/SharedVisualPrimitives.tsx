import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditDecision, SourceClip } from "../../schema/plan";
import { DUR, EASE, SPRING, useReduceMotion } from "../styles/motion";
import { glow, rgba } from "../styles/fx";
import { useReelTokens } from "../styles/tokens";
import { legibleAccent } from "../styles/contrast";

type MsProps = { sceneStartMs: number };
type BeatItem = { label: string; detail?: string; atMs?: number };
type ClipLike = Partial<SourceClip> & { src?: string };
type DecisionLike = Partial<EditDecision>;
// What PlanReel.tsx's resolveSceneProps actually produces from `mediaSlotId` (see its
// `plan.mediaSlots.find(...)` lookup) — a still image or video, as opposed to `sourceClip`,
// which is always a person/screen-recording CLIP with in/out points via `editDecision`.
type MediaLike = { src?: string; kind?: "image" | "video" | "screenshot" };

type SharedVisualProps = MsProps & {
  sourceClip?: ClipLike;
  editDecision?: DecisionLike;
  media?: MediaLike;
  layout?: "full" | "split-speaker";
  headline?: string;
  subline?: string;
  kicker?: string;
  accent?: string;
  labels?: string[];
  metrics?: BeatItem[];
  cards?: BeatItem[];
  items?: BeatItem[];
  atMs?: number;
};

const localFrame = (ms: number | undefined, sceneStartMs: number, fps: number) =>
  ms === undefined ? 0 : Math.round(((ms - sceneStartMs) * fps) / 1000);

const assetSrc = (src: string | undefined) => {
  if (!src) return undefined;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) return src;
  return staticFile(src);
};

const relLuma = (hex: string) => {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

const darkLight = (a: string, b: string) => (relLuma(a) <= relLuma(b) ? { dark: a, light: b } : { dark: b, light: a });

const MiniChrome: React.FC<{ color: string; label?: string }> = ({ color, label }) => (
  <div style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: `1px solid ${rgba("#ffffff", 0.08)}`, background: rgba("#ffffff", 0.035) }}>
    {["#FF5F57", "#FFBD2E", "#28C840"].map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: 999, background: c }} />)}
    <span style={{ marginLeft: 8, color: rgba("#ffffff", 0.5), fontFamily: "monospace", fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}>{label ?? "system"}</span>
    <span style={{ marginLeft: "auto", width: 12, height: 12, borderRadius: 999, background: color, boxShadow: glow(color, 0.18) }} />
  </div>
);

export const AmbientDetailLayer: React.FC<{ light: string; accent: string; frame: number; compact?: boolean }> = ({
  light,
  accent,
  frame,
  compact = false,
}) => {
  const marks = compact ? 16 : 26;
  return (
    <>
      {Array.from({ length: marks }, (_, i) => {
        const x = (73 + i * 197) % 1040;
        const y = (91 + i * 143) % (compact ? 880 : 1780);
        const drift = Math.sin(frame / 38 + i * 1.7) * 8;
        const isAccent = i % 5 === 0;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y + drift,
              width: i % 3 === 0 ? 34 : 6,
              height: i % 3 === 0 ? 2 : 6,
              borderRadius: 999,
              background: isAccent ? rgba(accent, 0.34) : rgba(light, 0.12),
              transform: `rotate(${(i * 23) % 180}deg)`,
              boxShadow: isAccent ? glow(accent, 0.08) : undefined,
              opacity: 0.32 + (i % 4) * 0.08,
            }}
          />
        );
      })}
      {[
        { left: 62, top: compact ? 74 : 128, rotate: -12 },
        { right: 62, top: compact ? 92 : 170, rotate: 10 },
        { left: 76, bottom: compact ? 72 : 148, rotate: 8 },
        { right: 70, bottom: compact ? 82 : 160, rotate: -9 },
      ].map(({ rotate, ...pos }, i) => (
        <span
          key={`corner-${i}`}
          style={{
            position: "absolute",
            ...pos,
            width: 72,
            height: 72,
            border: `1px solid ${rgba(i % 2 === 0 ? accent : light, 0.16)}`,
            borderRadius: 22,
            transform: `rotate(${rotate}deg)`,
            background: `linear-gradient(135deg, ${rgba(accent, 0.07)}, transparent)`,
          }}
        />
      ))}
    </>
  );
};

const SharedVisualShell: React.FC<
  SharedVisualProps & {
    renderVisual: (ctx: {
      COLOR: ReturnType<typeof useReelTokens>["COLOR"];
      TYPE: ReturnType<typeof useReelTokens>["TYPE"];
      DARK: string;
      LIGHT: string;
      ACCENT: string;
      frame: number;
      fps: number;
      p: number;
      revealFor: (itemAtMs: number | undefined, i: number) => number;
      ghostFor: (itemAtMs: number | undefined, i: number) => number;
      metricItems: BeatItem[];
      cardItems: BeatItem[];
      labelItems: string[];
      src?: string;
      isImage: boolean;
      startFrom: number;
      endAt?: number;
    }) => React.ReactNode;
  }
> = ({
  sourceClip,
  editDecision,
  media,
  layout = "full",
  headline,
  subline,
  kicker,
  accent,
  labels = [],
  metrics = [],
  cards = [],
  items = [],
  atMs,
  sceneStartMs,
  renderVisual,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { COLOR, TYPE } = useReelTokens();
  const reduceMotion = useReduceMotion();
  const ambientFrame = reduceMotion ? 0 : frame;
  const { dark: DARK, light: LIGHT } = darkLight(COLOR.ink, COLOR.paper);
  // The pack's accent, made legible on THIS shell's substrate. DARK/LIGHT above already go
  // through darkLight() to survive the ink/paper inversion; ACCENT had no equivalent guard and
  // was used raw. That breaks any pack whose accent was designed against a light page: Fun
  // Money's accent is #111111, correct as "maximum contrast" on its own white ground and
  // scoring 1.04:1 — invisible — on this shell's dark one. ApprovalShield's kicker, pane
  // border and shield glyph all disappeared in Fun Money's sales demo. Measured against the
  // dark ground, funMoney (1.04), groveCool (1.61), grove (2.31) and paper (2.98) all fall
  // under the 3:1 WCAG floor for graphical objects. legibleAccent lightens within the same
  // hue rather than substituting a token, so Grove stays green; packs already above the floor
  // are returned untouched.
  const ACCENT = legibleAccent(accent ?? COLOR.accent, DARK);
  // `sourceClip` (a person/screen-recording CLIP) wins when both are set — a scene rarely
  // wants both, and a clip is the richer asset. `media` (from mediaSlotId, see MediaLike
  // above) is the fallback: a still image or a video with no in/out trim. Every render site
  // below must branch on `isImage` — a bare <OffthreadVideo src="...png"> renders nothing,
  // which is exactly the bug this fixes (see the 2026-08-03 commit that added this prop:
  // mediaSlotId resolved correctly in PlanReel.tsx, but nothing in this file ever imported
  // Img or read the resolved value, so every image-kind mediaSlot rendered as if empty).
  // Substrate-safe palette for every shared primitive. Guarding only ACCENT was not enough:
  // `payoff` is a mark colour too, and four families put it under the 3:1 floor on this dark
  // ground (funMoney #111111 at 1.04, groveCool 1.82, flyMotionViolet 1.95, grove 2.49). That
  // bit immediately — replacing ApprovalShield's hardcoded #16A34A with COLOR.payoff was the
  // right call for tokenisation and made the dot INVISIBLE for Fun Money in the same edit.
  // Deriving the palette once here means a primitive can read COLOR.accent/COLOR.payoff
  // normally and still be legible on the substrate the shell imposes.
  const SHELL_COLOR = { ...COLOR, accent: ACCENT, payoff: legibleAccent(COLOR.payoff, DARK) };
  const src = assetSrc(sourceClip?.src ?? media?.src);
  const isImage = !sourceClip?.src && media?.kind === "image";
  const startMs = editDecision?.inMs ?? 0;
  const endMs = editDecision?.outMs;
  const startFrom = Math.max(0, Math.round((startMs * fps) / 1000));
  const endAt = endMs === undefined ? undefined : Math.max(startFrom + 1, Math.round((endMs * fps) / 1000));
  const p = spring({
    frame: frame - localFrame(atMs, sceneStartMs, fps),
    fps,
    config: reduceMotion ? SPRING.firm : SPRING.settle,
    durationInFrames: reduceMotion ? DUR.minor : DUR.reveal,
  });
  const revealStagger = reduceMotion ? 1 : 4;
  const revealSpan = reduceMotion ? 4 : 12;
  const revealFor = (itemAtMs: number | undefined, i: number) =>
    interpolate(
      frame,
      [
        localFrame(itemAtMs ?? atMs, sceneStartMs, fps) + i * revealStagger,
        localFrame(itemAtMs ?? atMs, sceneStartMs, fps) + i * revealStagger + revealSpan,
      ],
      [0, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: EASE.emphasized,
      },
    );
  // Ghost reveal (2026-08-03 layout pass). Item lists used to jump 0 -> 1 opacity exactly on
  // their own word-locked beat, which meant every panel opened EMPTY and filled in over the
  // scene — on a 7s scene with 3 staggered items, the first ~2s rendered a large container
  // holding one item and a lot of dead space. That reads as "unfinished layout", and was the
  // single biggest source of the empty-space problem in split-speaker scenes.
  //
  // Instead an item now holds its slot from frame one at a low ghost opacity and lights up on
  // its beat. Composition is stable and full for the whole scene, the beat still lands (0.16
  // -> 1 is a strong, legible pop), and word-locking is untouched — only the resting state of
  // a not-yet-revealed item changed. Used for item CONTAINERS; per-item text/accent colour
  // still keys off revealFor where a component wants a harder switch.
  const ghostFor = (itemAtMs: number | undefined, i: number) => 0.16 + revealFor(itemAtMs, i) * 0.84;
  const metricItems = metrics.length ? metrics : (items.length ? items : labels.map((label, i) => ({ label, detail: i === 0 ? kicker : subline })));
  const cardItems = cards.length ? cards : (items.length ? items : labels.map((label, i) => ({ label, detail: `beat ${i + 1}` })));

  const visual = renderVisual({ COLOR: SHELL_COLOR, TYPE, DARK, LIGHT, ACCENT, frame, fps, p, revealFor, ghostFor, metricItems, cardItems, labelItems: labels, src, isImage, startFrom, endAt });

  if (layout !== "split-speaker") {
    return (
      <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 36%, ${rgba(ACCENT, 0.2)}, transparent 43%), linear-gradient(180deg, ${rgba(COLOR.surface, 0.65)}, ${DARK})` }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(LIGHT, 0.028)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(LIGHT, 0.022)} 1px, transparent 1px)`, backgroundSize: "44px 44px" }} />
        <AmbientDetailLayer light={LIGHT} accent={ACCENT} frame={ambientFrame} />
        {visual}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ background: DARK, overflow: "hidden" }}>
      {/* Halves are 50% of the canvas, not a baked 960. Two fixed 960 halves only sum to the
          frame in 1080x1920 portrait; on a 1920x1080 landscape canvas they would overlap by
          840px and the lower pane would eat the upper one. No landscape plan uses
          split-speaker today (all four are portrait Talking Head), so this was latent rather
          than shipping broken — but SaaS Motion is now landscape-primary and shares these
          shells, so a baked portrait dimension here is a trap waiting on one Director choice.
          The substrate is also tokenized to match the non-split branch above, which already
          did this correctly; the hardcoded #171229/#080711 was a cold PURPLE left behind by
          an earlier migration and it leaked into Talking Head, whose palette is warm paper on
          neutral charcoal (#17191D) with an orange accent. That one ships in the free starter. */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "50%", overflow: "hidden", background: `radial-gradient(circle at 50% 36%, ${rgba(ACCENT, 0.2)}, transparent 43%), linear-gradient(180deg, ${rgba(COLOR.surface, 0.65)}, ${DARK})` }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${rgba(LIGHT, 0.028)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(LIGHT, 0.022)} 1px, transparent 1px)`, backgroundSize: "44px 44px" }} />
        <AmbientDetailLayer light={LIGHT} accent={ACCENT} frame={ambientFrame} compact />
        {visual}
      </div>
      {/* The media is sized to the WHOLE canvas and offset up by one pane, so this lower pane
          windows its bottom half. In canvas-relative terms that is height 200% / top -100% of
          this 50% pane — identical arithmetic to the old 1920/-960 in portrait, and still
          correct at any aspect ratio. cover is right here (unlike the object panes in
          InboxTaskList/ApprovalShield): this is a full-bleed backdrop, not a presented object. */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50%", overflow: "hidden", background: DARK }}>
        {src && isImage ? (
          <Img src={src} style={{ position: "absolute", left: 0, top: "-100%", width: "100%", height: "200%", objectFit: "cover" }} />
        ) : src ? (
          <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ position: "absolute", left: 0, top: "-100%", width: "100%", height: "200%", objectFit: "cover" }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: rgba(LIGHT, 0.62), fontFamily: "monospace", fontSize: 28, letterSpacing: 2 }}>SOURCE CLIP</div>
        )}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: rgba(ACCENT, 0.8), boxShadow: glow(ACCENT, 0.2) }} />
      </div>
    </AbsoluteFill>
  );
};

export const VoiceOrb: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, frame, p, cardItems, revealFor, ghostFor }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "76px 80px 86px" : "150px 110px", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 32, transform: `translateY(${(1 - p) * 24}px)` }}>
        <div style={{ display: "grid", placeItems: "center", position: "relative" }}>
          <div style={{ position: "absolute", width: 390, height: 390, borderRadius: 999, background: `radial-gradient(circle, ${rgba(ACCENT, 0.92)}, ${rgba(ACCENT, 0.22)} 42%, transparent 70%)`, filter: "blur(1px)", transform: `scale(${0.95 + Math.sin(frame / 18) * 0.035})`, boxShadow: `0 0 90px ${rgba(ACCENT, 0.6)}` }} />
          <div style={{ position: "absolute", width: 515, height: 515, borderRadius: 999, border: `2px solid ${rgba(ACCENT, 0.24)}` }} />
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 74, letterSpacing: 9 }}>{props.headline ?? "VOICE"}</div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "center" }}>
          {cardItems.slice(0, 5).map((item, i) => (
            <div key={i} style={{ borderRadius: 20, padding: "18px 22px", background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.16 : 0.055), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.38 : 0.1)}`, opacity: ghostFor(item.atMs, i) }}>
              <div style={{ ...TYPE.mono, color: i === 0 ? ACCENT : rgba(LIGHT, 0.5), fontSize: 15, textTransform: "uppercase" }}>{item.detail ?? `input ${i + 1}`}</div>
              <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 31, marginTop: 6 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    )}
  />
);

export const WaveformPanel: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, frame, p, cardItems, revealFor, ghostFor }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "112px 110px 110px" : "230px 130px", display: "grid", gridTemplateColumns: "1fr 0.78fr", gap: 28, transform: `scale(${0.96 + p * 0.04})` }}>
        {/* Content-aware sizing: the body is a stretching grid (waveform block fixed, card
            list takes the remainder and distributes) so a 1-3 item list fills the panel
            instead of hugging the top and leaving a dead band below the waveform. */}
        <div style={{ borderRadius: 30, overflow: "hidden", background: "#0B0D16", border: `1px solid ${rgba(ACCENT, 0.32)}`, boxShadow: `0 30px 90px ${rgba(ACCENT, 0.18)}`, display: "grid", gridTemplateRows: "40px 1fr", minHeight: 0 }}>
          <MiniChrome color={ACCENT} label={props.kicker ?? "waveform"} />
          <div style={{ padding: 30, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 22, minHeight: 0 }}>
            <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 16, textTransform: "uppercase", letterSpacing: 2 }}>{props.subline ?? "audio signal"}</div>
            <div style={{ height: 148, borderRadius: 22, background: rgba(ACCENT, 0.13), border: `1px dashed ${rgba(ACCENT, 0.55)}`, display: "grid", placeItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, height: 96 }}>
                {Array.from({ length: 42 }, (_, i) => <div key={i} style={{ width: 5, height: 20 + Math.sin(frame / 8 + i * 0.7) * 22 + (i % 4) * 4, borderRadius: 999, background: i % 5 === 0 ? ACCENT : rgba(LIGHT, 0.55) }} />)}
              </div>
            </div>
            <div style={{ display: "grid", gap: 14, alignContent: "space-evenly", minHeight: 0 }}>
              {cardItems.slice(0, 3).map((item, i) => <div key={i} style={{ borderRadius: 16, padding: 16, background: rgba(LIGHT, 0.055), color: LIGHT, ...TYPE.mono, fontSize: 18, opacity: ghostFor(item.atMs, i) }}>{item.label}</div>)}
            </div>
          </div>
        </div>
        <div style={{ borderRadius: 28, background: `linear-gradient(180deg, ${rgba(ACCENT, 0.22)}, ${rgba(LIGHT, 0.05)})`, border: `1px solid ${rgba(LIGHT, 0.1)}`, padding: 26, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 82, lineHeight: 0.92 }}>{props.headline ?? "AUDIO"}</div>
          <div style={{ ...TYPE.body, color: rgba(LIGHT, 0.62), fontSize: 24, marginTop: 18 }}>{props.subline ?? "signal → insight"}</div>
        </div>
      </div>
    )}
  />
);

export const EditorTimelinePanel: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, src, isImage, startFrom, endAt, cardItems, revealFor, ghostFor, p }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "120px 108px 120px" : "185px 140px", borderRadius: 24, overflow: "hidden", background: "#080A12", border: `1px solid ${rgba(ACCENT, 0.38)}`, boxShadow: `0 34px 110px ${rgba(ACCENT, 0.2)}`, transform: `translateY(${(1 - p) * 26}px) scale(${0.965 + p * 0.035})` }}>
        <MiniChrome color={ACCENT} label={props.kicker ?? "motion editor"} />
        <div style={{ height: props.layout === "split-speaker" ? 438 : 610, padding: 18, display: "grid", gridTemplateRows: "1fr 132px", gap: 18 }}>
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
              {src && isImage ? (
                <Img src={src} style={{ width: "54%", height: "100%", objectFit: "cover", borderLeft: `1px solid ${rgba(LIGHT, 0.08)}`, borderRight: `1px solid ${rgba(LIGHT, 0.08)}` }} />
              ) : src ? (
                <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ width: "54%", height: "100%", objectFit: "cover", borderLeft: `1px solid ${rgba(LIGHT, 0.08)}`, borderRight: `1px solid ${rgba(LIGHT, 0.08)}` }} />
              ) : (
                <div style={{ width: "52%", height: "100%", background: `linear-gradient(180deg, ${rgba(ACCENT, 0.16)}, ${rgba(LIGHT, 0.05)})` }} />
              )}
              <div style={{ position: "absolute", left: 28, top: 24, right: 28, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.62), fontSize: 13, textTransform: "uppercase" }}>preview</div>
                <div style={{ width: 22, height: 22, borderRadius: 999, border: `1px solid ${rgba(ACCENT, 0.7)}` }} />
              </div>
              <div style={{ position: "absolute", left: "50%", bottom: 28, transform: "translateX(-50%)", borderRadius: 999, padding: "8px 14px", background: rgba("#000", 0.7), border: `1px solid ${rgba(ACCENT, 0.32)}`, ...TYPE.mono, color: LIGHT, fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>{props.headline ?? "Timeline cut"}</div>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {cardItems.slice(0, 4).map((c, i) => (
                <div key={i} style={{ borderRadius: 11, background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.14 : 0.045), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.24 : 0.07)}`, padding: 10, opacity: ghostFor(c.atMs, i) }}>
                  <div style={{ ...TYPE.mono, color: i === 0 ? ACCENT : rgba(LIGHT, 0.52), fontSize: 10, textTransform: "uppercase" }}>{c.detail ?? `task ${i + 1}`}</div>
                  <div style={{ ...TYPE.mono, color: LIGHT, fontSize: 13, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {[ACCENT, "#62D58B", "#FF5F57", "#5B6CFF"].map((c, i) => <div key={i} style={{ height: 18, width: `${95 - i * 10}%`, borderRadius: 999, background: c, marginLeft: i * 22, opacity: 0.9, boxShadow: i === 0 ? glow(ACCENT, 0.16) : undefined }} />)}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 6, marginTop: 8 }}>
              {Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ height: 28, borderRadius: 5, background: rgba(i % 4 === 0 ? ACCENT : LIGHT, i % 4 === 0 ? 0.5 : 0.095) }} />)}
            </div>
          </div>
        </div>
      </div>
    )}
  />
);

export const AdsDashboard: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, metricItems, cardItems, revealFor, ghostFor, src, isImage, startFrom, endAt }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "84px 66px 74px" : "135px 95px", display: "grid", gridTemplateRows: "90px 1fr", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>{props.kicker ?? "dashboard"}</div>
            <div style={{ ...TYPE.headline, color: LIGHT, fontSize: 48 }}>{props.headline ?? "Performance Dashboard"}</div>
          </div>
          <div style={{ borderRadius: 999, padding: "10px 16px", background: rgba(ACCENT, 0.16), color: ACCENT, ...TYPE.mono, fontSize: 16, fontWeight: 900 }}>LIVE</div>
        </div>
        {/* Content-aware sizing (2026-08-03 layout pass). This panel used to hardcode a
            4-column metric grid and a 5-row table regardless of how many items the plan
            actually supplied, and its inner blocks were top-aligned inside a stretching
            `1fr` row — so a scene passing 3 metrics + 3 cards rendered a large light panel
            with an empty 4th column and a big dead band underneath. Columns now follow the
            real item count and the lower block stretches to fill, so the panel reads as
            composed at any content length instead of only at exactly 4/5 items. */}
        <div style={{ borderRadius: 28, background: rgba("#F7F1EA", 0.94), padding: 26, color: "#111827", boxShadow: `0 35px 100px ${rgba(ACCENT, 0.18)}`, display: "grid", gridTemplateRows: "auto 1fr", gap: 20, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(4, metricItems.length || 4)}, 1fr)`, gap: 14 }}>
            {(metricItems.length ? metricItems : [{ label: "$14.2k", detail: "spend" }, { label: "2.8x", detail: "ROAS" }, { label: "$22", detail: "CPM" }, { label: "41%", detail: "hold" }]).slice(0, 4).map((m, i) => (
              <div key={i} style={{ borderRadius: 18, background: i === 0 ? rgba(ACCENT, 0.18) : "#FFFFFF", padding: 16, border: `1px solid ${rgba("#111827", 0.08)}`, opacity: ghostFor(m.atMs, i) }}>
                <div style={{ ...TYPE.headline, color: i === 0 ? ACCENT : "#111827", fontSize: 30 }}>{m.label}</div>
                <div style={{ ...TYPE.mono, color: "#6B7280", fontSize: 12, marginTop: 5, textTransform: "uppercase" }}>{m.detail ?? "metric"}</div>
              </div>
            ))}
          </div>
          {/* Empty-state fix (2026-09-02). The 2026-08-03 pass made this row content-aware
              for 3-of-4 items but never handled ZERO cards: `cardItems.slice(0, 5)` on an
              empty array rendered the white list panel with no rows at all, i.e. a large
              blank white rectangle taking 1.4fr of the panel. That shipped visibly in the
              SaaS Motion sales demo's "Dashboard reacts" scene, which passes metrics and no
              cards. With no cards the list panel is dropped entirely and the chart takes the
              full width, so the panel stays composed instead of half-empty. */}
          {/* Media support (2026-09-02). SharedVisualShell has always resolved mediaSlotId
              into `src` and handed it to renderVisual, but this shell never destructured it
              — so a plan setting mediaSlotId on MetricDashboard passed a prop that reached
              nothing on screen. Verified by rendering the same frame with and without the
              prop and getting byte-identical output. When a real screen IS supplied it
              becomes the lower panel: a product film should show the actual dashboard, not
              a synthetic bar chart beside it. */}
          {src ? (
            <div style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${rgba("#111827", 0.1)}`, minHeight: 0, background: "#0B1120" }}>
              {isImage ? (
                // objectPosition biases the crop downward: product screenshots are wide and
                // usually carry desk/background above the screen, which is what a plain
                // center crop shows in a tall portrait panel.
                <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 72%" }} />
              ) : (
                <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 72%" }} />
              )}
            </div>
          ) : (
          <div style={{ display: "grid", gridTemplateColumns: cardItems.length ? "1.4fr 0.8fr" : "1fr", gap: 18, minHeight: 0 }}>
            {cardItems.length ? (
            <div style={{ borderRadius: 20, background: "#FFFFFF", padding: "8px 20px", border: `1px solid ${rgba("#111827", 0.08)}`, display: "grid", alignContent: "space-evenly", minHeight: 0 }}>
              {cardItems.slice(0, 5).map((c, i, arr) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "13px 0", borderBottom: i < arr.length - 1 ? `1px solid ${rgba("#111827", 0.07)}` : undefined, opacity: ghostFor(c.atMs, i) }}>
                <div style={{ ...TYPE.mono, color: "#111827", fontSize: 17, fontWeight: 900 }}>{c.label}</div>
                <div style={{ color: ACCENT, ...TYPE.mono, fontSize: 15 }}>{c.detail ?? "active"}</div>
              </div>)}
            </div>
            ) : null}
            <div style={{ borderRadius: 20, background: `linear-gradient(180deg, ${rgba(ACCENT, 0.18)}, #fff)`, padding: 22, display: "grid", alignItems: "end", gridTemplateColumns: `repeat(${cardItems.length ? 5 : 9}, 1fr)`, gap: cardItems.length ? 8 : 14, minHeight: 0 }}>
              {(() => { const bars = cardItems.length ? 5 : 9; return Array.from({ length: bars }, (_, i) => <div key={i} style={{ height: `${26 + i * (60 / Math.max(1, bars - 1))}%`, borderRadius: "10px 10px 4px 4px", background: i >= bars - 2 ? ACCENT : "#111827" }} />); })()}
            </div>
          </div>
          )}
        </div>
      </div>
    )}
  />
);

export const ApprovalShield: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ COLOR, TYPE, LIGHT, ACCENT, cardItems, revealFor, ghostFor, p, src, isImage, startFrom, endAt }) => (
      // Full-frame portrait STACKS; only split-speaker stays two-up. Side by side, this beat
      // put a fixed 430px pane and its text in a 1500px box with alignItems:center, so ~1050px
      // of the frame was empty by construction — Fun Money's sales demo rendered its whole
      // comparison in a narrow mid-frame band with ~700px dead above and ~740px below. It is
      // also rule B4 in director/08-composition-rules.md: 1080 minus a real gutter leaves
      // ~840px, and split two ways each side gets ~350px, narrower than a phone. Stacking
      // gives the media full width and lets the text fill the remaining height.
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "110px 96px 96px" : "150px 110px", display: "grid", gridTemplateColumns: props.layout === "split-speaker" ? "0.82fr 1.18fr" : "1fr", gridTemplateRows: props.layout === "split-speaker" ? "1fr" : "minmax(0, 1fr) auto", gap: props.layout === "split-speaker" ? 34 : 44, alignItems: props.layout === "split-speaker" ? "center" : "stretch" }}>
        {/* Media support (2026-09-02). ComparisonBoard maps here, and this shell never read
            the resolved mediaSlotId — so a plan could not put a real screen on a comparison
            beat at all, which is exactly where Fun Money's sales demo has its largest asset
            gap. A supplied screen replaces the generic shield glyph; the glyph stays as the
            no-media fallback. */}
        {src ? (
          <div style={{ height: props.layout === "split-speaker" ? 430 : "100%", minHeight: 0, borderRadius: 34, overflow: "hidden", border: `1px solid ${rgba(ACCENT, 0.32)}`, transform: `scale(${0.9 + p * 0.1})` }}>
            {isImage ? (
              <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 18, boxSizing: "border-box" }} />
            ) : (
              <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            )}
          </div>
        ) : (
        <div style={{ height: props.layout === "split-speaker" ? 430 : "100%", minHeight: 0, borderRadius: 34, background: rgba(ACCENT, 0.12), border: `1px solid ${rgba(ACCENT, 0.32)}`, display: "grid", placeItems: "center", transform: `scale(${0.9 + p * 0.1})` }}>
          {/* The fallback glyph scales with its pane. Stacking made the pane ~2.5x taller, and a
              fixed 260x310 shield left a large tinted box with a small mark floating in it —
              the same dead-space defect the stack was fixing, just relocated. */}
          <svg width={props.layout === "split-speaker" ? 260 : 440} height={props.layout === "split-speaker" ? 310 : 524} viewBox="0 0 260 310"><path d="M130 14 236 54v78c0 72-38 124-106 164C62 256 24 204 24 132V54Z" fill={rgba(ACCENT, 0.18)} stroke={ACCENT} strokeWidth="8" /><path d="M76 150l34 36 78-88" fill="none" stroke={LIGHT} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        )}
        <div>
          <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>{props.kicker ?? "approval flow"}</div>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: 70, lineHeight: 0.94 }}>{props.headline ?? "approved data only"}</div>
          <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
            {cardItems.slice(0, 4).map((item, i) => <div key={i} style={{ borderRadius: 18, padding: "16px 18px", background: rgba(LIGHT, 0.06), border: `1px solid ${rgba(LIGHT, 0.1)}`, opacity: ghostFor(item.atMs, i), display: "flex", gap: 14, alignItems: "center" }}>
              {/* Uniform accent, not an alternation. The old `i % 2 ? payoff : accent` encoded index
                PARITY — which is to say nothing — and after the substrate guard it rendered Fun
                Money's rows red/grey/red, where the grey dot reads as "disabled" next to two live
                ones. A colour device that carries no meaning is noise; these rows are peers, so
                they get one marker. If a row ever needs to signal an outcome, that should come
                from the item's own data, not from whether its index happens to be even. */}
              <span style={{ width: 22, height: 22, borderRadius: 999, background: ACCENT }} /><span style={{ ...TYPE.headline, color: LIGHT, fontSize: 27 }}>{item.label}</span>
            </div>)}
          </div>
        </div>
      </div>
    )}
  />
);

export const InboxTaskList: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, src, isImage, cardItems, revealFor, ghostFor }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "92px 92px 86px" : "160px 120px", display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 28 }}>
        <div style={{ borderRadius: 30, overflow: "hidden", background: "#080A12", border: `1px solid ${rgba(ACCENT, 0.28)}` }}>
          <MiniChrome color={ACCENT} label={props.kicker ?? "task inbox"} />
          <div style={{ padding: 24, display: "grid", gap: 14, alignContent: "space-evenly", minHeight: 0, height: "100%" }}>{cardItems.slice(0, 6).map((item, i) => <div key={i} style={{ borderRadius: 18, padding: "17px 18px", background: i === 0 ? rgba(ACCENT, 0.17) : rgba(LIGHT, 0.055), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.34 : 0.08)}`, opacity: ghostFor(item.atMs, i) }}><div style={{ ...TYPE.mono, color: i === 0 ? ACCENT : rgba(LIGHT, 0.48), fontSize: 13, textTransform: "uppercase" }}>{item.detail ?? `task ${i + 1}`}</div><div style={{ ...TYPE.headline, color: LIGHT, fontSize: 29, marginTop: 5 }}>{item.label}</div></div>)}</div>
        </div>
        {/* The right panel is an abstract score dial by default. When a real asset is
            supplied (mediaSlotId -> media, isImage), it replaces the dial rather than
            competing with it — ProcessTimeline had no image path at all before this, and a
            fabricated score number is a worse use of the panel than a real supplied photo. */}
        {isImage && src ? (
          <div style={{ borderRadius: 32, overflow: "hidden", border: `1px solid ${rgba(ACCENT, 0.28)}`, position: "relative" }}>
            <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 18, boxSizing: "border-box" }} />
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 55%, ${rgba("#000", 0.55)})` }} />
          </div>
        ) : (
          <div style={{ borderRadius: 32, background: rgba(ACCENT, 0.12), border: `1px solid ${rgba(ACCENT, 0.28)}`, padding: 30, display: "grid", placeItems: "center", textAlign: "center" }}>
            <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.48), fontSize: 18, letterSpacing: 2, textTransform: "uppercase" }}>{props.subline ?? "score"}</div><div style={{ ...TYPE.display, color: LIGHT, fontSize: 118, lineHeight: 0.9 }}>{props.labels?.[0] ?? "82"}</div><div style={{ height: 12, width: "88%", borderRadius: 999, background: rgba(LIGHT, 0.12), overflow: "hidden" }}><div style={{ height: "100%", width: "82%", borderRadius: 999, background: ACCENT }} /></div>
          </div>
        )}
      </div>
    )}
  />
);

export const StoryboardGrid: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, src, isImage, startFrom, endAt, cardItems, revealFor, ghostFor }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "84px 74px 82px" : "145px 110px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {Array.from({ length: 6 }, (_, i) => {
          const item = cardItems[i] ?? { label: `memory ${i + 1}` };
          // A still image (mediaSlotId -> media, `isImage`) is ONE real object, not six
          // seconds of footage to scrub through — showing it once, large, in the hero cell
          // reads as "here is the thing" the way the original video-scrub treatment (repeat
          // across every even cell at a different startFrom) cannot for a static asset.
          const showImage = isImage && i === 0;
          const showVideo = !isImage && src && i % 2 === 0;
          // Scaffold vs. content (2026-09-02). This cell used to fade the WHOLE card by
          // ghostFor(), whose floor is 0.16 — on a near-black pack substrate (Fly Motion)
          // that renders a pre-reveal card as effectively invisible, so a 6-cell grid mid-
          // scene read as one lit cell and five holes rather than a grid filling in on beat.
          // The card frame is now always present and only its CONTENT animates, so the
          // composition is legible from frame 0 on light and dark substrates alike.
          const reveal = ghostFor(item.atMs, i);
          const hasOwnMedia = showImage || showVideo;
          return <div key={i} style={{ borderRadius: 24, overflow: "hidden", background: rgba(LIGHT, hasOwnMedia ? 0.06 : 0.085), border: `1px solid ${rgba(i % 3 === 0 ? ACCENT : LIGHT, i % 3 === 0 ? 0.35 : 0.16)}`, position: "relative" }}>
            {showImage ? <Img src={src!} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: reveal }} /> : null}
            {showVideo ? <OffthreadVideo src={src!} muted startFrom={startFrom + i * 8} endAt={endAt} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.72)", opacity: reveal }} /> : null}
            {/* Cells with no media of their own get a token-driven wash so they read as
                designed cards rather than empty holes. */}
            {!hasOwnMedia ? <div style={{ position: "absolute", inset: 0, background: `linear-gradient(155deg, ${rgba(i % 3 === 0 ? ACCENT : LIGHT, 0.1)}, ${rgba(LIGHT, 0.02)})` }} /> : null}
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${rgba("#000", 0.1)}, ${rgba("#000", 0.72)})` }} />
            <div style={{ position: "absolute", left: 18, right: 18, bottom: 18, opacity: reveal, transform: `translateY(${(1 - reveal) * 10}px)` }}><div style={{ ...TYPE.mono, color: ACCENT, fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>{item.detail ?? "captured"}</div><div style={{ ...TYPE.headline, color: LIGHT, fontSize: 26, marginTop: 4 }}>{item.label}</div></div>
          </div>;
        })}
      </div>
    )}
  />
);

export const BodyAnalyticsMap: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, frame, metricItems, revealFor, ghostFor }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "72px 74px 72px" : "135px 110px", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 34 }}>
        {/* Token leak fix (2026-09-02): this frame hardcoded sky-blue #0EA5E9/#38BDF8, so
            every pack — Fly Motion's yellow, Fun Money's red, Grove's sage — rendered the
            SAME blue chrome here, which is precisely the surface-leak class HARDENING.md
            documents and AGENTS.md lists as a non-negotiable ("no new hardcoded colors in
            components — read from useReelTokens()"). Now follows the active family. */}
        <div style={{ position: "relative", borderRadius: 34, background: rgba(ACCENT, 0.08), border: `1px solid ${rgba(ACCENT, 0.28)}`, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: "50%", top: 74, width: 210, height: 600, transform: "translateX(-50%)", borderRadius: "110px 110px 56px 56px", background: `linear-gradient(180deg, ${rgba("#38BDF8", 0.28)}, ${rgba(ACCENT, 0.15)})`, border: `2px solid ${rgba("#38BDF8", 0.42)}` }} />
          <div style={{ position: "absolute", left: "50%", top: 270, transform: "translateX(-50%)", ...TYPE.display, color: LIGHT, fontSize: 116 }}>{props.labels?.[0] ?? "82"}</div>
          <div style={{ position: "absolute", left: 70, right: 70, bottom: 50, display: "flex", justifyContent: "space-between" }}>{["watch", "ring", "app"].map((l, i) => <div key={l} style={{ width: 74, height: 74, borderRadius: 24, background: i === 1 ? ACCENT : rgba(LIGHT, 0.08), display: "grid", placeItems: "center", color: LIGHT, ...TYPE.mono, fontSize: 12, boxShadow: i === 1 ? glow(ACCENT, 0.18) : undefined }}>{l}</div>)}</div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "center" }}>
          {metricItems.slice(0, 5).map((m, i) => <div key={i} style={{ borderRadius: 20, padding: "18px 22px", background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.15 : 0.055), border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.36 : 0.1)}`, opacity: ghostFor(m.atMs, i) }}><div style={{ ...TYPE.headline, color: i === 0 ? ACCENT : LIGHT, fontSize: 34 }}>{m.label}</div><div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.52), fontSize: 15, textTransform: "uppercase" }}>{m.detail ?? "signal"}</div></div>)}
          <svg width="100%" height="120" viewBox="0 0 480 120"><path d={`M0 72 C80 ${40 + Math.sin(frame / 12) * 12} 120 98 188 54 C266 6 318 82 480 28`} fill="none" stroke={ACCENT} strokeWidth="8" strokeLinecap="round" /></svg>
        </div>
      </div>
    )}
  />
);

export const RecoveryChart: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, cardItems, revealFor, ghostFor }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "96px 80px 84px" : "180px 130px", borderRadius: 34, background: rgba(LIGHT, 0.055), border: `1px solid ${rgba(LIGHT, 0.1)}`, padding: 34 }}>
        <div style={{ ...TYPE.mono, color: ACCENT, fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: 2 }}>{props.kicker ?? "timeline"}</div>
        <div style={{ ...TYPE.display, color: LIGHT, fontSize: 70, lineHeight: 0.94, marginTop: 8 }}>{props.headline ?? "growth lift"}</div>
        <div style={{ position: "absolute", left: 46, right: 46, bottom: 52, height: 310, display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 14, alignItems: "end" }}>{/* Same dark-substrate ghosting fix as StoryboardGrid (2026-09-02): every bar was faded
             by ghostFor(cardItems[i]?.atMs, i), but this chart always draws 9 bars while a plan
             typically supplies far fewer cards — so bars past the supplied count keyed off an
             undefined atMs and sat at the 0.16 floor, i.e. invisible on a dark pack. Bars now
             keep a visible base and only their fill strength animates. Hardcoded #38BDF8 also
             replaced with the active family's accent — it was the one raw hex in this file's
             render path, which HARDENING.md's surface-leak history is explicitly about. */}
           {Array.from({ length: 9 }, (_, i) => { const r = ghostFor(cardItems[i]?.atMs, i); return <div key={i} style={{ height: 70 + i * 24 + (i % 3) * 32, borderRadius: "16px 16px 5px 5px", background: i > 5 ? ACCENT : rgba(ACCENT, 0.55), opacity: 0.34 + r * 0.66 }} />; })}</div>
      </div>
    )}
  />
);

export const BrowserAgentPanel: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, ACCENT, cardItems, revealFor, ghostFor, src, isImage, startFrom, endAt }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "94px 88px 86px" : "155px 120px", display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 26 }}>
        <div style={{ borderRadius: 30, overflow: "hidden", background: "#090B12", border: `1px solid ${rgba(ACCENT, 0.32)}` }}>
          <MiniChrome color={ACCENT} label={props.kicker ?? "browser agent"} />
          <div style={{ padding: 26, display: "grid", gridTemplateRows: "auto 1fr", gap: 0, height: "calc(100% - 52px)", minHeight: 0 }}><div style={{ borderRadius: 18, padding: 18, background: rgba(LIGHT, 0.06), border: `1px solid ${rgba(LIGHT, 0.1)}`, ...TYPE.mono, color: LIGHT, fontSize: 20 }}>{props.headline ?? "How can I help?"}</div>
            {/* Same media gap as AdsDashboard (2026-09-02): mediaSlotId resolved but was
                never read here, so a supplied browser screen never rendered. A real screen
                takes the viewport; the synthetic pill list is the no-media fallback. */}
            {src ? (
              <div style={{ marginTop: 20, borderRadius: 16, overflow: "hidden", border: `1px solid ${rgba(LIGHT, 0.12)}`, minHeight: 0, background: "#02040A" }}>
                {isImage ? (
                  <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
              </div>
            ) : (
            <div style={{ display: "grid", gap: 12, marginTop: 20, alignContent: "start" }}>{cardItems.slice(0, 5).map((c, i) => <div key={i} style={{ borderRadius: 16, padding: "15px 16px", background: i % 2 ? rgba(ACCENT, 0.15) : rgba(LIGHT, 0.055), color: LIGHT, ...TYPE.mono, fontSize: 17, opacity: ghostFor(c.atMs, i) }}>{c.label}</div>)}</div>
            )}</div>
        </div>
        {/* alignContent:"start" on the item list is load-bearing, not decorative: CSS Grid's
            `align-content` defaults to `normal`, which computes to `stretch` for a grid
            container -- so this list's 4 "auto"-height rows were stretching to fill the
            entire "1fr" row of the OUTER grid (a tall, mostly-empty panel), each pill
            growing far past its own content instead of packing at natural height. Same root
            cause as the AdsDashboard sizing fix earlier in this file (which already sets
            alignContent explicitly for the same reason) -- this was the one spot in the file
            that still had the CSS Grid default doing that silently. */}
        <div style={{ borderRadius: 34, background: rgba(ACCENT, 0.12), border: `1px solid ${rgba(ACCENT, 0.28)}`, padding: 28, display: "grid", gridTemplateRows: "auto 1fr", gap: 20 }}><div style={{ ...TYPE.headline, color: LIGHT, fontSize: 38 }}>{props.subline ?? "agent session"}</div><div style={{ display: "grid", gap: 12, alignContent: "start" }}>{["search", "compare", "rerun", "notify"].map((x) => <div key={x} style={{ borderRadius: 16, background: rgba(LIGHT, 0.08), padding: 16, display: "flex", justifyContent: "space-between", color: LIGHT, ...TYPE.mono, fontSize: 16 }}><span>{x}</span><span style={{ color: ACCENT }}>✓</span></div>)}</div></div>
      </div>
    )}
  />
);

export const OddsBoard: React.FC<SharedVisualProps> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ COLOR, TYPE, LIGHT, ACCENT, src, isImage, metricItems, revealFor, ghostFor }) => (
      <div style={{ position: "absolute", inset: props.layout === "split-speaker" ? "94px 78px 86px" : "150px 115px", display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 24 }}>
        {/* Same leak: hardcoded #22C55E made this board green in every pack. The semantic
            role here is "positive/odds", which the token system already expresses as
            COLOR.payoff, so it now follows the family instead of overriding it. */}
        {/* Dead-space fix, same class as AdsDashboard/StoryboardGrid: the row list was
            top-anchored with no fill, so a real 2-3 metric scene parked its content in the
            top fifth of a full-height panel and left the rest empty. The panel is now a
            grid whose row band fills and distributes. */}
        <div style={{ borderRadius: 30, background: rgba(COLOR.ink, 0.72), border: `1px solid ${rgba(COLOR.payoff, 0.3)}`, padding: 24, display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
          <div style={{ ...TYPE.mono, color: COLOR.payoff, fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>{props.kicker ?? "odds board"}</div>
          <div style={{ display: "grid", gap: 12, marginTop: 20, alignContent: "center", minHeight: 0 }}>{(metricItems.length ? metricItems : [{ label: "Brazil", detail: "+120" }, { label: "Edge", detail: "4.8%" }, { label: "Model", detail: "live" }, { label: "Stake", detail: "$25" }]).slice(0, 6).map((m, i) => <div key={i} style={{ borderRadius: 16, padding: "15px 18px", background: rgba(i === 0 ? ACCENT : "#22C55E", i === 0 ? 0.16 : 0.08), border: `1px solid ${rgba(i === 0 ? ACCENT : "#22C55E", 0.22)}`, display: "flex", justifyContent: "space-between", opacity: ghostFor(m.atMs, i) }}><span style={{ ...TYPE.headline, color: LIGHT, fontSize: 26 }}>{m.label}</span><span style={{ ...TYPE.mono, color: i === 0 ? ACCENT : "#22C55E", fontSize: 20 }}>{m.detail ?? "live"}</span></div>)}</div>
        </div>
        {/* isImage && src bypasses the fixed "EDGE/ACTION" mockup for a real supplied asset —
            same reasoning as StoryboardGrid/InboxTaskList: a real photo is a worse fit
            *competing* with fake mockup chrome than replacing it outright. Previously this
            component never read src/isImage at all, so a plan's mediaSlotId was silently
            dropped here specifically (found while auditing fun-money's asset-density gaps —
            the "receipt" scene named receipt-badge.png and it never actually rendered). */}
        {isImage && src ? (
          <div style={{ borderRadius: 42, overflow: "hidden", border: `2px solid ${rgba(LIGHT, 0.16)}`, boxShadow: `0 34px 100px ${rgba(ACCENT, 0.22)}`, position: "relative" }}>
            <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 55%, ${rgba("#000", 0.55)})` }} />
          </div>
        ) : (
          <div style={{ borderRadius: 42, background: "#05070B", border: `2px solid ${rgba(LIGHT, 0.16)}`, padding: 18, boxShadow: `0 34px 100px ${rgba(ACCENT, 0.22)}` }}><div style={{ height: 28, display: "grid", placeItems: "center" }}><div style={{ width: 88, height: 9, borderRadius: 999, background: "#171C2B" }} /></div><div style={{ height: 620, borderRadius: 30, background: "#0B1118", padding: 22, position: "relative" }}><div style={{ ...TYPE.mono, color: ACCENT, fontSize: 15, fontWeight: 900 }}>EDGE</div><div style={{ ...TYPE.display, color: LIGHT, fontSize: 86, lineHeight: 0.9, marginTop: 42 }}>{props.headline ?? "EDGE"}</div><div style={{ position: "absolute", left: 30, right: 30, bottom: 28, height: 52, borderRadius: 999, background: ACCENT, color: "#121212", display: "grid", placeItems: "center", ...TYPE.mono, fontSize: 18, fontWeight: 900 }}>ACTION</div></div></div>
        )}
      </div>
    )}
  />
);

// CtaPlate — the closer. Closers run 3-11s, and this used to render kicker/headline/subline
// on ONE shared spring and then hold, so every reel ended on a multi-second freeze. That was
// the single most common uncovered span in the density audit (lint/visual-density.mjs): the
// tail gap was the only failure in the Workflow Poster demo and the largest in several others.
//
// It also silently ignored `cards`, which several plans supplied — so those beats were mined
// as pacing events while rendering nothing. That combination is the worst case: the metric
// says the closer is alive, the screen says otherwise. Now the plate stages its own copy and
// renders `cards` as action chips landing on their own beats, so a closer earns its runtime
// and the mined events correspond to something a viewer can actually see.
export const CtaPlate: React.FC<
  SharedVisualProps & {
    /** Override the headline's default 150px (112 split-speaker). For a single
     *  unbreakable brand word this box has no way to wrap, so anything wider than the
     *  plate's ~900px content width (inset 90px each side) overflows straight past the
     *  frame edge instead -- confirmed via the compiled Sora glyph-width metrics
     *  (tokens/compiled/font-metrics.json) and a rendered frame, not assumed. Undefined
     *  preserves the exact prior sizing. */
    headlineFontSize?: number;
  }
> = (props) => (
  <SharedVisualShell
    {...props}
    renderVisual={({ TYPE, LIGHT, DARK, ACCENT, p, cardItems, revealFor, ghostFor, src, isImage, startFrom, endAt }) => {
      const split = props.layout === "split-speaker";
      const chips = cardItems.slice(0, 6);
      // Explicit ms stagger off the scene's own atMs — index-only staggering (revealFor's
      // `i * 4 frames` fallback) reads fine for a grid of same-weight chips but is far too
      // tight (~130ms apart at 30fps) for four DIFFERENT-weight lines that should feel like a
      // considered build: label, then the big word, then an underline, then the payoff line.
      const base = props.atMs ?? 0;
      const kickerT = revealFor(base, 0);
      const headlineT = revealFor(base + 220, 0);
      const ruleT = revealFor(base + 520, 0);
      const sublineT = revealFor(base + 760, 0);
      return (
        <div style={{ position: "absolute", inset: split ? 0 : "120px 90px", display: "grid", placeItems: "center", alignContent: "center", gap: 18, textAlign: "center", transform: `scale(${0.92 + p * 0.08})` }}>
          {/* Media support (2026-09-02). End plates routinely want the product on screen,
              but this shell ignored the resolved mediaSlotId entirely — so the closing beat
              of every pack's reel could never carry an asset (Fun Money's sales demo ends on
              a 5.7s assetless CtaPlate). A supplied screen sits behind the copy, dimmed and
              scrimmed so the headline keeps its contrast. */}
          {src ? (
            <div style={{ position: "absolute", inset: 0, borderRadius: split ? 0 : 28, overflow: "hidden", zIndex: 0 }}>
              {/* Blurred and heavily dimmed on purpose: at 0.4 with only a gradient scrim, a
                  detail-rich product screenshot competed with the subline and chips — legible
                  headline, degraded everything else (caught on render, not review). A CTA
                  backdrop should read as atmosphere, not as a second thing to read. */}
              {isImage ? (
                <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.22, filter: "blur(3px)", transform: "scale(1.06)" }} />
              ) : (
                <OffthreadVideo src={src} muted startFrom={startFrom} endAt={endAt} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.22, filter: "blur(3px)", transform: "scale(1.06)" }} />
              )}
              <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${rgba(DARK, 0.74)}, ${rgba(DARK, 0.9)})` }} />
            </div>
          ) : null}
          <div style={{ ...TYPE.mono, color: rgba(LIGHT, 0.58), fontSize: 22, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase", opacity: kickerT }}>{props.kicker ?? "comment"}</div>
          <div style={{ ...TYPE.display, color: LIGHT, fontSize: props.headlineFontSize ?? (split ? 112 : 150), lineHeight: 0.9, textShadow: `0 12px 36px ${rgba(DARK, 0.7)}`, opacity: headlineT, transform: `translateY(${(1 - headlineT) * 14}px)` }}>{props.headline ?? "BUILD"}</div>
          <div style={{ height: 3, width: `${34 + ruleT * 46}%`, borderRadius: 999, background: ACCENT, opacity: ruleT, boxShadow: glow(ACCENT, 0.16) }} />
          {props.subline && (
            <div style={{ ...TYPE.body, color: ACCENT, fontSize: split ? 34 : 44, opacity: sublineT }}>{props.subline}</div>
          )}
          {chips.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 6 }}>
              {chips.map((c, i) => (
                <div
                  key={i}
                  style={{
                    ...TYPE.mono,
                    fontSize: split ? 22 : 26,
                    fontWeight: 900,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    padding: split ? "10px 18px" : "13px 22px",
                    borderRadius: 999,
                    color: LIGHT,
                    background: rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.2 : 0.07),
                    border: `1px solid ${rgba(i === 0 ? ACCENT : LIGHT, i === 0 ? 0.42 : 0.14)}`,
                    opacity: ghostFor(c.atMs, i),
                    transform: `scale(${0.9 + revealFor(c.atMs, i) * 0.1})`,
                  }}
                >
                  {c.label}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }}
  />
);

// Semantic wrappers for Director 2.0. These keep product-facing plans stable
// (`ProductStage`, `ProcessTimeline`, etc.) while the underlying renderer can evolve.
export const ProductStage: React.FC<SharedVisualProps> = (props) => <EditorTimelinePanel kicker={props.kicker ?? "product stage"} {...props} />;

export const MetricDashboard: React.FC<SharedVisualProps> = (props) => <AdsDashboard kicker={props.kicker ?? "metrics"} {...props} />;

export const ComparisonBoard: React.FC<SharedVisualProps> = (props) => <ApprovalShield kicker={props.kicker ?? "comparison"} {...props} />;

export const ProcessTimeline: React.FC<SharedVisualProps> = (props) => <InboxTaskList kicker={props.kicker ?? "process"} {...props} />;

export const InteractionSurface: React.FC<SharedVisualProps> = (props) => <BrowserAgentPanel kicker={props.kicker ?? "interaction"} {...props} />;

export const PricingProof: React.FC<SharedVisualProps> = (props) => <OddsBoard kicker={props.kicker ?? "proof"} {...props} />;

export const SocialProof: React.FC<SharedVisualProps> = (props) => <StoryboardGrid kicker={props.kicker ?? "social proof"} {...props} />;

export const MediaCollage: React.FC<SharedVisualProps> = (props) => <StoryboardGrid kicker={props.kicker ?? "media collage"} {...props} />;

export const TechnicalSurface: React.FC<SharedVisualProps> = (props) => <BrowserAgentPanel kicker={props.kicker ?? "technical surface"} {...props} />;
