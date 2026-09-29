import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRepository, parseScenario, safeParseScenario } from '@pt/core';
import { describeRepositoryConformance } from '@pt/core/testing';
import { importDocument, memoryOutput, createContext } from '@pt/cli';
import { afterEach, describe, expect, it } from 'vitest';
import { listDrafts, scenarioFromDraft } from '../src/lib/server/drafts.ts';
import { MultiRepository } from '../src/lib/server/multi.ts';
import { contentRoots, getRepository, resetRepository, workspaceRoot } from '../src/lib/server/repository.ts';
import { scenarioStatus } from '../src/lib/server/status.ts';

// The composite must behave exactly like a single repository.
describeRepositoryConformance('MultiRepository (two in-memory members)', async (seed) => ({
  repo: new MultiRepository([new InMemoryRepository(seed.slice(0, 1)), new InMemoryRepository(seed.slice(1))]),
}));

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  resetRepository();
});

describe('repository selection (PT_STORE / PT_ROOT)', () => {
  it('defaults to content/sets plus the reference corpus', () => {
    delete process.env.PT_ROOT;
    const roots = contentRoots();
    expect(roots).toContain(join(workspaceRoot(), 'fixtures'));
  });

  it('PT_STORE=memory snapshots the content: edits do not touch the files', async () => {
    process.env.PT_ROOT = 'fixtures';
    process.env.PT_STORE = 'memory';
    const repo = await getRepository();
    expect(repo).toBeInstanceOf(InMemoryRepository);
    const s = await repo.getScenario('c01-push-work');
    await repo.putScenario({ ...s, title: 'changed in memory' });
    expect((await repo.getScenario('c01-push-work')).title).toBe('changed in memory');
    const svg = await repo.resolveAsset('corpus/figures/placeholder.svg');
    expect(svg.mediaType).toBe('image/svg+xml');
  });

  it('rejects an unknown PT_STORE', async () => {
    process.env.PT_STORE = 'mongo';
    await expect(getRepository()).rejects.toThrow(/PT_STORE/);
  });
});

describe('canonical status', () => {
  it('is pass / fail / draft', async () => {
    process.env.PT_ROOT = 'fixtures';
    const repo = await getRepository();
    const c1 = await repo.getScenario('c01-push-work');
    expect(scenarioStatus(c1)).toBe('pass');
    expect(scenarioStatus(parseScenario({ ...c1, parts: [{ ...c1.parts[0]!, answer: 'F * d * 2' }] }))).toBe('fail');
    expect(scenarioStatus({ ...c1, draft: true })).toBe('draft');
  });
});

describe('imported drafts', () => {
  it('turns a draft into an editable, schema-valid scenario', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pt-studio-drafts-'));
    try {
      await importDocument(createContext(root, memoryOutput()), join(workspaceRoot(), 'packages/cli/test/fixtures/source.html'), { set: 'demo' });
      process.env.PT_ROOT = root;
      expect(listDrafts('demo').map((d) => d.label)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
      const s = scenarioFromDraft('demo', 'P3')!;
      const parsed = safeParseScenario(s);
      expect(parsed.ok).toBe(true);
      expect(s.vars?.[0]).toMatchObject({ name: 'm', min: 17, max: 31, step: 1 });
      expect(scenarioFromDraft('demo', 'P99')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
