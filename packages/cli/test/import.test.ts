import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { groupDrafts } from '../src/commands/group.ts';
import { buildAgentTask } from '../src/commands/agent-task.ts';
import { importDocument } from '../src/commands/import.ts';
import { createContext, main, memoryOutput } from '../src/index.ts';
import { type Draft, escapeTemplate, loadDrafts, splitNarrative, templatize } from '../src/import/draft.ts';
import { htmlToBlocks } from '../src/import/html.ts';
import { detectLiterals, writtenDecimals } from '../src/import/literals.ts';
import { normalizeText, symbolToIdentifier } from '../src/import/normalize.ts';
import { cleanSectionName, splitAnswer, splitProblems } from '../src/import/problems.ts';
import { tryParseUnit } from '@pt/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const FIXTURES_ROOT = join(HERE, '../../../fixtures');
const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'pt-import-'));
  temps.push(d);
  return d;
}

describe('source normalisation', () => {
  it('re-joins exporter-split superscripts and subscripts from CSS classes', () => {
    const blocks = htmlToBlocks(readFileSync(join(FIX, 'source.html'), 'utf8'));
    const text = blocks.map((b) => b.text).join('\n');
    expect(text).toContain('g = 9.8 m/s^2.');
    expect(text).toContain('1.6×10^8 kg');
    expect(text).toContain('μ_k = 0.36');
    expect(text).toContain('M_2 = 3 kg');
    expect(text).not.toContain('window.noise');
    const raw = blocks.map((b) => b.raw).join('\n');
    expect(raw).toContain('m/s<sup>2</sup>');
    expect(raw).toContain('μ<sub>k</sub>');
    expect(blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(['Exam 2', 'Work', 'Kinetic energy']);
    expect(blocks.flatMap((b) => b.images)).toEqual(['source_files/ramp.png', 'source_files/ramp.png']);
  });

  it('normalises Unicode sub/superscripts, degree signs, minus signs and unit vectors', () => {
    expect(normalizeText('4.3×10⁻¹⁶ J')).toBe('4.3×10^-16 J');
    expect(normalizeText('M₁ = 9.5 kg')).toBe('M_1 = 9.5 kg');
    expect(normalizeText('29˚ and 30º')).toBe('29° and 30°');
    expect(normalizeText('\u22122.6 m/s')).toBe('-2.6 m/s');
    expect(normalizeText('(2i\u02c6+ 2j\u02c6) m/s')).toBe('(2î+ 2ĵ) m/s');
    expect(normalizeText('a\u00a0 b\n  c')).toBe('a b\nc');
  });

  it('maps source symbols to identifiers', () => {
    expect(symbolToIdentifier('θ')).toBe('theta');
    expect(symbolToIdentifier('μk')).toBe('mu_k');
    expect(symbolToIdentifier('μ_s')).toBe('mu_s');
    expect(symbolToIdentifier('M_1')).toBe('M1');
    expect(symbolToIdentifier('|F1|')).toBe('F1');
    expect(symbolToIdentifier('h2')).toBe('h2');
    expect(symbolToIdentifier('2x')).toBeNull();
  });
});

describe('problem splitting', () => {
  it('splits on P<n>., tracks sections, joins continuation paragraphs and images', () => {
    const { problems, sections, title } = splitProblems(htmlToBlocks(readFileSync(join(FIX, 'source.html'), 'utf8')));
    expect(title).toBe('Exam 2');
    expect(sections).toEqual(['Work', 'Kinetic energy']);
    expect(problems.map((p) => [p.label, p.section])).toEqual([
      ['P1', 'Work'],
      ['P2', 'Work'],
      ['P3', 'Work'],
      ['P4', 'Work'],
      ['P5', 'Kinetic energy'],
      ['P6', 'Kinetic energy'],
      ['P7', 'Kinetic energy'],
    ]);
    expect(problems[2]!.images).toEqual(['source_files/ramp.png']);
    expect(problems[5]!.answer).toEqual({ value: 0.16, raw: '0.16' }); // answer on its own paragraph
  });

  it('strips the trailing printed answer', () => {
    expect(splitAnswer('Find it. (191.88 J)')).toEqual({ question: 'Find it.', answer: { value: 191.88, unit: 'J', raw: '191.88 J' } });
    expect(splitAnswer('Find it. (1.152E+16 J)').answer).toMatchObject({ value: 1.152e16, unit: 'J' });
    expect(splitAnswer('How many? (24)').answer).toEqual({ value: 24, raw: '24' });
    expect(splitAnswer('Angular momentum? (0.08165 kg m^2/s)').answer).toMatchObject({ unit: 'kg m^2/s' });
    expect(splitAnswer('Impulse? (1.5868 N·s)').answer).toMatchObject({ unit: 'N s' });
    expect(splitAnswer('No answer here.')).toEqual({ question: 'No answer here.' });
  });

  it('reads the printed-answer spellings of Exams 1 and 4', () => {
    const a = (s: string) => splitAnswer(s).answer;
    expect(a('Find D. (6.8926 m).')).toEqual({ value: 6.8926, unit: 'm', raw: '6.8926 m' });
    expect(a('What angle? (45)]')).toEqual({ value: 45, raw: '45' });
    expect(a('Specific heat? (862.89099526066 J/(kg K))')).toMatchObject({ value: 862.89099526066, unit: 'J/(kg K)' });
    expect(a('Specific heat? (327.54 J/ (kg K))')).toMatchObject({ unit: 'J/(kg K)' });
    expect(a('Conductivity? (0.0406 W/(m K))')).toMatchObject({ unit: 'W/(m K)' });
    expect(a('Mass? (0,00133459 kg)')).toMatchObject({ value: 0.00133459, unit: 'kg', raw: '0,00133459 kg' });
    expect(a('Work? (3 446 932.845 J)')).toMatchObject({ value: 3446932.845, unit: 'J' });
    expect(splitAnswer('Speed? (6.8926 m).').question).toBe('Speed?');
    expect(a('Consider (see the figure)')).toBeUndefined();
    for (const u of ['J/(kg K)', 'W/(m K)', 'J/mol K', '%', 'dB', 's^-1', 'in^3', 'hectares']) expect(tryParseUnit(u), u).not.toBeNull();
  });

  it('accepts P.76. labels and problems styled as headings; cleans section names', () => {
    const html = `
      <p class="title">Exam 4</p>
      <p class="subtitle">Temperature and heat:</p>
      <p>P1. First? (1 J)</p>
      <p class="subtitle">P2. A problem styled as a subtitle? (2 J)</p>
      <p class="subtitle">Newton’s 2nd law:</p>
      <p>P.76. Dotted label? (3 J)</p>
      <p>P 77 . Spaced label? (4 J)</p>`;
    const { problems, sections, title } = splitProblems(htmlToBlocks(html));
    expect(title).toBe('Exam 4');
    expect(sections).toEqual(['Temperature and heat', "Newton's 2nd law"]);
    expect(problems.map((p) => [p.label, p.section, p.answer?.value])).toEqual([
      ['P1', 'Temperature and heat', 1],
      ['P2', 'Temperature and heat', 2],
      ['P76', "Newton's 2nd law", 3],
      ['P77', "Newton's 2nd law", 4],
    ]);
    expect(problems[2]!.raw).toBe('Dotted label? (3 J)');
    expect(cleanSectionName('Friction: ')).toBe('Friction');
  });

  it('keeps a section reference sheet off the first problem, and flags pictures inside text', () => {
    const html = `
      <p class="subtitle">Moment of Inertia</p>
      <p><img src="table.png"></p>
      <p>P94. Find I. (2 kg m^2)</p>
      <p><img src="wheel.png"></p>
      <p>P95. What is the value of the <img src="data:image/png;base64,AAAA"> here? (3 s^-1)</p>`;
    const { problems } = splitProblems(htmlToBlocks(html));
    expect(problems[0]).toMatchObject({ label: 'P94', images: ['wheel.png'], sectionImages: ['table.png'] });
    expect(problems[1]!.inlineImages).toEqual(['data:image/png;base64,AAAA']);
    expect(problems[1]!.text).toContain('value of the [image] here?');
    expect(problems[1]!.answer).toMatchObject({ value: 3, unit: 's^-1' });
  });
});

describe('literal detection', () => {
  const lit = (s: string) => detectLiterals(s).map((l) => [l.name, l.value, l.unit ?? null, l.constant ?? false]);

  it('names literals from `symbol =` or from the unit', () => {
    expect(lit('lifting the mass of 1.5 kg from height 0.3 m up to 1.4 m. The gravitational acceleration is g = 9.8 m/s^2.')).toEqual([
      ['m', 1.5, 'kg', false],
      ['h', 0.3, 'm', false],
      ['h2', 1.4, 'm', false],
      ['g', 9.8, 'm/s^2', true],
    ]);
    expect(lit('a 24-kg suitcase at 29° with μ_k = 0.36 over 3.1 m')).toEqual([
      ['m', 24, 'kg', false],
      ['theta', 29, '°', false],
      ['mu_k', 0.36, null, false],
      ['d', 3.1, 'm', false],
    ]);
  });

  it('reads scientific notation in both spellings', () => {
    expect(lit('a mass of 1.6×10^8 kg at 12 km/s')).toEqual([
      ['m', 1.6e8, 'kg', false],
      ['v', 12, 'km/s', false],
    ]);
    expect(lit('moment of inertia as 8.5E+37 kg*m^2')).toEqual([['I', 8.5e37, 'kg m^2', false]]);
  });

  it('names vector components and skips identifiers, exponents, ordinals and function arguments', () => {
    expect(lit('a velocity of (2î+ 2ĵ) m/s')).toEqual([
      ['vx', 2, null, false],
      ['vy', 2, null, false],
    ]);
    expect(lit('24 m/s î - 3 m/s ĵ')).toEqual([
      ['vx', 24, 'm/s', false],
      ['vy', 3, 'm/s', false],
    ]);
    expect(lit('P12 with h1 and M_1, at 5th car until 1/6. Assume U(0)=0, m/s^2')).toEqual([
      ['x', 1, null, false],
      ['x2', 6, null, false],
    ]);
    expect(lit('The proton is 1836 times heavier')).toEqual([['ratio', 1836, null, false]]);
  });

  it('names thermodynamics literals by unit and keeps "1" in 1/K out of the literals', () => {
    expect(lit('The rail is 1028 m long at 16°C. The coefficient is 11.9×10^-6 1/K.')).toEqual([
      ['d', 1028, 'm', false],
      ['T', 16, '°C', false],
      ['alpha', 11.9e-6, '1/K', false],
    ]);
    expect(lit('c = 862 J/ (kg K), 2.5 atm, 3 mol, 4.2 L, 440 Hz, 60 dB')).toEqual([
      ['c', 862, 'J/(kg K)', false],
      ['p', 2.5, 'atm', false],
      ['n', 3, 'mol', false],
      ['V', 4.2, 'L', false],
      ['f', 440, 'Hz', false],
      ['beta', 60, 'dB', false],
    ]);
    expect(lit('α = 1.2 · 10^-5 1/°C')).toEqual([['alpha', 1.2e-5, '1/°C', false]]);
  });

  it('never proposes a reserved name, and keeps written decimals', () => {
    expect(lit('1 in = 2.54 cm')[1]).toEqual(['in_val', 2.54, 'cm', false]);
    expect(detectLiterals('a 2.50 m rod')[0]!.suggest.decimals).toBe(2);
    expect(writtenDecimals('2.50')).toBe(2);
    expect(writtenDecimals('300')).toBe(0);
    expect(writtenDecimals('1.6×10^8')).toBeUndefined();
    expect(normalizeText('\u2374 = 1000 kg/m^3')).toBe('ρ = 1000 kg/m^3');
  });

  it('turns leftover superscripts into math, merging with a preceding subscript', () => {
    expect(escapeTemplate('U(x) = α x^4 at 10^(-5)')).toBe('U(x) = α x$^{4}$ at 10$^{-5}$');
    expect(escapeTemplate('M_1^2')).toBe('$M_{1}^{2}$');
  });

  it('templatizes: numbers become tokens, spaced units become {name:unit}, subscripts become math', () => {
    const q = 'A 24-kg suitcase, μ_k = 0.36, g = 9.8 m/s^2 and M_1.';
    expect(templatize(q, detectLiterals(q))).toBe('A {m}-kg suitcase, $\\mu_{k}$ = {mu_k}, g = {g:unit} and $M_{1}$.');
  });

  it('splits narrative from the question sentence', () => {
    expect(splitNarrative('A block slides. It has mass 2 kg. Find its speed? The gravitational acceleration is g = 9.8.')).toEqual({
      narrative: 'A block slides. It has mass 2 kg. The gravitational acceleration is g = 9.8.',
      prompt: 'Find its speed?',
    });
    expect(splitNarrative('A blade turns. Through how many revolutions does it turn? Provide the answer in decimals.')).toEqual({
      narrative: 'A blade turns.',
      prompt: 'Through how many revolutions does it turn? Provide the answer in decimals.',
    });
  });
});

describe('pt import (M9)', () => {
  it('writes one draft per problem, a set.yaml and copies figures', async () => {
    const root = tempRoot();
    const out = memoryOutput();
    const r = await importDocument(createContext(root, out), join(FIX, 'source.html'), { set: 'demo', document: 'DEMO' });
    expect(r).toMatchObject({ drafts: 7, written: 7, skipped: 0, withFigure: 2, imagesCopied: 1, missingAnswers: [] });
    expect(readdirSync(join(root, 'demo/drafts')).sort()).toEqual(['P001.yaml', 'P002.yaml', 'P003.yaml', 'P004.yaml', 'P005.yaml', 'P006.yaml', 'P007.yaml']);
    expect(existsSync(join(root, 'demo/figures/ramp.png'))).toBe(true);
    const set = parseYaml(readFileSync(join(root, 'demo/set.yaml'), 'utf8')) as { title: string; sections: string[] };
    expect(set).toMatchObject({ title: 'Exam 2', sections: ['Work', 'Kinetic energy'] });

    const [p3] = loadDrafts(root, 'demo').filter((d) => d.draft.label === 'P3');
    const d = p3!.draft;
    expect(d.figures).toEqual([{ src: 'figures/ramp.png', original: 'source_files/ramp.png' }]);
    expect(d.answer).toEqual({ value: -240.5, unit: 'J', raw: '-240.5 J' });
    expect(d.scenario).toMatchObject({
      id: 'demo-p003',
      source: { document: 'DEMO', labels: ['P3'] },
      section: 'Work',
      figure: { id: 'fig', src: 'figures/ramp.png', alt: 'TODO: describe the figure' },
      canonical: { vars: { m: 24, theta: 29, mu_k: 0.36, d: 3.1 }, parts: [{ id: 'answer', answer: -240.5, unit: 'J', source: 'P3' }] },
    });
    expect((d.scenario.vars as { min: unknown }[])[0]!.min).toBe('TODO');
    expect(d.scenario.narrative).toContain('{@fig}');
    expect(((d.scenario.parts as { prompt: string }[])[0]!).prompt).toMatch(/\{_0\}\{_u\}$/);
  });

  it('keeps existing drafts unless --force', async () => {
    const root = tempRoot();
    const ctx = createContext(root, memoryOutput());
    await importDocument(ctx, join(FIX, 'source.html'), { set: 'demo' });
    expect(await importDocument(ctx, join(FIX, 'source.html'), { set: 'demo' })).toMatchObject({ written: 0, skipped: 7 });
    expect(await importDocument(ctx, join(FIX, 'source.html'), { set: 'demo', force: true })).toMatchObject({ written: 7 });
  });

  it('imports Markdown and .docx sources through the same pipeline', async () => {
    const root = tempRoot();
    const ctx = createContext(root, memoryOutput());
    const md = await importDocument(ctx, join(FIX, 'source.md'), { set: 'md' });
    expect(md).toMatchObject({ drafts: 3, withFigure: 1, sections: ['Work', 'Rotation'] });
    const p2 = loadDrafts(root, 'md')[1]!.draft;
    expect(p2.text).toContain('g = 9.8 m/s^2');
    expect(loadDrafts(root, 'md')[2]!.draft.answer).toEqual({ value: 141.04, raw: '141.04' });

    const docx = await importDocument(ctx, join(FIX, 'source.docx'), { set: 'docx' });
    expect(docx).toMatchObject({ drafts: 2, sections: ['Work'] });
    const drafts = loadDrafts(root, 'docx').map((d) => d.draft);
    expect(drafts[0]!.text).toContain('9.8 m/s^2');
    expect(drafts[1]!.literals.map((l) => l.name)).toEqual(['M1', 'M2']);
  });

  it('is available as `pt import`', async () => {
    const root = tempRoot();
    const o = memoryOutput();
    expect(await main(['--root', root, 'import', join(FIX, 'source.html'), '--set', 'demo'], o)).toBe(0);
    expect(o.text()).toMatch(/7 problem\(s\) → 7 draft\(s\) written/);
    expect(o.text()).toMatch(/2 figure stub\(s\), 1 image\(s\) copied, 2 section\(s\)/);
  });

  // The real sources (extra/fixed/, committed with their images).
  const SOURCES = join(HERE, '../../../extra/fixed');
  const REAL = [
    { file: 'PHYS161_Exam1_new.docx.html', problems: 150, sections: 11, figures: 41, inline: [] as string[] },
    { file: 'PHYS161_Exam2_new.docx.html', problems: 150, sections: 12, figures: 42, inline: [] },
    { file: 'PHYS161 Exam 3.html', problems: 105, sections: 4, figures: 15, inline: ['P51'] },
    { file: 'PHYS161 Exam 4.html', problems: 99, sections: 4, figures: 12, inline: [] },
  ];
  it.runIf(existsSync(SOURCES)).each(REAL)('imports the real source $file', async (x) => {
    const root = tempRoot();
    const r = await importDocument(createContext(root, memoryOutput()), join(SOURCES, x.file), { set: 'real', figures: false });
    expect(r).toMatchObject({ drafts: x.problems, written: x.problems, withFigure: x.figures, missingAnswers: [], inlineImages: x.inline });
    expect(r.sections).toHaveLength(x.sections);
    for (const name of r.sections) expect(name).not.toMatch(/:$|\u2019|^P\.?\s*\d/);
    const drafts = loadDrafts(root, 'real').map((d) => d.draft);
    expect(drafts.map((d) => d.number)).toEqual(Array.from({ length: x.problems }, (_, i) => i + 1));
    for (const d of drafts) {
      if (d.answer?.unit !== undefined) expect(tryParseUnit(d.answer.unit), `${d.label} ${d.answer.unit}`).not.toBeNull();
    }
  });

  const OLD_SOURCE = process.env.PT_SOURCE_HTML;
  it.runIf(OLD_SOURCE !== undefined && existsSync(OLD_SOURCE))('imports a source given by PT_SOURCE_HTML', async () => {
    const r = await importDocument(createContext(tempRoot(), memoryOutput()), OLD_SOURCE!, { set: 'env', figures: false });
    expect(r.missingAnswers).toEqual([]);
  });
});

describe('pt group / agent-task (M9)', () => {
  async function demoDrafts(): Promise<{ root: string; drafts: Draft[] }> {
    const root = tempRoot();
    await importDocument(createContext(root, memoryOutput()), join(FIX, 'source.html'), { set: 'demo' });
    return { root, drafts: loadDrafts(root, 'demo').map((d) => d.draft) };
  }

  it('groups drafts that share a figure or a narrative', async () => {
    const { drafts } = await demoDrafts();
    const groups = groupDrafts('demo', drafts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      labels: ['P3', 'P4'],
      sharedFigure: 'figures/ramp.png',
      proposedId: 'demo-p003-004',
    });
    expect(groups[0]!.reasons).toContain('shared figure figures/ramp.png');
    expect(groups[0]!.asks.map((a) => a.prompt)).toEqual([
      'Find the work done by friction over 3.1 m.',
      'Find the work done by gravity over 4.1 m.',
    ]);
  });

  it('`pt group --json` reports proposals', async () => {
    const { root } = await demoDrafts();
    const o = memoryOutput();
    expect(await main(['--root', root, 'group', 'demo', '--json'], o)).toBe(0);
    expect((JSON.parse(o.text()) as { groups: unknown[] }).groups).toHaveLength(1);
  });

  it('emits an agent packet for a draft: source, literals, answer, siblings, schema', async () => {
    const { root } = await demoDrafts();
    const packet = await buildAgentTask(createContext(root, memoryOutput()), 'P3');
    expect(packet).toMatchObject({
      task: 'author-scenario',
      setId: 'demo',
      source: { label: 'P3', section: 'Work' },
      printedAnswer: { value: -240.5, unit: 'J' },
      siblings: { labels: ['P3', 'P4'] },
    });
    expect(Object.keys((packet.schema as { properties: object }).properties)).toContain('canonical');
    expect(packet.instructions).toEqual(expect.arrayContaining([expect.stringMatching(/canonical/)]));
  });

  it('emits a fix/review packet for an existing scenario', async () => {
    const o = memoryOutput();
    expect(await main(['--root', FIXTURES_ROOT, 'agent-task', 'c08-bucket-box-gravel'], o)).toBe(0);
    const packet = JSON.parse(o.text()) as { task: string; canonical: { ok: boolean }; scenario: { id: string } };
    expect(packet).toMatchObject({ task: 'review-scenario', canonical: { ok: true }, scenario: { id: 'c08-bucket-box-gravel' } });
    expect(await main(['--root', FIXTURES_ROOT, 'agent-task', 'P999'], memoryOutput())).toBe(1);
  });

  it('refuses a label that exists in several sets unless --set picks one', async () => {
    const root = tempRoot();
    const ctx = createContext(root, memoryOutput());
    await importDocument(ctx, join(FIX, 'source.html'), { set: 'a' });
    await importDocument(ctx, join(FIX, 'source.html'), { set: 'b' });
    await expect(buildAgentTask(ctx, 'P3')).rejects.toThrow(/several sets \(a, b\)/);
    expect(await buildAgentTask(ctx, 'P3', { set: 'b' })).toMatchObject({ setId: 'b' });
  });
});
