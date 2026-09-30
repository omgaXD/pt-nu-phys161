import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenario, toStorable } from '@pt/core';
import { C1 } from '@pt/core/testing';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { FsRepository, newDocumentText, updateDocumentText } from '../src/index.ts';
import { copyCorpus, FIXTURES, tempDir, writeSeed } from './helpers.ts';

const corpusIds = readdirSync(join(FIXTURES, 'corpus/scenarios')).map((f) => f.replace(/\.yaml$/, ''));

describe('FsRepository on the reference corpus (M7)', () => {
  it('reads every corpus scenario', async () => {
    const repo = new FsRepository({ root: FIXTURES });
    const rows = await repo.listScenarios({ setId: 'corpus' });
    expect(rows.map((r) => r.id).sort()).toEqual([...corpusIds].sort());
    expect(await repo.diagnostics()).toEqual([]);
  });

  it.each(corpusIds)('%s survives write → read → write byte-stable', async (id) => {
    const { root, cleanup } = copyCorpus();
    try {
      const repo = new FsRepository({ root });
      const file = join(root, 'corpus/scenarios', `${id}.yaml`);
      const original = await repo.getScenario(id);
      await repo.putScenario(original);
      const first = readFileSync(file, 'utf8');
      const reread = await repo.getScenario(id);
      expect(reread).toEqual(original);
      await repo.putScenario(reread);
      expect(readFileSync(file, 'utf8')).toBe(first);
    } finally {
      cleanup();
    }
  });

  it('corpus files are already in canonical form (saving changes nothing)', async () => {
    const { root, cleanup } = copyCorpus();
    try {
      const repo = new FsRepository({ root });
      for (const id of corpusIds) {
        const file = join(root, 'corpus/scenarios', `${id}.yaml`);
        const before = readFileSync(file, 'utf8');
        await repo.putScenario(await repo.getScenario(id));
        expect(readFileSync(file, 'utf8'), id).toBe(before);
      }
    } finally {
      cleanup();
    }
  });
});

describe('comment-preserving writes', () => {
  const source = `# Header comment about the scenario
id: demo
narrative: >-
  A block of mass {m:unit} rests on a table. # not a comment inside folded text
vars:
  # the mass
  - { name: m, kind: range, min: 1, max: 5, step: 1, unit: kg }
parts:
  - id: p # inline comment
    prompt: "Weight? {_0}{_u}"
    answer: m * 9.8
    unit: N
    tolerance: { rel: 0.01 } # 1 %
canonical:
  vars: { m: 2 }
  parts:
    - { id: p, answer: 19.6, unit: N }
`;

  it('keeps comments and formatting when a value changes', () => {
    const s = parseScenario(parseYamlObject(source));
    const changed = { ...s, parts: [{ ...s.parts[0]!, answer: 'm * 9.81' }] };
    const out = updateDocumentText(source, toStorable(changed));
    expect(out).toContain('# Header comment about the scenario');
    expect(out).toContain('# the mass');
    expect(out).toContain('- id: p # inline comment');
    expect(out).toContain('tolerance: { rel: 0.01 } # 1 %');
    expect(out).toContain('answer: m * 9.81');
    expect(out.split('\n').length).toBe(source.split('\n').length);
  });

  it('is a fixed point for unchanged data', () => {
    const s = parseScenario(parseYamlObject(source));
    const once = updateDocumentText(source, toStorable(s));
    expect(updateDocumentText(once, toStorable(s))).toBe(once);
  });

  it('matches sequence items by id, so reordering keeps per-item comments', () => {
    const src = `parts:\n  # first\n  - id: a\n    x: 1\n  # second\n  - id: b\n    x: 2\n`;
    const out = updateDocumentText(src, { parts: [{ id: 'b', x: 2 }, { id: 'a', x: 1 }] });
    expect(out.indexOf('# second')).toBeLessThan(out.indexOf('id: b'));
    expect(out.indexOf('id: b')).toBeLessThan(out.indexOf('id: a'));
  });

  it('keeps records that share an id apart (one canonical row per source problem)', () => {
    const src = `parts:\n  - { id: a, source: P1 }\n  - { id: a, source: P2 }\n`;
    const value = { parts: [{ id: 'a', source: 'P1' }, { id: 'a', source: 'P2' }] };
    expect(updateDocumentText(src, value)).toBe(src);
    const changed = { parts: [{ id: 'a', source: 'P1', x: 1 }, { id: 'a', source: 'P2', x: 2 }] };
    expect(updateDocumentText(src, changed)).toBe(`parts:\n  - { id: a, source: P1, x: 1 }\n  - { id: a, source: P2, x: 2 }\n`);
  });

  it('writes new documents in house style', () => {
    const text = newDocumentText(toStorable(parseScenario(C1)));
    expect(text).toContain('  - { name: m, kind: range, min: 20, max: 90, step: 0.5, decimals: 1, unit: kg }');
    expect(text).toContain('narrative: >-\n');
    expect(text).toContain('    tolerance: { rel: 0.01 }');
    expect(text).toContain('  vars: { m: 66.5, d: 2.6, F: 73.8 }');
  });
});

describe('FsRepository file handling', () => {
  it('reports broken files and keeps listing the rest', async () => {
    const { dir, cleanup } = tempDir();
    try {
      writeSeed(dir, [{ set: { id: 'demo', title: 'Demo' }, scenarios: [C1] }]);
      const sdir = join(dir, 'demo/scenarios');
      writeFileSync(join(sdir, 'broken-yaml.yaml'), 'id: [unclosed\n');
      writeFileSync(join(sdir, 'bad-schema.yaml'), 'id: bad-schema\nnarrative: x\n');
      writeFileSync(join(sdir, 'wrong-name.yaml'), readFileSync(join(sdir, 'c01-push-work.yaml')));
      const repo = new FsRepository({ root: dir });
      expect((await repo.listScenarios()).map((r) => r.id)).toEqual(['c01-push-work']);
      const diags = await repo.diagnostics();
      expect(diags.map((d) => [d.file, d.code])).toEqual([
        ['demo/scenarios/bad-schema.yaml', 'invalid-scenario'],
        ['demo/scenarios/broken-yaml.yaml', 'yaml-syntax'],
        ['demo/scenarios/wrong-name.yaml', 'scenario-id-mismatch'],
      ]);
      await expect(repo.getScenario('bad-schema')).rejects.toMatchObject({ name: 'ValidationError' });
    } finally {
      cleanup();
    }
  });

  it('infers the set id from the directory and rejects mismatches', async () => {
    const { dir, cleanup } = tempDir();
    try {
      writeSeed(dir, [{ set: { id: 'demo', title: 'Demo' } }]);
      writeFileSync(join(dir, 'demo/set.yaml'), 'title: Demo without id\n');
      const repo = new FsRepository({ root: dir });
      expect(await repo.getSet('demo')).toMatchObject({ id: 'demo', title: 'Demo without id' });
      writeFileSync(join(dir, 'demo/set.yaml'), 'id: other\ntitle: Wrong\n');
      await expect(repo.getSet('demo')).rejects.toMatchObject({ code: 'set-id-mismatch' });
    } finally {
      cleanup();
    }
  });

  it('refuses unsafe ids and asset paths', async () => {
    const repo = new FsRepository({ root: FIXTURES });
    await expect(repo.getScenario('../../etc/passwd')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(repo.resolveAsset('corpus/../corpus/set.yaml')).rejects.toMatchObject({ name: 'ValidationError' });
    await expect(repo.resolveAsset('../corpus/set.yaml')).rejects.toMatchObject({ name: 'ValidationError' });
    await expect(repo.resolveAsset('corpus/figures')).rejects.toMatchObject({ name: 'NotFoundError' });
    const svg = await repo.resolveAsset('corpus/figures/placeholder.svg');
    expect(svg.mediaType).toBe('image/svg+xml');
  });

  it('works on an empty or missing root', async () => {
    expect(await new FsRepository({ root: '/nonexistent/pt-root' }).listSets()).toEqual([]);
  });
});

function parseYamlObject(text: string): unknown {
  return parse(text);
}
