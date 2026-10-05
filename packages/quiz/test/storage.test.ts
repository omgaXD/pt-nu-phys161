import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyAttempt,
  applyQuestion,
  type Attempt,
  defaultConfig,
  materialize,
  memoryStorage,
  QuizStorage,
  reduceAttempt,
  solvedCount,
  startAttempt,
} from '../src/index.ts';
import { corpusById, corpusCatalog } from './helpers.ts';

const catalog = [corpusCatalog()];

function attempt(id: string, preset: 'ordered' | 'exam' = 'exam'): Attempt {
  let { attempt: a } = startAttempt({ config: { ...defaultConfig(['corpus'], preset), seed: 3 }, catalog, contentVersion: 'v', now: 1000, id });
  a.questions.forEach((q, index) => {
    a = reduceAttempt(a, { type: 'snapshot', index, snapshot: materialize(q, corpusById.get(q.scenarioId)!, q.seed, 'h') });
  });
  return a;
}

function answerRight(a: Attempt, i: number): Attempt {
  const ip = a.snapshots[i]!.instance.parts[0]!;
  return reduceAttempt(a, { type: 'answer', index: i, answer: { value: `${ip.modelAnswer} ${ip.unit ?? ''}`.trim(), unit: '' } });
}

describe('mastery', () => {
  it('records solved problems by key, once per attempt', () => {
    let a = answerRight(attempt('a1'), 0);
    a = reduceAttempt(a, { type: 'finish', now: 2000, reason: 'submitted' });
    let m = applyAttempt({}, a);
    const key = a.questions[0]!.key;
    expect(m[key]).toMatchObject({ solved: true, attempts: 1, lastFraction: 1, lastAt: 2000 });
    expect(applyAttempt(m, a)[key]!.attempts).toBe(1);
    expect(Object.keys(m)).toHaveLength(1); // untouched questions are not recorded
    m = applyAttempt(m, reduceAttempt(attempt('a2'), { type: 'finish', now: 3000, reason: 'submitted' }));
    expect(m[key]!.attempts).toBe(1);
    expect(solvedCount(m, a.questions.map((q) => q.key))).toBe(1);
  });

  it('records a question as soon as it settles in immediate mode', () => {
    let a = answerRight(attempt('p1', 'ordered'), 0);
    expect(applyQuestion({}, a, 0, 5)).toEqual({});
    a = reduceAttempt(a, { type: 'check', index: 0, now: 5 });
    expect(applyQuestion({}, a, 0, 5)[a.questions[0]!.key]).toMatchObject({ solved: true });
    a = reduceAttempt(a, { type: 'reveal', index: 1, now: 6 });
    expect(applyQuestion({}, a, 1, 6)[a.questions[1]!.key]).toMatchObject({ solved: false, lastFraction: 0 });
  });
});

describe('storage', () => {
  it('saves and resumes the attempt in progress, snapshots included', () => {
    const mem = memoryStorage();
    const s = new QuizStorage(mem);
    const a = answerRight(attempt('r1'), 0);
    s.saveCurrent(a);
    expect(new QuizStorage(mem).loadCurrent()).toEqual(a);
    expect(mem.keys().sort()).toEqual(['pt:v1:attempt:r1', 'pt:v1:current', 'pt:v1:snap:r1']);
    s.abandonCurrent();
    expect(s.loadCurrent()).toBeNull();
    expect(mem.keys()).toEqual([]);
  });

  it('archives finished attempts: history summaries for all, full data for the newest few', () => {
    const s = new QuizStorage(memoryStorage(), { keepFull: 2 });
    for (const id of ['h1', 'h2', 'h3']) {
      const a = reduceAttempt(answerRight(attempt(id), 0), { type: 'finish', now: 5000, reason: 'submitted' });
      s.saveCurrent(a);
      s.archive(a);
    }
    expect(s.loadCurrent()).toBeNull();
    expect(s.history().map((h) => [h.id, h.full, h.marks, h.total])).toEqual([
      ['h3', true, 1, 7],
      ['h2', true, 1, 7],
      ['h1', false, 1, 7],
    ]);
    expect(s.loadAttempt('h1')).toBeNull();
    expect(s.loadAttempt('h3')!.finishReason).toBe('submitted');
    // A flag set in the review is kept; an attempt no longer kept in full is not brought back.
    s.updateFinished(reduceAttempt(s.loadAttempt('h3')!, { type: 'flag', index: 1, flagged: true }));
    expect(s.loadAttempt('h3')!.flagged[1]).toBe(true);
    s.updateFinished(reduceAttempt(attempt('h1'), { type: 'finish', now: 5000, reason: 'submitted' }));
    expect(s.loadAttempt('h1')).toBeNull();
    s.clearHistory();
    expect(s.history()).toEqual([]);
  });

  it('evicts the oldest full attempts when storage is full', () => {
    const one = JSON.stringify(attempt('x')).length;
    const mem = memoryStorage(one * 3.5);
    const s = new QuizStorage(mem, { keepFull: 10 });
    for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) {
      const a = reduceAttempt(attempt(id), { type: 'finish', now: 5000, reason: 'submitted' });
      s.archive(a);
    }
    const h = s.history();
    expect(h).toHaveLength(5);
    expect(h[0]).toMatchObject({ id: 'e5', full: true });
    expect(h.at(-1)).toMatchObject({ id: 'e1', full: false });
    expect(mem.size()).toBeLessThanOrEqual(one * 3.5);
  });

  it('brings older stored attempts up to date, and tells which finished ones can be reviewed', () => {
    const mem = memoryStorage();
    const s = new QuizStorage(mem);
    const a = reduceAttempt(answerRight(attempt('o1'), 0), { type: 'finish', now: 5000, reason: 'submitted' });
    s.archive(a);
    expect(s.reviewable('o1')).toBe(true);
    // Saved before `exclude` was part of the configuration, and while `skipSolved` was.
    const stored = JSON.parse(mem.getItem('pt:v1:attempt:o1')!) as Attempt;
    const { exclude: _drop, ...older } = stored.config;
    mem.setItem('pt:v1:attempt:o1', JSON.stringify({ ...stored, config: { ...older, skipSolved: true } }));
    expect(s.reviewable('o1')).toBe(true);
    expect(s.loadAttempt('o1')).toEqual(a);
    // Damaged or gone: nothing to review.
    mem.setItem('pt:v1:attempt:o1', JSON.stringify({ ...stored, answers: [] }));
    expect(s.reviewable('o1')).toBe(false);
    expect(s.loadAttempt('o1')).toBeNull();
    mem.removeItem('pt:v1:attempt:o1');
    expect(s.reviewable('o1')).toBe(false);
    // Not finished yet.
    s.saveCurrent(attempt('c1'));
    expect(s.reviewable('c1')).toBe(false);
    expect(s.loadCurrent()).not.toBeNull();
  });

  it('stores mastery and preferences, and ignores corrupt data', () => {
    const mem = memoryStorage();
    const s = new QuizStorage(mem);
    s.saveMastery({ 'a/P1': { attempts: 1, solved: true, lastFraction: 1, lastAt: 1, lastAttemptId: 'x' } });
    s.savePrefs({ sets: ['a'] });
    expect(s.mastery()['a/P1']!.solved).toBe(true);
    expect(s.prefs()).toEqual({ sets: ['a'] });
    mem.setItem('pt:v1:mastery', '{nope');
    expect(s.mastery()).toEqual({});
  });
});

describe('@pt/quiz boundaries', () => {
  const src = join(import.meta.dirname, '../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

  it('imports no Node built-ins, frameworks or UI packages', () => {
    const bad = files(src).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)]
        .map((m) => m[1]!)
        .filter((spec) => /^(node:|fs$|path$|svelte|@sveltejs|katex|@pt\/(ui|cli|store))/.test(spec))
        .map((spec) => `${f}: ${spec}`),
    );
    expect(bad).toEqual([]);
  });
});
