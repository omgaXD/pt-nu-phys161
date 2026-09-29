import { decimalExponent, roundHalfAway, roundToSigfigs, shiftDecimal } from './decimal.js';

export interface NumberFormat {
  decimals?: number | undefined;
  sigfigs?: number | undefined;
}

/**
 * A formatted value. `tex` is always valid inside math; `text` is a plain
 * rendering. When `math` is true the value needs math typesetting
 * (scientific notation, vectors) even in running text.
 */
export interface Formatted {
  text: string;
  tex: string;
  math: boolean;
}

/** Values outside [1e-3, 1e6) are shown in scientific notation by default. */
const SCI_LOW = 1e-3;
const SCI_HIGH = 1e6;
/** Significant digits for values with no declared format (derived, {= expr}). */
const DEFAULT_SIGFIGS = 6;

function sci(mantissa: string, exp: number): Formatted {
  const m = mantissa === '1' ? '' : mantissa;
  return {
    text: m ? `${m}×10^${exp}` : `10^${exp}`,
    tex: m ? `${m}\\times10^{${exp}}` : `10^{${exp}}`,
    math: true,
  };
}

function plain(s: string): Formatted {
  return { text: s, tex: s, math: false };
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function formatNumber(x: number, fmt: NumberFormat = {}): Formatted {
  if (!Number.isFinite(x)) return plain(String(x));
  if (Object.is(x, -0)) x = 0;

  if (fmt.decimals !== undefined) {
    const r = roundHalfAway(x, fmt.decimals);
    // toFixed switches to exponent notation at 1e21; show such values as sci.
    if (Math.abs(r) >= 1e15) return formatNumber(r, {});
    return plain(r.toFixed(fmt.decimals));
  }

  const sigfigs = fmt.sigfigs;
  const r = sigfigs !== undefined ? roundToSigfigs(x, sigfigs) : roundToSigfigs(x, DEFAULT_SIGFIGS);
  if (r === 0) return plain('0');
  const exp = decimalExponent(r);
  const abs = Math.abs(r);
  if (abs >= SCI_HIGH || abs < SCI_LOW) {
    const m = shiftDecimal(r, -exp);
    const mant = sigfigs === undefined ? trimZeros(String(m)) : m.toFixed(Math.max(0, sigfigs - 1));
    return sci(mant, exp);
  }
  if (sigfigs !== undefined) return plain(r.toFixed(Math.max(0, sigfigs - 1 - exp)));
  return plain(String(r));
}

const UNIT_VECTORS = ['\\hat{\\imath}', '\\hat{\\jmath}', '\\hat{k}'];
const UNIT_VECTORS_TEXT = ['î', 'ĵ', 'k\u0302'];

/** Unit-vector notation for 1–3 components: `2 î − 3 ĵ`. */
export function formatVector(v: readonly number[], fmt: NumberFormat = {}): Formatted {
  if (v.length === 0 || v.length > 3) {
    const parts = v.map((x) => formatNumber(x, fmt));
    return {
      text: `(${parts.map((p) => p.text).join(', ')})`,
      tex: `\\left(${parts.map((p) => p.tex).join(',\\ ')}\\right)`,
      math: true,
    };
  }
  let tex = '';
  let text = '';
  v.forEach((x, i) => {
    if (x === 0) return;
    const f = formatNumber(Math.abs(x), fmt);
    const neg = x < 0;
    if (tex === '') {
      tex = `${neg ? '-' : ''}${f.tex}\\,${UNIT_VECTORS[i]}`;
      text = `${neg ? '\u2212' : ''}${f.text} ${UNIT_VECTORS_TEXT[i]}`;
    } else {
      tex += ` ${neg ? '-' : '+'} ${f.tex}\\,${UNIT_VECTORS[i]}`;
      text += ` ${neg ? '\u2212' : '+'} ${f.text} ${UNIT_VECTORS_TEXT[i]}`;
    }
  });
  if (tex === '') return { text: '0', tex: '\\vec{0}', math: true };
  return { text, tex, math: true };
}

export function formatValue(value: number | string | boolean | readonly number[], fmt: NumberFormat = {}): Formatted {
  if (typeof value === 'number') return formatNumber(value, fmt);
  if (Array.isArray(value)) return formatVector(value, fmt);
  if (typeof value === 'boolean') return plain(String(value));
  const s = String(value);
  return { text: s, tex: `\\text{${s.replace(/[\\{}$&#%_^~]/g, '')}}`, math: false };
}
