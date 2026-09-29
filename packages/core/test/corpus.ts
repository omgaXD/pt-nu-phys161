// Test-only helper: the reference corpus (fixtures/corpus) is the integration
// test suite for the core. Loading YAML is I/O, so it lives in tests, not src.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { parseScenario, type Scenario } from '../src/index.ts';

export const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/corpus');

export function loadCorpus(): Scenario[] {
  const dir = join(CORPUS_DIR, 'scenarios');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => parseScenario(parse(readFileSync(join(dir, f), 'utf8'))));
}

const cache = new Map<string, Scenario>();
export function corpusScenario(id: string): Scenario {
  if (cache.size === 0) for (const s of loadCorpus()) cache.set(s.id, s);
  const s = cache.get(id);
  if (!s) throw new Error(`no corpus scenario ${id}`);
  return s;
}
