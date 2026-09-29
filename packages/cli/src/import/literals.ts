import { isReservedName } from '@pt/core';
import { symbolToIdentifier } from './normalize.js';

/** A numeric literal found in a problem statement: a draft variable. */
export interface Literal {
  name: string;
  value: number;
  unit?: string;
  /** Exact source text of the number (without unit), e.g. "1.6×10^8". */
  text: string;
  /** Offsets of the number in the question text. */
  start: number;
  end: number;
  /** End offset of the unit written directly after the number (space-separated), if any. */
  unitEnd?: number;
  /** A physical constant (g = 9.8…) rather than a problem parameter. */
  constant?: boolean;
  /** Suggested grid around the source value; the author decides. */
  suggest: { min: number; max: number; step: number; decimals?: number };
}

/** Unit spellings found after numbers, longest first; value = canonical unit. */
const UNITS: [RegExp, string][] = (
  [
    ['kJ/ ?\\(?kg ?[·⋅*]? ?K\\)?', 'kJ/(kg K)'],
    ['J/ ?\\(?kg ?[·⋅*]? ?K\\)?', 'J/(kg K)'],
    ['J/ ?\\(?kg ?[·⋅*]? ?°C\\)?', 'J/(kg °C)'],
    ['J/ ?\\(?mol ?[·⋅*]? ?K\\)?', 'J/(mol K)'],
    ['W/ ?\\(?m ?[·⋅*]? ?K\\)?', 'W/(m K)'],
    ['W/ ?\\(?m ?[·⋅*]? ?°C\\)?', 'W/(m °C)'],
    ['1/K', '1/K'],
    ['1/°C', '1/°C'],
    ['1/mol', '1/mol'],
    ['kJ/kg', 'kJ/kg'],
    ['kJ/g', 'kJ/g'],
    ['N/m\\^2', 'N/m^2'],
    ['cycles/s', 'Hz'],
    ['J/kg', 'J/kg'],
    ['J/K', 'J/K'],
    ['g/mol', 'g/mol'],
    ['kg/mol', 'kg/mol'],
    ['mol(?:es?)?', 'mol'],
    ['atm', 'atm'],
    ['kPa', 'kPa'],
    ['MPa', 'MPa'],
    ['Pa', 'Pa'],
    ['°\\s?C', '°C'],
    ['kHz', 'kHz'],
    ['Hz', 'Hz'],
    ['dB', 'dB'],
    ['kcal', 'kcal'],
    ['cal', 'cal'],
    ['kJ', 'kJ'],
    ['K', 'K'],
    ['kg ?[·⋅*]? ?m\\^2/s', 'kg m^2/s'],
    ['kg ?[·⋅*]? ?m\\^2', 'kg m^2'],
    ['kg ?[·⋅*]? ?m/s', 'kg m/s'],
    ['kg/m\\^3', 'kg/m^3'],
    ['kg/m\\^2', 'kg/m^2'],
    ['kg/s', 'kg/s'],
    ['kg', 'kg'],
    ['grams?', 'g'],
    ['km/s', 'km/s'],
    ['m/s\\^2', 'm/s^2'],
    ['m/s', 'm/s'],
    ['m\\^3', 'm^3'],
    ['cm\\^3', 'cm^3'],
    ['cm\\^2', 'cm^2'],
    ['m\\^2', 'm^2'],
    ['cm', 'cm'],
    ['mm', 'mm'],
    ['km', 'km'],
    ['J/m\\^4', 'J/m^4'],
    ['N/m', 'N/m'],
    ['N ?[·⋅*]? ?m', 'N m'],
    ['N ?[·⋅*]? ?s', 'N s'],
    ['rad/s\\^2', 'rad/s^2'],
    ['rad/s\\^3', 'rad/s^3'],
    ['rad/s', 'rad/s'],
    ['rad', 'rad'],
    ['rev/min', 'rpm'],
    ['rpm', 'rpm'],
    ['rev/s', 'rev/s'],
    ['revolutions', 'rev'],
    ['megajoules', 'MJ'],
    ['MJ', 'MJ'],
    ['MW', 'MW'],
    ['kW', 'kW'],
    ['J', 'J'],
    ['W', 'W'],
    ['N', 'N'],
    ['ms', 'ms'],
    ['s', 's'],
    ['days?', 'day'],
    ['liters?', 'L'],
    ['mL', 'mL'],
    ['L', 'L'],
    ['hours?', 'h'],
    ['percent', '%'],
    ['bullets/min', 'bullets/min'],
    ['earth-years', 'yr'],
    ['m', 'm'],
    ['g', 'g'],
  ] as const
).map(([re, unit]) => [new RegExp(`^[ -]?(?:${re})(?![\\w^/])`), unit]);

// Not glued to identifiers (P12, h1, M_1), exponents (s^2), unit denominators
// (kg/m3) or function arguments (U(0)); "1/6" still yields both numbers.
const NUMBER_RE = /(?<![\w^_.|\d])(?<![A-Za-z]\/)(?<![A-Za-z]\()([-+]?\d+(?:\.\d+)?)(?:\s*[×x·⋅*]\s*10\^\(?([-+]?\d+)\)?|[eE]([-+]?\d+)(?![\w.]))?/g;

const BY_UNIT: Record<string, string> = {
  kg: 'm',
  g: 'm',
  m: 'd',
  cm: 'd',
  mm: 'd',
  km: 'd',
  s: 't',
  ms: 't',
  day: 't',
  N: 'F',
  J: 'E',
  MJ: 'E',
  W: 'P',
  MW: 'P',
  kW: 'P',
  'm/s': 'v',
  'km/s': 'v',
  'm/s^2': 'a',
  '°': 'theta',
  'N/m': 'k',
  'kg/m^3': 'rho',
  'kg/m^2': 'sigma',
  'rad/s': 'omega',
  'rad/s^2': 'alpha',
  rpm: 'n',
  'rev/s': 'n',
  '%': 'pct',
  'kg/s': 'rate',
  'N m': 'tau',
  'kg m^2': 'I',
  L: 'V',
  'm^3': 'V',
  'cm^3': 'V',
  'm^2': 'A',
  'cm^2': 'A',
  'J/(kg K)': 'c',
  'J/(mol K)': 'C',
  'W/(m K)': 'kc',
  'kJ/kg': 'Lh',
  'J/kg': 'Lh',
  'J/K': 'S',
  'g/mol': 'M',
  'kg/mol': 'M',
  mol: 'n',
  atm: 'p',
  Pa: 'p',
  kPa: 'p',
  MPa: 'p',
  '°C': 'T',
  K: 'T',
  Hz: 'f',
  kHz: 'f',
  dB: 'beta',
  kJ: 'E',
  cal: 'Q',
  kcal: 'Q',
  'kJ/(kg K)': 'c',
  'J/(kg °C)': 'c',
  'W/(m °C)': 'kc',
  'kJ/g': 'Lh',
  'N/m^2': 'p',
  '1/K': 'alpha',
  '1/°C': 'alpha',
  '1/mol': 'NA',
  h: 't',
  mL: 'V',
};

/**
 * Decimal places as written: "2.50" has 2 (String(2.5) would say 1), "300"
 * has 0; undefined for scientific notation, whose precision is in sigfigs.
 */
export function writtenDecimals(text: string): number | undefined {
  const m = /^[-+]?\d+(?:\.(\d+))?$/.exec(text.trim());
  return m ? (m[1]?.length ?? 0) : undefined;
}

function suggest(value: number, written: string): Literal['suggest'] {
  const abs = Math.abs(value);
  if (abs === 0) return { min: 0, max: 1, step: 0.1, decimals: 1 };
  const text = String(abs);
  const decimals = writtenDecimals(written) ?? (text.includes('e') ? undefined : (text.split('.')[1]?.length ?? 0));
  const exp = Math.floor(Math.log10(abs));
  const step = decimals !== undefined ? 10 ** -decimals : 10 ** (exp - 1);
  const lo = value * 0.7;
  const hi = value * 1.3;
  const round = (x: number): number => Number((Math.round(x / step) * step).toPrecision(12));
  const out: Literal['suggest'] = { min: round(Math.min(lo, hi)), max: round(Math.max(lo, hi)), step: Number(step.toPrecision(6)) };
  if (decimals !== undefined && decimals > 0) out.decimals = decimals;
  return out;
}

/**
 * Detect the numeric literals in a problem statement and propose a variable
 * name for each: from a nearby `symbol =`, else from the unit. Numbers glued
 * to identifiers (P12, h1, M_1), exponents (m/s^2) and ordinals (5th) are skipped.
 */
export function detectLiterals(question: string): Literal[] {
  const out: Literal[] = [];
  const used = new Map<string, number>();
  const unique = (base: string): string => {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}${n}`;
  };

  // End of the last literal's unit: numbers inside it ("1" in "1/K") are not literals.
  let consumed = 0;
  for (const m of question.matchAll(NUMBER_RE)) {
    const start = m.index;
    if (start < consumed) continue;
    const end = start + m[0].length;
    const after = question.slice(end);
    if (/^(st|nd|rd|th)\b/.test(after)) continue;
    const exponent = m[2] ?? m[3];
    const value = exponent !== undefined ? Number(`${m[1]}e${exponent}`) : Number(m[1]);
    if (!Number.isFinite(value) || value === 0) continue;

    let unit: string | undefined;
    let unitLength = 0;
    let spaced = false;
    for (const [re, u] of UNITS) {
      const um = re.exec(after);
      if (um) {
        unit = u;
        unitLength = um[0].length;
        spaced = um[0].startsWith(' ');
        break;
      }
    }
    // Vector components: "2î", "24 m/s î", "-2.6 m/s i".
    const component = /^\s*(î|ĵ|k\u0302|[ijk])(?![\w])/u.exec(after.slice(unitLength));
    if (unit === undefined && /^\s?%/.test(after)) unit = '%';
    if (unit === undefined && /^°/.test(after)) unit = '°';
    if (unit === undefined && /^\s?degrees?\b/.test(after)) unit = '°';

    // "symbol = value" (or "symbol=value") shortly before the number.
    const before = question.slice(Math.max(0, start - 16), start);
    const sym = /(\|?[A-Za-zα-ωΑ-Ωµ][\w]*\|?)\s*=\s*\(?\s*$/u.exec(before);
    let name = sym ? symbolToIdentifier(sym[1]!) : null;
    const constant = name === 'g' && Math.abs(value - 9.8) < 0.1;
    if (!name && component) {
      const axis = { î: 'x', i: 'x', ĵ: 'y', j: 'y', k: 'z' }[component[1]![0]!] ?? 'x';
      name = `${(unit && BY_UNIT[unit]) || 'v'}${axis}`;
    }
    if (!name && /^\s*times\b/.test(after)) name = 'ratio';
    if (!name) {
      const context = question.slice(Math.max(0, start - 30), start).toLowerCase();
      if (unit && ['m', 'cm', 'km', 'mm'].includes(unit)) {
        name = /radius/.test(context) ? 'r' : /height|high|tall/.test(context) ? 'h' : /diameter/.test(context) ? 'D' : /long|length/.test(context) ? 'L' : 'd';
      } else name = (unit && BY_UNIT[unit]) || 'x';
    }
    if (isReservedName(name)) name = `${name}_val`;
    const unitEnd = unit !== undefined && (spaced || unitLength > 0) && !after.startsWith('-') ? end + unitLength : undefined;
    consumed = unitEnd ?? end;
    out.push({
      name: constant ? 'g' : unique(name),
      value,
      ...(unit !== undefined && { unit }),
      text: question.slice(start, end),
      start,
      end,
      ...(unitEnd !== undefined && { unitEnd }),
      ...(constant && { constant: true }),
      suggest: suggest(value, question.slice(start, end)),
    });
  }
  return out;
}
