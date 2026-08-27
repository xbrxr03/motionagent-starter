// PlanReel — the single plan-driven composition every registered Root.tsx composition
// (and DynamicPlanReel) renders through. Chrome is plain, JSON-serializable DATA, not React
// nodes: `component`-based Compositions ship `defaultProps` across Remotion's render-worker
// boundary (bundler -> renderer), which serializes them — a `background: <PaperGrid/>`
// literal reproducibly throws React error #31 ("object with keys {key, ref, props,
// _owner}") from `remotion render`. So `background` is a tagged union PlanReel resolves to
// the right visual itself, not a node Root hands down.
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { Plan, Scene } from "../schema/plan";
import { TokenProvider, getFamily } from "../tokens/TokenProvider";
import { ReduceMotionProvider } from "./styles/motion";
import { Background } from "./components/Background";
import { Camera } from "./components/Camera";
import {
  UiSwipeThreshold,
  UiFormValidation,
  UiOptimisticAction,
  UiInteractionSurface,
  UiMateCTA,
  UiColorSwatchPanel,
  UiCommandList,
  UiConfirmDialog,
  UiCompareCards,
  UiCursorPresenceGrid,
  UiIdentityFlow,
  UiLatencyGauge,
  UiDropZonePair,
  UiHoldProgressRing,
  UiFormStateCard,
  UiFormLiveErrorCard,
  UiFormBlurCheckCard,
  UiFormEscalateCard,
  UiFormSuccessCard,
  UiFormatTabsCard,
  UiOklchSliderCard,
  UiContrastCheckCard,
  UiLightDarkPreviewCard,
  UiScaleGenerationCard,
  UiPaletteTriggerCard,
  UiFuzzyMatchCard,
  UiKeyboardNavList,
  UiAsyncSpinnerRow,
  UiNestedCommandCard,
  UiUploadProgressCard,
  UiUploadErrorRetryCard,
  UiFilePreviewCard,
  UiMultiFileListCard,
  UiCountdownUndoRing,
  UiSettingsDangerCard,
  UiCooldownDeleteCard,
  UiRaceCompareCard,
  UiSplitCompareCard,
  UiSyncFlowDiagram,
  UiRollbackToastCard,
  UiSafeUnsafeListCard,
  UiCanvasCursorHero,
  UiInterpolationCompareCard,
  UiPresenceAvatarStackCard,
  UiSelectionLockCard,
  UiFollowModeCard,
} from "./components/UiMatePack";
import {
  TalkingHeadClaim,
  TalkingHeadProofSplit,
  TalkingHeadToolProof,
  TalkingHeadBrollStack,
  TalkingHeadSocialCTA,
  TalkingHeadCaption,
  TalkingHeadPhoneMockStage,
  TalkingHeadAppHeroReveal,
  TalkingHeadPillButtonCallout,
  TalkingHeadCommentCard,
  TalkingHeadFilterAppCard,
  TalkingHeadFunctionModalCard,
  TalkingHeadTerminalCard,
  TalkingHeadFeatureChecklist,
  TalkingHeadGradientSwatchCard,
  TalkingHeadSeriesCard,
  TalkingHeadStepTimeline,
  TalkingHeadCompetitorWatchCard,
  TalkingHeadSplitCompareCard,
  TalkingHeadZeroCostCard,
  TalkingHeadPluginRankCard,
  TalkingHeadPlatformTwinPhones,
  TalkingHeadBrowserLogoReveal,
} from "./components/TalkingHeadPack";
import {
  VoiceOrb,
  WaveformPanel,
  EditorTimelinePanel,
  AdsDashboard,
  ApprovalShield,
  InboxTaskList,
  StoryboardGrid,
  BodyAnalyticsMap,
  RecoveryChart,
  BrowserAgentPanel,
  OddsBoard,
  CtaPlate,
  ProductStage,
  MetricDashboard,
  ComparisonBoard,
  ProcessTimeline,
  InteractionSurface,
  PricingProof,
  SocialProof,
  MediaCollage,
  TechnicalSurface,
} from "./components/SharedVisualPrimitives";
import {
  StarRatingFill,
  HeartBurstReaction,
  CommentPopIn,
  ReceiptPrintLines,
  QrCodeAssemble,
} from "./components/AppNativeScenes";

const FPS = 30;
export const msToFrame = (ms: number): number => Math.round((ms * FPS) / 1000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<string, React.FC<any>> = {
  // --- UI Mate pack: interaction micro-patterns + literal-fidelity recreation primitives. ---
  UiSwipeThreshold,
  UiFormValidation,
  UiOptimisticAction,
  UiInteractionSurface,
  UiMateCTA,
  UiColorSwatchPanel,
  UiCommandList,
  UiConfirmDialog,
  UiCompareCards,
  UiCursorPresenceGrid,
  UiIdentityFlow,
  UiLatencyGauge,
  UiDropZonePair,
  UiHoldProgressRing,
  UiFormStateCard,
  UiFormLiveErrorCard,
  UiFormBlurCheckCard,
  UiFormEscalateCard,
  UiFormSuccessCard,
  UiFormatTabsCard,
  UiOklchSliderCard,
  UiContrastCheckCard,
  UiLightDarkPreviewCard,
  UiScaleGenerationCard,
  UiPaletteTriggerCard,
  UiFuzzyMatchCard,
  UiKeyboardNavList,
  UiAsyncSpinnerRow,
  UiNestedCommandCard,
  UiUploadProgressCard,
  UiUploadErrorRetryCard,
  UiFilePreviewCard,
  UiMultiFileListCard,
  UiCountdownUndoRing,
  UiSettingsDangerCard,
  UiCooldownDeleteCard,
  UiRaceCompareCard,
  UiSplitCompareCard,
  UiSyncFlowDiagram,
  UiRollbackToastCard,
  UiSafeUnsafeListCard,
  UiCanvasCursorHero,
  UiInterpolationCompareCard,
  UiPresenceAvatarStackCard,
  UiSelectionLockCard,
  UiFollowModeCard,
  // --- Talking Head pack: creator-led clip/proof/CTA scenes. ---
  TalkingHeadClaim,
  TalkingHeadProofSplit,
  TalkingHeadToolProof,
  TalkingHeadBrollStack,
  TalkingHeadSocialCTA,
  TalkingHeadCaption,
  TalkingHeadPhoneMockStage,
  TalkingHeadAppHeroReveal,
  TalkingHeadPillButtonCallout,
  TalkingHeadCommentCard,
  TalkingHeadFilterAppCard,
  TalkingHeadFunctionModalCard,
  TalkingHeadTerminalCard,
  TalkingHeadFeatureChecklist,
  TalkingHeadGradientSwatchCard,
  TalkingHeadSeriesCard,
  TalkingHeadStepTimeline,
  TalkingHeadCompetitorWatchCard,
  TalkingHeadSplitCompareCard,
  TalkingHeadZeroCostCard,
  TalkingHeadPluginRankCard,
  TalkingHeadPlatformTwinPhones,
  TalkingHeadBrowserLogoReveal,
  // --- Shared visual primitives: pack-agnostic visual vocabulary. These components use
  // useReelTokens(), so the same plan can render through either pack's family/preset and
  // pick up that pack's palette/type/motion personality. Talking Head uses
  // layout="split-speaker"; UI Mate can use the same primitive full-frame. ---
  VoiceOrb,
  WaveformPanel,
  EditorTimelinePanel,
  AdsDashboard,
  ApprovalShield,
  InboxTaskList,
  StoryboardGrid,
  BodyAnalyticsMap,
  RecoveryChart,
  BrowserAgentPanel,
  OddsBoard,
  CtaPlate,
  ProductStage,
  MetricDashboard,
  ComparisonBoard,
  ProcessTimeline,
  InteractionSurface,
  PricingProof,
  SocialProof,
  MediaCollage,
  TechnicalSurface,
  // --- App-native reaction/proof scenes (engine/components/AppNativeScenes.tsx) — QR
  // assembly and social-proof beats used by Talking Head plans. ---
  StarRatingFill,
  HeartBurstReaction,
  CommentPopIn,
  ReceiptPrintLines,
  QrCodeAssemble,
};

const sceneBeats = (scene: Scene): number[] => {
  const p = (scene.props ?? {}) as Record<string, unknown>;
  const out: number[] = [];
  for (const arr of [p.items, p.bullets, p.words, p.lines]) {
    if (Array.isArray(arr)) for (const x of arr) if (typeof x?.atMs === "number") out.push(x.atMs);
  }
  for (const k of ["flipAtMs", "titleAtMs", "punchMs", "revealAtMs", "atMs", "entamAtMs", "captionAtMs"]) {
    const v = p[k];
    if (typeof v === "number") out.push(v);
  }
  return out.map((ms) => msToFrame(ms - scene.startMs));
};

export type StaticBackground = { kind: "paper"; bg: string; line: string };

export type Chrome = { kind: "cinematic" } | { kind: "static"; background: StaticBackground };

const PAPER_CELL_PX = 135;
const PAPER_W = 1080;
const PAPER_H = 1920;

const PaperGrid: React.FC<{ bg: string; line: string }> = ({ bg, line }) => (
  <div style={{ position: "absolute", inset: 0, background: bg }}>
    <svg width={PAPER_W} height={PAPER_H} style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: Math.ceil(PAPER_W / PAPER_CELL_PX) + 1 }, (_, i) => (
        <line key={`v${i}`} x1={i * PAPER_CELL_PX} y1={0} x2={i * PAPER_CELL_PX} y2={PAPER_H} stroke={line} strokeWidth={1.6} opacity={0.55} />
      ))}
      {Array.from({ length: Math.ceil(PAPER_H / PAPER_CELL_PX) + 1 }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={i * PAPER_CELL_PX} x2={PAPER_W} y2={i * PAPER_CELL_PX} stroke={line} strokeWidth={1.6} opacity={0.55} />
      ))}
    </svg>
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse 90% 70% at 50% 42%, rgba(255,255,255,0.16), rgba(0,0,0,0.10))",
      }}
    />
  </div>
);

const renderStaticBackground = (bg: StaticBackground): React.ReactNode => <PaperGrid bg={bg.bg} line={bg.line} />;

const resolveSceneProps = (plan: Plan, item: { props?: Record<string, unknown> }): Record<string, unknown> => {
  const props = { ...(item.props ?? {}) } as Record<string, unknown>;
  const mediaSlotId = props.mediaSlotId;
  if (typeof mediaSlotId === "string" && props.media === undefined) {
    const media = (plan.mediaSlots ?? []).find((slot) => slot.id === mediaSlotId);
    if (media) props.media = media;
  }

  const editDecisionId = props.editDecisionId;
  if (typeof editDecisionId === "string" && props.editDecision === undefined) {
    const editDecision = (plan.editDecisions ?? []).find((decision) => decision.id === editDecisionId);
    if (editDecision) {
      props.editDecision = editDecision;
      if (props.sourceClip === undefined) {
        const sourceClip = (plan.sourceClips ?? []).find((clip) => clip.id === editDecision.sourceClip);
        if (sourceClip) props.sourceClip = sourceClip;
      }
    }
  }

  const sourceClipId = props.sourceClipId;
  if (typeof sourceClipId === "string" && props.sourceClip === undefined) {
    const sourceClip = (plan.sourceClips ?? []).find((clip) => clip.id === sourceClipId);
    if (sourceClip) props.sourceClip = sourceClip;
  }

  return props;
};

export const PlanReel: React.FC<{ plan: Plan; chrome: Chrome; reduceMotion?: boolean }> = ({ plan, chrome, reduceMotion }) => {
  const familyId = plan.meta?.family ?? "signal";
  const family = getFamily(familyId);
  const payoffScene = plan.scenes[plan.scenes.length - 1];
  return (
    <TokenProvider family={familyId}>
    <ReduceMotionProvider reduceMotion={reduceMotion}>
      <AbsoluteFill style={{ backgroundColor: family.color.bg }}>
        {chrome.kind === "cinematic" ? (
          <Background payoffFromFrame={msToFrame(payoffScene.startMs)} />
        ) : (
          renderStaticBackground(chrome.background)
        )}
        <Audio src={staticFile(plan.audio)} />
        {plan.scenes.map((scene) => {
          const C = REGISTRY[scene.component];
          if (!C) {
            // Should never reach render — lint R8 catches unknown components — but guard
            // anyway so a bad plan fails with a readable message, not React error #130.
            throw new Error(
              `Unknown component "${scene.component}" in scene "${scene.id}". Known: ${Object.keys(REGISTRY).join(", ")}`,
            );
          }
          const from = msToFrame(scene.startMs);
          const to = msToFrame(scene.endMs);
          const body = <C {...resolveSceneProps(plan, scene)} sceneStartMs={scene.startMs} />;
          return (
            <Sequence key={scene.id} from={from} durationInFrames={to - from} name={scene.id}>
              {chrome.kind === "cinematic" ? (
                <Camera beats={sceneBeats(scene)} durationInFrames={to - from} shake={scene.shake === true}>
                  {body}
                </Camera>
              ) : (
                body
              )}
            </Sequence>
          );
        })}
        {(plan.overlays ?? []).map((overlay) => {
          const C = REGISTRY[overlay.component];
          if (!C) {
            throw new Error(
              `Unknown component "${overlay.component}" in overlay "${overlay.id}". Known: ${Object.keys(REGISTRY).join(", ")}`,
            );
          }
          const startMs = overlay.startMs ?? 0;
          const endMs = overlay.endMs ?? plan.durationMs;
          const from = msToFrame(startMs);
          const to = msToFrame(endMs);
          return (
            <Sequence key={overlay.id} from={from} durationInFrames={Math.max(1, to - from)} name={overlay.id}>
              <C {...resolveSceneProps(plan, overlay)} sceneStartMs={startMs} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </ReduceMotionProvider>
    </TokenProvider>
  );
};
