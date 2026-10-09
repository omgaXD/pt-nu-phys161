import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradePart, instantiate, parseScenario } from '@pt/core';
import { BundleIndexSchema, BundleSetSchema } from '@pt/quiz';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSetCatalog } from '../src/bundle/catalog.ts';
import { importDocument } from '../src/commands/import.ts';
import { createContext, main, memoryOutput } from '../src/index.ts';
import { type Draft, loadDrafts } from '../src/import/draft.ts';
import { fixedScenarioFromDraft, writtenSigfigs } from '../src/import/fixed.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const CONTENT = join(HERE, '../../../content/sets');
const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

async function demoRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pt-catalog-'));
  temps.push(root);
  await importDocument(createContext(root, memoryOutput()), join(FIX, 'source.html'), { set: 'demo' });
  return root;
}

function draftOf(root: string, label: string): Draft {
  const d = loadDrafts(root, 'demo').find((x) => x.draft.label === label);
  if (!d) throw new Error(label);
  return structuredClone(d.draft);
}

function fixed(d: Draft) {
  const r = fixedScenarioFromDraft(d);
  if (!r.ok) throw new Error(r.message);
  return r.scenario;
}

describe('fixed fallback (source values)', () => {
  it('pins every variable to its printed value and grades the printed answer as correct', async () => {
    const root = await demoRoot();
    const s = fixed(draftOf(root, 'P1'));
    expect(s.id).toBe('fixed.demo-p001');
    expect(s.vars).toEqual([
      { name: 'm', kind: 'choice', options: [66.5], decimals: 1, unit: 'kg' },
      { name: 'd', kind: 'choice', options: [2.6], decimals: 1, unit: 'm' },
      { name: 'F', kind: 'choice', options: [73.8], decimals: 1, unit: 'N' },
    ]);
    // Every seed gives the source problem.
    const a = instantiate(s, 0);
    expect(instantiate(s, 12345).narrativeHtml + instantiate(s, 12345).parts[0]!.promptHtml).toBe(a.narrativeHtml + a.parts[0]!.promptHtml);
    expect(a.parts[0]!.promptHtml).toContain('66.5');
    expect(gradePart(s.parts[0]!, a, { combined: '191.88 J' }).fraction).toBe(1);
    expect(gradePart(s.parts[0]!, a, { combined: '190 J' }).fraction).toBe(1); // within 1 %
    expect(gradePart(s.parts[0]!, a, { combined: '180 J' }).fraction).toBe(0);
  });

  it('keeps figures, derived constants, dimensionless answers and the written precision', async () => {
    const root = await demoRoot();
    const ramp = fixed(draftOf(root, 'P3'));
    expect(ramp.figure).toMatchObject({ src: 'figures/ramp.png', alt: 'Figure for P3' });
    const frac = fixed(draftOf(root, 'P6'));
    expect(frac.parts[0]!.unit).toBeUndefined();
    expect(frac.vars.find((v) => v.name === 'E')).toMatchObject({ options: [4.3e-16], sigfigs: 2 });
    expect(writtenSigfigs('1.60×10^8')).toBe(3);
    expect(writtenSigfigs('8.5E+37')).toBe(2);
    expect(writtenSigfigs('1.2 · 10^-5')).toBe(2);
    expect(writtenSigfigs('12')).toBeUndefined();

    const d = draftOf(root, 'P1');
    d.literals[1]!.text = '2.60';
    expect(fixed(d).vars[1]).toMatchObject({ decimals: 2 });
  });

  it('marks counts as integers and "express in …" answers as exact-unit', async () => {
    const root = await demoRoot();
    const count = draftOf(root, 'P6');
    count.answer = { value: 24, raw: '24' };
    (count.scenario.parts as { prompt: string }[])[0]!.prompt = 'How many cars are in the final collection? {_0}';
    (count.scenario.canonical as { parts: { answer: number }[] }).parts[0]!.answer = 24;
    expect(fixed(count).parts[0]).toMatchObject({ integer: true, tolerance: {} });

    const exact = draftOf(root, 'P1');
    (exact.scenario.parts as { prompt: string }[])[0]!.prompt = 'Give the answer in kJ. {_0}{_u}';
    expect(fixed(exact).parts[0]!.exactUnit).toBe(true);
    expect(fixed(draftOf(root, 'P1')).parts[0]!.exactUnit).toBeUndefined();
  });

  it('explains why a draft cannot be played', async () => {
    const root = await demoRoot();
    const noAnswer = draftOf(root, 'P1');
    delete noAnswer.answer;
    expect(fixedScenarioFromDraft(noAnswer)).toMatchObject({ ok: false, reason: 'no-answer' });
    const inline = draftOf(root, 'P1');
    inline.figures.push({ src: 'figures/x.png', original: 'x', role: 'inline' });
    expect(fixedScenarioFromDraft(inline)).toMatchObject({ ok: false, reason: 'inline-image' });
    const badUnit = draftOf(root, 'P1');
    badUnit.answer = { value: 191.88, unit: 'J/s/m', raw: '191.88 J/s/m' };
    expect(fixedScenarioFromDraft(badUnit)).toMatchObject({ ok: false, reason: 'unit-unparseable' });
  });

  it.runIf(existsSync(join(CONTENT, 'phys161-exam1')))('plays every imported PHYS161 problem except the known inline-picture one', () => {
    const failures: string[] = [];
    let ok = 0;
    for (const set of ['phys161-exam1', 'phys161-exam2', 'phys161-exam3', 'phys161-exam4']) {
      for (const { draft } of loadDrafts(CONTENT, set)) {
        const r = fixedScenarioFromDraft(draft);
        if (r.ok) ok++;
        else failures.push(`${set}/${draft.label}:${r.reason}`);
      }
    }
    expect(failures).toEqual(['phys161-exam3/P72:inline-image']);
    expect(ok).toBe(548);
  });
});

const authored = (id: string, labels: string[], extraPart = false): string =>
  [
    `id: ${id}`,
    `source: { document: source, labels: [ ${labels.join(', ')} ] }`,
    'section: Work',
    'narrative: A suitcase slides {d:unit}.',
    'vars:',
    '  - { name: d, kind: range, min: 2, max: 4, step: 0.1, decimals: 1, unit: m }',
    'parts:',
    '  - id: friction',
    '    prompt: "Work done by friction? {_0}{_u}"',
    '    answer: -240.5 * d / 3.1',
    '    unit: J',
    '    tolerance: { rel: 0.01 }',
    ...(extraPart ? ['  - id: extra', '    prompt: "Something else? {_0}{_u}"', '    answer: d', '    unit: m', '    tolerance: { rel: 0.01 }'] : []),
    'canonical:',
    '  vars: { d: 3.1 }',
    '  parts:',
    ...labels.map((l) => `    - { id: friction, answer: -240.5, unit: J, source: ${l} }`),
    '',
  ].join('\n');

function writeScenario(root: string, id: string, text: string): void {
  mkdirSync(join(root, 'demo', 'scenarios'), { recursive: true });
  writeFileSync(join(root, 'demo', 'scenarios', `${id}.yaml`), text);
}

describe('set catalog / pt coverage', () => {
  it('offers every drafted problem as fixed until a scenario covers it', async () => {
    const root = await demoRoot();
    const ctx = createContext(root, memoryOutput());
    let c = await buildSetCatalog(ctx.repo, root, 'demo');
    expect(c.questions.map((q) => `${q.label}:${q.kind}`)).toEqual(['P1:fixed', 'P2:fixed', 'P3:fixed', 'P4:fixed', 'P5:fixed', 'P6:fixed', 'P7:fixed']);
    expect(c.questions[0]).toMatchObject({ key: 'demo/P1', setId: 'demo', number: 1, section: 'Work', scenarioId: 'fixed.demo-p001', partId: 'answer' });
    // P3 and P4 share the ramp figure: one family.
    const fam = Object.fromEntries(c.questions.map((q) => [q.label, q.family]));
    expect(fam.P3).toBe(fam.P4);
    expect(fam.P1).not.toBe(fam.P3);

    writeScenario(root, 'ramp-friction', authored('ramp-friction', ['P3']));
    c = await buildSetCatalog(createContext(root, memoryOutput()).repo, root, 'demo');
    expect(c.questions.find((q) => q.label === 'P3')).toMatchObject({ kind: 'authored', scenarioId: 'ramp-friction', partId: 'friction' });
    expect(c.scenarios.has('ramp-friction')).toBe(true);
    expect(c.scenarios.has('fixed.demo-p003')).toBe(false);
    expect(c.issues).toEqual([]);
  });

  it('reports conflicts, orphan parts, unknown labels and broken files; --strict fails on them', async () => {
    const root = await demoRoot();
    writeScenario(root, 'a', authored('a', ['P3']));
    writeScenario(root, 'b', authored('b', ['P3', 'P99'], true));
    writeScenario(root, 'broken', 'id: broken\nnarrative: [\n');
    const c = await buildSetCatalog(createContext(root, memoryOutput()).repo, root, 'demo');
    expect(c.issues.map((i) => i.code).sort()).toEqual(['invalid-file', 'label-conflict', 'orphan-part', 'unknown-label']);
    expect(c.questions.find((q) => q.label === 'P3')!.scenarioId).toBe('a');

    const o = memoryOutput();
    expect(await main(['--root', root, 'coverage', 'demo'], o)).toBe(0);
    expect(o.text()).toMatch(/demo — .*: 8 problem\(s\), 2 authored, 6 fixed, 0 missing/);
    expect(await main(['--root', root, 'coverage', 'demo', '--strict'], memoryOutput())).toBe(1);
  });

  it('`pt coverage --json` lists every label', async () => {
    const root = await demoRoot();
    writeScenario(root, 'ramp-friction', authored('ramp-friction', ['P3']));
    const o = memoryOutput();
    expect(await main(['--root', root, 'coverage', '--json', '--strict'], o)).toBe(0);
    const r = JSON.parse(o.text()) as { ok: boolean; sets: { labels: Record<string, string>; sections: { section: string; authored: number }[] }[] };
    expect(r.ok).toBe(true);
    expect(r.sets[0]!.labels).toMatchObject({ P1: 'fixed', P3: 'authored ramp-friction#friction' });
    expect(r.sets[0]!.sections.find((s) => s.section === 'Work')!.authored).toBe(1);
  });
});

describe('pt bundle', () => {
  function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  it('writes the index, one file per set and the figures; authored beats fixed', async () => {
    const root = await demoRoot();
    writeScenario(root, 'ramp-friction', authored('ramp-friction', ['P3']));
    const out = join(root, '..', `${root.split('/').pop()}-out`);
    temps.push(out);
    const o = memoryOutput();
    expect(await main(['--root', root, 'bundle', '--out', out, '--strict'], o)).toBe(0);
    expect(o.text()).toMatch(/demo: 7 question\(s\) \(1 randomized, 6 source values\)/);

    const index = BundleIndexSchema.parse(readJson(join(out, 'index.json')));
    expect(index.sets).toEqual([
      expect.objectContaining({ id: 'demo', questions: 7, authored: 1, fixed: 6, missing: 0 }),
    ]);
    expect(index.sets[0]!.sections.map((s) => [s.id, s.questions, s.authored])).toEqual([
      ['work', 4, 1],
      ['kinetic-energy', 3, 0],
    ]);
    const set = BundleSetSchema.parse(readJson(join(out, 'sets', 'demo.json')));
    expect(set.questions.find((q) => q.label === 'P3')).toMatchObject({ kind: 'authored', scenarioId: 'ramp-friction' });
    expect(Object.keys(set.scenarios)).not.toContain('fixed.demo-p003');
    for (const [id, { scenario }] of Object.entries(set.scenarios)) expect(parseScenario(scenario).id).toBe(id);
    // Figures of the scenarios in use are copied.
    expect(readdirSync(join(out, 'assets', 'demo', 'figures'))).toEqual(['ramp.png']);
  });

  it('is byte-stable and versions content', async () => {
    const root = await demoRoot();
    const a = join(root, 'out-a');
    const b = join(root, 'out-b');
    await main(['--root', root, 'bundle', '--out', a], memoryOutput());
    await main(['--root', root, 'bundle', '--out', b], memoryOutput());
    expect(readFileSync(join(a, 'sets', 'demo.json'), 'utf8')).toBe(readFileSync(join(b, 'sets', 'demo.json'), 'utf8'));
    const v1 = BundleIndexSchema.parse(readJson(join(a, 'index.json'))).version;
    writeScenario(root, 'ramp-friction', authored('ramp-friction', ['P3']));
    await main(['--root', root, 'bundle', '--out', a], memoryOutput());
    expect(BundleIndexSchema.parse(readJson(join(a, 'index.json'))).version).not.toBe(v1);
  });

  it('--strict fails on inconsistent content; --no-fixed bundles authored problems only', async () => {
    const root = await demoRoot();
    writeScenario(root, 'a', authored('a', ['P3']));
    writeScenario(root, 'b', authored('b', ['P3']));
    const out = join(root, 'out');
    expect(await main(['--root', root, 'bundle', '--out', out, '--strict'], memoryOutput())).toBe(1);
    expect(await main(['--root', root, 'bundle', '--out', out, '--no-fixed'], memoryOutput())).toBe(0);
    expect(BundleSetSchema.parse(readJson(join(out, 'sets', 'demo.json'))).questions.map((q) => q.label)).toEqual(['P3']);
    expect(await main(['--root', root, 'bundle', 'nope', '--out', out], memoryOutput())).toBe(1);
  });
});
