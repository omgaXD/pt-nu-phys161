import { describe, expect, it } from 'vitest';
import {
  buildPool,
  defaultConfig,
  isProblemOn,
  type QuizConfig,
  sectionSelection,
  sectionSlug,
  setAllSections,
  toggleProblem,
  toggleSection,
} from '../src/index.ts';
import { syntheticSet } from './helpers.ts';

// Work: P1–P3, Power: P4–P6, Torque: P7–P9.
const SET = syntheticSet('a', ['Work', 'Power', 'Torque'], 3);
const IDS = ['Work', 'Power', 'Torque'].map(sectionSlug);
const Q = (label: string) => SET.questions.find((q) => q.label === label)!;
const base = defaultConfig(['a']);
const off = (c: QuizConfig, label: string): QuizConfig => toggleProblem(c, Q(label), false, IDS, SET.questions);
const on = (c: QuizConfig, label: string): QuizConfig => toggleProblem(c, Q(label), true, IDS, SET.questions);
const labels = (c: QuizConfig): string[] => buildPool([SET], c).map((q) => q.label);

describe('problem selection', () => {
  it('leaves problems out and brings them back, storing nothing once all are back', () => {
    const c = off(off(base, 'P5'), 'P2');
    expect(c.exclude).toEqual({ a: ['P2', 'P5'] });
    expect(labels(c)).toEqual(['P1', 'P3', 'P4', 'P6', 'P7', 'P8', 'P9']);
    expect(sectionSelection(c, 'a', 'work', SET.questions)).toEqual({ selected: 2, total: 3, state: 'some' });
    expect(on(on(c, 'P2'), 'P5')).toEqual(base);
  });

  it('turns a section off when its last problem is left out', () => {
    const c = off(off(off(base, 'P1'), 'P2'), 'P3');
    expect(c.sections).toEqual({ a: ['power', 'torque'] });
    expect(c.exclude).toEqual({});
    expect(sectionSelection(c, 'a', 'work', SET.questions).state).toBe('none');
  });

  it('turns an off section on with just the problem picked', () => {
    const c = on(setAllSections(base, 'a', false), 'P8');
    expect(labels(c)).toEqual(['P8']);
    expect(c.sections).toEqual({ a: ['torque'] });
    expect(c.exclude).toEqual({ a: ['P7', 'P9'] });
    expect(isProblemOn(c, Q('P8'))).toBe(true);
    expect(isProblemOn(c, Q('P7'))).toBe(false);
    // Leaving out a problem of a section that is off changes nothing.
    expect(off(c, 'P1')).toEqual(c);
  });

  it('a section toggle includes or drops all its problems, keeping other sections untouched', () => {
    const c = off(off(base, 'P2'), 'P8');
    const workOn = toggleSection(c, 'a', 'work', true, IDS, SET.questions);
    expect(workOn.exclude).toEqual({ a: ['P8'] });
    const workOff = toggleSection(c, 'a', 'work', false, IDS, SET.questions);
    expect(workOff).toMatchObject({ sections: { a: ['power', 'torque'] }, exclude: { a: ['P8'] } });
    expect(toggleSection(workOff, 'a', 'work', true, IDS, SET.questions)).toMatchObject({ sections: {}, exclude: { a: ['P8'] } });
  });

  it('None selects nothing (an empty section list), All everything', () => {
    const none = setAllSections(off(base, 'P2'), 'a', false);
    expect(none).toMatchObject({ sections: { a: [] }, exclude: {} });
    expect(labels(none)).toEqual([]);
    expect(setAllSections(none, 'a', true)).toEqual(base);
    // Unchecking the last section is the same as None.
    const last = toggleSection(toggleSection(toggleSection(base, 'a', 'work', false, IDS, SET.questions), 'a', 'power', false, IDS, SET.questions), 'a', 'torque', false, IDS, SET.questions);
    expect(labels(last)).toEqual([]);
  });

  it('sorts exclusions in source order', () => {
    const big = syntheticSet('b', ['One'], 12);
    const c = [10, 2, 11].reduce<QuizConfig>((acc, n) => toggleProblem(acc, big.questions[n - 1]!, false, ['one'], big.questions), defaultConfig(['b']));
    expect(c.exclude).toEqual({ b: ['P2', 'P10', 'P11'] });
  });
});
