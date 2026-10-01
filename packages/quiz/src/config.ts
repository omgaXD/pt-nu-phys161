import { DifficultySchema } from '@pt/core';
import { z } from 'zod';

/**
 * A difficulty range (inclusive). Unrated problems (fixed ones, mostly) are
 * left out unless `unrated` is set. The full range 1–5 is no filter at all:
 * see `difficultyFilter`.
 */
export const DifficultyFilterSchema = z
  .strictObject({ min: DifficultySchema, max: DifficultySchema, unrated: z.boolean() })
  .refine((d) => d.min <= d.max, { message: 'min must be <= max', path: ['max'] });
export type DifficultyFilter = z.infer<typeof DifficultyFilterSchema>;

/** The effective filter: `undefined` when it lets every problem through (absent, or the full range). */
export function difficultyFilter(d: DifficultyFilter | undefined): DifficultyFilter | undefined {
  return d && (d.min > 1 || d.max < 5) ? d : undefined;
}

/**
 * One configuration model for every way of taking a quiz. The presets are
 * just values of it: picking one sets the mode fields and keeps the content
 * selection (sets, sections, excluded problems).
 */
export const QuizConfigSchema = z.strictObject({
  /** Selected set ids. */
  sets: z.array(z.string().min(1)).min(1),
  /** Per set, the selected section ids (see `sectionSlug`); absent = every section, empty = none. */
  sections: z.record(z.string(), z.array(z.string())).default({}),
  /** Per set, problem labels left out of the selected sections (see `selection.ts`); absent = none. */
  exclude: z.record(z.string(), z.array(z.string())).default({}),
  /** `random`: fresh numbers per attempt; `source`: the source document's own numbers. */
  values: z.enum(['random', 'source']),
  /** Include problems that are not randomized yet (played with the source's numbers). */
  includeFixed: z.boolean(),
  /** Leave out problems already solved (local progress; never part of a share link). */
  skipSolved: z.boolean().default(false),
  /** Only problems in this difficulty range; absent = every problem. */
  difficulty: DifficultyFilterSchema.optional(),
  /** How many questions: every selected problem, or a sample of N. */
  count: z.union([z.literal('all'), z.number().int().min(1).max(1000)]),
  /** How a sample is spread: evenly over problems, sections or sets. */
  draw: z.enum(['uniform', 'sections', 'sets']),
  /** Source order (set, then problem number), shuffled, or by difficulty (shuffled within each level). */
  order: z.enum(['source', 'shuffled', 'easy-first', 'hard-first']),
  /** `immediate`: a Check button per question; `deferred`: feedback only after finishing. */
  feedback: z.enum(['immediate', 'deferred']),
  /** Immediate feedback only: checks allowed per question; null = unlimited. */
  maxTries: z.number().int().min(1).max(99).nullable(),
  /** Immediate feedback only: a "Show correct answer" button (the question then earns nothing). */
  allowReveal: z.boolean(),
  /** Auto-submit after this many minutes; null = no limit. */
  timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
  /** Attempt seed: fixes the draw, the order and every question's numbers. Random when absent. */
  seed: z.number().int().min(0).max(0xffff_ffff).optional(),
});
export type QuizConfig = z.infer<typeof QuizConfigSchema>;
export type QuizConfigInput = z.input<typeof QuizConfigSchema>;

/** The fields a preset decides. */
export type ModeFields = Omit<QuizConfig, 'sets' | 'sections' | 'exclude' | 'skipSolved' | 'difficulty' | 'seed'>;
export const MODE_FIELDS = [
  'values',
  'includeFixed',
  'count',
  'draw',
  'order',
  'feedback',
  'maxTries',
  'allowReveal',
  'timeLimitMinutes',
] as const satisfies readonly (keyof ModeFields)[];

export const PRESET_IDS = ['ordered', 'exam', 'chaotic'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

const ORDERED: ModeFields = {
  values: 'random',
  includeFixed: true,
  count: 'all',
  draw: 'uniform',
  order: 'source',
  feedback: 'immediate',
  maxTries: null,
  allowReveal: true,
  timeLimitMinutes: null,
};

export const PRESETS: Readonly<Record<PresetId, Readonly<ModeFields>>> = Object.freeze({
  /** Every problem of the selected sets in source order, with a Check button. */
  ordered: ORDERED,
  /** Seven problems from different sections, feedback only at the end, 40 minutes. */
  exam: {
    values: 'random',
    includeFixed: true,
    count: 7,
    draw: 'sections',
    order: 'source',
    feedback: 'deferred',
    maxTries: null,
    allowReveal: false,
    timeLimitMinutes: 40,
  },
  /** Ordered, shuffled. */
  chaotic: { ...ORDERED, order: 'shuffled' },
});

export function defaultConfig(sets: readonly string[], preset: PresetId = 'ordered'): QuizConfig {
  return { sets: [...sets], sections: {}, exclude: {}, skipSolved: false, ...PRESETS[preset] };
}

/** Pick a preset: its mode fields replace the current ones; sets, sections, excluded problems, skipSolved, difficulty and seed stay. */
export function applyPreset(config: QuizConfig, preset: PresetId): QuizConfig {
  return { ...config, ...PRESETS[preset] };
}

/**
 * Mode fields with the ones that do not matter blanked out: the draw is
 * irrelevant without a sample, tries and reveal without immediate feedback.
 */
function effective(m: ModeFields): Record<string, unknown> {
  return {
    ...Object.fromEntries(MODE_FIELDS.map((k) => [k, m[k]])),
    ...(m.count === 'all' && { draw: null }),
    ...(m.feedback === 'deferred' && { maxTries: null, allowReveal: null }),
  };
}

/** Which preset the configuration is, or `custom` once any mode field differs. */
export function matchPreset(config: ModeFields): PresetId | 'custom' {
  const mine = JSON.stringify(effective(config));
  return PRESET_IDS.find((id) => JSON.stringify(effective(PRESETS[id])) === mine) ?? 'custom';
}
