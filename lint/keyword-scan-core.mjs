// Pure keyword-matching logic for the animation-keyword suggestion system.
// Split from cli/keyword-scan.mjs to break the ESM circular dependency:
// lint.mjs needs scanKeywords(), but keyword-scan.mjs imports render-core.mjs,
// which imports lint.mjs. This module has zero imports (pure functions + constants)
// so both lint.mjs and keyword-scan.mjs can import from it without creating a cycle.
//
// The CLI wrapper (cli/keyword-scan.mjs) re-exports these and adds I/O (loadRegistry,
// resolveTranscriptPath, stdout formatting) — same pattern as lint.mjs (pure) +
// cli/lint.mjs (thin CLI).

export const DEFAULT_WINDOW_MS = 2500;

// ---------------------------------------------------------------------------
// Word/keyword normalization. Whisper word tokens carry a leading space and sometimes
// trailing punctuation attached to the word itself (e.g. "Here's", "branding,", "3,").
// Both the transcript words AND the registry's keyword tokens are normalized through this
// SAME function before comparison, so punctuation differences on either side (a keyword
// authored as "3, 2, 1" vs. a transcript word "3,") cancel out instead of causing a false
// negative. Keeps a-z, 0-9, and the apostrophe (so "i'm" stays one token, matching
// LowerThird's registered keyword) — strips everything else.
// ---------------------------------------------------------------------------
export const normalizeToken = (raw) => raw.toLowerCase().replace(/[^a-z0-9']/g, "");

// Builds the word list lint.mjs's own R1 rule reads from (transcript.transcription,
// filtered to non-empty text, offsets.from as the ms timestamp — see lint/lint.mjs's
// `wordStarts` for the exact precedent this mirrors), then attaches a normalized token to
// each word and drops any word whose normalized form is empty (pure punctuation tokens,
// rare in whisper.cpp output but not impossible).
export function buildWords(transcript) {
  return transcript.transcription
    .filter((w) => typeof w.text === "string" && w.text.trim().length > 0)
    .map((w) => ({ text: w.text.trim(), ms: w.offsets.from, norm: normalizeToken(w.text.trim()) }))
    .filter((w) => w.norm.length > 0);
}

// Splits+normalizes a registry keyword ("percent of") into its token sequence (["percent",
// "of"]) using the identical normalizeToken() function words go through, so a keyword
// authored with punctuation ("3, 2, 1") matches transcript words that carry punctuation too.
export function keywordTokens(keyword) {
  return keyword
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
}

// Finds every place `tokens` (a keyword's normalized word sequence) occurs contiguously in
// `words` (the transcript's normalized word sequence). Returns the word INDEX each match
// starts at — the caller reads that word's `.ms` as the match's timestamp (the phrase's
// first word onset, the same "when did this start being said" convention R1 audio-lock
// uses for scene boundaries).
export function findPhraseMatches(words, tokens) {
  const matches = [];
  if (tokens.length === 0 || words.length < tokens.length) return matches;
  for (let i = 0; i <= words.length - tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < tokens.length; j++) {
      if (words[i + j].norm !== tokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }
  return matches;
}

// Does any scene or overlay already using `component` sit within `windowMs` of `wordMs`?
// A scene "covers" a timestamp if [scene.startMs - windowMs, scene.endMs + windowMs]
// contains it — not just a bare distance-to-startMs check — so a long scene whose START is
// more than windowMs before the word, but whose body still spans the word's timestamp,
// correctly counts as covering it. overlays[] (ARCHITECTURE-V2.md §4) get the same
// treatment since they're real components on the timeline too, just non-contiguous;
// missing endMs defaults to plan.durationMs (overlaySchema's own documented convention —
// see schema/plan.ts's comment on overlaySchema.endMs) and missing startMs to 0.
export function findCoveringScene(plan, component, wordMs, windowMs) {
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const overlays = Array.isArray(plan.overlays) ? plan.overlays : [];
  const candidates = [
    ...scenes.map((s) => ({ id: s.id, component: s.component, startMs: s.startMs, endMs: s.endMs })),
    ...overlays.map((o) => ({
      id: o.id,
      component: o.component,
      startMs: typeof o.startMs === "number" ? o.startMs : 0,
      endMs: typeof o.endMs === "number" ? o.endMs : plan.durationMs,
    })),
  ];
  for (const c of candidates) {
    if (c.component !== component) continue;
    if (wordMs >= c.startMs - windowMs && wordMs <= c.endMs + windowMs) return c;
  }
  return null;
}

// The pure scan. `registry` is the parsed array from engine/animation-keywords.json (or an
// equivalent test fixture) — never read from disk in here, matching lint/lint.mjs's own
// "no I/O in the rule body" discipline. Returns findings sorted by timestamp (stable,
// deterministic output — required for this to be diffable/greppable in CI later).
//
// Dedup: when two keywords of the SAME registry entry both match starting at the exact
// same word index (e.g. "percent" and "percent of" both matching on the word "percent"),
// only the LONGEST keyword's match is kept for that (component, wordIndex) pair — the more
// specific phrase is the more informative one to report, and reporting both would just be
// noise about the same real moment.
export function scanKeywords(plan, transcript, registry, windowMs = DEFAULT_WINDOW_MS) {
  const words = buildWords(transcript);
  const raw = [];

  for (const entry of registry) {
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    for (const keyword of keywords) {
      const tokens = keywordTokens(keyword);
      for (const wordIndex of findPhraseMatches(words, tokens)) {
        raw.push({
          wordIndex,
          wordMs: words[wordIndex].ms,
          matchedText: words
            .slice(wordIndex, wordIndex + tokens.length)
            .map((w) => w.text)
            .join(" "),
          matchedKeyword: keyword,
          component: entry.component,
          category: entry.category,
          description: entry.description,
          tokenCount: tokens.length,
        });
      }
    }
  }

  // Dedup per (component, wordIndex): keep the match with the most tokens (most specific).
  const bestByKey = new Map();
  for (const m of raw) {
    const key = `${m.component}::${m.wordIndex}`;
    const existing = bestByKey.get(key);
    if (!existing || m.tokenCount > existing.tokenCount) bestByKey.set(key, m);
  }

  const findings = [...bestByKey.values()]
    .sort((a, b) => a.wordMs - b.wordMs || a.component.localeCompare(b.component))
    .map((m) => {
      const covering = findCoveringScene(plan, m.component, m.wordMs, windowMs);
      return {
        wordMs: m.wordMs,
        matchedText: m.matchedText,
        matchedKeyword: m.matchedKeyword,
        component: m.component,
        category: m.category,
        description: m.description,
        covered: Boolean(covering),
        coveringSceneId: covering?.id ?? null,
      };
    });

  return findings;
}