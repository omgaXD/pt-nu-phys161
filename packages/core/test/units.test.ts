import { describe, expect, it } from 'vitest';
import {
  areCompatible,
  createUnitTable,
  DEFAULT_UNIT_TABLE,
  formatUnit,
  parseUnit,
  SI_CLASSES,
  tryParseStudentUnit,
  tryParseUnit,
  UnitParseError,
  unitToTex,
} from '../src/index.ts';

describe('parseUnit', () => {
  it('space is multiplication, one "/" negates the right side', () => {
    expect(parseUnit('kg m/s')).toEqual({ kg: 1, m: 1, s: -1 });
    expect(parseUnit('J/m^4')).toEqual({ J: 1, m: -4 });
    expect(parseUnit('J/(kg K)')).toEqual({ J: 1, kg: -1, K: -1 });
    expect(parseUnit('1/s')).toEqual({ s: -1 });
    expect(parseUnit('')).toEqual({});
  });

  it('accepts ^ exponents in all the documented spellings', () => {
    expect(parseUnit('m s^(-1)')).toEqual({ m: 1, s: -1 });
    expect(parseUnit('m s^-1')).toEqual({ m: 1, s: -1 });
    expect(parseUnit('kg m^2')).toEqual({ kg: 1, m: 2 });
    expect(parseUnit('rad/s^2')).toEqual({ rad: 1, s: -2 });
    expect(parseUnit('m/s²')).toEqual({ m: 1, s: -2 });
    expect(parseUnit('kg·m²')).toEqual({ kg: 1, m: 2 });
    expect(parseUnit('N⋅m')).toEqual({ N: 1, m: 1 });
    expect(parseUnit('μm')).toEqual({ µm: 1 }); // Greek mu → micro sign
    expect(parseUnit('°')).toEqual({ '°': 1 });
  });

  it('rejects malformed units', () => {
    for (const bad of ['m/s/s', 'm m', 'm/m', 'm^', 'm/', '2 m', 'm^0', 'm)', '(m', 'm^(x)']) {
      expect(() => parseUnit(bad), bad).toThrow(UnitParseError);
    }
  });

  it('is permutation-invariant', () => {
    expect(areCompatible('m s^(-1)', 'm/s')).toBe(1);
    expect(areCompatible('s^-1 m', 'm/s')).toBe(1);
    expect(areCompatible('kg m^2/s', 'm^2 kg s^-1')).toBe(1);
  });
});

describe('areCompatible — deliberate consequences', () => {
  it('5000 mm ≡ 5 m', () => {
    const f = areCompatible('mm', 'm');
    expect(f).toBeCloseTo(1e-3);
    expect(5000 * (f as number)).toBeCloseTo(5);
  });

  it('units with the same SI dimensions are interchangeable, as in Moodle', () => {
    expect(areCompatible('N', 'kg m/s^2')).toBe(1);
    expect(areCompatible('kg m/s^2', 'N')).toBe(1);
    expect(areCompatible('N m', 'J')).toBe(1);
    expect(areCompatible('kg m^2 s^-2', 'J')).toBe(1);
    expect(areCompatible('J/s', 'W')).toBe(1);
    expect(areCompatible('N/m^2', 'kPa')).toBeCloseTo(1e-3);
    expect(areCompatible('g cm/s^2', 'N')).toBeCloseTo(1e-5);
    expect(areCompatible('s^-1', 'Hz')).toBe(1);
    // Different dimensions still differ; so do unknown names and angles vs pure numbers.
    expect(areCompatible('N', 'J')).toBe(false);
    expect(areCompatible('N', 'kg m/s')).toBe(false);
    expect(areCompatible('xyz m', 'J')).toBe(false);
    expect(areCompatible('rad/s', 's^-1')).toBe(false);
    expect(areCompatible('°C', 'K')).toBe(false);
  });

  it('72 km/h vs 20 m/s: only compatible because h is in the s class', () => {
    const f = areCompatible('km/h', 'm/s');
    expect(f).not.toBe(false);
    expect(72 * (f as number)).toBeCloseTo(20);
    const withoutHours = createUnitTable(
      SI_CLASSES.map((c) =>
        c.id === 's' ? { id: 's', units: Object.fromEntries(Object.entries(c.units).filter(([n]) => n !== 'h')) } : c,
      ),
    );
    expect(areCompatible('km/h', 'm/s', withoutHours)).toBe(false);
  });

  it('converts within classes with the product of factors', () => {
    expect(areCompatible('kJ', 'J')).toBe(1000);
    expect(areCompatible('g', 'kg')).toBeCloseTo(1e-3);
    expect(areCompatible('g km', 'kg m')).toBeCloseTo(1);
    expect(areCompatible('eV', 'J')).toBeCloseTo(1 / 6.24150947e18, 30);
    expect(areCompatible('°', 'rad')).toBeCloseTo(Math.PI / 180);
    expect(areCompatible('rev', 'rad')).toBeCloseTo(2 * Math.PI);
    expect(areCompatible('rpm', 'Hz')).toBeCloseTo(1 / 60);
    expect(areCompatible('days', 'day')).toBe(1);
    expect(areCompatible('min', 's')).toBe(60);
    expect(areCompatible('mL', 'L')).toBeCloseTo(1e-3);
    expect(areCompatible('MJ', 'J')).toBe(1e6);
    expect(areCompatible('µm', 'um')).toBe(1);
  });

  it('respects exponents and classes', () => {
    expect(areCompatible('cm^2', 'm^2')).toBeCloseTo(1e-4);
    expect(areCompatible('m^2', 'm^3')).toBe(false);
    expect(areCompatible('m', 's')).toBe(false);
    expect(areCompatible('L', 'm^3')).toBeCloseTo(1e-3);
    expect(areCompatible('mL', 'cm^3')).toBeCloseTo(1);
    expect(areCompatible('rad/s', 'rpm')).toBe(false);
  });

  it('treats the empty unit as dimensionless, and unknown names as matching only themselves', () => {
    expect(areCompatible('', '')).toBe(1);
    expect(areCompatible('', 'J')).toBe(false);
    expect(areCompatible('bullets/min', 'bullets/min')).toBe(1);
    expect(areCompatible('bullets/min', 'bullets/s')).toBe(1 / 60);
    expect(areCompatible('foo', 'bar')).toBe(false);
    expect(areCompatible('m/s/s', 'm/s^2')).toBe(false); // unparseable is incompatible
  });

  it('thermodynamics: K and °C never convert, atm/bar are pressures, cal is energy, mol has prefixes', () => {
    expect(areCompatible('K', '°C')).toBe(false);
    expect(areCompatible('mK', 'K')).toBeCloseTo(1e-3);
    expect(areCompatible('°C', '°C')).toBe(1);
    expect(parseUnit('°C')).toEqual({ '°C': 1 });
    expect(areCompatible('atm', 'Pa')).toBe(101_325);
    expect(areCompatible('bar', 'kPa')).toBe(100);
    expect(areCompatible('kcal', 'J')).toBe(4184);
    expect(areCompatible('J/(mol K)', 'J/mol K')).toBe(1);
    expect(areCompatible('kJ/(kmol K)', 'J/(mol K)')).toBeCloseTo(1);
    expect(areCompatible('W/(m K)', 'W/(m K)')).toBe(1);
  });

  it('percent and decibels are units that only match themselves', () => {
    expect(parseUnit('%')).toEqual({ '%': 1 });
    expect(areCompatible('%', '%')).toBe(1);
    expect(areCompatible('%', '')).toBe(false);
    expect(areCompatible('dB', 'dB')).toBe(1);
    expect(DEFAULT_UNIT_TABLE.lookup('%')).toEqual({ classId: '%', factor: 1 });
  });

  it('leaves in and ha unknown, so they only match themselves (unit-conversion prompts)', () => {
    expect(DEFAULT_UNIT_TABLE.lookup('in')).toBeUndefined();
    expect(DEFAULT_UNIT_TABLE.lookup('ha')).toBeUndefined();
    expect(areCompatible('in^3', 'in^3')).toBe(1);
    expect(areCompatible('in^3', 'm^3')).toBe(false);
  });

  it('has no name in two classes', () => {
    expect(() => createUnitTable([...SI_CLASSES, { id: 'x', units: { m: 1 } }])).toThrow(/more than one class/);
    expect(DEFAULT_UNIT_TABLE.lookup('kg')).toEqual({ classId: 'g', factor: 1, dims: { kg: 1 } });
  });
});

describe('formatUnit / unitToTex', () => {
  it('formats canonically', () => {
    expect(formatUnit(parseUnit('kg m/s^2'))).toBe('kg m/s^2');
    expect(formatUnit(parseUnit('J/(kg K)'))).toBe('J/(kg K)');
    expect(formatUnit(parseUnit('s^-1'))).toBe('1/s');
    expect(formatUnit(parseUnit('m^2 s^-2'))).toBe('m^2/s^2');
    expect(formatUnit({})).toBe('');
    for (const u of ['kg m/s^2', 'J/(kg K)', 'rad/s', 'kg m^2']) expect(parseUnit(formatUnit(parseUnit(u)))).toEqual(parseUnit(u));
  });

  it('renders TeX', () => {
    expect(unitToTex('m/s^2')).toBe('\\text{m}/\\text{s}^{2}');
    expect(unitToTex('J/m^4')).toBe('\\text{J}/\\text{m}^{4}');
    expect(unitToTex('kg m^2')).toBe('\\text{kg}\\,\\text{m}^{2}');
    expect(unitToTex('J/(kg K)')).toBe('\\text{J}/\\left(\\text{kg}\\,\\text{K}\\right)');
    expect(unitToTex('°')).toBe('^{\\circ}');
  });

  it('parses student units with qtype_formulas\' stricter grammar', () => {
    expect(tryParseStudentUnit('kg m^2 s^-2')).toEqual({ kg: 1, m: 2, s: -2 });
    expect(tryParseStudentUnit('J/(kg K)')).toEqual({ J: 1, kg: -1, K: -1 });
    for (const u of ['N*m', 'N·m', 'N⋅m', '1/s']) expect(tryParseStudentUnit(u)).toBeNull();
    expect(tryParseUnit('N*m')).toEqual({ N: 1, m: 1 }); // authored units stay lenient
  });

  it('renders the fraction form of the answer preview', () => {
    const tex = (u: string) => unitToTex(u, { fraction: true });
    expect(tex('kg m^2/(s^3 A)')).toBe('\\dfrac{\\text{kg} \\cdot \\text{m}^{2}}{\\text{s}^{3} \\cdot \\text{A}}');
    expect(tex('m s^-1')).toBe('\\dfrac{\\text{m}}{\\text{s}}');
    expect(tex('1/s')).toBe('\\dfrac{1}{\\text{s}}');
    expect(tex('N m')).toBe('\\text{N} \\cdot \\text{m}');
  });
});
