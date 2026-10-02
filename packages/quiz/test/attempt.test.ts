import { describe, expect, it } from 'vitest';
import {
  type Attempt,
  type AttemptAction,
  defaultConfig,
  isLocked,
  materialize,
  type QuizConfig,
  questionState,
  reduceAttempt,
  snapshotAtStart,
  startAttempt,
  summarizeAttempt,
  triesLeft,
} from '../src/index.ts';
import { corpusById, corpusCatalog } from './helpers.ts';

const catalog = [corpusCatalog()];
const T0 = 1_700_000_000_000;

/** Start an attempt and snapshot every question (as the app does). */
function start(over: Partial<QuizConfig> = {}, preset: 'ordered' | 'exam' | 'chaotic' = 'ordered'): Attempt {
  const config = { ...defaultConfig(['corpus'], preset), seed: 11, ...over };
  let { attempt } = startAttempt({ config, catalog, contentVersion: 'v1', now: T0, id: 'att1' });
  attempt.questions.forEach((q, index) => {
    attempt = reduceAttempt(attempt, { type: 'snapshot', index, snapshot: materialize(q, corpusById.get(q.scenarioId)!, q.seed, 'h') });
  });
  return attempt;
}

const run = (a: Attempt, ...actions: AttemptAction[]): Attempt => actions.reduce(reduceAttempt, a);

/** The correct combined answer for question i. */
function correct(a: Attempt, i: number): { value: string; unit: string } {
  const ip = a.snapshots[i]!.instance.parts[0]!;
  return { value: `${ip.modelAnswer}${ip.unit ? ` ${ip.unit}` : ''}`, unit: '' };
}
const wrong = { value: '12345 J', unit: '' };

describe('starting', () => {
  it('selects questions and seeds them by key; source values have no seed', () => {
    const a = start();
    expect(a.questions.map((q) => q.label).slice(0, 4)).toEqual(['P1', 'P2', 'P12', 'P13']);
    expect(a.questions.every((q) => typeof q.seed === 'number')).toBe(true);
    expect(start().questions.map((q) => q.seed)).toEqual(a.questions.map((q) => q.seed));
    expect(start({ values: 'source' }).questions.every((q) => q.seed === null)).toBe(true);
    expect(a).toMatchObject({ preset: 'ordered', endsAt: null, page: 0, contentVersion: 'v1' });
    expect(start({}, 'exam')).toMatchObject({ preset: 'exam', endsAt: T0 + 40 * 60_000 });
    expect(start({}, 'exam').questions).toHaveLength(7);
    expect(snapshotAtStart(a)).toBe(true);
  });

  it('JSON round-trips', () => {
    const a = run(start(), { type: 'answer', index: 0, answer: wrong }, { type: 'check', index: 0, now: T0 + 1 });
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe('immediate feedback', () => {
  it('Check grades; a correct answer locks the question', () => {
    let a = run(start(), { type: 'answer', index: 0, answer: wrong }, { type: 'check', index: 0, now: T0 + 1 });
    expect(questionState(a, 0)).toBe('incorrect');
    expect(isLocked(a, 0)).toBe(false);
    a = run(a, { type: 'answer', index: 0, answer: correct(a, 0) }, { type: 'check', index: 0, now: T0 + 2 });
    expect(questionState(a, 0)).toBe('correct');
    expect(isLocked(a, 0)).toBe(true);
    expect(run(a, { type: 'answer', index: 0, answer: wrong })).toBe(a); // locked
    expect(summarizeAttempt(a)).toMatchObject({ correct: 1, firstTry: 0, afterRetries: 1, marks: 1 });
  });

  it('an edited answer is "saved" until checked again; checking the same answer twice costs nothing', () => {
    let a = run(start({ maxTries: 2 }), { type: 'answer', index: 0, answer: wrong }, { type: 'check', index: 0, now: 1 });
    expect(run(a, { type: 'check', index: 0, now: 2 })).toBe(a);
    a = run(a, { type: 'answer', index: 0, answer: { value: '1 J', unit: '' } });
    expect(questionState(a, 0)).toBe('answersaved');
    expect(triesLeft(a, 0)).toBe(1);
  });

  it('maxTries locks a wrong answer', () => {
    const a = run(start({ maxTries: 1 }), { type: 'answer', index: 0, answer: wrong }, { type: 'check', index: 0, now: 1 });
    expect(isLocked(a, 0)).toBe(true);
    expect(questionState(a, 0)).toBe('incorrect');
    expect(triesLeft(a, 0)).toBe(0);
  });

  it('Show correct answer locks the question and earns nothing', () => {
    let a = run(start(), { type: 'reveal', index: 1, now: 1 });
    expect(questionState(a, 1)).toBe('revealed');
    expect(isLocked(a, 1)).toBe(true);
    a = run(a, { type: 'finish', now: 2, reason: 'submitted' });
    expect(a.marks[1]).toBe(0);
    expect(summarizeAttempt(a).revealed).toBe(1);
    expect(run(start({ allowReveal: false }), { type: 'reveal', index: 1, now: 1 }).revealed[1]).toBe(false);
  });

  it('blank answers are not checked', () => {
    const a = start();
    expect(run(a, { type: 'check', index: 0, now: 1 })).toBe(a);
  });

  it('Reset starts a settled question over: same numbers, no checks, empty field', () => {
    const fresh = start({ maxTries: 1 });
    expect(run(fresh, { type: 'reset', index: 0 })).toBe(fresh); // not settled yet
    let a = run(fresh, { type: 'answer', index: 0, answer: wrong }, { type: 'check', index: 0, now: 1 }, { type: 'reveal', index: 1, now: 2 });
    a = run(a, { type: 'reset', index: 0 }, { type: 'reset', index: 1 });
    for (const i of [0, 1]) {
      expect(isLocked(a, i)).toBe(false);
      expect(questionState(a, i)).toBe('notyetanswered');
      expect(triesLeft(a, i)).toBe(1);
    }
    expect(a.answers[0]).toEqual({ value: '', unit: '' });
    expect(a.snapshots[0]).toBe(fresh.snapshots[0]);
    a = run(a, { type: 'answer', index: 0, answer: correct(a, 0) }, { type: 'check', index: 0, now: 3 });
    expect(questionState(a, 0)).toBe('correct');
    // Not in an exam, and not after finishing.
    const exam = run(start({}, 'exam'), { type: 'answer', index: 0, answer: wrong });
    expect(run(exam, { type: 'reset', index: 0 })).toBe(exam);
    const done = run(a, { type: 'finish', now: 4, reason: 'submitted' });
    expect(run(done, { type: 'reset', index: 0 })).toBe(done);
  });
});

describe('deferred feedback (exam)', () => {
  it('has no Check or reveal; finishing grades every answer', () => {
    let a = start({}, 'exam');
    a = run(a, { type: 'answer', index: 0, answer: correct(a, 0) }, { type: 'answer', index: 1, answer: wrong });
    expect(run(a, { type: 'check', index: 0, now: 1 })).toBe(a);
    expect(run(a, { type: 'reveal', index: 0, now: 1 })).toBe(a);
    expect(questionState(a, 0)).toBe('answersaved');
    a = run(a, { type: 'flag', index: 2, flagged: true }, { type: 'finish', now: T0 + 60_000, reason: 'submitted' });
    expect(a.flagged[2]).toBe(true);
    expect(a.marks.slice(0, 3)).toEqual([1, 0, 0]);
    expect([0, 1, 2].map((i) => questionState(a, i))).toEqual(['correct', 'incorrect', 'notanswered']);
    expect(summarizeAttempt(a)).toMatchObject({ total: 7, marks: 1, correct: 1, incorrect: 1, unanswered: 5, durationMs: 60_000 });
  });

  it('times out at the deadline, and nothing but paging and flagging happens after finishing', () => {
    let a = start({}, 'exam');
    a = run(a, { type: 'answer', index: 0, answer: correct(a, 0) }, { type: 'tick', now: T0 + 39 * 60_000 });
    expect(a.finishedAt).toBeNull();
    a = run(a, { type: 'tick', now: T0 + 41 * 60_000 });
    expect(a).toMatchObject({ finishReason: 'timeout', finishedAt: T0 + 40 * 60_000 });
    expect(a.marks[0]).toBe(1);
    expect(run(a, { type: 'answer', index: 1, answer: wrong })).toBe(a);
    expect(run(a, { type: 'finish', now: T0, reason: 'submitted' })).toBe(a);
    expect(run(a, { type: 'goto', page: 3 }).page).toBe(3);
    expect(run(a, { type: 'flag', index: 1, flagged: true }).flagged[1]).toBe(true);
    // Submitting after the deadline (tab closed) still records the deadline.
    expect(run(start({}, 'exam'), { type: 'finish', now: T0 + 99 * 60_000, reason: 'submitted' }).finishedAt).toBe(T0 + 40 * 60_000);
  });
});

describe('paging and availability', () => {
  it('clamps pages', () => {
    const a = start();
    expect(run(a, { type: 'goto', page: 999 }).page).toBe(a.questions.length - 1);
    expect(run(a, { type: 'goto', page: -3 }).page).toBe(0);
  });

  it('unavailable questions do not count', () => {
    const a = run(start({}, 'exam'), { type: 'unavailable', index: 3 }, { type: 'finish', now: T0 + 1, reason: 'submitted' });
    expect(questionState(a, 3)).toBe('unavailable');
    expect(summarizeAttempt(a).total).toBe(6);
  });

  it('a snapshot is taken once', () => {
    const a = start();
    const other = materialize(a.questions[1]!, corpusById.get(a.questions[1]!.scenarioId)!, 999, 'x');
    expect(run(a, { type: 'snapshot', index: 0, snapshot: other })).toBe(a);
  });
});
