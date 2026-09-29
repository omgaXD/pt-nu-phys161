import { type Attempt, isFinished, isLocked, questionState } from './attempt.js';

/**
 * Per-problem progress across attempts, keyed by `setId/label` so a problem
 * stays solved when it moves from fixed to authored.
 */
export interface MasteryEntry {
  /** Attempts in which the problem was answered, checked or revealed. */
  attempts: number;
  /** Ever answered fully correctly without revealing. */
  solved: boolean;
  lastFraction: number;
  lastAt: number;
  /** Last attempt counted (so re-applying an attempt does not count it twice). */
  lastAttemptId: string;
}

export type Mastery = Record<string, MasteryEntry>;

function touched(a: Attempt, i: number): boolean {
  return a.revealed[i] === true || (a.checks[i]?.length ?? 0) > 0 || (isFinished(a) && a.final[i] !== null);
}

function update(m: Mastery, a: Attempt, i: number, fraction: number, at: number): Mastery {
  const key = a.questions[i]!.key;
  const prev = m[key];
  const solved = fraction >= 1 && !a.revealed[i];
  const entry: MasteryEntry = {
    attempts: (prev?.attempts ?? 0) + (prev?.lastAttemptId === a.id ? 0 : 1),
    solved: (prev?.solved ?? false) || solved,
    lastFraction: fraction,
    lastAt: at,
    lastAttemptId: a.id,
  };
  return { ...m, [key]: entry };
}

/**
 * Record one question as soon as it is settled in immediate-feedback mode
 * (solved, out of tries, or revealed), so progress survives an abandoned run.
 */
export function applyQuestion(m: Mastery, a: Attempt, i: number, now: number): Mastery {
  if (a.unavailable[i] || !isLocked(a, i) || !touched(a, i)) return m;
  const last = a.checks[i]?.at(-1);
  return update(m, a, i, a.revealed[i] ? 0 : (last?.result.fraction ?? 0), now);
}

/** Record every answered question of a finished attempt. */
export function applyAttempt(m: Mastery, a: Attempt): Mastery {
  if (!isFinished(a)) return m;
  let out = m;
  a.questions.forEach((_, i) => {
    if (questionState(a, i) === 'unavailable' || !touched(a, i)) return;
    out = update(out, a, i, a.revealed[i] ? 0 : (a.marks[i] ?? 0), a.finishedAt!);
  });
  return out;
}

/** Solved problems among the given keys. */
export function solvedCount(m: Mastery, keys: Iterable<string>): number {
  let n = 0;
  for (const k of keys) if (m[k]?.solved) n++;
  return n;
}
