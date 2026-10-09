import { describe, expect, it } from 'vitest';
import { checkCanonical, diagnoseScenario, parseScenario, type Scenario } from '../src/index.ts';
import { C1 } from '../src/testing/index.ts';
import { corpusScenario } from './corpus.ts';

const mutate = (s: Scenario, f: (s: Scenario) => void): Scenario => {
  const c = structuredClone(s);
  f(c);
  return parseScenario(c);
};

describe('canonical check', () => {
  it('passes on a correct transcription', () => {
    const r = checkCanonical(parseScenario(C1));
    expect(r.ok).toBe(true);
    expect(r.parts[0]).toMatchObject({ partId: 'work', source: 'P1', expected: 191.88, ok: true });
    expect(r.parts[0]!.relError).toBeLessThan(1e-12);
  });

  it('catches a transcription error in a formula', () => {
    const s = mutate(corpusScenario('c03-luggage-ramp'), (x) => {
      x.parts[1]!.answer = '-mu * N'; // forgot "* d"
    });
    const r = checkCanonical(s);
    expect(r.ok).toBe(false);
    const friction = r.parts.find((p) => p.partId === 'work-by-friction')!;
    expect(friction.ok).toBe(false);
    expect(friction.expected).toBe(-190.796);
    expect(friction.computed).toBeCloseTo(-190.796 / 3.5, 3);
    expect(r.parts.filter((p) => p.ok).map((p) => p.partId)).toEqual(['work-by-f', 'work-by-gravity']);
  });

  it('verifies each part against its own source values', () => {
    const r = checkCanonical(corpusScenario('c13-printing-roller'));
    expect(r.parts.map((p) => [p.source, p.ok])).toEqual([
      ['P115', true],
      ['P116', true],
      ['P117', true],
      ['P118', true],
    ]);
  });

  it('converts the printed unit to the part unit', () => {
    const r = checkCanonical(mutate(parseScenario(C1), (x) => (x.canonical.parts[0]!.unit = 'kJ')));
    expect(r.ok).toBe(false); // 191.88 kJ ≠ 191.88 J
    const ok = checkCanonical(
      mutate(parseScenario(C1), (x) => {
        x.canonical.parts[0]!.unit = 'kJ';
        x.canonical.parts[0]!.answer = 0.19188;
      }),
    );
    expect(ok.ok).toBe(true);
    const bad = checkCanonical(mutate(parseScenario(C1), (x) => (x.canonical.parts[0]!.unit = 'N')));
    expect(bad.parts[0]!.error?.code).toBe('unit-mismatch');
  });

  it('asserts pinned derived constants', () => {
    const r = checkCanonical(mutate(corpusScenario('c09-loop-min-height'), (x) => (x.canonical.vars.g = 9.81)));
    expect(r.ok).toBe(false);
    expect(r.parts[0]!.derivedMismatches).toEqual([{ name: 'g', expected: 9.81, actual: 9.8 }]);
  });

  it('warns (not fails) when source values violate a constraint or are off-grid', () => {
    const r = checkCanonical(corpusScenario('c03-luggage-ramp'));
    expect(r.ok).toBe(true);
    expect(r.warnings).toContainEqual({
      code: 'canonical-violates-constraint',
      partId: 'work-by-f',
      constraint: 'F > m * g * sin(theta * pi / 180) + mu * N',
    });
    const off = checkCanonical(mutate(parseScenario(C1), (x) => (x.canonical.vars.m = 66.25)));
    expect(off.ok).toBe(true);
    expect(off.warnings).toEqual([{ code: 'canonical-off-grid', name: 'm', value: 66.25 }]);
  });

  it('reports evaluation errors instead of throwing', () => {
    const r = checkCanonical(mutate(parseScenario(C1), (x) => (x.parts[0]!.answer = 'F / (d - 2.6)')));
    expect(r.parts[0]!.error?.code).toBe('expression-error');
    expect(r.ok).toBe(false);
  });
});

describe('diagnoseScenario', () => {
  const codes = (s: Scenario): string[] => diagnoseScenario(s).map((d) => `${d.severity}:${d.code}@${d.path.join('.')}`);

  it('is clean for a good scenario', () => {
    expect(diagnoseScenario(parseScenario(C1))).toEqual([]);
  });

  it('flags formula problems with their path', () => {
    const s = mutate(parseScenario(C1), (x) => {
      x.derived = [
        { name: 'a', expr: 'b * 2' },
        { name: 'b', expr: 'F +' },
      ];
      x.constraints = ['zeta > 0'];
      x.parts[0]!.answer = 'F * dd';
    });
    expect(codes(s)).toEqual([
      'error:forward-reference@derived.0.expr',
      'error:syntax@derived.1.expr',
      'error:unknown-identifier@constraints.0',
      'error:unknown-identifier@parts.0.answer',
    ]);
  });

  it('flags template problems with positions', () => {
    const s = mutate(parseScenario(C1), (x) => {
      x.narrative = 'Mass {mass} and $x {@fig}';
      x.parts[0]!.prompt = 'Work {_1} {_u} {= F *}';
      x.parts[0]!.hint = 'Try {_0}';
    });
    const d = diagnoseScenario(s);
    expect(d.map((x) => `${x.code}@${x.path.join('.')}`)).toEqual([
      'unclosed-math@narrative',
      'unknown-identifier@narrative',
      'multi-slot@parts.0.prompt',
      'syntax@parts.0.prompt',
      'slot-not-allowed@parts.0.hint',
    ]);
    expect(d[1]!.position).toBe(5);
  });

  it('checks units and figure usage', () => {
    const s = mutate(parseScenario(C1), (x) => {
      x.parts[0]!.unit = 'm/s/s';
      x.vars[0]!.unit = 'furlong';
      x.narrative += ' {@fig}';
    });
    expect(codes(s)).toEqual(['warning:unit-unknown@vars.0.unit', 'error:no-figure@narrative', 'error:unit-syntax@parts.0.unit']);
  });

  it('warns about ineffective settings', () => {
    const s = mutate(corpusScenario('c10-bounce-energy-fraction'), (x) => {
      x.parts[0]!.unitPenalty = 0.5;
      x.parts[0]!.prompt += ' {_u}';
      x.vars.push({ name: 'z', kind: 'range', min: 1, max: 1 });
      x.canonical.vars.z = 1;
    });
    expect(codes(s)).toEqual([
      'warning:single-variant@vars.3',
      'warning:unit-slot-dimensionless@parts.0.prompt',
      'warning:penalty-without-unit@parts.0.unitPenalty',
    ]);
  });
});
