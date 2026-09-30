import { z } from 'zod';
import { IDENTIFIER_RE, isReservedName } from '../expr/names.js';

// Zod is the single source of truth for types (§2.2). Objects are strict so a
// typo in a hand-authored YAML file (`tolernce:`) is an error, not silently
// dropped data.

/** Stable ids for scenarios and parts: lowercase kebab-ish, file-name safe. */
export const ID_RE = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

const Id = z.string().regex(ID_RE, { message: 'must be lowercase letters/digits separated by - _ or .' });

const VarName = z
  .string()
  .regex(IDENTIFIER_RE, { message: 'must start with a letter and contain only letters, digits and _' })
  .refine((n) => !isReservedName(n), { message: 'is a reserved name (constant, function or keyword)' });

const Decimals = z.number().int().min(0).max(15);
const Sigfigs = z.number().int().min(1).max(15);

// ---- Variables -------------------------------------------------------------

// Keys are declared in authoring order: zod output (and therefore every file
// the tools write) follows declaration order.
const varPresentation = {
  /** Round to N decimals BEFORE use (§3.3 step 3). */
  decimals: Decimals.optional(),
  /** Round to N significant figures BEFORE use; alternative to `decimals`. */
  sigfigs: Sigfigs.optional(),
  /** Unit shown next to the value in the prompt (`{name:unit}`). */
  unit: z.string().optional(),
  /** Human name for the editor UI. */
  label: z.string().optional(),
};

export const RangeVarSchema = z.strictObject({
  name: VarName,
  kind: z.literal('range'),
  min: z.number(),
  max: z.number(),
  /** Grid spacing. Default: 10^-decimals when `decimals` is set, otherwise 1. */
  step: z.number().positive().optional(),
  ...varPresentation,
});

export const ChoiceVarSchema = z.strictObject({
  name: VarName,
  kind: z.literal('choice'),
  options: z.array(z.union([z.number(), z.string()])).min(1),
  ...varPresentation,
});

export const RandomVarSchema = z
  .discriminatedUnion('kind', [RangeVarSchema, ChoiceVarSchema])
  .superRefine((v, ctx) => {
    if (v.decimals !== undefined && v.sigfigs !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'set either decimals or sigfigs, not both', path: ['sigfigs'] });
    }
    if (v.kind === 'range' && v.max < v.min) {
      ctx.addIssue({ code: 'custom', message: 'max must be >= min', path: ['max'] });
    }
  });

export const DerivedVarSchema = z.strictObject({
  name: VarName,
  /** Evaluated after randoms, in declaration order. */
  expr: z.string().min(1),
  unit: z.string().optional(),
});

// ---- Figures ---------------------------------------------------------------

const AssetPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split(/[\\/]/).includes('..') && !/^[a-z]+:/i.test(p), {
    message: 'must be a relative path inside the set directory',
  });

export const OverlaySchema = z.strictObject({
  id: z.string().min(1),
  /** Fractional coordinates, 0..1 from the top-left corner of the image. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /** Interpolated template text, e.g. "θ = {theta}°". */
  text: z.string(),
  anchor: z.enum(['start', 'middle', 'end']).optional(),
});

export const FigureSchema = z.strictObject({
  id: z.string().min(1),
  /** Asset path, relative to the set directory; resolved by the repository. */
  src: AssetPath,
  /** Required, non-empty: figures are first-class and must be accessible. */
  alt: z.string().trim().min(1, { message: 'alt text is required' }),
  /** May contain {var} interpolation. */
  caption: z.string().optional(),
  overlays: z.array(OverlaySchema).optional(),
});

// ---- Parts -----------------------------------------------------------------

/**
 * What a student may type (§3.2). A future `algebraic` type (symbolic
 * answers compared by numerical sampling) slots in here; grading dispatches on
 * this value so adding it does not change the Part shape.
 */
export const ANSWER_TYPES = ['number', 'numeric', 'numericalFormula'] as const;
export const AnswerTypeSchema = z.enum(ANSWER_TYPES);

export const ToleranceSchema = z.strictObject({
  /** Relative tolerance. Default 0.01. */
  rel: z.number().min(0).optional(),
  /** Absolute tolerance, used only when |model| is below `absBelow`. */
  abs: z.number().min(0).optional(),
  /** Default 1e-12. */
  absBelow: z.number().positive().optional(),
});

export const PartSchema = z.strictObject({
  id: Id,
  /** Markup with {var} interpolation and {_0} {_u} answer slots. */
  prompt: z.string(),
  answerType: AnswerTypeSchema.default('numeric'),
  /** Formula for the model answer, evaluated in the scenario scope. */
  answer: z.string().min(1),
  /** Expected unit; omit for dimensionless answers. */
  unit: z.string().min(1).optional(),
  /** 0..1, default 0.1 (Moodle: 0.9 for a right number with a wrong unit). Fraction of credit lost for a wrong/missing unit. */
  unitPenalty: z.number().min(0).max(1).optional(),
  tolerance: ToleranceSchema.default({}),
  /** The answer is an exact integer; tolerance does not apply. */
  integer: z.boolean().optional(),
  /**
   * The unit must be written exactly as expected (same components, any order):
   * no conversion within a dimension class. For "express the answer in km/h".
   */
  exactUnit: z.boolean().optional(),
  /** Weight within the scenario, default 1. */
  mark: z.number().positive().optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  tags: z.array(z.string().min(1)).optional(),
  hint: z.string().optional(),
  /** Worked solution markup, shown in review modes. */
  solution: z.string().optional(),
});

// ---- Canonical check (§2.4) ------------------------------------------------

const PinnedValues = z.record(z.string(), z.union([z.number(), z.string()]));

export const CanonicalPartSchema = z.strictObject({
  id: z.string().min(1),
  /** The answer printed in the source document. */
  answer: z.number(),
  /** Unit of the printed answer, if any (may differ from part.unit if compatible). */
  unit: z.string().min(1).optional(),
  /** Source label for this particular check, e.g. "P13". */
  source: z.string().optional(),
  /**
   * Per-part overrides merged over `canonical.vars`. Sibling source problems
   * often use different numbers (P12/P13/P14); this lets every part of a
   * multi-part scenario be verified against its own source values.
   */
  vars: PinnedValues.optional(),
});

export const CanonicalCheckSchema = z.strictObject({
  /**
   * Source values. Random variables are pinned to these; a key naming a
   * derived variable is asserted (e.g. `g: 9.8`) rather than overridden.
   */
  vars: PinnedValues,
  parts: z.array(CanonicalPartSchema).min(1),
});

// ---- Scenario --------------------------------------------------------------

export const SourceRefSchema = z.strictObject({
  document: z.string().min(1),
  labels: z.array(z.string()).default([]),
});

export const ScenarioSchema = z
  .strictObject({
    /** Stable id, e.g. "phys161-e2-luggage-ramp". */
    id: Id,
    /** Short human title for listings; defaults to the start of the narrative. */
    title: z.string().optional(),
    source: SourceRefSchema.optional(),
    section: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    figure: FigureSchema.optional(),
    /** Shared text with {var} interpolation. */
    narrative: z.string(),
    vars: z.array(RandomVarSchema).default([]),
    derived: z.array(DerivedVarSchema).default([]),
    /** Boolean expressions; a falsy one rejects the draw (§3.3). */
    constraints: z.array(z.string().min(1)).default([]),
    /** Default 200. */
    maxSampleAttempts: z.number().int().positive().max(100_000).optional(),
    parts: z.array(PartSchema).min(1),
    canonical: CanonicalCheckSchema,
    /** Saved while failing its canonical check. */
    draft: z.boolean().optional(),
  })
  .superRefine((s, ctx) => {
    const names = new Map<string, string>();
    s.vars.forEach((v, i) => {
      if (names.has(v.name)) {
        ctx.addIssue({ code: 'custom', message: `duplicate variable name "${v.name}"`, path: ['vars', i, 'name'] });
      }
      names.set(v.name, 'random');
    });
    s.derived.forEach((d, i) => {
      if (names.has(d.name)) {
        ctx.addIssue({ code: 'custom', message: `duplicate variable name "${d.name}"`, path: ['derived', i, 'name'] });
      }
      names.set(d.name, 'derived');
    });

    const partIds = new Set<string>();
    s.parts.forEach((p, i) => {
      if (partIds.has(p.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate part id "${p.id}"`, path: ['parts', i, 'id'] });
      }
      partIds.add(p.id);
    });

    for (const key of Object.keys(s.canonical.vars)) {
      if (!names.has(key)) {
        ctx.addIssue({ code: 'custom', message: `unknown variable "${key}"`, path: ['canonical', 'vars', key] });
      }
    }
    const randomNames = s.vars.map((v) => v.name);
    const sources = new Set<string>();
    s.canonical.parts.forEach((cp, i) => {
      if (!partIds.has(cp.id)) {
        ctx.addIssue({ code: 'custom', message: `unknown part "${cp.id}"`, path: ['canonical', 'parts', i, 'id'] });
      }
      if (cp.source !== undefined) {
        if (sources.has(cp.source)) {
          ctx.addIssue({ code: 'custom', message: `duplicate canonical source "${cp.source}"`, path: ['canonical', 'parts', i, 'source'] });
        }
        sources.add(cp.source);
      }
      for (const key of Object.keys(cp.vars ?? {})) {
        if (!names.has(key)) {
          ctx.addIssue({
            code: 'custom',
            message: `unknown variable "${key}"`,
            path: ['canonical', 'parts', i, 'vars', key],
          });
        }
      }
      const pinned = { ...s.canonical.vars, ...cp.vars };
      const missing = randomNames.filter((n) => !(n in pinned));
      if (missing.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `canonical values missing for ${missing.join(', ')}`,
          path: ['canonical', 'parts', i],
        });
      }
    });
  });

// ---- Derived types -----------------------------------------------------------

export type RangeVar = z.infer<typeof RangeVarSchema>;
export type ChoiceVar = z.infer<typeof ChoiceVarSchema>;
export type RandomVar = z.infer<typeof RandomVarSchema>;
export type DerivedVar = z.infer<typeof DerivedVarSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Figure = z.infer<typeof FigureSchema>;
export type AnswerType = z.infer<typeof AnswerTypeSchema>;
export type Tolerance = z.infer<typeof ToleranceSchema>;
export type Part = z.infer<typeof PartSchema>;
export type CanonicalPart = z.infer<typeof CanonicalPartSchema>;
export type CanonicalCheck = z.infer<typeof CanonicalCheckSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
/** The authored (pre-defaults) shape, e.g. what a YAML file contains. */
export type ScenarioInput = z.input<typeof ScenarioSchema>;
