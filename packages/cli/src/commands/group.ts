import { type Draft, draftScenarioId, loadDrafts, splitNarrative } from '../import/draft.js';
import { CliError, type Context, paint } from '../context.js';

export interface DraftGroup {
  labels: string[];
  /** Why these drafts belong together. */
  reasons: string[];
  /** Mean pairwise narrative similarity (0..1). */
  similarity: number;
  sharedFigure?: string;
  proposedId: string;
  /** Shared setup text of the first draft (numbers masked). */
  narrative: string;
  /** What each draft asks. */
  asks: { label: string; prompt: string; answer?: string }[];
}

const STOP = new Set(['the', 'a', 'an', 'of', 'is', 'to', 'and', 'in', 'on', 'at', 'by', 'with', 'its', 'it', 'as', 'from', 'for', 'that', 'this', 'are', 'be']);

/** Narrative with numbers masked, as a set of word bigrams. */
function shingles(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/\{[^}]*\}/g, ' # ')
    .replace(/[-+]?\d+(\.\d+)?(e[-+]?\d+)?/g, ' # ')
    .split(/[^\p{L}#]+/u)
    .filter((w) => w && !STOP.has(w));
  const out = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function setupText(d: Draft): string {
  return splitNarrative(d.text.replace(/\([^()]*\)\s*$/, '')).narrative;
}

/**
 * Cluster drafts that share a figure or have highly similar narratives into
 * candidate multi-part scenarios (§7). Proposals only: a human or agent
 * confirms and writes the merged scenario.
 */
export function groupDrafts(setId: string, drafts: readonly Draft[], threshold = 0.6): DraftGroup[] {
  const n = drafts.length;
  const parent = drafts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const sh = drafts.map((d) => shingles(setupText(d)));
  const reasons = new Map<string, Set<string>>();
  const note = (i: number, j: number, reason: string): void => {
    union(i, j);
    for (const k of [i, j]) {
      const key = drafts[k]!.label;
      reasons.set(key, (reasons.get(key) ?? new Set()).add(reason));
    }
  };

  const byFigure = new Map<string, number[]>();
  drafts.forEach((d, i) => {
    for (const f of d.figures.filter((x) => x.role === undefined)) byFigure.set(f.src, [...(byFigure.get(f.src) ?? []), i]);
  });
  for (const [src, idx] of byFigure) for (const i of idx.slice(1)) note(idx[0]!, i, `shared figure ${src}`);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = jaccard(sh[i]!, sh[j]!);
      if (s >= threshold) note(i, j, 'similar narrative');
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) clusters.set(find(i), [...(clusters.get(find(i)) ?? []), i]);

  const groups: DraftGroup[] = [];
  for (const idx of clusters.values()) {
    if (idx.length < 2) continue;
    idx.sort((a, b) => drafts[a]!.number - drafts[b]!.number);
    let total = 0;
    let pairs = 0;
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        total += jaccard(sh[idx[a]!]!, sh[idx[b]!]!);
        pairs++;
      }
    }
    const members = idx.map((i) => drafts[i]!);
    const first = members[0]!;
    const last = members.at(-1)!;
    const figs = new Set(members.flatMap((d) => d.figures.filter((f) => f.role === undefined).map((f) => f.src)));
    const labels = members.map((d) => d.label);
    groups.push({
      labels,
      reasons: [...new Set(labels.flatMap((l) => [...(reasons.get(l) ?? [])]))].sort(),
      similarity: Number((total / pairs).toFixed(3)),
      ...(figs.size === 1 && { sharedFigure: [...figs][0]! }),
      proposedId: `${draftScenarioId(setId, first.number)}${members.length > 1 ? `-${String(last.number).padStart(3, '0')}` : ''}`,
      narrative: setupText(first).replace(/[-+]?\d+(\.\d+)?(e[-+]?\d+)?/gi, '#'),
      asks: members.map((d) => ({
        label: d.label,
        prompt: splitNarrative(d.text.replace(/\([^()]*\)\s*$/, '')).prompt,
        ...(d.answer && { answer: d.answer.raw }),
      })),
    });
  }
  return groups.sort((a, b) => Number(a.labels[0]!.slice(1)) - Number(b.labels[0]!.slice(1)));
}

export async function runGroup(ctx: Context, setId: string, opts: { threshold?: number; json?: boolean } = {}): Promise<number> {
  const drafts = loadDrafts(ctx.root, setId).map((d) => d.draft);
  if (drafts.length === 0) throw new CliError(`no drafts in ${setId}/drafts (run \`pt import\` first)`);
  const groups = groupDrafts(setId, drafts, opts.threshold ?? 0.6);
  const o = ctx.output;
  if (opts.json) {
    o.out(JSON.stringify({ setId, drafts: drafts.length, groups }, null, 2));
    return 0;
  }
  for (const g of groups) {
    o.out(`${paint(o, 'bold', g.labels.join(' + '))} → ${paint(o, 'cyan', g.proposedId)}  ${paint(o, 'dim', `(${g.reasons.join('; ')}; similarity ${g.similarity})`)}`);
    o.out(`    ${paint(o, 'dim', g.narrative.length > 160 ? `${g.narrative.slice(0, 157)}…` : g.narrative)}`);
    for (const a of g.asks) o.out(`    ${a.label}: ${a.prompt}${a.answer ? paint(o, 'dim', `  (${a.answer})`) : ''}`);
  }
  const grouped = groups.reduce((s, g) => s + g.labels.length, 0);
  o.out('');
  o.out(`${groups.length} proposed multi-part scenario(s) covering ${grouped} of ${drafts.length} drafts. Confirm each before merging.`);
  return 0;
}
