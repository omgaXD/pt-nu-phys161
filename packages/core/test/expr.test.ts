import { describe, expect, it } from 'vitest';
import {
  type AnswerType,
  BudgetExceededError,
  createEvaluator,
  DomainError,
  ExprError,
  FUNCTION_NAMES,
  IMPLEMENTED_FUNCTIONS,
  ParseError,
  UnknownIdentifierError,
  validateAnswer,
} from '../src/index.ts';

const ev = createEvaluator();
const val = (src: string, scope = {}): unknown => ev.evaluate(src, scope);

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected an error');
}

// ---- §3.2 acceptance table -----------------------------------------------------

type Row = [src: string, expected: 'ok' | string];

const TABLE: Record<AnswerType, Row[]> = {
  number: [
    ['42', 'ok'],
    ['-3.5', 'ok'],
    ['+2', 'ok'],
    ['1.152e16', 'ok'],
    ['1.152E+16', 'ok'],
    ['2.34205e-19', 'ok'],
    ['pi', 'ok'],
    ['-e', 'ok'],
    ['1+2', 'operator-not-allowed'],
    ['2*pi', 'operator-not-allowed'],
    ['2 pi', 'operator-not-allowed'],
    ['(5)', 'operator-not-allowed'],
    ['--5', 'operator-not-allowed'],
    ['10^3', 'operator-not-allowed'],
    ['sqrt(2)', 'function-not-allowed'],
    ['x', 'identifier-not-allowed'],
    ['', 'empty'],
    ['1..2', 'syntax'],
  ],
  numeric: [
    ['0.01*1.70 + 0.01*5.60', 'ok'], // the plan's example
    ['2^3', 'ok'],
    ['2**3', 'ok'],
    ['-(3+4)/2', 'ok'],
    ['3.2e5*2', 'ok'],
    ['2 pi', 'ok'],
    ['pi/2', 'ok'],
    ['1.6×10^8', 'ok'],
    ['sqrt(0.017^2+0.056^2)', 'function-not-allowed'], // the plan's example
    ['sin(1)', 'function-not-allowed'],
    ['x + 1', 'identifier-not-allowed'],
    ['2 m', 'identifier-not-allowed'],
    ['3!', 'operator-not-allowed'],
    ['1 < 2', 'operator-not-allowed'],
    ['5 mod 2', 'operator-not-allowed'],
    ['[1, 2]', 'syntax-not-allowed'],
    ['a = 3', 'syntax-not-allowed'],
    ['f(x) = x', 'syntax-not-allowed'],
    ['1; 2', 'syntax-not-allowed'],
    ['"text"', 'syntax-not-allowed'],
    ['1/0', 'domain'],
  ],
  numericalFormula: [
    ['sqrt(0.017^2+0.056^2)', 'ok'],
    ['2*sin(pi/6)', 'ok'],
    ['log(100, 10)', 'ok'],
    ['hypot(3, 4)', 'ok'],
    ['max(1, 2, 3)', 'ok'],
    ['sum([1, 2, 3])', 'ok'],
    ['deg(pi)', 'ok'],
    ['x^2', 'identifier-not-allowed'],
    ['solve(f(x) = x, 0, 1)', 'syntax-not-allowed'],
    ['norm([3, 4])', 'function-not-allowed'],
    ['import("fs")', 'function-not-allowed'],
    ['evaluate("1+1")', 'function-not-allowed'],
    ['createUnit("foo")', 'function-not-allowed'],
    ['sqrt(-1)', 'domain'],
    ['log(0)', 'domain'],
    ['[1, 2]', 'not-a-number'],
    ['1 < 2', 'operator-not-allowed'],
  ],
};

describe('validateAnswer — §3.2 acceptance table (M2)', () => {
  for (const [type, rows] of Object.entries(TABLE) as [AnswerType, Row[]][]) {
    describe(type, () => {
      it.each(rows)('%s → %s', (src, expected) => {
        const r = validateAnswer(src, type);
        if (expected === 'ok') {
          expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
        } else {
          expect(r).toMatchObject({ ok: false, error: expected });
        }
      });
    });
  }

  it('is monotone: anything a stricter type accepts, a looser one accepts', () => {
    for (const [src] of [...TABLE.number, ...TABLE.numeric]) {
      if (validateAnswer(src, 'number').ok) expect(validateAnswer(src, 'numeric').ok, src).toBe(true);
      if (validateAnswer(src, 'numeric').ok) expect(validateAnswer(src, 'numericalFormula').ok, src).toBe(true);
    }
  });

  it('returns the value and a TeX preview', () => {
    expect(validateAnswer('1.152e16', 'number')).toEqual({ ok: true, latex: '1.152\\times10^{16}', value: 1.152e16 });
    expect(validateAnswer('0.01*1.70 + 0.01*5.60', 'numeric')).toMatchObject({
      latex: '0.01 \\cdot 1.7 + 0.01 \\cdot 5.6',
    });
    expect(validateAnswer('sqrt(2)/2', 'numericalFormula')).toMatchObject({ latex: '\\frac{\\sqrt{2}}{2}' });
    expect(validateAnswer('2^(1/2)', 'numeric')).toMatchObject({ latex: '{2}^{\\frac{1}{2}}' });
    expect(validateAnswer('-2^2', 'numeric')).toMatchObject({ value: -4 });
  });

  it('enforces the student input budgets', () => {
    expect(validateAnswer('1+'.repeat(150) + '1', 'numeric')).toMatchObject({ ok: false, error: 'too-long' });
    expect(validateAnswer(`${'('.repeat(40)}1${')'.repeat(40)}`, 'numeric')).toMatchObject({ ok: false, error: 'budget' });
  });

  it('accepts typographic input (unicode minus, ×, superscripts)', () => {
    expect(validateAnswer('\u22123.5', 'number')).toMatchObject({ ok: true, value: -3.5 });
    expect(validateAnswer('1.6×10⁸', 'numeric')).toMatchObject({ ok: true, value: 1.6e8 });
    expect(validateAnswer('2.3×10⁻¹⁹', 'numeric')).toMatchObject({ ok: true, value: 2.3e-19 });
  });
});

// ---- Evaluator ------------------------------------------------------------------

describe('restricted evaluator (M2)', () => {
  it('implements exactly the documented function set', () => {
    expect([...IMPLEMENTED_FUNCTIONS].sort()).toEqual([...FUNCTION_NAMES].sort());
  });

  it('does arithmetic with the usual precedence; ^ and ** are both exponentiation', () => {
    expect(val('1 + 2 * 3')).toBe(7);
    expect(val('-2^2')).toBe(-4);
    expect(val('2^3^2')).toBe(512);
    expect(val('2**3')).toBe(8);
    expect(val('2 pi')).toBeCloseTo(2 * Math.PI);
    expect(val('(1 + 2)(3 + 4)')).toBe(21);
    expect(val('7 mod 3')).toBe(1);
    expect(val('e')).toBe(Math.E);
  });

  it('reads variables from scope', () => {
    expect(val('F * d', { F: 73.8, d: 2.6 })).toBeCloseTo(191.88);
    expect(val('dir == "up" ? 1 : -1', { dir: 'up' })).toBe(1);
  });

  it('has the allowed functions and project helpers', () => {
    expect(val('sqrt(16) + abs(-2) + ln(e) + log10(1000) + log(8, 2)')).toBe(4 + 2 + 1 + 3 + 3);
    expect(val('atan2(1, 1)')).toBeCloseTo(Math.PI / 4);
    expect(val('round(2.5) + round(-2.5) + round(1.005, 2)')).toBeCloseTo(3 - 3 + 1.01);
    expect(val('floor(-1.5) + ceil(1.2) + sign(-3)')).toBe(-2 + 2 - 1);
    expect(val('min(3, 1, 2) + max([1, 5]) + sum(1, 2, 3) + hypot(3, 4)')).toBe(1 + 5 + 6 + 5);
    expect(val('factorial(5) + 3!')).toBe(126);
    expect(val('deg(pi) + rad(180)')).toBeCloseTo(180 + Math.PI);
    expect(val('norm([3, 4]) + dot([1, 2], [3, 4])')).toBe(5 + 11);
    expect(val('cross([1, 0, 0], [0, 1, 0])')).toEqual([0, 0, 1]);
    expect(val('clamp(5, 0, 3) + clamp(-1, 0, 3)')).toBe(3);
    expect(val('sinh(0) + cosh(0) + tanh(0) + asin(1) - acos(0) + atan(0)')).toBeCloseTo(1);
  });

  it('supports arrays with 1-based indexing and vector arithmetic', () => {
    expect(val('[10, 20, 30][2]')).toBe(20);
    expect(val('v[3]', { v: [1, 2, 3] })).toBe(3);
    expect(val('2 * [1, 2] + [1, 1] / 1 - [0, 1]')).toEqual([3, 4]);
    expect(thrown(() => val('[1, 2][3]'))).toMatchObject({ name: 'DomainError', code: 'index-out-of-range' });
    expect(thrown(() => val('[1, 2] * [3, 4]'))).toBeInstanceOf(DomainError);
  });

  it('supports comparisons, logic and conditionals for constraints', () => {
    expect(val('1 < 2 and 2 < 3')).toBe(true);
    expect(val('1 < 2 < 3')).toBe(true);
    expect(val('3 > 2 > 1')).toBe(true);
    expect(val('1 == 2 or not (1 == 2)')).toBe(true);
    expect(val('true xor false')).toBe(true);
    expect(val('x >= 0 ? x : -x', { x: -3 })).toBe(3);
    // short-circuit: the right side would throw
    expect(val('false and 1/0 > 1')).toBe(false);
  });

  it('solves inverse problems by bisection (solve) and iterates maps (iterate)', () => {
    expect(val('solve(f(x) = x^2 - 2, 0, 2)')).toBeCloseTo(Math.SQRT2, 14);
    expect(val('solve(f(r) = r^3 - a, 0, 10)', { a: 27 })).toBeCloseTo(3, 12);
    expect(val('iterate(f(x) = x / 2, 64, 3)')).toBe(8);
    expect(val('iterate(f(x) = cos(x), 1, 100)')).toBeCloseTo(0.7390851332, 9);
    expect(thrown(() => val('solve(f(x) = x^2 + 1, 0, 2)'))).toMatchObject({ code: 'solve-no-bracket' });
    expect(thrown(() => val('solve(1, 0, 2)'))).toBeInstanceOf(DomainError);
  });

  it('rejects assignment, definitions and every other mutating or exotic syntax at the AST level', () => {
    for (const src of ['x = 3', 'f(x) = x^2', '1; 2', '1:3', '{a: 1}', 'a.b', 'a[1] = 2', 'sin(f(x) = x)']) {
      const e = thrown(() => ev.compile(src));
      expect(e, src).toBeInstanceOf(ParseError);
    }
  });

  it('does not expose mathjs runtime functions', () => {
    for (const fn of ['import', 'createUnit', 'evaluate', 'parse', 'simplify', 'derivative', 'compile', 'unit']) {
      const e = thrown(() => ev.compile(`${fn}("1")`));
      expect(e, fn).toBeInstanceOf(UnknownIdentifierError);
      expect((e as UnknownIdentifierError).identifiers).toEqual([fn]);
    }
  });

  it('reports unknown identifiers with the full list', () => {
    const e = thrown(() => val('a + b * c', { b: 1 })) as UnknownIdentifierError;
    expect(e).toBeInstanceOf(UnknownIdentifierError);
    expect(e.identifiers).toEqual(['a', 'c']);
    expect(ev.compile('a + solve(f(x) = x - a, 0, 1)').identifiers).toEqual(['a']);
  });

  it('raises typed domain errors instead of NaN/Infinity', () => {
    for (const src of ['sqrt(-1)', '1/0', 'log(-1)', 'asin(2)', '(-8)^(1/3)', 'factorial(-1)', 'factorial(171)', '10^400', '0^-1']) {
      expect(thrown(() => val(src)), src).toBeInstanceOf(DomainError);
    }
    expect(thrown(() => ev.compile('1e400'))).toBeInstanceOf(ParseError);
  });

  it('enforces node, depth, step and wall-clock budgets', () => {
    const tight = createEvaluator({ maxNodes: 20, maxDepth: 5, maxSteps: 1000, timeoutMs: 5 });
    expect(thrown(() => tight.compile(`max(${Array(30).fill(1).join(',')})`))).toMatchObject({ code: 'too-many-nodes' });
    expect(thrown(() => tight.compile('((((((1))))))'))).toMatchObject({ code: 'too-deep' });
    expect(thrown(() => tight.evaluate('iterate(f(x) = x + 1, 0, 5000)'))).toMatchObject({ code: 'too-many-steps' });
    const slow = createEvaluator({ maxSteps: 1e9, timeoutMs: 1 });
    const e = thrown(() => slow.evaluate('iterate(f(x) = sin(x) + cos(x) + sqrt(abs(x)), 0, 100000)'));
    expect(e).toBeInstanceOf(BudgetExceededError);
    expect((e as BudgetExceededError).code).toBe('timeout');
  });

  it('can forbid lambdas entirely', () => {
    const strict = createEvaluator({ allowLambdas: false });
    expect(thrown(() => strict.compile('solve(f(x) = x, 0, 1)'))).toBeInstanceOf(ParseError);
  });

  it('caches compilation by source', () => {
    expect(ev.compile('F * d')).toBe(ev.compile('F * d'));
  });

  it('never leaks raw mathjs errors (fuzzed garbage)', () => {
    const alphabet = '0123456789+-*/^()[]{},.;:=<>!?"\'abcxyz epi_ ';
    let seed = 42;
    const rand = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 3000; i++) {
      const len = 1 + Math.floor(rand() * 16);
      let src = '';
      for (let j = 0; j < len; j++) src += alphabet[Math.floor(rand() * alphabet.length)];
      try {
        ev.evaluate(src, { a: 1, b: 2, c: 3, x: 0.5, y: [1, 2] });
      } catch (e) {
        expect(e, src).toBeInstanceOf(ExprError);
      }
      const r = validateAnswer(src, 'numericalFormula');
      expect(typeof r.ok).toBe('boolean');
    }
  });
});
