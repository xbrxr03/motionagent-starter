import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { MeshGradient } from "@paper-design/shaders-react";
import { useReelTokens } from "../styles/tokens";
import { Grain, rgba } from "../styles/fx";

// Cinematic field: noise-driven aurora, drifting particles, bokeh, perspective grid, vignette, grain.
export const Background: React.FC<{ payoffFromFrame?: number }> = ({ payoffFromFrame }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { COLOR, BACKDROP } = useReelTokens();

  const payoff =
    payoffFromFrame === undefined
      ? 0
      : interpolate(frame, [payoffFromFrame, payoffFromFrame + 20], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  // Aurora blobs wander on noise fields — organic, never looping.
  const a1x = 30 + noise2D("a1x", frame * 0.004, 0) * 22;
  const a1y = 22 + noise2D("a1y", frame * 0.004, 7) * 16;
  const a2x = 72 + noise2D("a2x", frame * 0.003, 3) * 20;
  const a2y = 70 + noise2D("a2y", frame * 0.003, 11) * 18;

  const particles = Array.from({ length: 30 }, (_, i) => {
    const px = ((i * 397) % 1080) + noise2D(`px${i}`, frame * 0.006, i) * 70;
    const py = ((i * 683) % 1920) + noise2D(`py${i}`, frame * 0.005, i) * 90 - frame * (0.15 + (i % 5) * 0.08);
    const size = 2 + (i % 4);
    const accent = i % 6 === 0;
    return { px, py: ((py % 1920) + 1920) % 1920, size, accent, o: 0.10 + ((i * 37) % 10) * 0.016 };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.ink }}>
      {/* true shader mesh gradient, frame-deterministic (speed=0 + frame in ms) */}
      <AbsoluteFill style={{ opacity: 0.55 }}>
        <MeshGradient
          speed={0}
          frame={(frame * 1000) / 30}
          width="100%"
          height="100%"
          colors={BACKDROP.mesh}
          distortion={0.9}
          swirl={0.6}
        />
      </AbsoluteFill>
      {/* aurora accents over the mesh — both hues come from the active family's backdrop */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(48% 34% at ${a1x}% ${a1y}%, ${rgba(BACKDROP.aurora[0], 0.14 * (1 - payoff))}, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(52% 40% at ${a2x}% ${a2y}%, ${rgba(BACKDROP.aurora[1], 0.1 * (1 - payoff))}, transparent 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(64% 48% at 50% 78%, ${rgba(COLOR.payoff, 0.2 * payoff)}, transparent 74%)`,
        }}
      />
      {/* perspective grid, faded at edges — tinted with the family's own `text` role (paper)
          at low alpha (was a hardcoded rgba(237,234,226,…), which happens to equal Signal's
          paper token exactly; reusing COLOR.paper instead of baking that literal in lets
          abrxr's near-white render its own grid tint). */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${rgba(COLOR.paper, 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(COLOR.paper, 0.05)} 1px, transparent 1px)`,
          backgroundSize: "108px 108px",
          transform: "perspective(1200px) rotateX(28deg) scale(1.6)",
          transformOrigin: "50% 100%",
          maskImage: "radial-gradient(70% 60% at 50% 60%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 60%, black 30%, transparent 100%)",
          opacity: 0.8,
        }}
      />
      {/* bokeh depth */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 140 + i * 340 + noise2D(`bx${i}`, frame * 0.003, i) * 60,
            top: 300 + i * 480 + noise2D(`by${i}`, frame * 0.003, i + 5) * 80,
            width: 180 + i * 60,
            height: 180 + i * 60,
            borderRadius: 400,
            background: rgba(COLOR.accent, 0.05 + i * 0.012),
            filter: "blur(48px)",
          }}
        />
      ))}
      {/* particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.px,
            top: p.py,
            width: p.size,
            height: p.size,
            borderRadius: p.size,
            background: p.accent ? COLOR.accent : COLOR.paper,
            opacity: p.o,
            boxShadow: p.accent ? `0 0 12px ${COLOR.accent}` : "none",
          }}
        />
      ))}
      {/* vignette — edge-darken toward BACKDROP.vignette, a color deliberately independent
          of the family's own `bg` role (ink). Dark families set vignette===bg (so this is
          visually identical to the old "reuse COLOR.ink" behavior — near-black on an
          already near-black field); a light family's bg is near-white, where fading toward
          bg would be an invisible no-op, so it ships its own real dark neutral instead. See
          types.ts's Backdrop.vignette comment / HARDENING.md's 2026-07-14 entry. */}
      <AbsoluteFill
        style={{ background: `radial-gradient(80% 64% at 50% 46%, transparent 55%, ${rgba(BACKDROP.vignette, 0.72)} 100%)` }}
      />
      <Grain frame={frame} />
      {/* interlace shimmer kept OFF — grain + aurora carry the texture. Letterbox fade also
          uses BACKDROP.vignette, same reasoning as the vignette above. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${rgba(BACKDROP.vignette, 0.5)} 0%, transparent 12%, transparent 88%, ${rgba(BACKDROP.vignette, 0.6)} 100%)`,
        }}
      />
      {/* durationInFrames referenced to keep hook deps honest */}
      <div style={{ display: "none" }}>{durationInFrames}</div>
    </AbsoluteFill>
  );
};
