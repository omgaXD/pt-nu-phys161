import { type FieldContents, gradePart, type PartResult, responseFromFields } from '@pt/core';
import type { CatalogQuestion, CatalogSet } from './bundle.js';
import { matchPreset, type PresetId, type QuizConfig } from './config.js';
import { selectQuestions } from './draw.js';
import type { QuestionSnapshot } from './materialize.js';
import { questionSeed, randomId, randomSeed } from './random.js';

export interface AttemptQuestion extends CatalogQuestion {
  /** Instance seed; null = the source's own numbers. */
  seed: number | null;
}

export interface CheckRecord {
  at: number;
  /** The field contents that were checked. */
  answer: FieldContents;
  result: PartResult;
}

/**
 * One attempt, JSON-serialisable. `(config, seed, content)` determines the
 * questions and their numbers; snapshots freeze what was actually shown.
 */
export interface Attempt {
  format: 1;
  id: string;
  /** The configuration, with `seed` filled in. */
  config: QuizConfig;
  seed: number;
  preset: PresetId | 'custom';
  contentVersion: string;
  startedAt: number;
  /** Absolute deadline (ms), when there is a time limit. */
  endsAt: number | null;
  finishedAt: number | null;
  finishReason: 'submitted' | 'timeout' | null;
  questions: AttemptQuestion[];
  snapshots: (QuestionSnapshot | null)[];
  answers: FieldContents[];
  /** Immediate feedback: every Check, in order. */
  checks: CheckRecord[][];
  revealed: boolean[];
  flagged: boolean[];
  /** The question could not be built from the current content (removed); excluded from marks. */
  unavailable: boolean[];
  /** Set at finish: the grading behind each mark (null when unanswered, revealed or unavailable). */
  final: (PartResult | null)[];
  /** Set at finish: 0..1 per question. */
  marks: number[];
  /** Current page (one question per page). */
  page: number;
}

export type AttemptAction =
  | { type: 'snapshot'; index: number; snapshot: QuestionSnapshot }
  | { type: 'unavailable'; index: number }
  | { type: 'answer'; index: number; answer: FieldContents }
  | { type: 'check'; index: number; now: number }
  | { type: 'reveal'; index: number; now: number }
  | { type: 'reset'; index: number }
  | { type: 'flag'; index: number; flagged: boolean }
  | { type: 'goto'; page: number }
  | { type: 'finish'; now: number; reason: 'submitted' | 'timeout' }
  | { type: 'tick'; now: number };

export interface StartOptions {
  config: QuizConfig;
  catalog: readonly CatalogSet[];
  contentVersion: string;
  now: number;
  id?: string;
}

const blank = (): FieldContents => ({ value: '', unit: '' });
const isBlank = (a: FieldContents | undefined): boolean => !a || (a.value.trim() === '' && a.unit.trim() === '');
const sameAnswer = (a: FieldContents, b: FieldContents): boolean => a.value.trim() === b.value.trim() && a.unit.trim() === b.unit.trim();

/** Select the questions and set up a new attempt (no snapshots yet: see `snapshotAtStart`). */
export function startAttempt(opts: StartOptions): { attempt: Attempt; pool: number; shortfall: number } {
  const seed = opts.config.seed ?? randomSeed();
  const config: QuizConfig = { ...opts.config, seed };
  const { questions, pool, shortfall } = selectQuestions(opts.catalog, config, seed);
  const n = questions.length;
  const attempt: Attempt = {
    format: 1,
    id: opts.id ?? randomId(),
    config,
    seed,
    preset: matchPreset(config),
    contentVersion: opts.contentVersion,
    startedAt: opts.now,
    endsAt: config.timeLimitMinutes === null ? null : opts.now + config.timeLimitMinutes * 60_000,
    finishedAt: null,
    finishReason: null,
    questions: questions.map((q) => ({
      ...q,
      seed: config.values === 'random' && q.kind === 'authored' ? questionSeed(seed, q.key) : null,
    })),
    snapshots: Array.from({ length: n }, () => null),
    answers: Array.from({ length: n }, blank),
    checks: Array.from({ length: n }, () => []),
    revealed: Array.from({ length: n }, () => false),
    flagged: Array.from({ length: n }, () => false),
    unavailable: Array.from({ length: n }, () => false),
    final: Array.from({ length: n }, () => null),
    marks: Array.from({ length: n }, () => 0),
    page: 0,
  };
  return { attempt, pool, shortfall };
}

/**
 * Snapshot every question up front for exams (deferred feedback) and short
 * attempts; long practice runs snapshot each question when first shown.
 */
export function snapshotAtStart(a: Pick<Attempt, 'config' | 'questions'>): boolean {
  return a.config.feedback === 'deferred' || a.questions.length <= 50;
}

export function isFinished(a: Attempt): boolean {
  return a.finishedAt !== null;
}

function lastCheck(a: Attempt, i: number): CheckRecord | undefined {
  return a.checks[i]?.at(-1);
}

/** Immediate feedback: no more checks for this question (solved, out of tries, or revealed). */
export function isLocked(a: Attempt, i: number): boolean {
  if (isFinished(a) || a.revealed[i] || a.unavailable[i]) return true;
  if (a.config.feedback !== 'immediate') return false;
  const last = lastCheck(a, i);
  if (last?.result.fraction === 1) return true;
  return a.config.maxTries !== null && (a.checks[i]?.length ?? 0) >= a.config.maxTries;
}

export function triesLeft(a: Attempt, i: number): number | null {
  if (a.config.maxTries === null) return null;
  return Math.max(0, a.config.maxTries - (a.checks[i]?.length ?? 0));
}

function grade(a: Attempt, i: number, answer: FieldContents): PartResult | null {
  const snap = a.snapshots[i];
  const ip = snap?.instance.parts[0];
  if (!snap || !ip) return null;
  return gradePart(snap.part, ip, responseFromFields(ip, answer));
}

function set<T>(list: readonly T[], i: number, value: T): T[] {
  const out = [...list];
  out[i] = value;
  return out;
}

function finish(a: Attempt, now: number, reason: 'submitted' | 'timeout'): Attempt {
  const final: (PartResult | null)[] = [];
  const marks: number[] = [];
  a.questions.forEach((_, i) => {
    const answer = a.answers[i] ?? blank();
    const last = lastCheck(a, i);
    let result: PartResult | null = null;
    if (!a.revealed[i] && !a.unavailable[i]) {
      if (last && sameAnswer(last.answer, answer)) result = last.result;
      else if (!isBlank(answer)) result = grade(a, i, answer);
    }
    final.push(result);
    marks.push(result?.fraction ?? 0);
  });
  return { ...a, finishedAt: now, finishReason: reason, final, marks };
}

/**
 * The attempt state machine. Pure: returns a new attempt, or the same one
 * when the action is not allowed (answering a locked question, checking in
 * an exam, anything but paging and flagging after finishing…).
 */
export function reduceAttempt(a: Attempt, action: AttemptAction): Attempt {
  const inRange = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < a.questions.length;
  if (action.type === 'goto') {
    const page = Math.max(0, Math.min(a.questions.length - 1, Math.trunc(action.page)));
    return page === a.page ? a : { ...a, page };
  }
  if (action.type === 'snapshot') {
    return inRange(action.index) && !a.snapshots[action.index] ? { ...a, snapshots: set(a.snapshots, action.index, action.snapshot) } : a;
  }
  // Flags stay editable in the review, as in Moodle.
  if (action.type === 'flag') {
    return inRange(action.index) && a.flagged[action.index] !== action.flagged ? { ...a, flagged: set(a.flagged, action.index, action.flagged) } : a;
  }
  if (isFinished(a)) return a;

  switch (action.type) {
    case 'tick':
      return a.endsAt !== null && action.now >= a.endsAt ? finish(a, a.endsAt, 'timeout') : a;
    case 'finish':
      return finish(a, a.endsAt !== null ? Math.min(action.now, a.endsAt) : action.now, action.reason);
    case 'unavailable':
      return inRange(action.index) ? { ...a, unavailable: set(a.unavailable, action.index, true) } : a;
    case 'answer': {
      const i = action.index;
      if (!inRange(i) || isLocked(a, i)) return a;
      return { ...a, answers: set(a.answers, i, { value: action.answer.value, unit: action.answer.unit }) };
    }
    case 'check': {
      const i = action.index;
      if (!inRange(i) || a.config.feedback !== 'immediate' || isLocked(a, i)) return a;
      const answer = a.answers[i] ?? blank();
      if (isBlank(answer)) return a;
      const last = lastCheck(a, i);
      if (last && sameAnswer(last.answer, answer)) return a; // nothing new to check
      const result = grade(a, i, answer);
      if (!result) return a;
      return { ...a, checks: set(a.checks, i, [...(a.checks[i] ?? []), { at: action.now, answer: { ...answer }, result }]) };
    }
    case 'reveal': {
      const i = action.index;
      if (!inRange(i) || a.config.feedback !== 'immediate' || !a.config.allowReveal || isLocked(a, i) || !a.snapshots[i]) return a;
      return { ...a, revealed: set(a.revealed, i, true) };
    }
    case 'reset': {
      // Immediate feedback: a settled question starts over (same numbers, no checks, empty field).
      // Progress already recorded for it stays.
      const i = action.index;
      if (!inRange(i) || a.config.feedback !== 'immediate' || a.unavailable[i] || !isLocked(a, i)) return a;
      return { ...a, answers: set(a.answers, i, blank()), checks: set(a.checks, i, []), revealed: set(a.revealed, i, false) };
    }
  }
}

export type QuestionState =
  | 'notyetanswered'
  | 'answersaved'
  | 'correct'
  | 'partiallycorrect'
  | 'incorrect'
  | 'revealed'
  | 'notanswered'
  | 'unavailable';

const byFraction = (f: number): QuestionState => (f >= 1 ? 'correct' : f > 0 ? 'partiallycorrect' : 'incorrect');

/** Moodle-style state of a question, during or after the attempt. */
export function questionState(a: Attempt, i: number): QuestionState {
  if (a.unavailable[i]) return 'unavailable';
  if (a.revealed[i]) return 'revealed';
  const answer = a.answers[i] ?? blank();
  if (isFinished(a)) {
    const r = a.final[i];
    return r ? byFraction(r.fraction) : 'notanswered';
  }
  const last = lastCheck(a, i);
  if (last && sameAnswer(last.answer, answer)) return byFraction(last.result.fraction);
  return isBlank(answer) ? 'notyetanswered' : 'answersaved';
}

export interface AttemptSummary {
  /** Questions that count (available). */
  total: number;
  marks: number;
  /** 0..100 */
  percent: number;
  correct: number;
  partial: number;
  incorrect: number;
  revealed: number;
  unanswered: number;
  /** Immediate feedback: solved at the first Check / after retries. */
  firstTry: number;
  afterRetries: number;
  durationMs: number;
}

/**
 * A question's mark so far, 0..1: after finishing, its final mark; before, the last Check of the
 * answer still in the field (0 once the answer is shown). Null while it has no mark: not checked,
 * edited since its last Check, or unavailable.
 */
export function questionMark(a: Attempt, i: number): number | null {
  const state = questionState(a, i);
  if (state === 'unavailable') return null;
  if (isFinished(a)) return a.marks[i] ?? 0;
  if (state === 'revealed') return 0;
  if (state === 'correct' || state === 'partiallycorrect' || state === 'incorrect') return lastCheck(a, i)?.result.fraction ?? 0;
  return null;
}

/** Marks and counts of a finished attempt (or the checks so far of one in progress). */
export function summarizeAttempt(a: Attempt, now = a.finishedAt ?? a.startedAt): AttemptSummary {
  const s: AttemptSummary = {
    total: 0,
    marks: 0,
    percent: 0,
    correct: 0,
    partial: 0,
    incorrect: 0,
    revealed: 0,
    unanswered: 0,
    firstTry: 0,
    afterRetries: 0,
    durationMs: Math.max(0, (a.finishedAt ?? now) - a.startedAt),
  };
  a.questions.forEach((_, i) => {
    const state = questionState(a, i);
    if (state === 'unavailable') return;
    s.total++;
    s.marks += questionMark(a, i) ?? 0;
    if (state === 'correct') {
      s.correct++;
      const n = a.checks[i]?.length ?? 0;
      if (n === 1) s.firstTry++;
      else if (n > 1) s.afterRetries++;
    } else if (state === 'partiallycorrect') s.partial++;
    else if (state === 'incorrect') s.incorrect++;
    else if (state === 'revealed') s.revealed++;
    else s.unanswered++;
  });
  s.percent = s.total > 0 ? (100 * s.marks) / s.total : 0;
  return s;
}
