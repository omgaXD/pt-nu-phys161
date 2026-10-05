import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  decodeConfig,
  defaultConfig,
  encodeConfig,
  hash32,
  matchPreset,
  PRESET_IDS,
  PRESETS,
  type QuizConfig,
  QuizConfigSchema,
  questionSeed,
  sectionSlug,
  shuffle,
  streamRng,
} from '../src/index.ts';

describe('presets', () => {
  it('are values of the one configuration model', () => {
    for (const id of PRESET_IDS) {
      expect(QuizConfigSchema.parse(defaultConfig(['a'], id))).toEqual(defaultConfig(['a'], id));
      expect(matchPreset(defaultConfig(['a'], id))).toBe(id);
    }
  });

  it('describe the five presets', () => {
    expect(PRESETS.exam).toMatchObject({ count: 7, draw: 'sections', order: 'shuffled', feedback: 'deferred', allowReveal: false, timeLimitMinutes: 40 });
    expect(PRESETS.exam.difficulty).toBeUndefined();
    expect(PRESETS.nightmare).toEqual({ ...PRESETS.exam, difficulty: { min: 3, max: 5, unrated: false } });
    expect(PRESETS.ordered).toMatchObject({ count: 'all', order: 'source', feedback: 'immediate', allowReveal: true, timeLimitMinutes: null, values: 'random' });
    expect(PRESETS.chaotic).toEqual({ ...PRESETS.ordered, order: 'shuffled' });
    expect(PRESETS['easy-to-hard']).toEqual({ ...PRESETS.ordered, order: 'easy-first' });
  });

  it('keep the content selection and seed when applied, and become custom when any other field changes', () => {
    const c: QuizConfig = { ...defaultConfig(['a', 'b']), sections: { a: ['work'] }, exclude: { b: ['P3'] }, seed: 5 };
    const exam = applyPreset(c, 'exam');
    expect(exam).toMatchObject({ sets: ['a', 'b'], sections: { a: ['work'] }, exclude: { b: ['P3'] }, seed: 5, count: 7 });
    expect(matchPreset({ ...exam, timeLimitMinutes: 30 })).toBe('custom');
    expect(matchPreset({ ...c, values: 'source' })).toBe('custom');
    // The difficulty range belongs to the presets too.
    expect(matchPreset({ ...exam, difficulty: { min: 3, max: 5, unrated: false } })).toBe('nightmare');
    expect(matchPreset({ ...exam, difficulty: { min: 3, max: 5, unrated: true } })).toBe('custom');
    expect(matchPreset({ ...exam, difficulty: { min: 1, max: 5, unrated: true } })).toBe('exam');
    expect(matchPreset({ ...c, order: 'easy-first' })).toBe('easy-to-hard');
    const ranged: QuizConfig = { ...c, difficulty: { min: 2, max: 4, unrated: false } };
    expect(matchPreset(ranged)).toBe('custom');
    expect(applyPreset(ranged, 'exam')).not.toHaveProperty('difficulty');
    expect(matchPreset(applyPreset(ranged, 'exam'))).toBe('exam');
    expect(matchPreset(applyPreset(ranged, 'nightmare'))).toBe('nightmare');
  });

  it('ignore fields that do not apply (draw without a sample, tries without immediate feedback)', () => {
    expect(matchPreset({ ...PRESETS.ordered, draw: 'sets' })).toBe('ordered');
    expect(matchPreset({ ...PRESETS.exam, maxTries: 3, allowReveal: true })).toBe('exam');
    expect(matchPreset({ ...PRESETS.ordered, maxTries: 3 })).toBe('custom');
  });

  it('rejects invalid configurations', () => {
    expect(QuizConfigSchema.safeParse({ ...defaultConfig([]) }).success).toBe(false);
    expect(QuizConfigSchema.safeParse({ ...defaultConfig(['a']), count: 0 }).success).toBe(false);
    expect(QuizConfigSchema.safeParse({ ...defaultConfig(['a']), extra: 1 }).success).toBe(false);
    expect(QuizConfigSchema.safeParse({ ...defaultConfig(['a']), difficulty: { min: 4, max: 2, unrated: false } }).success).toBe(false);
    expect(QuizConfigSchema.safeParse({ ...defaultConfig(['a']), difficulty: { min: 0, max: 2, unrated: false } }).success).toBe(false);
  });

  it('read and drop the old skipSolved option', () => {
    expect(QuizConfigSchema.parse({ ...defaultConfig(['a']), skipSolved: true })).toEqual(defaultConfig(['a']));
  });
});

describe('share links', () => {
  it('name the preset and only the fields that differ', () => {
    const exam = { ...defaultConfig(['phys161-exam1', 'phys161-exam2'], 'exam'), seed: 42 };
    expect(encodeConfig(exam).toString()).toBe('p=exam&sets=phys161-exam1%2Cphys161-exam2&seed=42');
    const custom = { ...exam, timeLimitMinutes: null, count: 10, sections: { 'phys161-exam1': ['work', 'friction'] } };
    expect(encodeConfig(custom, 'abc').toString()).toBe(
      'p=exam&sets=phys161-exam1%2Cphys161-exam2&sec.phys161-exam1=friction%2Cwork&n=10&time=none&seed=42&cv=abc',
    );
  });

  it('round-trip every configuration (seeded property loop)', () => {
    const rng = streamRng(7, 'configs');
    const pick = <T>(xs: readonly T[]): T => xs[(rng.next() >>> 0) % xs.length]!;
    for (let i = 0; i < 300; i++) {
      const c: QuizConfig = {
        sets: pick([['a'], ['a', 'b'], ['b', 'c', 'a']]),
        sections: pick<Record<string, string[]>>([{}, { a: ['x', 'y'] }, { a: [] }]),
        exclude: pick<Record<string, string[]>>([{}, { a: ['P2', 'P10'] }]),
        values: pick(['random', 'source'] as const),
        includeFixed: pick([true, false]),
        count: pick(['all', 1, 7, 25] as const),
        draw: pick(['uniform', 'sections', 'sets'] as const),
        order: pick(['source', 'shuffled', 'easy-first', 'hard-first'] as const),
        feedback: pick(['immediate', 'deferred'] as const),
        maxTries: pick([null, 1, 3]),
        allowReveal: pick([true, false]),
        timeLimitMinutes: pick([null, 1, 40]),
        ...(pick([true, false]) && { difficulty: pick([{ min: 1, max: 3, unrated: false }, { min: 2, max: 5, unrated: true }, { min: 3, max: 5, unrated: false }, { min: 4, max: 4, unrated: false }] as const) }),
        ...(pick([true, false]) && { seed: rng.next() >>> 0 }),
      };
      const q = encodeConfig(c, 'v1');
      const d = decodeConfig(new URLSearchParams(q.toString()));
      expect(d).toEqual({ ok: true, config: c, contentVersion: 'v1' });
      // Canonical: same config, same link.
      expect(encodeConfig({ ...c }, 'v1').toString()).toBe(q.toString());
    }
  });

  it('carry excluded problems and empty section lists', () => {
    const c: QuizConfig = { ...defaultConfig(['a', 'b']), sections: { b: [] }, exclude: { a: ['P10', 'P2'] } };
    expect(encodeConfig(c).toString()).toBe('p=ordered&sets=a%2Cb&ex.a=P2%2CP10&sec.b=');
    expect(decodeConfig(new URLSearchParams('sets=a&ex.a=P3'))).toMatchObject({ ok: true, config: { exclude: { a: ['P3'] } } });
  });

  it('name the Nightmare preset without repeating its range', () => {
    const nightmare = defaultConfig(['a'], 'nightmare');
    expect(encodeConfig(nightmare).toString()).toBe('p=nightmare&sets=a');
    expect(decodeConfig(new URLSearchParams('p=nightmare&sets=a'))).toEqual({ ok: true, config: nightmare });
    expect(decodeConfig(new URLSearchParams('p=nightmare&sets=a&diff=1-5'))).toEqual({ ok: true, config: defaultConfig(['a'], 'exam') });
    expect(encodeConfig({ ...nightmare, difficulty: { min: 4, max: 5, unrated: false } }).toString()).toBe('p=exam&sets=a&diff=4-5');
    expect(encodeConfig(defaultConfig(['a'], 'easy-to-hard')).toString()).toBe('p=easy-to-hard&sets=a');
  });

  it('carry a difficulty range, and drop the full range (no filter)', () => {
    const c: QuizConfig = { ...defaultConfig(['a']), difficulty: { min: 2, max: 4, unrated: true } };
    expect(encodeConfig(c).toString()).toBe('p=ordered&sets=a&diff=2-4&unrated=1');
    expect(encodeConfig({ ...c, difficulty: { min: 1, max: 5, unrated: true } }).toString()).toBe('p=ordered&sets=a');
    expect(decodeConfig(new URLSearchParams('sets=a&diff=3-3'))).toMatchObject({ ok: true, config: { difficulty: { min: 3, max: 3, unrated: false } } });
    expect(decodeConfig(new URLSearchParams('sets=a&diff=1-5'))).toEqual({ ok: true, config: defaultConfig(['a']) });
    expect(decodeConfig(new URLSearchParams('sets=a&diff=hard'))).toMatchObject({ ok: false, issues: [expect.stringMatching(/difficulty/)] });
    expect(decodeConfig(new URLSearchParams('sets=a&diff=4-2'))).toMatchObject({ ok: false });
  });

  it('report bad links instead of guessing', () => {
    expect(decodeConfig(new URLSearchParams(''))).toBeNull();
    expect(decodeConfig(new URLSearchParams('p=nope&sets=a'))).toMatchObject({ ok: false, issues: [expect.stringMatching(/preset/)] });
    expect(decodeConfig(new URLSearchParams('p=exam&sets='))).toMatchObject({ ok: false });
    expect(decodeConfig(new URLSearchParams('p=exam&sets=a&n=zero'))).toMatchObject({ ok: false });
    expect(decodeConfig(new URLSearchParams('sets=a'))).toMatchObject({ ok: true, config: defaultConfig(['a']) });
  });
});

describe('randomness (share-link contract)', () => {
  it('hash32 is pinned', () => {
    expect([hash32(''), hash32('a'), hash32('phys161-exam2/P12'), hash32('42|phys161-exam2/P12')]).toMatchInlineSnapshot(`
      [
        2872998923,
        444641715,
        2270612525,
        1552141504,
      ]
    `);
    expect(questionSeed(42, 'phys161-exam2/P12')).toBe(hash32('42|phys161-exam2/P12'));
  });

  it('shuffles deterministically per seed and stream', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffle(xs, streamRng(1, 'order'));
    expect(shuffle(xs, streamRng(1, 'order'))).toEqual(a);
    expect(shuffle(xs, streamRng(1, 'draw'))).not.toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(xs);
  });

  it('slugs section names', () => {
    expect(sectionSlug("Newton's 2nd law")).toBe('newtons-2nd-law');
    expect(sectionSlug('Kinematics of 2D and 3D motion in vectors form')).toBe('kinematics-of-2d-and-3d-motion-in-vectors-form');
    expect(sectionSlug(undefined)).toBe('other');
  });
});
