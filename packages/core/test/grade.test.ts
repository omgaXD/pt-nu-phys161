import { describe, expect, it } from 'vitest';
import {
  gradePart,
  gradeScenario,
  instantiateAt,
  type Part,
  type PartResponse,
  type ProblemInstance,
  responseFromFields,
  type Scenario,
  splitCombinedAnswer,
  withinTolerance,
} from '../src/index.ts';
import { corpusScenario } from './corpus.ts';

function atCanonical(s: Scenario): ProblemInstance {
  const randoms = Object.fromEntries(Object.entries(s.canonical.vars).filter(([k]) => s.vars.some((v) => v.name === k)));
  return instantiateAt(s, randoms);
}

function grader(id: string, partIndex = 0) {
  const s = corpusScenario(id);
  const inst = atCanonical(s);
  const part = s.parts[partIndex]!;
  const ip = inst.parts[partIndex]!;
  return {
    part,
    model: ip.modelAnswer,
    grade: (r: PartResponse | undefined, override: Partial<Part> = {}) => gradePart({ ...part, ...override }, ip, r),
  };
}

describe('grading (M6)', () => {
  it('C5: relative tolerance at 1e-19 scale; zero is not "close enough"', () => {
    const { grade, model } = grader('c05-proton-momentum');
    expect(model).toBeCloseTo(2.34205e-19, 24);
    expect(grade({ value: '2.34205e-19', unit: 'J' })).toMatchObject({ fraction: 1, valueOk: true, unitOk: true });
    expect(grade({ value: '2.35e-19', unit: 'J' }).fraction).toBe(1); // within 1 %
    expect(grade({ value: '2.5e-19', unit: 'J' }).fraction).toBe(0); // 7 % off
    expect(grade({ value: '0', unit: 'J' }).fraction).toBe(0);
    expect(grade({ value: '1e-30', unit: 'J' }).fraction).toBe(0);
    // Why absolute tolerance is meaningless here: any plausible abs tolerance accepts 0.
    expect(grade({ value: '0', unit: 'J' }, { tolerance: { rel: 0.01, abs: 1e-15 } }).fraction).toBe(1);
    // Prefixed units convert: 2.34205e-19 J = 2.34205e-16 mJ.
    expect(grade({ value: '2.34205e-16', unit: 'mJ' }).fraction).toBe(1);
  });

  it('C10: dimensionless — no unit expected, unit penalty never applies', () => {
    const { grade, part } = grader('c10-bounce-energy-fraction');
    expect(part.unit).toBeUndefined();
    expect(grade({ value: '0.16' })).toMatchObject({ fraction: 1, valueOk: true, unitOk: true });
    expect(grade({ value: '0.16', unit: 'J' })).toMatchObject({ fraction: 1, unitOk: true });
    expect(grade({ value: '1 - 0.84' })).toMatchObject({ fraction: 1 });
    expect(grade({ value: '0.1616' }).fraction).toBe(1);
    expect(grade({ value: '0.17' })).toMatchObject({ fraction: 0, valueOk: false, unitOk: true });
    expect(grade({ value: '0.16' }, { unitPenalty: 1 }).fraction).toBe(1);
  });

  it('C11: integer answers are exact — 23.9 is wrong at any tolerance', () => {
    const { grade } = grader('c11-railroad-cars');
    expect(grade({ value: '24' }).fraction).toBe(1);
    expect(grade({ value: '24.0' }).fraction).toBe(1);
    expect(grade({ value: '4*6' }).fraction).toBe(1);
    expect(grade({ value: '23.9' }).fraction).toBe(0);
    expect(grade({ value: '24.1' }).fraction).toBe(0);
    expect(grade({ value: '23.9' }, { tolerance: { rel: 0.5 } }).fraction).toBe(0);
    expect(grade({ value: '25' }).fraction).toBe(0);
    expect(withinTolerance(24.000000000001, 24, { integer: true, tolerance: {} })).toBe(true);
  });

  it('unit penalty: wrong or missing unit costs `unitPenalty` of the credit', () => {
    const { grade } = grader('c01-push-work');
    expect(grade({ value: '191.88', unit: 'J' }).fraction).toBe(1);
    expect(grade({ value: '191.88' })).toMatchObject({ fraction: 0, valueOk: true, unitOk: false });
    expect(grade({ value: '191.88', unit: 'N' })).toMatchObject({ fraction: 0, valueOk: true, unitOk: false });
    expect(grade({ value: '191.88', unit: 'N' }, { unitPenalty: 0.25 }).fraction).toBe(0.75);
    expect(grade({ value: '191.88' }, { unitPenalty: 0 }).fraction).toBe(1);
    expect(grade({ value: '150', unit: 'J' }, { unitPenalty: 0.25 }).fraction).toBe(0);
  });

  it('converts compatible units before comparing', () => {
    const { grade } = grader('c01-push-work');
    expect(grade({ value: '0.19188', unit: 'kJ' })).toMatchObject({ fraction: 1, conversionFactor: 1000 });
    expect(grade({ value: '191880', unit: 'mJ' }).fraction).toBe(1);
    expect(grade({ value: '191.88', unit: 'kJ' })).toMatchObject({ fraction: 0, unitOk: true, valueOk: false });
    expect(grade({ value: '191.88', unit: 'N m' }).unitOk).toBe(false); // J ≠ N m by design
  });

  it('grades combined number+unit fields', () => {
    const { grade } = grader('c01-push-work');
    expect(grade({ combined: '191.88 J' }).fraction).toBe(1);
    expect(grade({ combined: '191.88J' }).fraction).toBe(1);
    expect(grade({ combined: '0.19188 kJ' }).fraction).toBe(1);
    expect(grade({ combined: '191.88' })).toMatchObject({ fraction: 0, unitOk: false, valueOk: true });
    const mars = grader('c12c-mars-launch-window');
    expect(mars.grade({ combined: '111.3 days' }).fraction).toBe(1);
    expect(mars.grade({ combined: '111.3 day' }).fraction).toBe(1);
  });

  it('parse failures give zero but still evaluate the unit', () => {
    const { grade } = grader('c01-push-work');
    expect(grade({ value: 'abc', unit: 'J' })).toMatchObject({
      fraction: 0,
      valueOk: false,
      unitOk: true,
      studentValue: null,
      parsedLatex: null,
      error: { code: 'identifier-not-allowed' },
    });
    expect(grade({ value: 'sqrt(36817)', unit: 'J' }).error?.code).toBe('function-not-allowed');
    expect(grade({ value: '191.88', unit: 'm/s/s' })).toMatchObject({ unitOk: false, error: { code: 'unit-syntax' } });
    expect(grade(undefined)).toMatchObject({ fraction: 0, error: { code: 'no-response' } });
  });

  it('accepts the whole instance, as in the plan (gradePart(part, instance, response))', () => {
    const s = corpusScenario('c03-luggage-ramp');
    const inst = atCanonical(s);
    expect(gradePart(s.parts[2]!, inst, { combined: '372.496 J' }).fraction).toBe(1);
    expect(() => gradePart({ ...s.parts[2]!, id: 'nope' }, inst, { combined: '1 J' })).toThrow(/no part "nope"/);
  });

  it('reports everything a review UI needs', () => {
    const { grade } = grader('c02-angled-push');
    const r = grade({ value: '233.2', unit: 'J' });
    expect(Object.keys(r).sort()).toEqual(
      ['conversionFactor', 'fraction', 'modelAnswer', 'parsedLatex', 'partId', 'studentUnit', 'studentValue', 'unitOk', 'valueOk'].sort(),
    );
    expect(r).toMatchObject({ parsedLatex: '233.2', studentValue: 233.2, studentUnit: 'J', conversionFactor: 1 });
  });

  it('negative model answers (C3 friction work)', () => {
    const { grade } = grader('c03-luggage-ramp', 1);
    expect(grade({ combined: '-190.796 J' }).fraction).toBe(0); // P14 values, not P13
    const s = corpusScenario('c03-luggage-ramp');
    const inst = instantiateAt(s, { m: 18, theta: 28, F: 195, mu: 0.35, d: 3.5 });
    expect(gradePart(s.parts[1]!, inst.parts[1]!, { combined: '-190.796 J' }).fraction).toBe(1);
    expect(gradePart(s.parts[1]!, inst.parts[1]!, { combined: '190.796 J' }).fraction).toBe(0);
  });

  it('gradeScenario weights parts by mark', () => {
    const s = corpusScenario('c03-luggage-ramp');
    const weighted = { ...s, parts: s.parts.map((p, i) => ({ ...p, mark: i + 1 })) }; // marks 1, 2, 3
    const inst = atCanonical(s);
    const [f, fr, g] = inst.parts.map((p) => p.modelAnswer);
    const r = gradeScenario(weighted, inst, {
      'work-by-f': { combined: `${f} J` },
      'work-by-friction': { combined: `${fr! * 2} J` },
      'work-by-gravity': { value: String(g), unit: 'J' },
    });
    expect(r.parts.map((p) => p.fraction)).toEqual([1, 0, 1]);
    expect(r).toMatchObject({ earned: 4, total: 6 });
    expect(r.fraction).toBeCloseTo(4 / 6);
    expect(gradeScenario(s, inst, {}).fraction).toBe(0);
  });
});

describe('splitCombinedAnswer', () => {
  it.each([
    ['191.88 J', '191.88', 'J'],
    ['191.88J', '191.88', 'J'],
    ['3.2 m/s^2', '3.2', 'm/s^2'],
    ['1.152e16 J', '1.152e16', 'J'],
    ['2 pi rad', '2 pi', 'rad'],
    ['5 min', '5', 'min'],
    ['9.8 kg m/s^2', '9.8', 'kg m/s^2'],
    ['-20.32 rad/s^2', '-20.32', 'rad/s^2'],
    ['42', '42', ''],
    ['1.5e3', '1.5e3', ''],
    ['12 widgets', '12', 'widgets'],
    ['12%', '12', '%'],
    ['12 %', '12', '%'],
    ['300 K', '300', 'K'],
    ['25 °C', '25', '°C'],
    ['862.9 J/(kg K)', '862.9', 'J/(kg K)'],
  ])('%s → value %s, unit %s', (input, value, unit) => {
    expect(splitCombinedAnswer(input)).toEqual({ value, unit });
  });
});

describe('exactUnit and percent', () => {
  const part = (over: Partial<Part>): Part =>
    ({ id: 'a', prompt: '', answerType: 'numeric', answer: '0', tolerance: {}, ...over }) as Part;

  it('converts within a class by default, but not when exactUnit is set', () => {
    const p = part({ unit: 'km/h' });
    expect(gradePart(p, { modelAnswer: 72 }, { combined: '20 m/s' })).toMatchObject({ valueOk: true, unitOk: true, fraction: 1 });
    const exact = part({ unit: 'km/h', exactUnit: true });
    expect(gradePart(exact, { modelAnswer: 72 }, { combined: '20 m/s' })).toMatchObject({ unitOk: false, fraction: 0 });
    expect(gradePart(exact, { modelAnswer: 72 }, { combined: '72 km/h' })).toMatchObject({ valueOk: true, unitOk: true, fraction: 1 });
    // Same components in another order or spelling still count as exact.
    expect(gradePart(part({ unit: 'm/s', exactUnit: true }), { modelAnswer: 3 }, { combined: '3 m s^-1' }).fraction).toBe(1);
  });

  it('grades percent answers', () => {
    const p = part({ unit: '%' });
    expect(gradePart(p, { modelAnswer: 12.5 }, { combined: '12.5%' }).fraction).toBe(1);
    expect(gradePart(p, { modelAnswer: 12.5 }, { combined: '12.5' })).toMatchObject({ valueOk: true, unitOk: false, fraction: 0 });
  });

  it('turns field contents into responses', () => {
    const combined = { slots: [{ index: 0, kind: 'combined' as const }] };
    const separate = { slots: [{ index: 0, kind: 'value' as const }, { index: 0, kind: 'unit' as const }] };
    expect(responseFromFields(combined, { value: '3 m', unit: '' })).toEqual({ combined: '3 m' });
    expect(responseFromFields(separate, { value: '3', unit: 'm' })).toEqual({ value: '3', unit: 'm' });
    expect(responseFromFields(separate, { value: ' ', unit: '' })).toBeUndefined();
    expect(responseFromFields(separate, undefined)).toBeUndefined();
  });
});
