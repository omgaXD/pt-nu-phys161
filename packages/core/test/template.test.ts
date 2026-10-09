import { describe, expect, it } from 'vitest';
import {
  createEvaluator,
  formatNumber,
  formatVector,
  instantiateAt,
  InstantiationError,
  parseScenario,
  type RenderContext,
  renderTemplate,
  type Scenario,
  splitRenderedHtml,
  TemplateError,
  tokenizeTemplate,
} from '../src/index.ts';
import { C1 } from '../src/testing/index.ts';
import { corpusScenario } from './corpus.ts';

const ev = createEvaluator();

function ctx(values: RenderContext['values'], meta: RenderContext['meta'] = {}, figureId?: string): RenderContext {
  return { values, meta, evaluator: ev, figureId };
}

/** Evaluate a scenario at its canonical source values (optionally a part's overrides). */
function atCanonical(s: Scenario, partId?: string) {
  const cp = s.canonical.parts.find((p) => p.id === partId);
  const pinned = { ...s.canonical.vars, ...cp?.vars };
  const randoms = Object.fromEntries(Object.entries(pinned).filter(([k]) => s.vars.some((v) => v.name === k)));
  return instantiateAt(s, randoms);
}

const texOf = (html: string): string[] =>
  splitRenderedHtml(html).flatMap((seg) => (seg.type === 'math' ? [seg.tex] : []));
const textOf = (html: string): string =>
  splitRenderedHtml(html)
    .map((seg) => (seg.type === 'html' ? seg.html : seg.type === 'math' ? `$${seg.tex}$` : `[${seg.type}]`))
    .join('');

describe('tokenizer', () => {
  it('recognises every token kind', () => {
    const { tokens } = tokenizeTemplate('A {m} {m:unit} {= m*2} {_0}{_u} {_1} {@fig} $x = {m}$ $$y$$');
    expect(tokens.map((t) => t.kind)).toEqual([
      'text',
      'var',
      'text',
      'var',
      'text',
      'expr',
      'text',
      'slot',
      'unitSlot',
      'text',
      'slot',
      'text',
      'figure',
      'text',
      'math',
      'text',
      'math',
    ]);
  });

  it('leaves TeX groups alone inside math', () => {
    for (const src of ['$\\hat{\\imath}$', '$x^{2}$', '$\\frac{m}{s}$', '$\\mathrm{kg}$', '$a_{k}$', '$\\sqrt{m}$']) {
      const math = tokenizeTemplate(src).tokens[0]!;
      expect(math.kind).toBe('math');
      expect((math as { body: { kind: string }[] }).body.every((b) => b.kind === 'text'), src).toBe(true);
    }
    const mixed = tokenizeTemplate('$\\alpha = {alpha}\\,\\mathrm{J}$').tokens[0] as { body: { kind: string }[] };
    expect(mixed.body.map((b) => b.kind)).toEqual(['text', 'var', 'text']);
  });

  it('treats non-token braces and escaped dollars as text', () => {
    expect(tokenizeTemplate('costs \\$5 {not a token} {1}').tokens).toEqual([
      { kind: 'text', text: 'costs $5 {not a token} {1}', start: 0, end: 27 },
    ]);
  });

  it('reports unclosed math and expressions', () => {
    expect(tokenizeTemplate('a $x').diagnostics.map((d) => d.code)).toEqual(['unclosed-math']);
    expect(tokenizeTemplate('a {= 1 + ').diagnostics.map((d) => d.code)).toEqual(['unclosed-expr']);
  });
});

describe('rendering', () => {
  it('C3: shared narrative, shared figure with a bound overlay, three prompts with slots', () => {
    const s = corpusScenario('c03-luggage-ramp');
    const inst = atCanonical(s); // P14 values
    expect(textOf(inst.narrativeHtml)).toBe(
      'A luggage handler pulls a 18-kg suitcase up a ramp inclined at 31° above the horizontal by a force $F$ of ' +
        'magnitude 170 N that acts parallel to the ramp. The coefficient of kinetic friction between the ramp and ' +
        'the suitcase is $\\mu_k = 0.32$. The suitcase travels 4.1\u00a0m along the ramp. [figure]',
    );
    expect(inst.figure).toMatchObject({ id: 'ramp', src: 'figures/placeholder.svg', overlays: [{ id: 'angle', html: '31°', x: 0.22, y: 0.78 }] });
    expect(inst.figure!.alt).toMatch(/suitcase on a ramp/);
    expect(inst.parts.map((p) => p.partId)).toEqual(['work-by-f', 'work-by-friction', 'work-by-gravity']);
    for (const p of inst.parts) {
      expect(p.slots).toEqual([{ index: 0, kind: 'combined' }]);
      expect(p.unit).toBe('J');
    }
    expect(inst.parts[2]!.modelAnswer).toBeCloseTo(372.49613729795, 8);
    expect(splitRenderedHtml(inst.parts[0]!.promptHtml).at(-1)).toEqual({ type: 'slot', index: 0, kind: 'combined' });
  });

  it('C6: vectors render in unit-vector notation with correct signs', () => {
    const s = corpusScenario('c06-vector-work');
    const inst = atCanonical(s);
    expect(texOf(inst.narrativeHtml)).toEqual(['\\left(2\\,\\hat{\\imath} + 2\\,\\hat{\\jmath}\\right)\\,\\text{m/s}']);
    expect(texOf(inst.parts[0]!.promptHtml)).toEqual(['\\left(8\\,\\hat{\\imath} + 5\\,\\hat{\\jmath}\\right)\\,\\text{m/s}']);
    const neg = instantiateAt(s, { m: 4, v1x: -2, v1y: 0, v2x: 0, v2y: -3 });
    expect(texOf(neg.narrativeHtml)[0]).toContain('-2\\,\\hat{\\imath}\\right)');
    expect(texOf(neg.parts[0]!.promptHtml)[0]).toContain('\\left(-3\\,\\hat{\\jmath}\\right)');
    expect(formatVector([-2.6, 1.1, 0]).tex).toBe('-2.6\\,\\hat{\\imath} + 1.1\\,\\hat{\\jmath}');
    expect(formatVector([5.5, -2.3, 2.9]).text).toBe('5.5 î \u2212 2.3 ĵ + 2.9 k\u0302');
    expect(formatVector([0, 0]).tex).toBe('\\vec{0}');
  });

  it('C7: math markup, a J/m^4 unit and a negative coordinate', () => {
    const s = corpusScenario('c07-quartic-potential');
    const inst = atCanonical(s);
    expect(texOf(inst.narrativeHtml)).toEqual(['U(x) = \\alpha x^4', '\\alpha = 2.7\\ \\text{J}/\\text{m}^{4}']);
    expect(texOf(inst.parts[0]!.promptHtml)).toEqual(['x = -0.2']);
    expect(texOf(inst.parts[1]!.promptHtml)).toEqual(['x = 1.3', 'x = 0.2']);
    expect(inst.parts[0]!.modelAnswer).toBeCloseTo(0.0864, 12);
  });

  it('formats large and small numbers in scientific notation (C4, C5)', () => {
    const meteor = atCanonical(corpusScenario('c04-meteor'));
    expect(texOf(meteor.narrativeHtml)).toEqual(['1.6\\times10^{8}\\ \\text{kg}', '12\\ \\text{km}/\\text{s}']);
    const proton = atCanonical(corpusScenario('c05-proton-momentum'));
    expect(texOf(proton.narrativeHtml)).toEqual(['4.3\\times10^{-16}\\ \\text{J}']);
    expect(textOf(proton.narrativeHtml)).toContain('proton is 1836 times');
    expect(formatNumber(6110000, { sigfigs: 3 }).tex).toBe('6.11\\times10^{6}');
    expect(formatNumber(0.00005).tex).toBe('5\\times10^{-5}');
    expect(formatNumber(1e-5).tex).toBe('10^{-5}');
    expect(formatNumber(4, { decimals: 1 }).text).toBe('4.0');
    expect(formatNumber(1234.5678).text).toBe('1234.57');
    expect(formatNumber(-0.25, { sigfigs: 3 }).text).toBe('-0.250');
  });

  it('interpolates inline expressions (C11 ordinals)', () => {
    const inst = atCanonical(corpusScenario('c11-railroad-cars'));
    expect(textOf(inst.narrativeHtml)).toMatch(/^4 coupled railroad cars .* a 5th car, .* These 5 cars .* a 6th car .* is \$1\/6\$ the speed/);
  });

  it('dimensionless parts render no unit slot (C10)', () => {
    const inst = atCanonical(corpusScenario('c10-bounce-energy-fraction'));
    expect(inst.parts[0]!.slots).toEqual([{ index: 0, kind: 'value' }]);
    expect(inst.parts[0]).not.toHaveProperty('unit');
    const r = renderTemplate('Fraction? {_0} {_u}', ctx({}), { field: 'prompt', hasUnit: false });
    expect(r.slots).toEqual([{ index: 0, kind: 'value' }]);
    expect(r.html).not.toContain('data-kind="unit"');
  });

  it('lays out slots: combined, separate, appended', () => {
    const P = (src: string, hasUnit = true) => renderTemplate(src, ctx({}), { field: 'prompt', hasUnit }).slots;
    expect(P('Work? {_0}{_u}')).toEqual([{ index: 0, kind: 'combined' }]);
    expect(P('Work? {_0} {_u}')).toEqual([
      { index: 0, kind: 'value' },
      { index: 0, kind: 'unit' },
    ]);
    expect(P('Work?')).toEqual([{ index: 0, kind: 'combined' }]);
    expect(P('Work?', false)).toEqual([{ index: 0, kind: 'value' }]);
    expect(P('{_0} is the work.')).toEqual([
      { index: 0, kind: 'value' },
      { index: 0, kind: 'unit' },
    ]);
  });

  it('escapes HTML in authored text and values', () => {
    const r = renderTemplate('<script>alert(1)</script> {s} & "q"', ctx({ s: '<b>' }), { field: 'narrative' });
    expect(r.html).toBe('&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt; &amp; &quot;q&quot;');
    const math = renderTemplate('$a < b$', ctx({}), { field: 'narrative' });
    expect(math.html).toBe('<span class="pt-math" data-display="inline" data-tex="a &lt; b">a &lt; b</span>');
    expect(splitRenderedHtml(math.html)).toEqual([{ type: 'math', tex: 'a < b', display: false }]);
  });

  it('turns blank lines into paragraph breaks', () => {
    expect(renderTemplate('One.\n\nTwo.', ctx({}), { field: 'narrative' }).html).toBe('One.<br><br>Two.');
  });

  it('throws typed errors for bad templates', () => {
    const c = ctx({ a: 1 });
    const err = (src: string, field: 'narrative' | 'prompt' | 'caption' = 'narrative'): unknown => {
      try {
        renderTemplate(src, c, { field });
      } catch (e) {
        return e;
      }
      return undefined;
    };
    expect(err('{b}')).toMatchObject({ name: 'TemplateError', code: 'unknown-identifier', params: { name: 'b', position: 0 } });
    expect(err('{@fig}')).toMatchObject({ code: 'no-figure' });
    expect(err('{_0}')).toMatchObject({ code: 'slot-not-allowed' });
    expect(err('{@fig}', 'caption')).toMatchObject({ code: 'figure-not-allowed' });
    expect(err('{= a / 0}')).toBeInstanceOf(TemplateError);
    expect(err('$x {_0}$', 'prompt')).toMatchObject({ code: 'token-in-math' });
  });

  it('wraps template errors with their location when instantiating', () => {
    const s = parseScenario({ ...C1, parts: [{ ...C1.parts[0]!, prompt: 'Work on {mass}? {_0}' }] });
    let e: unknown;
    try {
      instantiateAt(s, { m: 66.5, d: 2.6, F: 73.8 });
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(InstantiationError);
    expect((e as InstantiationError).params.location).toEqual({ kind: 'template', field: 'prompt', partId: 'work' });
  });

  it('splits rendered HTML into segments for component rendering', () => {
    const r = renderTemplate('A {x:unit} block. {@fig} Speed? {_0}{_u}', ctx({ x: 2 }, { x: { unit: 'kg' } }, 'f'), {
      field: 'prompt',
      hasUnit: true,
    });
    expect(splitRenderedHtml(r.html)).toEqual([
      { type: 'html', html: 'A 2\u00a0kg block. ' },
      { type: 'figure', id: 'f' },
      { type: 'html', html: ' Speed? ' },
      { type: 'slot', index: 0, kind: 'combined' },
    ]);
  });
});
