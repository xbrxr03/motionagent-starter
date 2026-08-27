import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { EASE } from "../styles/motion";
import { punchScale, shakeOffset } from "../styles/fx";

type Props = {
  beats: number[]; // scene-local frames
  durationInFrames: number;
  shake?: boolean;
  children: React.ReactNode;
};

// Camera language: settle-in on the cut, slow push through the scene, kick on every beat.
export const Camera: React.FC<Props> = ({ beats, durationInFrames, shake = false, children }) => {
  const frame = useCurrentFrame();
  const settle = interpolate(frame, [0, 9], [1.09, 1], { easing: EASE.emphasized, extrapolateRight: "clamp" });
  const push = interpolate(frame, [0, durationInFrames], [1, 1.05]);
  const punch = punchScale(frame, beats);
  // zoom-through exit: accelerate into the next cut so the incoming settle reads as one move
  const exit = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 1.22], {
    easing: EASE.exit,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const { x, y } = shake ? shakeOffset(frame, beats) : { x: 0, y: 0 };
  return (
    <AbsoluteFill style={{ transform: `scale(${settle * push * punch * exit}) translate(${x}px, ${y}px)` }}>
      {children}
    </AbsoluteFill>
  );
};
