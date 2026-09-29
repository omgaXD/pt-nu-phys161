import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  DEFAULTS,
  effectiveMark,
  effectiveStep,
  effectiveTolerance,
  effectiveUnitPenalty,
  parseScenario,
  parseSetDoc,
  type RandomVar,
  safeParseScenario,
  ScenarioSchema,
  toStorable,
} from '../src/index.ts';
import { C1 } from '../src/testing/index.ts';

const clone = <T>(x: T): T => structuredClone(x);

function issuesOf(input: unknown): string[] {
  const r = safeParseScenario(input);
  return r.ok ? [] : r.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('scenario schema (M1)', () => {
  it('C1 parses and validates', () => {
    const s = parseScenario(C1);
    expect(s.id).toBe('c01-push-work');
    expect(s.parts).toHaveLength(1);
  });

  it('applies defaults (answerType, empty derived/constraints, tolerance)', () => {
    const minimal = clone(C1);
    delete minimal.parts[0]!.tolerance;
    const s = parseScenario(minimal);
    expect(s.parts[0]!.answerType).toBe('numeric');
    expect(s.derived).toEqual([]);
    expect(s.constraints).toEqual([]);
    expect(s.parts[0]!.tolerance).toEqual({});
    expect(effectiveTolerance(s.parts[0]!)).toEqual({ rel: 0.01, abs: undefined, absBelow: 1e-12 });
    expect(effectiveUnitPenalty(s.parts[0]!)).toBe(1);
    expect(effectiveMark(s.parts[0]!)).toBe(1);
    expect(DEFAULTS.maxSampleAttempts).toBe(200);
  });

  it('round-trips through JSON, the storable form and YAML', () => {
    const s = parseScenario(C1);
    expect(parseScenario(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseScenario(toStorable(s))).toEqual(s);
    expect(parseScenario(parseYaml(stringifyYaml(toStorable(s))))).toEqual(s);
  });

  it('storable form drops uninformative defaults', () => {
    const stored = toStorable(parseScenario(C1)) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('derived');
    expect(stored).not.toHaveProperty('constraints');
    expect((stored.parts as Record<string, unknown>[])[0]).not.toHaveProperty('answerType');
  });

  it('is strict about unknown keys (typos are errors)', () => {
    const bad = clone(C1) as unknown as { parts: Record<string, unknown>[] };
    bad.parts[0]!.tolernce = { rel: 0.01 };
    expect(issuesOf(bad).join('\n')).toMatch(/tolernce/);
  });

  it('rejects duplicate and reserved variable names', () => {
    const dup = clone(C1);
    dup.derived = [{ name: 'm', expr: '1' }];
    expect(issuesOf(dup).join()).toMatch(/duplicate variable name "m"/);
    for (const name of ['pi', 'sqrt', 'and', '_x', '1x']) {
      const r = clone(C1);
      r.vars = [{ name, kind: 'range', min: 1, max: 2 }] as RandomVar[];
      expect(issuesOf(r).length, name).toBeGreaterThan(0);
    }
  });

  it('checks canonical references and completeness', () => {
    const unknownPart = clone(C1);
    unknownPart.canonical.parts[0]!.id = 'nope';
    expect(issuesOf(unknownPart).join()).toMatch(/unknown part "nope"/);

    const missingVar = clone(C1);
    delete (missingVar.canonical.vars as Record<string, unknown>).F;
    expect(issuesOf(missingVar).join()).toMatch(/canonical values missing for F/);

    const unknownVar = clone(C1);
    (unknownVar.canonical.vars as Record<string, unknown>).zeta = 1;
    expect(issuesOf(unknownVar).join()).toMatch(/unknown variable "zeta"/);

    const noCanonical = clone(C1) as Record<string, unknown>;
    delete noCanonical.canonical;
    expect(issuesOf(noCanonical).join()).toMatch(/canonical/);
  });

  it('validates variables', () => {
    const both = clone(C1);
    both.vars![0] = { ...both.vars![0]!, sigfigs: 2 } as RandomVar;
    expect(issuesOf(both).join()).toMatch(/either decimals or sigfigs/);

    const inverted = clone(C1);
    inverted.vars![1] = { name: 'd', kind: 'range', min: 5, max: 1 };
    expect(issuesOf(inverted).join()).toMatch(/max must be >= min/);

    const choiceWithRange = clone(C1);
    choiceWithRange.vars![1] = { name: 'd', kind: 'choice', options: [1, 2], min: 1 } as unknown as RandomVar;
    expect(issuesOf(choiceWithRange).length).toBeGreaterThan(0);

    const emptyChoice = clone(C1);
    emptyChoice.vars![1] = { name: 'd', kind: 'choice', options: [] };
    expect(issuesOf(emptyChoice).length).toBeGreaterThan(0);
  });

  it('requires figure alt text and a safe relative src', () => {
    const noAlt = clone(C1);
    noAlt.figure = { id: 'f', src: 'figures/a.png', alt: '   ' };
    expect(issuesOf(noAlt).join()).toMatch(/alt text is required/);
    for (const src of ['../escape.png', '/abs.png', 'https://x.y/a.png', 'figures/../../a.png']) {
      const bad = clone(C1);
      bad.figure = { id: 'f', src, alt: 'ok' };
      expect(issuesOf(bad).join(), src).toMatch(/relative path/);
    }
  });

  it('validates part fields', () => {
    const p = clone(C1);
    p.parts[0]!.unitPenalty = 2;
    p.parts[0]!.difficulty = 7 as 1;
    p.parts[0]!.answerType = 'algebraic' as 'numeric';
    expect(issuesOf(p)).toHaveLength(3);
    const dup = clone(C1);
    dup.parts.push(clone(dup.parts[0]!));
    expect(issuesOf(dup).join()).toMatch(/duplicate part id/);
  });

  it('accepts an integer flag on parts', () => {
    const p = clone(C1);
    p.parts[0]!.integer = true;
    expect(parseScenario(p).parts[0]!.integer).toBe(true);
  });

  it('derives the step of a range variable', () => {
    expect(effectiveStep({ name: 'a', kind: 'range', min: 0, max: 1, step: 0.25 })).toBe(0.25);
    expect(effectiveStep({ name: 'a', kind: 'range', min: 0, max: 1, decimals: 2 })).toBe(0.01);
    expect(effectiveStep({ name: 'a', kind: 'range', min: 0, max: 10 })).toBe(1);
  });

  it('exposes a JSON schema for agents (zod is the single source of truth)', async () => {
    const { toJSONSchema } = await import('zod');
    const js = toJSONSchema(ScenarioSchema, { io: 'input' }) as { properties: Record<string, unknown> };
    expect(Object.keys(js.properties)).toEqual(expect.arrayContaining(['id', 'narrative', 'vars', 'parts', 'canonical']));
  });

  it('parses set documents', () => {
    expect(parseSetDoc({ id: 'phys', title: 'Physics' })).toEqual({ id: 'phys', title: 'Physics', sections: [] });
    expect(() => parseSetDoc({ id: 'Bad Id', title: 'x' })).toThrow(/invalid set/);
  });
});
