// cli/ingest-brief.mjs — shared "content brief" shape + helpers for the non-audio ingest
// paths (SPEC.md's pipeline line: "ingest (whisper word-timestamps | Readability | pdf.js
// | TTS if no audio)"). cli/ingest-url.mjs and cli/ingest-pdf.mjs both turn some source
// (a web page / a PDF) into the SAME normalized JSON artifact; that normalization lives
// here so the two scripts can't drift apart on field names or highlight heuristics.
//
// WHAT A "CONTENT BRIEF" IS (and is NOT):
//   It is a clean, source-agnostic bag of extracted content — title, body text, a couple
//   of best-effort key stats/quotes, and (for URLs) a product screenshot path. It is the
//   raw material a Director/storyboard step reasons OVER, not a scene plan and not a
//   DirectorInput. There is deliberately NO tone/dataPoints/comparisons/codeSnippet
//   structuring here: ROADMAP.md's "DirectorInput schema (tone + dataPoints/quotes/
//   comparisons hints)" and "Director v1" are unbuilt as real code (grep: only ROADMAP.md
//   mentions them), so this file does NOT invent that schema — it stops at "here is the
//   content, cleanly." Feeding a brief into a real DirectorInput is future wiring (Wave 5
//   MCP `ingest_url`/`ingest_pdf` + Director v1), noted so it's not forgotten, just not
//   this task's scope.
//
// Output lands at demo/input/brief-<slug>.json — same demo/input/ home and <thing>-<slug>
// naming as cli/ingest.mjs's transcript-<slug>.json, so all ingest artifacts sit together.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Bump this if the brief shape changes incompatibly — a downstream Director/MCP consumer
// can gate on it instead of guessing. @1 = the shape emitted below.
export const BRIEF_SCHEMA = "motionagent/content-brief@1";

// Same slug rule as cli/ingest.mjs (alphanumeric + hyphen) — slugs become filenames and,
// for URLs, the public/captures/<slug>/ folder capture.mjs writes, so keep them tame.
export function assertSlug(slug) {
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    console.error(`✕ --slug must be alphanumeric/hyphen only, got: "${slug ?? ""}"`);
    process.exit(1);
  }
}

// Best-effort highlight extraction. Intentionally dumb and deterministic — NOT an attempt
// at real key-point extraction (that's the Director's LLM job downstream). These just
// surface obvious candidates a human or the Director can keep/drop:
//   - quotes: spans wrapped in straight or curly double-quotes (8..240 chars inside).
//   - stats: sentences that carry a number/percentage (12..220 chars), the kind that map
//     nicely onto a StatFlip/StatCard/CountUp component later.
// Both are capped and de-duplicated. Empty arrays are a fine, expected result.
export function extractHighlights(text) {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();

  const quotes = [];
  const quoteRe = /["“]([^"“”]{8,240}?)["”]/g;
  let qm;
  while ((qm = quoteRe.exec(clean)) !== null) {
    const q = qm[1].trim();
    if (q && !quotes.includes(q)) quotes.push(q);
    if (quotes.length >= 6) break;
  }

  const stats = [];
  // Split into sentences on terminal punctuation (optionally followed by a closing quote,
  // e.g. `… not." Roughly …`) followed by whitespace.
  for (const raw of clean.split(/(?<=[.!?]["”')\]]?)\s+/)) {
    const s = raw.trim();
    if (s.length < 12 || s.length > 220) continue;
    if (!/\d/.test(s)) continue; // must carry a number to be a "stat"
    if (!stats.includes(s)) stats.push(s);
    if (stats.length >= 6) break;
  }

  return { stats, quotes };
}

// Tidy extracted body text without destroying structure: normalize line endings, collapse
// runs of spaces/tabs (Readability's textContent is full of indentation tabs; pdfjs joins
// glyph-runs with spaces), trim spaces around newlines, and cap blank-line runs. Only
// spaces/tabs collapse — newlines are preserved, so words never merge and paragraph breaks
// survive. A downstream Director can re-flow further; this just removes obvious noise.
function normalizeBodyText(text) {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Assemble the normalized brief. Callers pass whatever they extracted; every field is
// present in the output (null where a source doesn't have it — e.g. a PDF has no siteName,
// a URL has no pageCount) so a consumer sees ONE stable shape regardless of source.
export function buildBrief({
  source,
  title,
  byline = null,
  siteName = null,
  excerpt = null,
  text,
  screenshot = null,
  pageCount = null,
  capture = null,
  notes = [],
}) {
  const body = normalizeBodyText(text);
  const { stats, quotes } = extractHighlights(body);
  return {
    schema: BRIEF_SCHEMA,
    source, // { type: "url"|"pdf", ref: <url|abs path>, fetchedAt: null }
    title: (title ?? "").trim() || "(untitled)",
    byline: byline || null,
    siteName: siteName || null,
    excerpt: excerpt ? excerpt.trim() : null,
    text: body,
    wordCount: body ? body.split(/\s+/).filter(Boolean).length : 0,
    stats,
    quotes,
    screenshot: screenshot || null, // path RELATIVE TO public/ (capture.mjs convention) or null
    pageCount: pageCount ?? null,
    capture: capture ?? null, // { ok, note } for the URL screenshot step, or null
    notes, // provenance / caveats for a human or the Director (e.g. "Readability failed; used body text")
  };
}

// Write demo/input/brief-<slug>.json (creating demo/input/ if needed) and return the path.
// Trailing newline + 2-space indent matches capture.mjs's meta.json / the repo's JSON style.
export function writeBrief(slug, brief) {
  const dir = path.resolve("demo/input");
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `brief-${slug}.json`);
  writeFileSync(out, `${JSON.stringify(brief, null, 2)}\n`);
  return out;
}
