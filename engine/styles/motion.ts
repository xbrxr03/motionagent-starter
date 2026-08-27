// Motion grammar — named easings only; components never invent curves.
// Values are public design-system facts (MD3 emphasized, Carbon productive, classic ease).
import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import { Easing } from "remotion";

export const EASE = {
  emphasized: Easing.bezier(0.05, 0.7, 0.1, 1), // hero entrances
  productive: Easing.bezier(0.2, 0, 0.38, 0.9), // utility moves
  standard: Easing.bezier(0.25, 0.1, 0.25, 1), // gentle drift
  exit: Easing.bezier(0.3, 0, 0.8, 0.15), // leaving elements accelerate
} as const;

// Duration bands in frames @30fps: micro 100ms · minor 200ms · major 430ms · reveal 800ms
export const DUR = { micro: 3, minor: 6, major: 13, reveal: 24 } as const;

// Stagger 66ms — inside the researched 40–80ms band
export const STAGGER = 2 as const;

export const SPRING = {
  firm: { damping: 200, stiffness: 130, mass: 1 }, // no overshoot — utility
  settle: { damping: 24, stiffness: 170, mass: 0.9 }, // slight overshoot — expressive entrances
} as const;

const ReduceMotionContext = createContext(false);

export const ReduceMotionProvider = ({
  reduceMotion = false,
  children,
}: {
  reduceMotion?: boolean;
  children: ReactNode;
}) => createElement(ReduceMotionContext.Provider, { value: reduceMotion }, children);

export const useReduceMotion = (): boolean => useContext(ReduceMotionContext);
