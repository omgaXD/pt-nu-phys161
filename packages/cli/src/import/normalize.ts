const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
  '⁺': '+',
};

const SUBSCRIPT: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
};

/**
 * Normalise source typography: Unicode super/subscript digits become
 * ^n / _n, ˚ and º become °, the Unicode minus becomes -, `i\u02c6`/`j\u02c6` unit
 * vectors become î/ĵ, and whitespace collapses. Greek letters are kept.
 */
export function normalizeText(s: string): string {
  return s
    .replace(/[\u00a0\u2009\u202f\t]/g, ' ')
    .replace(/[˚º]/g, '°')
    .replace(/\u2374/g, 'ρ') // APL rho, used in some exports for density
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/([ijk])\s*(?:\u02c6|\u0302)/g, (_m, c: string) => ({ i: 'î', j: 'ĵ', k: 'k\u0302' })[c]!)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (run) => `^${[...run].map((c) => SUPERSCRIPT[c]).join('')}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (run) => `_${[...run].map((c) => SUBSCRIPT[c]).join('')}`)
    .replace(/ *\n */g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

const GREEK: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  θ: 'theta',
  λ: 'lambda',
  μ: 'mu',
  µ: 'mu',
  ν: 'nu',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  τ: 'tau',
  φ: 'phi',
  ω: 'omega',
  Δ: 'Delta',
  Ω: 'Omega',
};

/** A symbol as written in the source (θ, μk, M_1, |F1|, h1) → a formula identifier. */
export function symbolToIdentifier(symbol: string): string | null {
  const s = symbol.replace(/[|]/g, '').replace(/_/g, '');
  const m = /^([A-Za-zα-ωΑ-Ωµ])([A-Za-z0-9]*)$/u.exec(s);
  if (!m) return null;
  const head = GREEK[m[1]!] ?? m[1]!;
  const tail = m[2]!;
  if (!tail) return head;
  return GREEK[m[1]!] ? `${head}_${tail}` : `${head}${tail}`;
}
