import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario, parseSetDoc, type SeedSet, toStorable, toStorableSet } from '@pt/core';
import { newDocumentText } from '../src/index.ts';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pt-store-fs-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Materialise seed data as a directory tree (the on-disk format). */
export function writeSeed(root: string, seed: SeedSet[]): void {
  for (const s of seed) {
    const set = parseSetDoc(s.set);
    const dir = join(root, set.id);
    mkdirSync(join(dir, 'scenarios'), { recursive: true });
    writeFileSync(join(dir, 'set.yaml'), newDocumentText(toStorableSet(set)));
    for (const input of s.scenarios ?? []) {
      const sc = parseScenario(input);
      writeFileSync(join(dir, 'scenarios', `${sc.id}.yaml`), newDocumentText(toStorable(sc)));
    }
    for (const [path, data] of Object.entries(s.assets ?? {})) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), data);
    }
  }
}

/** A private copy of the reference corpus. */
export function copyCorpus(): { root: string; cleanup: () => void } {
  const { dir, cleanup } = tempDir();
  cpSync(join(FIXTURES, 'corpus'), join(dir, 'corpus'), { recursive: true });
  return { root: dir, cleanup };
}
