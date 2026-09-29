import type { Ast } from './ast.js';

const GREEK = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
]);

/** TeX for an identifier: greek names become symbols, `mu_k` → `\mu_{k}`. */
export function identifierToTex(name: string): string {
  if (name === 'pi') return '\\pi';
  const [head, ...rest] = name.split('_');
  const base = GREEK.has(head!) ? `\\${head}` : head!.length === 1 ? head! : `\\mathit{${head}}`;
  if (rest.length === 0) return base;
  const sub = rest.join('_');
  const subTex = GREEK.has(sub) ? `\\${sub}` : sub.length === 1 ? sub : `\\mathrm{${sub.replace(/_/g, '\\_')}}`;
  return `${base}_{${subTex}}`;
}

/** TeX for a number literal; values outside [1e-4, 1e6) become `a\times10^{b}`. */
export function numberToTex(v: number): string {
  const abs = Math.abs(v);
  if (v === 0 || (abs >= 1e-4 && abs < 1e6)) return String(v);
  const [mantissa, exp] = v.toExponential().split('e') as [string, string];
  const e = Number(exp);
  return mantissa === '1' ? `10^{${e}}` : mantissa === '-1' ? `-10^{${e}}` : `${mantissa}\\times10^{${e}}`;
}

const FN_TEX: Record<string, string> = {
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  asin: '\\arcsin',
  acos: '\\arccos',
  atan: '\\arctan',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  exp: '\\exp',
  ln: '\\ln',
  log: '\\log',
  log10: '\\log_{10}',
  min: '\\min',
  max: '\\max',
};

const CMP_TEX: Record<string, string> = {
  '<': '<',
  '>': '>',
  '<=': '\\le',
  '>=': '\\ge',
  '==': '=',
  '!=': '\\ne',
};

function stripParen(n: Ast): Ast {
  return n.t === 'paren' ? n.a : n;
}

/** Render an expression AST as TeX (for live previews of typed answers). */
export function toTex(n: Ast): string {
  switch (n.t) {
    case 'num':
      return numberToTex(n.v);
    case 'str':
      return `\\text{"${n.v.replace(/[\\{}$&#%_^~]/g, '')}"}`;
    case 'bool':
      return `\\mathrm{${n.v}}`;
    case 'sym':
      return identifierToTex(n.name);
    case 'paren':
      return `\\left(${toTex(n.a)}\\right)`;
    case 'unary':
      return n.op === 'not' ? `\\lnot ${toTex(n.a)}` : `${n.op}${toTex(n.a)}`;
    case 'factorial':
      return `${toTex(n.a)}!`;
    case 'bin': {
      const a = toTex(n.a);
      const b = toTex(n.b);
      switch (n.op) {
        case '+':
          return `${a} + ${b}`;
        case '-':
          return `${a} - ${b}`;
        case '*':
          return n.implicit ? `${a}\\,${b}` : `${a} \\cdot ${b}`;
        case '/':
          return `\\frac{${toTex(stripParen(n.a))}}{${toTex(stripParen(n.b))}}`;
        case '^': {
          const base = n.a.t === 'bin' || n.a.t === 'unary' ? `\\left(${a}\\right)` : a;
          return `{${base}}^{${toTex(stripParen(n.b))}}`;
        }
        case 'mod':
          return `${a} \\bmod ${b}`;
        case 'and':
          return `${a} \\land ${b}`;
        case 'or':
          return `${a} \\lor ${b}`;
        case 'xor':
          return `${a} \\oplus ${b}`;
        default:
          return `${a} ${CMP_TEX[n.op]} ${b}`;
      }
    }
    case 'chain':
      return n.args.map((a, i) => (i === 0 ? toTex(a) : ` ${CMP_TEX[n.ops[i - 1]!]} ${toTex(a)}`)).join('');
    case 'cond':
      return `\\left(${toTex(n.c)} \\;?\\; ${toTex(n.a)} : ${toTex(n.b)}\\right)`;
    case 'array':
      return `\\left[${n.items.map(toTex).join(', ')}\\right]`;
    case 'index':
      return `${toTex(n.obj)}\\left[${toTex(n.idx)}\\right]`;
    case 'lambda':
      return `\\left(${n.params.map(identifierToTex).join(', ')} \\mapsto ${toTex(n.body)}\\right)`;
    case 'call': {
      const args = n.args.map((a) => toTex(stripParen(a)));
      if (n.name === 'sqrt' && args.length === 1) return `\\sqrt{${args[0]}}`;
      if (n.name === 'abs' && args.length === 1) return `\\left|${args[0]}\\right|`;
      if (n.name === 'log' && args.length === 2) return `\\log_{${args[1]}}\\left(${args[0]}\\right)`;
      const head = FN_TEX[n.name] ?? `\\operatorname{${n.name}}`;
      return `${head}\\left(${args.join(', ')}\\right)`;
    }
  }
}
