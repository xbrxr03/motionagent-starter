import { Composition, type CalculateMetadataFunction } from "remotion";
import { PlanReel, msToFrame, type Chrome } from "./PlanReel";
import type { Plan } from "../schema/plan";
import { UI_MATE } from "../tokens/families/uiMate.data";
import { TALKING_HEAD } from "../tokens/families/talkingHead.data";
import planUiMateCapabilityShowcase from "../demo/plan-ui-mate-capability-showcase.json";
import planTalkingHeadCapabilityShowcase from "../demo/plan-talking-head-capability-showcase.json";
import { CANVAS } from "./styles/tokens";

// JSON imports get a structural literal type from resolveJsonModule that doesn't line up
// 1:1 with the zod-inferred `Plan` type (e.g. meta.version's literal-vs-number, passthrough
// fields).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asPlan = (p: unknown): Plan => p as any;

const CINEMATIC: Chrome = { kind: "cinematic" };
type PlanReelProps = { plan: Plan; chrome: Chrome };

const UI_MATE_CHROME: Chrome = {
  kind: "static",
  background: { kind: "paper", bg: UI_MATE.bg, line: UI_MATE.line },
};

const TALKING_HEAD_CHROME: Chrome = {
  kind: "static",
  background: { kind: "paper", bg: TALKING_HEAD.warmWhite, line: TALKING_HEAD.line },
};

const chromeForPlan = (p: Plan): Chrome => {
  switch (p.meta?.family) {
    case "uiMate":
      return UI_MATE_CHROME;
    case "talkingHead":
      return TALKING_HEAD_CHROME;
    default:
      return CINEMATIC;
  }
};

const dynamicDefaultPlan = asPlan(planUiMateCapabilityShowcase);
const dynamicDefaultProps = {
  plan: dynamicDefaultPlan,
  chrome: chromeForPlan(dynamicDefaultPlan),
} satisfies PlanReelProps;

const calculateDynamicPlanMetadata: CalculateMetadataFunction<PlanReelProps> = ({ props }) => {
  const dynamicPlan = asPlan(props.plan);
  return {
    durationInFrames: msToFrame(dynamicPlan.durationMs),
    fps: dynamicPlan.meta?.fps ?? dynamicPlan.fps ?? CANVAS.fps,
    width: dynamicPlan.meta?.canvas?.w ?? dynamicPlan.width ?? CANVAS.w,
    height: dynamicPlan.meta?.canvas?.h ?? dynamicPlan.height ?? CANVAS.h,
    props: {
      ...props,
      plan: dynamicPlan,
      chrome: chromeForPlan(dynamicPlan),
    },
  };
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="DynamicPlanReel"
      component={PlanReel}
      calculateMetadata={calculateDynamicPlanMetadata}
      fps={CANVAS.fps}
      width={CANVAS.w}
      height={CANVAS.h}
      defaultProps={dynamicDefaultProps}
    />
    <Composition
      id="UiMateCapabilityShowcase"
      component={PlanReel}
      defaultProps={{ plan: asPlan(planUiMateCapabilityShowcase), chrome: UI_MATE_CHROME }}
      durationInFrames={msToFrame(planUiMateCapabilityShowcase.durationMs)}
      fps={CANVAS.fps}
      width={CANVAS.w}
      height={CANVAS.h}
    />
    <Composition
      id="TalkingHeadCapabilityShowcase"
      component={PlanReel}
      defaultProps={{ plan: asPlan(planTalkingHeadCapabilityShowcase), chrome: TALKING_HEAD_CHROME }}
      durationInFrames={msToFrame(planTalkingHeadCapabilityShowcase.durationMs)}
      fps={CANVAS.fps}
      width={CANVAS.w}
      height={CANVAS.h}
    />
  </>
);
