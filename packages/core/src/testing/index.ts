/**
 * @pt/core/testing — the shared conformance suite every ProblemRepository
 * implementation must pass. Uses Vitest; import it only from tests.
 */
import { describe, expect, it } from 'vitest';
import { parseScenario } from '../schema/index.js';
import type { Scenario } from '../schema/scenario.js';
import type { ProblemRepository } from '../repo/types.js';
import type { SeedSet } from '../repo/memory.js';
import { assetRef } from '../repo/query.js';
import { C1, conformanceSeed } from './fixtures.js';

export { C1, conformanceSeed } from './fixtures.js';

export interface ConformanceHarness {
  repo: ProblemRepository;
  /** Called after each test (delete temp dirs, close connections...). */
  cleanup?: () => Promise<void> | void;
}

/** Build a fresh repository containing exactly `seed`. */
export type RepositoryFactory = (seed: SeedSet[]) => Promise<ConformanceHarness>;

async function expectCode(p: Promise<unknown>, name: string, code?: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected ${name}${code ? ` (${code})` : ''}`).toBeInstanceOf(Error);
  expect((err as Error).name).toBe(name);
  if (code) expect((err as { code?: string }).code).toBe(code);
}

function withPart(s: Scenario, prompt: string): Scenario {
  return { ...s, parts: s.parts.map((p, i) => (i === 0 ? { ...p, prompt } : p)) };
}

export function describeRepositoryConformance(name: string, factory: RepositoryFactory): void {
  describe(`ProblemRepository conformance: ${name}`, () => {
    const run = (title: string, fn: (repo: ProblemRepository) => Promise<void>): void => {
      it(title, async () => {
        const h = await factory(conformanceSeed());
        try {
          await fn(h.repo);
        } finally {
          await h.cleanup?.();
        }
      });
    };

    run('lists sets with titles, sections and counts', async (repo) => {
      const sets = await repo.listSets();
      expect(sets).toEqual([
        { id: 'alpha', title: 'Alpha set', sections: ['Work', 'Energy'], scenarioCount: 3 },
        { id: 'beta', title: 'Beta set', sections: ['Torque'], scenarioCount: 2 },
      ]);
    });

    run('gets a set document; unknown set is NotFoundError', async (repo) => {
      const set = await repo.getSet('alpha');
      expect(set).toMatchObject({ id: 'alpha', title: 'Alpha set', sections: ['Work', 'Energy'] });
      await expectCode(repo.getSet('nope'), 'NotFoundError');
    });

    run('round-trips a scenario exactly (parsed form)', async (repo) => {
      expect(await repo.getScenario('c01-push-work')).toEqual(parseScenario(C1));
    });

    run('unknown scenario is NotFoundError', async (repo) => {
      await expectCode(repo.getScenario('missing'), 'NotFoundError');
    });

    run('lists all scenarios in set order, then by id', async (repo) => {
      const rows = await repo.listScenarios();
      expect(rows.map((r) => r.id)).toEqual(['c01-push-work', 'a-energy-2', 'a-energy-1', 'b-torque-1', 'b-torque-2']);
    });

    run('summaries carry listing data and nothing storage-specific', async (repo) => {
      const [row] = await repo.listScenarios({ text: 'c01-push-work' });
      expect(row).toEqual({
        id: 'c01-push-work',
        setId: 'alpha',
        title: 'Work pushing a mass on a frictionless surface',
        section: 'Work',
        tags: ['work', 'baseline'],
        difficulties: [1],
        partCount: 1,
        hasFigure: false,
        sourceLabels: ['P1'],
        draft: false,
      });
      const fig = (await repo.listScenarios({ text: 'a-energy-2' }))[0]!;
      expect(fig.hasFigure).toBe(true);
      expect(JSON.stringify(fig)).not.toMatch(/figures\/|\.ya?ml|\\/);
    });

    run('filters by set and section', async (repo) => {
      expect((await repo.listScenarios({ setId: 'beta' })).map((r) => r.id)).toEqual(['b-torque-1', 'b-torque-2']);
      expect((await repo.listScenarios({ section: 'Energy' })).map((r) => r.id)).toEqual(['a-energy-2', 'a-energy-1']);
      expect(await repo.listScenarios({ setId: 'alpha', section: 'Torque' })).toEqual([]);
    });

    run('filters by tags (any / all), including part tags', async (repo) => {
      const any = await repo.listScenarios({ tags: ['spring', 'baseline'] });
      expect(any.map((r) => r.id).sort()).toEqual(['a-energy-1', 'b-torque-1', 'c01-push-work']);
      const all = await repo.listScenarios({ tags: ['energy', 'spring'], tagMode: 'all' });
      expect(all.map((r) => r.id)).toEqual(['a-energy-1']);
      const partTag = await repo.listScenarios({ tags: ['hard'] });
      expect(partTag.map((r) => r.id)).toEqual(['a-energy-1']);
    });

    run('filters by part difficulty range', async (repo) => {
      expect((await repo.listScenarios({ difficulty: { min: 2 } })).map((r) => r.id)).toEqual(['a-energy-1']);
      expect((await repo.listScenarios({ difficulty: { max: 1 } })).map((r) => r.id)).toEqual(['c01-push-work']);
      expect((await repo.listScenarios({ difficulty: { min: 4 } })).map((r) => r.id)).toEqual([]);
    });

    run('filters by case-insensitive text over title, narrative, prompts and tags', async (repo) => {
      expect((await repo.listScenarios({ text: 'FRICTIONLESS' })).map((r) => r.id)).toEqual(['c01-push-work']);
      expect((await repo.listScenarios({ text: 'wrench' })).map((r) => r.id)).toEqual(['b-torque-1']);
      expect((await repo.listScenarios({ text: 'weight?' })).map((r) => r.id)).toHaveLength(4);
    });

    run('paginates with limit + cursor without gaps or duplicates', async (repo) => {
      const all = (await repo.listScenarios()).map((r) => r.id);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await repo.listScenarios({ limit: 2, ...(cursor !== undefined && { cursor }) });
        if (rows.length === 0) break;
        expect(rows.length).toBeLessThanOrEqual(2);
        seen.push(...rows.map((r) => r.id));
        cursor = rows.at(-1)!.id;
      }
      expect(seen).toEqual(all);
    });

    run('creates a scenario in a named set', async (repo) => {
      const s = parseScenario({ ...C1, id: 'new-one', title: 'New one', section: 'Torque' });
      await repo.putScenario(s, { setId: 'beta' });
      expect(await repo.getScenario('new-one')).toEqual(s);
      const rows = await repo.listScenarios({ setId: 'beta' });
      expect(rows.map((r) => r.id)).toContain('new-one');
      expect((await repo.listSets()).find((x) => x.id === 'beta')?.scenarioCount).toBe(3);
    });

    run('appends a new scenario to the set order', async (repo) => {
      await repo.putScenario(parseScenario({ ...C1, id: 'zzz-appended' }), { setId: 'alpha' });
      const set = await repo.getSet('alpha');
      expect(set.order?.at(-1)).toBe('zzz-appended');
    });

    run('requires a set for a new scenario when several exist', async (repo) => {
      await expectCode(repo.putScenario(parseScenario({ ...C1, id: 'orphan' })), 'ValidationError', 'set-required');
      await expectCode(repo.putScenario(parseScenario({ ...C1, id: 'orphan' }), { setId: 'nope' }), 'NotFoundError');
    });

    run('updates a scenario in place', async (repo) => {
      const s = withPart(await repo.getScenario('c01-push-work'), 'Changed prompt {_0}{_u}');
      await repo.putScenario(s);
      expect((await repo.getScenario('c01-push-work')).parts[0]!.prompt).toBe('Changed prompt {_0}{_u}');
      expect((await repo.listScenarios({ setId: 'alpha' })).map((r) => r.id)[0]).toBe('c01-push-work');
    });

    run('rejects an invalid scenario with ValidationError and changes nothing', async (repo) => {
      const bad = { ...(await repo.getScenario('c01-push-work')), parts: [] } as unknown as Scenario;
      await expectCode(repo.putScenario(bad), 'ValidationError');
      expect((await repo.getScenario('c01-push-work')).parts).toHaveLength(1);
    });

    run('refuses to move a scenario between sets', async (repo) => {
      const s = await repo.getScenario('b-torque-1');
      await expectCode(repo.putScenario(s, { setId: 'alpha' }), 'ConflictError');
    });

    run('deletes a scenario; deleting again is NotFoundError', async (repo) => {
      await repo.deleteScenario('a-energy-1');
      await expectCode(repo.getScenario('a-energy-1'), 'NotFoundError');
      expect((await repo.listScenarios()).map((r) => r.id)).not.toContain('a-energy-1');
      expect((await repo.getSet('alpha')).order).not.toContain('a-energy-1');
      await expectCode(repo.deleteScenario('a-energy-1'), 'NotFoundError');
    });

    run('returns copies: mutating a result does not change the store', async (repo) => {
      const s = await repo.getScenario('c01-push-work');
      s.parts[0]!.answer = 'tampered';
      (await repo.getSet('alpha')).sections.push('tampered');
      expect((await repo.getScenario('c01-push-work')).parts[0]!.answer).toBe('F * d');
      expect((await repo.getSet('alpha')).sections).toEqual(['Work', 'Energy']);
    });

    run('creates and updates sets', async (repo) => {
      await repo.putSet({ id: 'gamma', title: 'Gamma', sections: ['Rotation'] });
      expect((await repo.listSets()).map((s) => s.id)).toEqual(['alpha', 'beta', 'gamma']);
      await repo.putSet({ ...(await repo.getSet('beta')), title: 'Beta renamed' });
      expect((await repo.getSet('beta')).title).toBe('Beta renamed');
      expect((await repo.listScenarios({ setId: 'beta' })).length).toBe(2);
    });

    run('resolves assets by reference; missing or escaping refs fail', async (repo) => {
      const png = await repo.resolveAsset(assetRef('alpha', 'figures/block.png'));
      expect(png.mediaType).toBe('image/png');
      expect(png.size).toBe(12);
      expect(Array.from(await png.read()).slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
      const svg = await repo.resolveAsset(assetRef('alpha', 'figures/diagram.svg'));
      expect(svg.mediaType).toBe('image/svg+xml');
      expect(new TextDecoder().decode(await svg.read())).toContain('<svg');
      await expectCode(repo.resolveAsset(assetRef('alpha', 'figures/none.png')), 'NotFoundError');
      await expectCode(repo.resolveAsset(assetRef('beta', 'figures/block.png')), 'NotFoundError');
      await expectCode(repo.resolveAsset('alpha/../beta/set.yaml'), 'ValidationError');
      // Only figure media are assets: the set's own files are never served.
      await expectCode(repo.resolveAsset(assetRef('alpha', 'set.yaml')), 'NotFoundError');
      await expectCode(repo.resolveAsset(assetRef('alpha', 'scenarios/c01-push-work.yaml')), 'NotFoundError');
    });
  });
}
