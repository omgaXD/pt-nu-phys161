import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  decodeConfig,
  defaultConfig,
  encodeConfig,
  hash32,
  matchPreset,
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
    for (const id of ['ordered', 'exam', 'chaotic'] as const) {
      expect(QuizConfigSchema.parse(defaultConfig(['a'], id))).toEqual(defaultConfig(['a'], id));
      expect(matchPreset(defaultConfig(['a'], id))).toBe(id);
    }
  });

  it('describe the three modes', () => {
    expect(PRESETS.ordered).toMatchObject({ count: 'all', order: 'source', feedback: 'immediate', allowReveal: true, timeLimitMinutes: null, values: 'random' });
    expect(PRESETS.exam).toMatchObject({ count: 7, draw: 'sections', feedback: 'deferred', allowReveal: false, timeLimitMinutes: 40 });
    expect(PRESETS.chaotic).toEqual({ ...PRESETS.ordered, order: 'shuffled' });
  });

  it('keep the content selection when applied, and become custom when a mode field changes', () => {
    const c: QuizConfig = { ...defaultConfig(['a', 'b']), sections: { a: ['work'] }, skipSolved: true, seed: 5 };
    const exam = applyPreset(c, 'exam');
    expect(exam).toMatchObject({ sets: ['a', 'b'], sections: { a: ['work'] }, skipSolved: true, seed: 5, count: 7 });
    expect(matchPreset({ ...exam, timeLimitMinutes: 30 })).toBe('custom');
    expect(matchPreset({ ...c, values: 'source' })).toBe('custom');
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

  it('round-trip every configuration (seeded property loop), never carrying skipSolved', () => {
    const rng = streamRng(7, 'configs');
    const pick = <T>(xs: readonly T[]): T => xs[(rng.next() >>> 0) % xs.length]!;
    for (let i = 0; i < 300; i++) {
      const c: QuizConfig = {
        sets: pick([['a'], ['a', 'b'], ['b', 'c', 'a']]),
        sections: pick<Record<string, string[]>>([{}, { a: ['x', 'y'] }]),
        values: pick(['random', 'source'] as const),
        includeFixed: pick([true, false]),
        skipSolved: pick([true, false]),
        count: pick(['all', 1, 7, 25] as const),
        draw: pick(['uniform', 'sections', 'sets'] as const),
        order: pick(['source', 'shuffled'] as const),
        feedback: pick(['immediate', 'deferred'] as const),
        maxTries: pick([null, 1, 3]),
        allowReveal: pick([true, false]),
        timeLimitMinutes: pick([null, 1, 40]),
        ...(pick([true, false]) && { seed: rng.next() >>> 0 }),
      };
      const q = encodeConfig(c, 'v1');
      const d = decodeConfig(new URLSearchParams(q.toString()));
      expect(d).toEqual({ ok: true, config: { ...c, sections: c.sections, skipSolved: false }, contentVersion: 'v1' });
      expect(q.toString()).not.toMatch(/skip/i);
      // Canonical: same config, same link.
      expect(encodeConfig({ ...c }, 'v1').toString()).toBe(q.toString());
    }
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
