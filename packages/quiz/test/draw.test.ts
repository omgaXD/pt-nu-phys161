import { describe, expect, it } from 'vitest';
import { buildPool, defaultConfig, drawQuestions, orderQuestions, type QuizConfig, sectionSlug, selectQuestions } from '../src/index.ts';
import { syntheticSet } from './helpers.ts';

const SECTIONS = ['Work', 'Kinetic energy', 'Power', 'Potential energy', 'Energy conservation', 'Impulse', 'Momentum', 'Rockets', 'Inertia', 'Rotation', 'Torque', 'Angular momentum'];
const A = syntheticSet('a', SECTIONS, 10, { fixedEvery: 3 });
const B = syntheticSet('b', ['Gravitation', 'Waves'], 5);
const CATALOG = [A, B];
const exam = (over: Partial<QuizConfig> = {}): QuizConfig => ({ ...defaultConfig(['a'], 'exam'), ...over });

describe('pool', () => {
  it('filters by set, section, fixed and solved, keeping source order', () => {
    expect(buildPool(CATALOG, defaultConfig(['a', 'b']))).toHaveLength(130);
    expect(buildPool(CATALOG, defaultConfig(['b']))[0]!.key).toBe('b/P1');
    const work = buildPool(CATALOG, { ...defaultConfig(['a']), sections: { a: [sectionSlug('Work'), sectionSlug('Power')] } });
    expect(new Set(work.map((q) => q.section))).toEqual(new Set(['Work', 'Power']));
    expect(buildPool(CATALOG, { ...defaultConfig(['a']), includeFixed: false }).every((q) => q.kind === 'authored')).toBe(true);
    const mastery = { 'a/P1': { solved: true, attempts: 1, lastFraction: 1, lastAt: 0, lastAttemptId: 'x' } };
    expect(buildPool(CATALOG, { ...defaultConfig(['a']), skipSolved: true }, mastery).map((q) => q.key)).not.toContain('a/P1');
    expect(buildPool(CATALOG, defaultConfig(['a']), mastery).map((q) => q.key)).toContain('a/P1');
  });

  it('leaves out excluded problems, and takes nothing from a set with no sections', () => {
    const keys = buildPool(CATALOG, { ...defaultConfig(['a', 'b']), exclude: { a: ['P1', 'P20'], b: ['P3'] } }).map((q) => q.key);
    expect(keys).toHaveLength(127);
    expect(keys).not.toContain('a/P1');
    expect(keys).not.toContain('b/P3');
    expect(buildPool(CATALOG, { ...defaultConfig(['a', 'b']), sections: { a: [] } }).every((q) => q.setId === 'b')).toBe(true);
  });

  it('filters by difficulty range, leaving unrated problems out unless asked', () => {
    // P1..P10: difficulty 1..5 twice, except every fifth problem, which is unrated.
    const rated = syntheticSet('r', ['Work', 'Power'], 5, { difficulty: (n) => (n % 5 === 0 ? undefined : ((((n - 1) % 5) + 1) as 1 | 2 | 3 | 4)) });
    const keys = (difficulty: QuizConfig['difficulty']): string[] =>
      buildPool([rated], { ...defaultConfig(['r']), ...(difficulty && { difficulty }) }).map((q) => q.label);
    expect(keys(undefined)).toHaveLength(10);
    expect(keys({ min: 1, max: 5, unrated: false })).toHaveLength(10); // the full range is no filter
    expect(keys({ min: 2, max: 3, unrated: false })).toEqual(['P2', 'P3', 'P7', 'P8']);
    expect(keys({ min: 2, max: 3, unrated: true })).toEqual(['P2', 'P3', 'P5', 'P7', 'P8', 'P10']);
    expect(keys({ min: 4, max: 4, unrated: false })).toEqual(['P4', 'P9']);
  });
});

describe('draw', () => {
  const pool = buildPool(CATALOG, defaultConfig(['a']));

  it('is deterministic per seed', () => {
    const one = drawQuestions(pool, exam(), 99).questions.map((q) => q.key);
    expect(drawQuestions(pool, exam(), 99).questions.map((q) => q.key)).toEqual(one);
    expect(drawQuestions(pool, exam(), 100).questions.map((q) => q.key)).not.toEqual(one);
  });

  it('spreads an exam over different sections', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { questions, shortfall } = drawQuestions(pool, exam(), seed);
      expect(shortfall).toBe(0);
      expect(questions).toHaveLength(7);
      expect(new Set(questions.map((q) => q.section)).size).toBe(7);
    }
  });

  it('cycles through sections when asking for more questions than there are sections', () => {
    const { questions } = drawQuestions(pool, exam({ count: 30 }), 1);
    const perSection = new Map<string, number>();
    for (const q of questions) perSection.set(q.section!, (perSection.get(q.section!) ?? 0) + 1);
    expect(questions).toHaveLength(30);
    expect([...perSection.values()].every((n) => n === 2 || n === 3)).toBe(true);
  });

  it('spreads over sets, or uniformly', () => {
    const both = buildPool(CATALOG, defaultConfig(['a', 'b']));
    const { questions } = drawQuestions(both, exam({ draw: 'sets', count: 6 }), 3);
    expect(questions.filter((q) => q.setId === 'b')).toHaveLength(3);
    expect(drawQuestions(both, exam({ draw: 'uniform', count: 20 }), 3).questions).toHaveLength(20);
  });

  it('never draws two questions of one family, and reports a shortfall', () => {
    const families = syntheticSet('f', ['Work'], 12, { family: (n) => `F${Math.ceil(n / 4)}` });
    const { questions, shortfall } = drawQuestions(families.questions, exam({ count: 7, draw: 'uniform' }), 5);
    expect(questions).toHaveLength(3);
    expect(new Set(questions.map((q) => q.family)).size).toBe(3);
    expect(shortfall).toBe(4);
  });

  it('takes everything for count "all", families included', () => {
    const families = syntheticSet('f', ['Work'], 12, { family: () => 'same' });
    expect(drawQuestions(families.questions, { count: 'all', draw: 'uniform' }, 1).questions).toHaveLength(12);
  });
});

describe('order', () => {
  it('source order is set order, then problem number', () => {
    const qs = [...B.questions.slice(0, 2), ...A.questions.slice(5, 7).reverse()];
    expect(orderQuestions(qs, { order: 'source' }, 1, ['a', 'b']).map((q) => q.key)).toEqual(['a/P6', 'a/P7', 'b/P1', 'b/P2']);
  });

  it('shuffled order is seeded', () => {
    const qs = A.questions.slice(0, 30);
    const one = orderQuestions(qs, { order: 'shuffled' }, 4, ['a']).map((q) => q.key);
    expect(orderQuestions(qs, { order: 'shuffled' }, 4, ['a']).map((q) => q.key)).toEqual(one);
    expect(one).not.toEqual(qs.map((q) => q.key));
    expect([...one].sort()).toEqual(qs.map((q) => q.key).sort());
  });

  it('difficulty orders group by level, shuffled within each level, unrated last', () => {
    // 40 problems: levels 1..5 in turn, every eighth one unrated.
    const qs = syntheticSet('d', ['Work', 'Power'], 20, { difficulty: (n) => (n % 8 === 0 ? undefined : ((n % 5) + 1) as 1 | 2 | 3 | 4 | 5) }).questions;
    const levels = (order: 'easy-first' | 'hard-first', seed: number): (number | undefined)[] =>
      orderQuestions(qs, { order }, seed, ['d']).map((q) => q.difficulty);
    const rated = qs.flatMap((q) => (q.difficulty === undefined ? [] : [q.difficulty]));
    const unrated = qs.length - rated.length;
    expect(levels('easy-first', 1)).toEqual([...[...rated].sort((a, b) => a - b), ...Array<undefined>(unrated).fill(undefined)]);
    expect(levels('hard-first', 1)).toEqual([...[...rated].sort((a, b) => b - a), ...Array<undefined>(unrated).fill(undefined)]);
    // Within a level: seeded, and not source order.
    const keys = (seed: number): string[] => orderQuestions(qs, { order: 'easy-first' }, seed, ['d']).map((q) => q.key);
    expect(keys(3)).toEqual(keys(3));
    expect(keys(3)).not.toEqual(keys(4));
    const level1 = (seed: number): number[] => orderQuestions(qs, { order: 'easy-first' }, seed, ['d']).filter((q) => q.difficulty === 1).map((q) => q.number);
    expect([level1(3), level1(4)].some((ns) => ns.join() !== [...ns].sort((a, b) => a - b).join())).toBe(true);
  });

  it('an exam lists its draw in topic order; the draw does not depend on the order stream', () => {
    const c = exam({ seed: 8 });
    const src = selectQuestions(CATALOG, c, 8);
    const numbers = src.questions.map((q) => q.number);
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
    const shuffled = selectQuestions(CATALOG, { ...c, order: 'shuffled' }, 8);
    expect(shuffled.questions.map((q) => q.key).sort()).toEqual(src.questions.map((q) => q.key).sort());
    expect(src.pool).toBe(120);
  });
});
