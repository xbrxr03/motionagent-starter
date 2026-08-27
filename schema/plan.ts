// plan.json schema v2 (Zod is canonical; JSON Schema is exported FROM this file).
// Matches the CURRENT plan.json shape (v1: top-level fps/width/height/audio/durationMs,
// scenes[] with component/startMs/endMs/props) PLUS the v2 additions from
// EDITOR.md ("dual-control model" / "prop is the keyframe") and ARCHITECTURE.md §4:
//   - meta{title?,family,preset?,version:2,fps?,canvas{w,h}?,director?}
//   - per-scene: motion{}, overrides{palette?}, locks{}, author?, intent?,
//     transitionIn?/transitionOut?
//   - top-level: tracks?{audio?,captions?}, history?{cursor,patches[]}
//
// Component `props` are intentionally NOT deep-validated here — per ARCHITECTURE §5,
// prop schemas live with each component (registry/<component>/schema.ts) and get
// composed in at build time. This file validates plan STRUCTURE, not scene content.
//
// Run directly to regenerate plan.schema.json and self-check demo/plan.json:
//   node --experimental-strip-types schema/plan.ts
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
// SFX cue registry (sfx/sfx-registry.json) is the single source of truth for the valid
// cue vocabulary. Imported directly so the exported plan.schema.json enumerates the real
// cue names (non-TS agents consuming get_plan_schema see them), and so this file and the
// render-pipeline resolver (sfx/registry.mjs) can never drift on what a valid cue is.
// This import only executes under `node`/tsc; engine/* imports schema/plan as TYPE-ONLY,
// so it never reaches the Remotion webpack bundle.
import sfxRegistry from "../sfx/sfx-registry.json" with { type: "json" };

const ms = z.number().nonnegative();

// The valid `sfxCues[].cue` names, derived from the committed registry. Non-empty tuple
// cast keeps z.enum happy across Zod versions.
const SFX_CUE_NAMES = Object.keys(sfxRegistry.cues) as [string, ...string[]];

// ---------------------------------------------------------------------------
// Scene-level v2 additions (EDITOR.md "prop is the keyframe" + dual-control model)
// ---------------------------------------------------------------------------

// Named easing family — never a raw bezier (EDITOR.md: "calm/normal/punchy").
const emphasisSchema = z.enum(["calm", "normal", "punchy"]);

const motionSchema = z
  .object({
    intensity: z.number().min(0).max(100).optional(),
    direction: z.string().optional(),
    timingOffsetBeats: z.number().optional(),
    stagger: z.number().min(0).max(100).optional(),
    emphasis: emphasisSchema.optional(),
  })
  .partial()
  .optional();

// Per-scene palette/family override — enum-of-registered-families in spirit, but kept
// as an open string here since families register dynamically (registerFamily()).
const overridesSchema = z
  .object({
    palette: z.string().optional(),
  })
  .partial()
  .optional();

const locksSchema = z.record(z.string(), z.boolean()).optional();

// transitionIn/transitionOut: accept BOTH the ARCHITECTURE §4 shape (type/durMs) and
// the EDITOR.md shape (kind/durationBeats) — the two docs named this differently and
// neither is locked yet (ARCHITECTURE §4 status: OPEN, field bikeshedding welcome).
const transitionSchema = z.union([
  z
    .object({
      type: z.string(),
      durMs: z.number().nonnegative().optional(),
      direction: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.string(),
      durationBeats: z.number().nonnegative().optional(),
      direction: z.string().optional(),
    })
    .passthrough(),
]);

// ---------------------------------------------------------------------------
// Scene (v1 fields required; v2 fields all optional so v1 plans validate as-is)
// ---------------------------------------------------------------------------

export const sceneSchema = z
  .object({
    id: z.string(),
    component: z.string(),
    startMs: ms,
    endMs: ms,
    // Component-specific — see file header. Defaults to {} so a propless scene validates.
    props: z.record(z.string(), z.unknown()).default({}),

    // v2 additions
    motion: motionSchema,
    overrides: overridesSchema,
    locks: locksSchema,
    author: z.string().optional(),
    intent: z.string().optional(),
    transitionIn: transitionSchema.optional(),
    transitionOut: transitionSchema.optional(),
    locked: z.boolean().optional(), // ARCHITECTURE §4: edit-loop freeze flag
    // Camera shake on this scene's punch beats (PLANREEL-SPEC.md: the one genuine
    // per-reel datum previously hardcoded as a SHAKE_SCENES id-set per Reel*.tsx).
    // Cinematic-chrome only; ignored under static chrome (no Camera mounted there).
    shake: z.boolean().optional(),
  })
  .passthrough()
  .refine((s) => s.endMs >= s.startMs, {
    message: "endMs must be >= startMs",
    path: ["endMs"],
  });

// ---------------------------------------------------------------------------
// overlays[] (v2.1 addition, ARCHITECTURE-V2.md §4) — runtime-spanning layers no scene
// can express (the always-on karaoke caption, ref1's game-HUD rail, ref3's telemetry
// chrome). Same id/component/props shape as a scene, minus contiguity: overlays are NOT
// required to tile the timeline and MAY overlap each other in time (subject to lint R14's
// zone discipline, not a schema constraint — schema only enforces endMs >= startMs).
// ---------------------------------------------------------------------------

// Reserved bands (ARCHITECTURE-V2.md §4 point 2): "top" reserves the y<280 IG-unsafe-top
// adjacency, "bottom" the caption band; "free" claims neither and never zone-conflicts
// with anything (lint R14 skips it on both sides of the check).
const overlayZoneSchema = z.enum(["top", "bottom", "free"]);

export const overlaySchema = z
  .object({
    id: z.string(),
    component: z.string(),
    // Default 0 (schema-level default is safe here — unlike endMs below, it doesn't
    // depend on any sibling field). Runtime consumers (PlanReel, lint) that read RAW
    // parsed JSON rather than going through this zod schema must still apply the same
    // `?? 0` themselves — see PlanReel.tsx/lint.mjs's own comments on this.
    startMs: ms.default(0),
    // No schema-level default: "plan end" depends on the sibling top-level
    // `durationMs`, which zod object schemas can't reach from a per-field .default().
    // Consumers resolve it as `overlay.endMs ?? plan.durationMs`.
    endMs: ms.optional(),
    zone: overlayZoneSchema,
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough()
  .refine((o) => o.endMs === undefined || o.endMs >= o.startMs, {
    message: "endMs must be >= startMs",
    path: ["endMs"],
  });

// ---------------------------------------------------------------------------
// meta (v2 addition; current plan.json already carries meta.family)
// ---------------------------------------------------------------------------

export const metaSchema = z
  .object({
    title: z.string().optional(),
    family: z.string().default("signal"),
    preset: z.string().optional(),
    // HARDENING.md Gap #5: meta.version:2 is an awkward grammar target for a weak,
    // grammar-constrained model, which may emit the string "2" instead of the number 2.
    // A bare `z.literal(2).default(2)` only rescues an ABSENT meta.version — a wrong-typed
    // "2" still fails validation. Accept either literal (number 2 or string "2") and
    // normalize both to the number 2; anything else (e.g. 3, "v2") still fails as before.
    // Tradeoff: the transform makes this field "unrepresentable" to z.toJSONSchema() below
    // (it degrades to `{"default":2}` with no type/const, vs the previous `{"type":
    // "number","const":2}`) — acceptable per this file's header ("Zod is canonical; JSON
    // Schema is exported FROM this file"): runtime validation (what actually gates plans)
    // keeps the exact same strictness, only the exported artifact's self-description
    // loosens for this one field.
    version: z
      .union([z.literal(2), z.literal("2")])
      .transform((): 2 => 2)
      .default(2),
    // fps/canvas mirror the top-level fields in ARCHITECTURE §4's v2 example. The
    // CURRENT plan.json keeps fps/width/height top-level (kept below, required), so
    // these are optional here rather than duplicated/required — a plan may nest them
    // in meta once authors migrate, without breaking the v1 top-level fields.
    fps: z.number().int().positive().optional(),
    canvas: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .optional(),
    director: z
      .object({ generator: z.string().optional(), briefHash: z.string().optional() })
      .partial()
      .optional(),
    // Explicit transcript pairing (v1.1, director friction #5). By convention a plan's
    // transcript is inferred from its basename (plan2.json → demo/input/transcript2.json;
    // plan-foo.json → demo/input/transcript-foo.json in lint-all). When a plan reuses an
    // EXISTING transcript under a different name (e.g. plan-blind-stack3.json narrating
    // demo/input/transcript-stack3.json), that convention forces a duplicate transcript
    // file. meta.transcript names the transcript path explicitly (relative to the repo
    // root, e.g. "demo/input/transcript-stack3.json"); lint-all and render-final honor it
    // FIRST, falling back to the basename convention when absent.
    transcript: z.string().optional(),
    // v2.1 (ARCHITECTURE-V2.md §4 tail / §10 V2-7) — carried into this migration WITH
    // overlays[] per that doc's own instruction ("ride the overlays migration... one
    // migration"). All three optional with byte-neutral defaults for every existing
    // plan; nothing downstream reads them yet (still-unbuilt multiformat debt) — adding
    // them now just means a future format/durationClass/timingSpine consumer doesn't
    // force a second schema migration.
    format: z.string().default("portrait-9x16"),
    durationClass: z.string().default("reel"),
    timingSpine: z.object({ type: z.string() }).passthrough().default({ type: "word" }),
    // SFX master switch — DEFAULT OFF. Absent/false means the render pipeline mixes NO
    // sound effects and behaves byte-identically to before this feature existed (Abrar's
    // explicit instruction: don't change existing plans' audio). A plan opts in by setting
    // this true AND carrying a non-empty top-level sfxCues[]. Intentionally NO default here
    // (unlike the fields above) so an existing plan's parsed meta stays exactly as authored.
    sfxEnabled: z.boolean().optional(),
  })
  .passthrough();

// Full defaulted meta object, used when `meta` is entirely absent from the plan.
// (A bare `.default({})` on the field below would substitute `{}` verbatim without
// re-running metaSchema's own per-field defaults — this factory sidesteps that.)
const defaultMeta = () => metaSchema.parse({});

// ---------------------------------------------------------------------------
// tracks / history (v2 top-level additions — EDITOR.md dual-control model)
// ---------------------------------------------------------------------------

const tracksSchema = z
  .object({
    audio: z.array(z.record(z.string(), z.unknown())).optional(),
    captions: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .partial()
  .optional();

// One JSON patch, carrying its inverse so undo is a stack pop, not a recompute.
const historyPatchSchema = z
  .object({
    op: z.string().optional(),
    path: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).optional(),
    value: z.unknown().optional(),
    inverse: z.unknown().optional(),
    author: z.string().optional(),
    intent: z.string().optional(),
    ts: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const historySchema = z
  .object({
    cursor: z.number().int().nonnegative(),
    patches: z.array(historyPatchSchema),
  })
  .optional();

// ---------------------------------------------------------------------------
// mediaSlots[] / sourceClips[] / editDecisions[] (v2.2)
// ---------------------------------------------------------------------------

const mediaSlotKindSchema = z.enum(["image", "video", "screenshot", "avatar", "logo"]);
const mediaFitSchema = z.enum(["cover", "contain", "crop"]);

export const mediaSlotSchema = z
  .object({
    id: z.string(),
    kind: mediaSlotKindSchema,
    src: z.string().optional(),
    alt: z.string().optional(),
    fit: mediaFitSchema.default("cover"),
    crop: z
      .object({
        x: z.number().min(0).max(1).default(0.5),
        y: z.number().min(0).max(1).default(0.5),
        scale: z.number().positive().default(1),
      })
      .partial()
      .optional(),
    caption: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const sourceClipSchema = z
  .object({
    id: z.string(),
    src: z.string(),
    kind: z.enum(["video", "audio"]).default("video"),
    durationMs: ms.optional(),
    transcript: z.string().optional(),
    speakerHints: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const editDecisionSchema = z
  .object({
    id: z.string(),
    sourceClip: z.string(),
    inMs: ms,
    outMs: ms,
    role: z.string().optional(),
    crop: z.string().optional(),
    audio: z.enum(["primary", "muted", "ducked"]).default("primary"),
    transcriptSpan: z
      .object({
        startWord: z.number().int().nonnegative(),
        endWord: z.number().int().nonnegative(),
      })
      .partial()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .refine((d) => d.outMs >= d.inMs, {
    message: "outMs must be >= inMs",
    path: ["outMs"],
  });

// ---------------------------------------------------------------------------
// sfxCues[] (SFX-cue system) — explicitly authored cues that resolve, at render time, to a
// cached CC0 audio asset via sfx/sfx-registry.json and get mixed into the final audio at
// `atMs` (cli/audio-master.mjs's `--sfx path:atMs`). DEFAULT OFF: only mixed when
// meta.sfxEnabled=true. `cue` is a z.enum of the registry's real cue names, so an unknown
// cue fails validation with the valid list, and plan.schema.json enumerates them.
//
// NOTE (fast-follow, intentionally NOT done here): cues are AUTHORED, not auto-derived from
// component-manifest `sfx` tags — that manifest-driven auto-detection waits until the
// concurrent lint/lint.mjs COMPONENT_MANIFEST generalization lands (see task scope note).
// ---------------------------------------------------------------------------

export const sfxCueSchema = z
  .object({
    id: z.string(),
    atMs: ms, // nonnegative; upper bound (<= plan.durationMs) checked at the plan level below
    cue: z.enum(SFX_CUE_NAMES),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Plan (top level)
// ---------------------------------------------------------------------------

export const planSchema = z
  .object({
    // v1 fields — unchanged, required, exactly what demo/plan.json has today.
    fps: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    audio: z.string(),
    audioDurationMs: ms,
    durationMs: ms,
    scenes: z.array(sceneSchema).min(1),
    meta: metaSchema.default(defaultMeta),

    // v2 top-level additions
    tracks: tracksSchema,
    history: historySchema,

    // v2.1 (ARCHITECTURE-V2.md §4) — optional and defaulted to [] so every existing
    // plan (none of which carry this key) validates identically to before.
    overlays: z.array(overlaySchema).default([]),

    // SFX-cue system — optional, defaulted to [] so every existing plan (none carry it)
    // validates identically. Only mixed into audio when meta.sfxEnabled=true (default off).
    sfxCues: z.array(sfxCueSchema).default([]),

    // v2.2 media/clip registry — optional and defaulted to [] so existing plans remain
    // byte-neutral. Components may still accept direct `media` props as a bridge, but new
    // plans should reference these registries by `mediaSlotId` / `editDecisionId`.
    mediaSlots: z.array(mediaSlotSchema).default([]),
    sourceClips: z.array(sourceClipSchema).default([]),
    editDecisions: z.array(editDecisionSchema).default([]),
  })
  .passthrough()
  // atMs upper-bound check lives here (not on sfxCueSchema) because it needs the sibling
  // top-level durationMs. Per-cue lower bound (>= 0) is already enforced by `ms` above, and
  // cue-name membership by the z.enum. This is the "basic validation" the task asks for,
  // kept entirely out of lint/lint.mjs (no COMPONENT_MANIFEST touched); the render pipeline
  // enforces the identical two rules independently via sfx/registry.mjs.
  .superRefine((plan, ctx) => {
    for (let i = 0; i < (plan.sfxCues ?? []).length; i++) {
      const atMs = plan.sfxCues[i].atMs;
      if (typeof plan.durationMs === "number" && atMs > plan.durationMs) {
        ctx.addIssue({
          code: "custom",
          message: `atMs ${atMs} is past plan.durationMs ${plan.durationMs}`,
          path: ["sfxCues", i, "atMs"],
        });
      }
    }

    const mediaSlotIds = new Set<string>();
    (plan.mediaSlots ?? []).forEach((slot, i) => {
      if (mediaSlotIds.has(slot.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate mediaSlot id "${slot.id}"`, path: ["mediaSlots", i, "id"] });
      }
      mediaSlotIds.add(slot.id);
    });

    const sourceClipIds = new Set<string>();
    (plan.sourceClips ?? []).forEach((clip, i) => {
      if (sourceClipIds.has(clip.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate sourceClip id "${clip.id}"`, path: ["sourceClips", i, "id"] });
      }
      sourceClipIds.add(clip.id);
    });

    const editDecisionIds = new Set<string>();
    (plan.editDecisions ?? []).forEach((decision, i) => {
      if (editDecisionIds.has(decision.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate editDecision id "${decision.id}"`, path: ["editDecisions", i, "id"] });
      }
      editDecisionIds.add(decision.id);
      if (!sourceClipIds.has(decision.sourceClip)) {
        ctx.addIssue({
          code: "custom",
          message: `unknown sourceClip "${decision.sourceClip}"`,
          path: ["editDecisions", i, "sourceClip"],
        });
      }
    });
  });

export type Plan = z.infer<typeof planSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Overlay = z.infer<typeof overlaySchema>;
export type SfxCue = z.infer<typeof sfxCueSchema>;
export type MediaSlot = z.infer<typeof mediaSlotSchema>;
export type SourceClip = z.infer<typeof sourceClipSchema>;
export type EditDecision = z.infer<typeof editDecisionSchema>;

export type ValidatePlanResult =
  | { ok: true; data: Plan; errors: [] }
  | { ok: false; data: null; errors: string[] };

/** Validate an arbitrary JSON value against the plan schema. Never throws. */
export const validatePlan = (json: unknown): ValidatePlanResult => {
  const result = planSchema.safeParse(json);
  if (result.success) {
    return { ok: true, data: result.data, errors: [] };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return { ok: false, data: null, errors };
};

/** JSON Schema (draft 2020-12), generated from the same Zod schema — non-TS agents /
 * the future `get_plan_schema` MCP tool consume this instead of re-deriving it. */
export const getPlanJsonSchema = () => z.toJSONSchema(planSchema, { unrepresentable: "any" });

// ---------------------------------------------------------------------------
// CLI mode: `node --experimental-strip-types schema/plan.ts`
// Regenerates plan.schema.json next to this file and self-checks demo/plan.json.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const { writeFileSync, readFileSync } = await import("node:fs");
  const dir = fileURLToPath(new URL(".", import.meta.url));

  const jsonSchema = getPlanJsonSchema();
  writeFileSync(`${dir}plan.schema.json`, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`wrote ${dir}plan.schema.json`);

  const planPath = `${dir}../demo/plan.json`;
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const result = validatePlan(plan);
  if (result.ok) {
    console.log(`✓ ${planPath} validates (meta.family=${result.data.meta.family}, meta.version=${result.data.meta.version}, ${result.data.scenes.length} scenes)`);
  } else {
    console.error(`✕ ${planPath} FAILED validation:`);
    for (const e of result.errors) console.error(`  ✕ ${e}`);
    process.exit(1);
  }
}
