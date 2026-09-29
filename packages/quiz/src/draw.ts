import { type CatalogQuestion, type CatalogSet, sectionSlug } from './bundle.js';
import type { QuizConfig } from './config.js';
import type { Mastery } from './mastery.js';
import { shuffle, streamRng } from './random.js';

/**
 * Every question the configuration allows, in source order (the sets in
 * `catalog` order, then problem number): selected sets and sections, fixed
 * problems only if included, solved problems left out if asked.
 */
export function buildPool(catalog: readonly CatalogSet[], config: Pick<QuizConfig, 'sets' | 'sections' | 'includeFixed' | 'skipSolved'>, mastery: Mastery = {}): CatalogQuestion[] {
  const out: CatalogQuestion[] = [];
  for (const set of catalog) {
    if (!config.sets.includes(set.setId)) continue;
    const sections = config.sections[set.setId];
    for (const q of set.questions) {
      if (sections && sections.length > 0 && !sections.includes(sectionSlug(q.section))) continue;
      if (!config.includeFixed && q.kind === 'fixed') continue;
      if (config.skipSolved && mastery[q.key]?.solved) continue;
      out.push(q);
    }
  }
  return out;
}

function groupKey(q: CatalogQuestion, draw: QuizConfig['draw']): string {
  if (draw === 'sections') return `${q.setId}/${sectionSlug(q.section)}`;
  if (draw === 'sets') return q.setId;
  return '';
}

/**
 * A sample of `count` questions. The pool is grouped (one group, or per
 * section, or per set); groups are visited round-robin in a random order and
 * each gives its next random question whose family has not been used yet. So
 * 7 questions from 12 sections come from 7 different sections, and variants
 * of the same situation never appear together.
 */
export function drawQuestions(
  pool: readonly CatalogQuestion[],
  config: Pick<QuizConfig, 'count' | 'draw'>,
  seed: number,
): { questions: CatalogQuestion[]; shortfall: number } {
  if (config.count === 'all') return { questions: [...pool], shortfall: 0 };
  const rng = streamRng(seed, 'draw');
  const groups = new Map<string, CatalogQuestion[]>();
  for (const q of pool) {
    const k = groupKey(q, config.draw);
    groups.set(k, [...(groups.get(k) ?? []), q]);
  }
  const queues = shuffle([...groups.keys()].sort(), rng).map((k) => shuffle(groups.get(k)!, rng));
  const used = new Set<string>();
  const picked: CatalogQuestion[] = [];
  while (picked.length < config.count && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      if (picked.length >= config.count) break;
      while (queue.length > 0) {
        const q = queue.shift()!;
        if (used.has(q.family)) continue;
        used.add(q.family);
        picked.push(q);
        break;
      }
    }
  }
  return { questions: picked, shortfall: config.count - picked.length };
}

/** Source order (set order, then problem number) or a seeded shuffle. */
export function orderQuestions(
  questions: readonly CatalogQuestion[],
  config: Pick<QuizConfig, 'order'>,
  seed: number,
  setOrder: readonly string[],
): CatalogQuestion[] {
  if (config.order === 'shuffled') return shuffle(questions, streamRng(seed, 'order'));
  const rank = (q: CatalogQuestion): number => {
    const i = setOrder.indexOf(q.setId);
    return i < 0 ? setOrder.length : i;
  };
  return [...questions].sort((a, b) => rank(a) - rank(b) || a.number - b.number || a.label.localeCompare(b.label));
}

/** Pool → draw → order: the questions of a new attempt. */
export function selectQuestions(
  catalog: readonly CatalogSet[],
  config: QuizConfig,
  seed: number,
  mastery: Mastery = {},
): { questions: CatalogQuestion[]; pool: number; shortfall: number } {
  const pool = buildPool(catalog, config, mastery);
  const { questions, shortfall } = drawQuestions(pool, config, seed);
  return {
    questions: orderQuestions(questions, config, seed, catalog.map((s) => s.setId)),
    pool: pool.length,
    shortfall,
  };
}
