// Test-only fixtures: the reference corpus as a quiz catalog, and synthetic catalogs.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario, type Scenario } from '@pt/core';
import { parse } from 'yaml';
import type { CatalogQuestion, CatalogSet } from '../src/index.ts';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/corpus/scenarios');

export const corpus: Scenario[] = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .map((f) => parseScenario(parse(readFileSync(join(CORPUS, f), 'utf8'))));

export const corpusById = new Map(corpus.map((s) => [s.id, s]));

/** One question per canonical source label, as `pt bundle` would list them. */
export function corpusCatalog(setId = 'corpus'): CatalogSet {
  const questions: CatalogQuestion[] = [];
  for (const s of corpus) {
    for (const cp of s.canonical.parts) {
      if (!cp.source) continue;
      questions.push({
        key: `${setId}/${cp.source}`,
        setId,
        label: cp.source,
        number: Number(cp.source.slice(1)),
        ...(s.section !== undefined && { section: s.section }),
        kind: 'authored',
        scenarioId: s.id,
        partId: cp.id,
        family: `${setId}/${s.source?.labels[0] ?? cp.source}`,
      });
    }
  }
  return { setId, questions: questions.sort((a, b) => a.number - b.number) };
}

/** A synthetic set: `sections` × `perSection` questions, every question its own family unless `family` says otherwise. */
export function syntheticSet(
  setId: string,
  sections: string[],
  perSection: number,
  opts: { fixedEvery?: number; family?: (n: number) => string; difficulty?: (n: number) => CatalogQuestion['difficulty'] } = {},
): CatalogSet {
  const questions: CatalogQuestion[] = [];
  let n = 0;
  for (const section of sections) {
    for (let i = 0; i < perSection; i++) {
      n++;
      questions.push({
        key: `${setId}/P${n}`,
        setId,
        label: `P${n}`,
        number: n,
        section,
        kind: opts.fixedEvery && n % opts.fixedEvery === 0 ? 'fixed' : 'authored',
        scenarioId: `${setId}-s${n}`,
        partId: 'answer',
        family: `${setId}/${opts.family ? opts.family(n) : `P${n}`}`,
      });
      const difficulty = opts.difficulty?.(n);
      if (difficulty !== undefined) questions.at(-1)!.difficulty = difficulty;
    }
  }
  return { setId, questions };
}
