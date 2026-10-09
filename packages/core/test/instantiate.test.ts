import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConstraintUnsatisfiableError,
  countVariants,
  drawSeed,
  evaluateConstraints,
  InstantiationError,
  instantiate,
  instantiateAt,
  MAX_SEED,
  parseScenario,
  rangeGrid,
  sampleScenario,
  type Scenario,
  uniformIndex,
  variantBreakdown,
} from '../src/index.ts';
import { C1 } from '../src/testing/index.ts';
import { corpusScenario, loadCorpus } from './corpus.ts';

function fingerprint(scenario: Scenario, seeds: number): string {
  const h = createHash('sha256');
  for (let seed = 0; seed < seeds; seed++) {
    const inst = instantiate(scenario, seed);
    h.update(JSON.stringify([seed, inst.values, inst.parts.map((p) => p.modelAnswer)]));
  }
  return h.digest('hex').slice(0, 16);
}

describe('determinism', () => {
  it('same seed ⇒ identical instance, for every corpus scenario', () => {
    for (const s of loadCorpus()) {
      for (const seed of [0, 1, 7, 12345, MAX_SEED]) {
        expect(instantiate(s, seed), `${s.id}@${seed}`).toEqual(instantiate(s, seed));
      }
    }
  });

  it('instances are plain JSON-serialisable data', () => {
    const inst = instantiate(corpusScenario('c03-luggage-ramp'), 3);
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });

  // The determinism contract: (scenarioId, seed) → values must never change.
  // These fingerprints cover 10k seeds each. If one changes, generated
  // problems changed identity — that is a breaking change, never a refactor.
  it.each([
    ['c03-luggage-ramp', '690d8d4dc6399968'],
    ['c06-vector-work', '323895664fc3adc0'],
    ['c08-bucket-box-gravel', '2929e9e7ff8c566d'],
  ])('10k-seed stability: %s', (id, expected) => {
    expect(fingerprint(corpusScenario(id), 10_000)).toBe(expected);
  });

  it('pins a few full instances (readable diff when rendering changes)', () => {
    expect(instantiate(corpusScenario('c03-luggage-ramp'), 42)).toMatchSnapshot();
    expect(instantiate(corpusScenario('c06-vector-work'), 42)).toMatchSnapshot();
  });

  it('different seeds give different problems', () => {
    const s = corpusScenario('c01-push-work');
    const seen = new Set(Array.from({ length: 100 }, (_, seed) => JSON.stringify(instantiate(s, seed).values)));
    expect(seen.size).toBeGreaterThan(95);
  });

  it('validates seeds', () => {
    const s = parseScenario(C1);
    for (const bad of [-1, 1.5, MAX_SEED + 1, Number.NaN]) {
      expect(() => instantiate(s, bad)).toThrow(InstantiationError);
    }
  });

  it('derives retry sub-seeds as seed·0x9E3779B1 + k (mod 2^32)', () => {
    expect(drawSeed(123, 0)).toBe(123);
    expect(drawSeed(1, 1)).toBe((0x9e3779b1 + 1) >>> 0);
    expect(drawSeed(MAX_SEED, 5)).toBe((Math.imul(MAX_SEED, 0x9e3779b1) + 5) >>> 0);
  });

  it('draws uniform indices without modulo bias', () => {
    let i = 0;
    const outputs = [0xffffffff | 0, 5, 6]; // first value is in the rejected tail for n = 3
    const rng = { next: () => outputs[i++]! };
    expect(uniformIndex(rng, 3)).toBe(5 % 3);
    const counts = [0, 0, 0];
    let x = 1;
    const lcg = { next: () => (x = (Math.imul(x, 1664525) + 1013904223) | 0) };
    for (let k = 0; k < 30_000; k++) counts[uniformIndex(lcg, 3)]!++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(400);
  });
});

describe('quantization', () => {
  it('computes grids exactly in decimal', () => {
    const g = rangeGrid({ name: 'mu', kind: 'range', min: 0.25, max: 0.45, step: 0.01 });
    expect(g.count).toBe(21); // naive floor((0.45-0.25)/0.01)+1 gives 20
    expect(g.valueAt(7)).toBe(0.32); // not 0.32000000000000006
    expect(rangeGrid({ name: 'a', kind: 'range', min: 0.1, max: 0.3, step: 0.1 }).count).toBe(3);
    expect(rangeGrid({ name: 'a', kind: 'range', min: 1e-16, max: 9.9e-16, step: 1e-17 }).valueAt(33)).toBe(4.3e-16);
    expect(rangeGrid({ name: 'a', kind: 'range', min: 6.0e6, max: 6.4e6, step: 1e4 }).count).toBe(41);
  });

  it('the value shown is the value used', () => {
    const s = corpusScenario('c03-luggage-ramp');
    for (let seed = 0; seed < 300; seed++) {
      const inst = instantiate(s, seed);
      const mu = inst.values.mu as number;
      const d = inst.values.d as number;
      expect(String(mu)).toMatch(/^0\.\d{1,2}$/);
      expect(String(d)).toMatch(/^\d(\.\d)?$/);
      expect(inst.narrativeHtml).toContain(`\\mu_k = ${mu.toFixed(2)}`);
      expect(inst.narrativeHtml).toContain(`${d.toFixed(1)}\u00a0m`);
      const N = (inst.values.m as number) * 9.8 * Math.cos(((inst.values.theta as number) * Math.PI) / 180);
      expect(inst.parts[1]!.modelAnswer).toBeCloseTo(-mu * N * d, 9);
    }
  });

  it('applies decimals and sigfigs to drawn values', () => {
    const s = parseScenario({
      ...C1,
      vars: [
        { name: 'm', kind: 'range', min: 0, max: 1, step: 0.001, decimals: 1 },
        { name: 'd', kind: 'range', min: 1000, max: 9999, step: 1, sigfigs: 2 },
        { name: 'F', kind: 'choice', options: [1.23456, 2.34567], decimals: 2 },
      ],
    });
    for (let seed = 0; seed < 100; seed++) {
      const v = instantiate(s, seed).values;
      expect(String(v.m)).toMatch(/^(0|1)(\.\d)?$/);
      expect((v.d as number) % 100).toBe(0);
      expect([1.23, 2.35]).toContain(v.F);
    }
  });
});

describe('constraints', () => {
  it('C8: rejected draws are re-drawn and every accepted draw satisfies the constraints', () => {
    const s = corpusScenario('c08-bucket-box-gravel');
    let retried = 0;
    for (let seed = 0; seed < 500; seed++) {
      const r = sampleScenario(s, seed);
      if (r.draws > 1) {
        retried++;
        expect(Object.keys(r.rejections).some((k) => k.startsWith('constraint'))).toBe(true);
      }
      expect(evaluateConstraints(s, r.values).every((c) => c.ok)).toBe(true);
      const { mb, M, mg, mus } = r.values as { mb: number; M: number; mg: number; mus: number };
      expect(mb).toBeLessThan(mus * (M + mg));
      expect(mb).toBeGreaterThan(mus * M);
    }
    expect(retried).toBeGreaterThan(50); // the constraints really do reject draws
  });

  it('without the constraints, C8 would silently flip branch', () => {
    const s = corpusScenario('c08-bucket-box-gravel');
    const unconstrained = { ...s, constraints: [] };
    const flipped = Array.from({ length: 500 }, (_, seed) => instantiate(unconstrained, seed).values).filter(
      (v) => !((v.mb as number) < (v.mus as number) * ((v.M as number) + (v.mg as number)) && (v.mb as number) > (v.mus as number) * (v.M as number)),
    );
    expect(flipped.length).toBeGreaterThan(50);
  });

  it('throws ConstraintUnsatisfiableError naming the failing constraint', () => {
    const s = parseScenario({ ...C1, constraints: ['m > 0', 'F > 1000'], maxSampleAttempts: 20 });
    let err: unknown;
    try {
      instantiate(s, 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConstraintUnsatisfiableError);
    expect((err as ConstraintUnsatisfiableError).params.failing).toBe('constraint #2 (F > 1000)');
    expect((err as ConstraintUnsatisfiableError).params.rejections).toEqual({ 'constraint #2 (F > 1000)': 20 });
  });

  it('treats domain errors in derived values as rejections', () => {
    const s = parseScenario({
      ...C1,
      derived: [{ name: 'r', expr: 'sqrt(F - 70)' }],
      parts: [{ id: 'work', prompt: '{_0}{_u}', answer: 'r', unit: 'J' }],
      canonical: { vars: { m: 66.5, d: 2.6, F: 73.8 }, parts: [{ id: 'work', answer: 1.949, unit: 'J' }] },
    });
    for (let seed = 0; seed < 50; seed++) expect(instantiate(s, seed).values.F as number).toBeGreaterThanOrEqual(70);
  });

  it('reports authoring bugs with their location', () => {
    const s = parseScenario({ ...C1, parts: [{ ...C1.parts[0]!, answer: 'F * dd' }] });
    let err: InstantiationError | undefined;
    try {
      instantiate(s, 0);
    } catch (e) {
      err = e as InstantiationError;
    }
    expect(err).toBeInstanceOf(InstantiationError);
    expect(err!.params.location).toEqual({ kind: 'answer', partId: 'work' });
    expect(err!.message).toMatch(/answer of part "work".*dd/);
  });
});

describe('variant counting', () => {
  it('multiplies grid sizes', () => {
    expect(countVariants(parseScenario(C1))).toBe(141 * 41 * 601);
    expect(variantBreakdown(corpusScenario('c03-luggage-ramp'))).toEqual({
      total: 17 * 15 * 15 * 21 * 26,
      vars: [
        { name: 'm', count: 17 },
        { name: 'theta', count: 15 },
        { name: 'F', count: 15 },
        { name: 'mu', count: 21 },
        { name: 'd', count: 26 },
      ],
    });
    expect(countVariants({ vars: [] })).toBe(1);
  });

  it('clamps to MAX_SAFE_INTEGER', () => {
    const huge = { name: 'x', kind: 'range' as const, min: 0, max: 1e9, step: 1 };
    const vars = ['a', 'b', 'c'].map((name) => ({ ...huge, name }));
    expect(countVariants({ vars })).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('pinned evaluation', () => {
  it('instantiateAt evaluates at explicit values (seed -1)', () => {
    const inst = instantiateAt(parseScenario(C1), { m: 66.5, d: 2.6, F: 73.8 });
    expect(inst.seed).toBe(-1);
    expect(inst.parts[0]!.modelAnswer).toBeCloseTo(191.88, 10);
  });
});
