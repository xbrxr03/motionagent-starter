// preset.json schema (ARCHITECTURE.md §7). Zod is canonical, same pattern as
// schema/plan.ts: JSON Schema is exported FROM this file, not hand-maintained separately.
//
// Deliberately MINIMAL relative to ARCHITECTURE §7's full description ("family,
// dials{motion,density,variance}, beat envelope, sceneMix ranges per component,
// tokenOverrides, captions config"). This schema covers exactly what's actually wired
// into lint() via presets/dials.ts's resolveDials() — id/label/family/dials/description.
// sceneMix ranges, tokenOverrides, and captions config are real ARCHITECTURE §7 ideas but
// have no consuming code yet (no rule reads a sceneMix range, no render path applies a
// tokenOverride); adding schema fields for them now would let a preset author write
// settings that silently do nothing. Extend this schema in the same change that adds the
// code consuming a new field, not before.
//
// Run directly to regenerate preset.schema.json and self-check every presets/*.json:
//   node --experimental-strip-types schema/preset.ts
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dialValue = z.number().int().min(1).max(10);

export const presetSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  // Default family for a plan using this preset — plan.meta.family still wins if a plan
  // sets its own, same "per-scene overrides win" precedent as everywhere else in this
  // schema family. Not validated against TokenProvider's registered family ids here
  // (schema/ has no dependency on tokens/ or the bundler) — lint()'s own family lookup
  // already falls back safely on an unknown id.
  family: z.string(),
  dials: z.object({
    motion: dialValue,
    density: dialValue,
    variance: dialValue,
  }),
});

export type Preset = z.infer<typeof presetSchema>;

export const validatePreset = (json: unknown) => {
  const result = presetSchema.safeParse(json);
  if (result.success) {
    return { ok: true as const, data: result.data, errors: [] };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return { ok: false as const, data: null, errors };
};

export const getPresetJsonSchema = () => z.toJSONSchema(presetSchema, { unrepresentable: "any" });

// ---------------------------------------------------------------------------
// CLI mode: `node --experimental-strip-types schema/preset.ts`
// Regenerates preset.schema.json next to this file and self-checks every presets/*.json.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const dir = fileURLToPath(new URL(".", import.meta.url));

  const jsonSchema = getPresetJsonSchema();
  writeFileSync(`${dir}preset.schema.json`, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`wrote ${dir}preset.schema.json`);

  const presetsDir = `${dir}../presets`;
  const files = readdirSync(presetsDir).filter((f) => f.endsWith(".json"));
  let failed = false;
  for (const file of files) {
    const json = JSON.parse(readFileSync(`${presetsDir}/${file}`, "utf8"));
    const result = validatePreset(json);
    if (result.ok) {
      console.log(`✓ presets/${file} validates (id=${result.data.id}, family=${result.data.family})`);
    } else {
      failed = true;
      console.error(`✕ presets/${file} FAILED validation:`);
      for (const e of result.errors) console.error(`  ✕ ${e}`);
    }
  }
  if (failed) process.exit(1);
}
