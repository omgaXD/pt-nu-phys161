import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { assetRef, InMemoryRepository, type ProblemRepository, type SeedSet, toStorable, toStorableSet } from '@pt/core';
import { FsRepository } from '@pt/store-fs';
import { MultiRepository } from './multi.js';

/** The monorepo root (the directory holding pnpm-workspace.yaml). */
export function workspaceRoot(from = process.cwd()): string {
  let dir = resolve(from);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) return resolve(from);
    dir = up;
  }
  return dir;
}

/** Content roots: PT_ROOT (path-list) or content/sets + the reference corpus. */
export function contentRoots(env: Record<string, string | undefined> = process.env): string[] {
  const root = workspaceRoot();
  if (env.PT_ROOT) return env.PT_ROOT.split(delimiter).filter(Boolean).map((p) => resolve(root, p));
  return [join(root, 'content/sets'), join(root, 'fixtures')].filter((p) => existsSync(p));
}

/** Copy file-backed content into memory (PT_STORE=memory: edits are not persisted). */
async function memorySnapshot(roots: string[]): Promise<InMemoryRepository> {
  const seed: SeedSet[] = [];
  for (const root of roots) {
    const fs = new FsRepository({ root });
    for (const summary of await fs.listSets()) {
      const set = await fs.getSet(summary.id);
      const scenarios = await Promise.all((await fs.listScenarios({ setId: set.id })).map((r) => fs.getScenario(r.id)));
      const assets: Record<string, Uint8Array> = {};
      for (const s of scenarios) {
        if (s.figure && !assets[s.figure.src]) {
          try {
            assets[s.figure.src] = await (await fs.resolveAsset(assetRef(set.id, s.figure.src))).read();
          } catch {
            // Missing figure files are reported by `pt lint`; the editor still works.
          }
        }
      }
      seed.push({ set: toStorableSet(set), scenarios: scenarios.map(toStorable), assets });
    }
  }
  return new InMemoryRepository(seed);
}

let repo: Promise<ProblemRepository> | undefined;

/**
 * The repository Studio talks to, chosen by PT_STORE=fs|memory (default fs).
 * Nothing else in the app knows which one is in use.
 */
export function getRepository(env: Record<string, string | undefined> = process.env): Promise<ProblemRepository> {
  repo ??= (async () => {
    const roots = contentRoots(env);
    const store = env.PT_STORE ?? 'fs';
    if (store === 'memory') return memorySnapshot(roots);
    if (store !== 'fs') throw new Error(`PT_STORE must be "fs" or "memory", not "${store}"`);
    const members = roots.map((root) => new FsRepository({ root }));
    return members.length === 1 ? members[0]! : new MultiRepository(members);
  })();
  return repo;
}

/** Test hook: forget the cached repository. */
export function resetRepository(): void {
  repo = undefined;
}
