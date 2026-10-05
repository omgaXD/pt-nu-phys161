import { z } from 'zod';
import type { Attempt } from './attempt.js';
import { CatalogQuestionSchema } from './bundle.js';
import { PRESET_IDS, QuizConfigSchema } from './config.js';
import type { Mastery } from './mastery.js';
import type { HistoryEntry } from './storage.js';

/**
 * A saved-state file: everything the quiz keeps in one browser, so it can be
 * moved to another one (or backed up). Every section is optional; importing
 * picks which ones to take.
 */
export const STATE_FILE_KIND = 'pt-quiz-state';
export const STATE_FILE_FORMAT = 1;

export interface QuizStateFile {
  kind: typeof STATE_FILE_KIND;
  format: typeof STATE_FILE_FORMAT;
  /** When the file was written (ms, the exporting browser's clock). */
  exportedAt: number;
  /** Content version at export; null when content was not loaded. */
  contentVersion: string | null;
  /** Per-problem progress. */
  mastery?: Mastery;
  /** The attempt in progress, up to the question on screen. */
  attempt?: Attempt;
  /** Finished attempts: every history entry, and the full attempts still kept for review. */
  history?: { entries: HistoryEntry[]; attempts: Attempt[] };
  /** The app's preferences (the last start-page configuration). */
  prefs?: unknown;
}

const PresetSchema = z.enum([...PRESET_IDS, 'custom']);
const FinishReasonSchema = z.enum(['submitted', 'timeout']);
const FieldContentsSchema = z.object({ value: z.string(), unit: z.string() });
// Grading results and snapshots are records of what the app produced: checked for shape, kept whole.
const PartResultSchema = z.looseObject({ partId: z.string(), fraction: z.number().min(0).max(1) });
const SnapshotSchema = z.looseObject({
  instance: z.looseObject({ parts: z.array(z.looseObject({})).min(1) }),
  part: z.looseObject({ id: z.string() }),
  scenarioHash: z.string(),
  sourceValues: z.boolean(),
});

const MasteryEntrySchema = z.object({
  attempts: z.number().int().min(0),
  solved: z.boolean(),
  lastFraction: z.number().min(0).max(1),
  lastAt: z.number(),
  lastAttemptId: z.string(),
});

const HistoryEntrySchema = z.object({
  id: z.string().min(1),
  preset: PresetSchema,
  sets: z.array(z.string()),
  startedAt: z.number(),
  finishedAt: z.number(),
  finishReason: FinishReasonSchema,
  marks: z.number(),
  total: z.number(),
  questions: z.number().int(),
  full: z.boolean(),
});

const PER_QUESTION = ['snapshots', 'answers', 'checks', 'revealed', 'flagged', 'unavailable', 'final', 'marks'] as const;

/** A stored or exported attempt; parsing fills in config fields added since it was saved. */
export const AttemptSchema = z
  .object({
    format: z.literal(1),
    id: z.string().min(1),
    config: QuizConfigSchema,
    seed: z.number().int(),
    preset: PresetSchema,
    contentVersion: z.string(),
    startedAt: z.number(),
    endsAt: z.number().nullable(),
    finishedAt: z.number().nullable(),
    finishReason: FinishReasonSchema.nullable(),
    questions: z.array(CatalogQuestionSchema.extend({ seed: z.number().int().nullable() })).min(1),
    snapshots: z.array(SnapshotSchema.nullable()),
    answers: z.array(FieldContentsSchema),
    checks: z.array(z.array(z.object({ at: z.number(), answer: FieldContentsSchema, result: PartResultSchema }))),
    revealed: z.array(z.boolean()),
    flagged: z.array(z.boolean()),
    unavailable: z.array(z.boolean()),
    final: z.array(PartResultSchema.nullable()),
    marks: z.array(z.number()),
    page: z.number().int().min(0),
  })
  .superRefine((a, ctx) => {
    const n = a.questions.length;
    for (const k of PER_QUESTION) {
      if (a[k].length !== n) ctx.addIssue({ code: 'custom', path: [k], message: `has ${a[k].length} entries for ${n} questions` });
    }
    if (a.page >= n) ctx.addIssue({ code: 'custom', path: ['page'], message: `is past the last question` });
    if ((a.finishedAt === null) !== (a.finishReason === null)) ctx.addIssue({ code: 'custom', path: ['finishReason'], message: 'does not match finishedAt' });
  });

const StateFileSchema = z.object({
  kind: z.literal(STATE_FILE_KIND),
  format: z.literal(STATE_FILE_FORMAT),
  exportedAt: z.number(),
  contentVersion: z.string().nullable(),
  mastery: z.record(z.string(), MasteryEntrySchema).optional(),
  attempt: AttemptSchema.refine((a) => a.finishedAt === null, 'is already finished').optional(),
  history: z
    .object({
      entries: z.array(HistoryEntrySchema),
      attempts: z.array(AttemptSchema.refine((a) => a.finishedAt !== null, 'is not finished')),
    })
    .optional(),
  prefs: z.unknown().optional(),
});

export interface StateFileParts {
  now: number;
  contentVersion: string | null;
  mastery: Mastery;
  attempt: Attempt | null;
  history: { entries: HistoryEntry[]; attempts: Attempt[] };
  prefs: unknown;
}

/** The file for the given state; empty sections are left out. */
export function createStateFile(s: StateFileParts): QuizStateFile {
  const file: QuizStateFile = { kind: STATE_FILE_KIND, format: STATE_FILE_FORMAT, exportedAt: s.now, contentVersion: s.contentVersion };
  if (Object.keys(s.mastery).length > 0) file.mastery = s.mastery;
  if (s.attempt && s.attempt.finishedAt === null) file.attempt = s.attempt;
  if (s.history.entries.length > 0) file.history = s.history;
  if (s.prefs !== null && s.prefs !== undefined) file.prefs = s.prefs;
  return file;
}

export type ParsedStateFile = { ok: true; file: QuizStateFile } | { ok: false; message: string };

/** Read a saved-state file, with a readable message when it is not one or is damaged. */
export function parseStateFile(text: string): ParsedStateFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This is not a saved quiz state (the file is not JSON).' };
  }
  const head = z.looseObject({ kind: z.literal(STATE_FILE_KIND), format: z.number() }).safeParse(raw);
  if (!head.success) return { ok: false, message: 'This is not a saved quiz state.' };
  if (head.data.format !== STATE_FILE_FORMAT) {
    return { ok: false, message: 'This file was saved by a newer version of the quiz. Reload the page and try again.' };
  }
  const parsed = StateFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')} ` : '';
    return { ok: false, message: `The file is damaged (${where}${issue?.message ?? 'invalid'}).` };
  }
  // Snapshots and grading results are checked for shape only; they are what this app wrote.
  return { ok: true, file: parsed.data as unknown as QuizStateFile };
}

/**
 * Combine two progress records: a problem solved on either side stays solved,
 * the more recent result wins, and attempts take the larger count (re-importing
 * your own export must not count attempts twice).
 */
export function mergeMastery(here: Mastery, incoming: Mastery): Mastery {
  const out: Mastery = { ...here };
  for (const [key, b] of Object.entries(incoming)) {
    const a = out[key];
    if (!a) {
      out[key] = b;
      continue;
    }
    const newer = b.lastAt > a.lastAt ? b : a;
    out[key] = { ...newer, attempts: Math.max(a.attempts, b.attempts), solved: a.solved || b.solved };
  }
  return out;
}

/** Both histories, one entry per attempt (the one with full data when either has it), newest first. */
export function mergeHistory(here: readonly HistoryEntry[], incoming: readonly HistoryEntry[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  for (const h of [...here, ...incoming]) {
    const prev = byId.get(h.id);
    if (!prev || (h.full && !prev.full)) byId.set(h.id, h);
  }
  return [...byId.values()].sort((a, b) => b.finishedAt - a.finishedAt);
}

/**
 * An exported attempt continued at `now`: the clock stood still while it was
 * in the file, so a time limit keeps the time that was left at export.
 * Both times are moved relative to `exportedAt`, so the two browsers' clocks
 * need not agree.
 */
export function resumeAttempt(a: Attempt, exportedAt: number, now: number): Attempt {
  const shift = now - exportedAt;
  return { ...a, startedAt: a.startedAt + shift, endsAt: a.endsAt === null ? null : a.endsAt + shift };
}
