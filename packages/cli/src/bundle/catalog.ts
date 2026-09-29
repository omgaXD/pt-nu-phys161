import { checkCanonical, diagnoseScenario, instantiate, type Scenario, type SetDoc } from '@pt/core';
import type { CatalogQuestion, SectionReference } from '@pt/quiz';
import type { FsRepository } from '@pt/store-fs';
import { groupDrafts } from '../commands/group.js';
import { type Draft, loadDrafts } from '../import/draft.js';
import { type FixedFailure, fixedScenarioFromDraft } from '../import/fixed.js';

export interface MissingProblem {
  label: string;
  number: number;
  section?: string;
  reason: FixedFailure | 'no-fallback';
  message: string;
}

export type CatalogIssueCode =
  | 'invalid-file'
  | 'draft-scenario'
  | 'check-failed'
  | 'label-conflict'
  | 'orphan-part'
  | 'unknown-label'
  | 'document-mismatch';

export interface CatalogIssue {
  code: CatalogIssueCode;
  message: string;
  scenarioId?: string;
  label?: string;
}

/** Codes that make `--strict` fail: the content is inconsistent, not merely incomplete. */
export const STRICT_ISSUES: ReadonlySet<CatalogIssueCode> = new Set([
  'invalid-file',
  'check-failed',
  'label-conflict',
  'orphan-part',
  'unknown-label',
]);

export type { CatalogQuestion, SectionReference };

export interface SetCatalog {
  set: SetDoc;
  /** In source order. */
  questions: CatalogQuestion[];
  missing: MissingProblem[];
  /** Every scenario a question points at (authored and fixed), by id. */
  scenarios: Map<string, Scenario>;
  references: SectionReference[];
  issues: CatalogIssue[];
}

export interface CatalogOptions {
  /** Fall back to fixed-values questions for problems without an authored scenario (default true). */
  fixed?: boolean;
  /** Seeds 0..n-1 every authored scenario must instantiate for (default 20). */
  seeds?: number;
}

const labelNumber = (label: string): number => Number(/\d+/.exec(label)?.[0] ?? Number.NaN);

/** Union-find over labels. */
function families(labels: readonly string[], groups: readonly (readonly string[])[]): Map<string, string> {
  const parent = new Map(labels.map((l) => [l, l]));
  const find = (l: string): string => {
    const p = parent.get(l) ?? l;
    if (p === l) return l;
    const root = find(p);
    parent.set(l, root);
    return root;
  };
  const byNumber = (a: string, b: string): number => labelNumber(a) - labelNumber(b) || a.localeCompare(b);
  for (const g of groups) {
    const known = g.filter((l) => parent.has(l));
    for (const l of known.slice(1)) {
      const [a, b] = [find(known[0]!), find(l)].sort(byNumber) as [string, string];
      if (a !== b) parent.set(b, a);
    }
  }
  return new Map(labels.map((l) => [l, find(l)]));
}

/**
 * Work out what a set offers the quiz: which source problems are playable,
 * by which scenario part, and what is wrong with the content. Shared by
 * `pt coverage` and `pt bundle`.
 */
export async function buildSetCatalog(repo: FsRepository, root: string, setId: string, opts: CatalogOptions = {}): Promise<SetCatalog> {
  const set = await repo.getSet(setId);
  const issues: CatalogIssue[] = [];
  const scenarios = new Map<string, Scenario>();

  for (const d of await repo.diagnostics(setId)) {
    issues.push({ code: 'invalid-file', message: `${d.file}: ${d.message}` });
  }

  const drafts: Draft[] = loadDrafts(root, setId).map((d) => d.draft);
  const draftByLabel = new Map(drafts.map((d) => [d.label, d]));

  // ---- Authored scenarios: which source label each part answers -----------
  const authored = new Map<string, { scenario: Scenario; partId: string }>();
  const authoredGroups: string[][] = [];
  const seeds = opts.seeds ?? 20;
  for (const summary of await repo.listScenarios({ setId })) {
    const s = await repo.getScenario(summary.id);
    if (s.draft) {
      issues.push({ code: 'draft-scenario', scenarioId: s.id, message: `${s.id} is marked draft (saved while failing); skipped` });
      continue;
    }
    const problem =
      diagnoseScenario(s).find((d) => d.severity === 'error')?.message ??
      (checkCanonical(s).ok ? undefined : 'canonical check fails') ??
      firstInstantiationError(s, seeds);
    if (problem !== undefined) {
      issues.push({ code: 'check-failed', scenarioId: s.id, message: `${s.id}: ${problem}` });
      continue;
    }
    if (s.source && set.source && s.source.document !== set.source.document) {
      issues.push({ code: 'document-mismatch', scenarioId: s.id, message: `${s.id}: source document "${s.source.document}" is not "${set.source.document}"` });
    }

    const byLabel = new Map<string, string>();
    for (const cp of s.canonical.parts) if (cp.source !== undefined) byLabel.set(cp.source, cp.id);
    if (byLabel.size === 0 && s.parts.length === 1 && s.source?.labels.length === 1) byLabel.set(s.source.labels[0]!, s.parts[0]!.id);
    const covered = new Set(byLabel.values());
    for (const p of s.parts) {
      if (!covered.has(p.id)) issues.push({ code: 'orphan-part', scenarioId: s.id, message: `${s.id}#${p.id} answers no source label` });
    }

    for (const [label, partId] of byLabel) {
      if (drafts.length > 0 && !draftByLabel.has(label)) {
        issues.push({ code: 'unknown-label', scenarioId: s.id, label, message: `${s.id}: ${label} is not a problem of ${setId}` });
      }
      const other = authored.get(label);
      if (other) {
        issues.push({ code: 'label-conflict', scenarioId: s.id, label, message: `${label} is claimed by ${other.scenario.id} and ${s.id}` });
        continue;
      }
      authored.set(label, { scenario: s, partId });
      scenarios.set(s.id, s);
    }
    authoredGroups.push([...byLabel.keys()]);
  }

  // ---- Questions: authored first, else the fixed fallback ----------------
  const labels = [...new Set([...drafts.map((d) => d.label), ...authored.keys()])];
  const family = families(labels, [...groupDrafts(setId, drafts).map((g) => g.labels), ...authoredGroups]);
  const questions: CatalogQuestion[] = [];
  const missing: MissingProblem[] = [];

  for (const label of labels) {
    const draft = draftByLabel.get(label);
    const number = draft?.number ?? labelNumber(label);
    const base = { key: `${setId}/${label}`, setId, label, number, family: `${setId}/${family.get(label) ?? label}` };
    const a = authored.get(label);
    if (a) {
      const section = draft?.section ?? a.scenario.section;
      questions.push({ ...base, ...(section !== undefined && { section }), kind: 'authored', scenarioId: a.scenario.id, partId: a.partId });
      continue;
    }
    if (!draft) continue;
    const section = draft.section !== undefined ? { section: draft.section } : {};
    if (opts.fixed === false) {
      missing.push({ label, number, ...section, reason: 'no-fallback', message: `${label} has no authored scenario` });
      continue;
    }
    const f = fixedScenarioFromDraft(draft);
    if (!f.ok) {
      missing.push({ label, number, ...section, reason: f.reason, message: f.message });
      continue;
    }
    scenarios.set(f.scenario.id, f.scenario);
    questions.push({ ...base, ...section, kind: 'fixed', scenarioId: f.scenario.id, partId: f.scenario.parts[0]!.id });
  }
  const bySource = (a: { number: number; label: string }, b: { number: number; label: string }): number =>
    a.number - b.number || a.label.localeCompare(b.label);
  questions.sort(bySource);
  missing.sort(bySource);

  const references: SectionReference[] = [];
  for (const d of drafts) {
    for (const f of d.figures) {
      if (f.role !== 'section' || references.some((r) => r.src === f.src)) continue;
      const section = d.section ?? '';
      references.push({ section, src: f.src, alt: `Reference sheet for ${section || 'this section'}` });
    }
  }
  return { set, questions, missing, scenarios, references, issues };
}

function firstInstantiationError(s: Scenario, seeds: number): string | undefined {
  for (let seed = 0; seed < seeds; seed++) {
    try {
      instantiate(s, seed);
    } catch (e) {
      return `seed ${seed}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return undefined;
}
