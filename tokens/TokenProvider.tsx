// TokenProvider — components read the ACTIVE family via context, never a singleton.
// Swapping the `family` prop re-themes the entire reel with zero component edits.
// This is the refactor that unblocks N families sharing one component library.
import { createContext, useContext } from "react";
import type { Family } from "./types";
import { signal } from "./families/signal";
import { uiMate } from "./families/uiMate";
import { talkingHead } from "./families/talkingHead";

const FAMILIES: Record<string, Family> = {
  signal,
  uiMate,
  talkingHead,
};

export const registerFamily = (f: Family) => {
  FAMILIES[f.id] = f;
};
export const getFamily = (id: string): Family => FAMILIES[id] ?? signal;

const TokenContext = createContext<Family>(signal);

export const TokenProvider: React.FC<{ family: string; children: React.ReactNode }> = ({ family, children }) => (
  <TokenContext.Provider value={getFamily(family)}>{children}</TokenContext.Provider>
);

/** Active family's semantic tokens. Components call this instead of importing COLOR/TYPE. */
export const useTokens = () => useContext(TokenContext);
