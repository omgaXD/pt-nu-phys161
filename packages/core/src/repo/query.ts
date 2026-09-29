import { ValidationError } from '../errors.js';
import type { Scenario } from '../schema/scenario.js';
import type { SetDoc } from '../schema/set.js';
import type { ScenarioQuery, ScenarioSummary } from './types.js';

/** Opaque asset reference: `<setId>/<path relative to the set>`. */
export function assetRef(setId: string, src: string): string {
  return `${setId}/${src}`;
}

export function parseAssetRef(ref: string): { setId: string; path: string } {
  const i = ref.indexOf('/');
  const setId = i > 0 ? ref.slice(0, i) : '';
  const path = i > 0 ? ref.slice(i + 1) : '';
  const segments = path.split(/[\\/]/);
  if (!setId || !path || path.startsWith('/') || segments.includes('..') || segments.includes('')) {
    throw new ValidationError('invalid-asset-ref', `invalid asset reference "${ref}"`, { ref });
  }
  return { setId, path };
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

export function mediaTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MEDIA_TYPES[ext] ?? 'application/octet-stream';
}

/** Strip template tokens and math delimiters to get readable plain text. */
export function plainText(template: string): string {
  return template
    .replace(/\{@fig\}|\{_\w+\}/g, '')
    .replace(/\{=\s*([^}]*)\}/g, '…')
    .replace(/\{([A-Za-z][A-Za-z0-9_]*)(:unit)?\}/g, '$1')
    .replace(/\$+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scenarioTitle(s: Pick<Scenario, 'title' | 'narrative' | 'parts'>): string {
  if (s.title) return s.title;
  const text = plainText(s.narrative) || plainText(s.parts[0]?.prompt ?? '');
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

export function allTags(s: Pick<Scenario, 'tags' | 'parts'>): string[] {
  return [...new Set([...(s.tags ?? []), ...s.parts.flatMap((p) => p.tags ?? [])])];
}

export function summarize(s: Scenario, setId: string): ScenarioSummary {
  const summary: ScenarioSummary = {
    id: s.id,
    setId,
    title: scenarioTitle(s),
    tags: allTags(s),
    difficulties: s.parts.flatMap((p) => (p.difficulty !== undefined ? [p.difficulty] : [])),
    partCount: s.parts.length,
    hasFigure: s.figure !== undefined,
    sourceLabels: s.source?.labels ?? [],
    draft: s.draft ?? false,
  };
  if (s.section !== undefined) summary.section = s.section;
  return summary;
}

/** Does a scenario match the non-pagination parts of a query? */
export function matchesQuery(s: Scenario, setId: string, q: ScenarioQuery): boolean {
  if (q.setId !== undefined && q.setId !== setId) return false;
  if (q.section !== undefined && s.section !== q.section) return false;
  if (q.tags && q.tags.length > 0) {
    const tags = new Set(allTags(s));
    const mode = q.tagMode ?? 'any';
    const ok = mode === 'all' ? q.tags.every((t) => tags.has(t)) : q.tags.some((t) => tags.has(t));
    if (!ok) return false;
  }
  if (q.difficulty) {
    const { min = 1, max = 5 } = q.difficulty;
    if (!s.parts.some((p) => p.difficulty !== undefined && p.difficulty >= min && p.difficulty <= max)) return false;
  }
  if (q.text !== undefined && q.text.trim() !== '') {
    const needle = q.text.trim().toLowerCase();
    const hay = [
      s.id,
      s.title ?? '',
      s.narrative,
      ...s.parts.map((p) => p.prompt),
      ...allTags(s),
      ...(s.source?.labels ?? []),
    ]
      .join('\n')
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/**
 * Stable listing order: sets by id, then each set's `order`, then remaining
 * scenario ids alphabetically.
 */
export function orderIds(set: Pick<SetDoc, 'order'>, ids: readonly string[]): string[] {
  const present = new Set(ids);
  const ordered = (set.order ?? []).filter((id) => present.has(id));
  const listed = new Set(ordered);
  return [...ordered, ...ids.filter((id) => !listed.has(id)).sort()];
}

/** Apply cursor + limit to an already filtered, ordered list. */
export function paginate<T extends { id: string }>(rows: readonly T[], q: ScenarioQuery): T[] {
  let start = 0;
  if (q.cursor !== undefined) {
    const i = rows.findIndex((r) => r.id === q.cursor);
    start = i < 0 ? rows.length : i + 1;
  }
  const end = q.limit !== undefined ? start + Math.max(0, q.limit) : rows.length;
  return rows.slice(start, end);
}
