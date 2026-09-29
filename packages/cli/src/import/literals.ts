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
    ['bullets/min', 'bullets/min'],
    ['earth-years', 'yr'],
    ['m', 'm'],
    ['g', 'g'],
  ] as const
).map(([re, unit]) => [new RegExp(`^[ -]?(?:${re})(?![\\w^/])`), unit]);

// Not glued to identifiers (P12, h1, M_1), exponents (s^2), unit denominators
// (kg/m3) or function arguments (U(0)); "1/6" still yields both numbers.
const NUMBER_RE = /(?<![\w^_.|\d])(?<![A-Za-z]\/)(?<![A-Za-z]\()([-+]?\d+(?:\.\d+)?)(?:\s*[×x]\s*10\^\(?([-+]?\d+)\)?|[eE]([-+]?\d+)(?![\w.]))?/g;

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
};

function suggest(value: number): Literal['suggest'] {
  const abs = Math.abs(value);
  if (abs === 0) return { min: 0, max: 1, step: 0.1, decimals: 1 };
  const text = String(abs);
  const decimals = text.includes('e') ? undefined : (text.split('.')[1]?.length ?? 0);
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

  for (const m of question.matchAll(NUMBER_RE)) {
    const start = m.index;
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
    if (name === 'pi' || name === 'e') name = `${name}_val`;
    out.push({
      name: constant ? 'g' : unique(name),
      value,
      ...(unit !== undefined && { unit }),
      text: question.slice(start, end),
      start,
      end,
      ...(unit !== undefined && (spaced || unitLength > 0) && !after.startsWith('-') && { unitEnd: end + unitLength }),
      ...(constant && { constant: true }),
      suggest: suggest(value),
    });
  }
  return out;
}
