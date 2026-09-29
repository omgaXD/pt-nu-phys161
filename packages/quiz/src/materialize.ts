import {
  ConstraintUnsatisfiableError,
  type GradablePart,
  instantiate,
  instantiateAt,
  type ProblemInstance,
  type Scenario,
} from '@pt/core';
import type { CatalogQuestion } from './bundle.js';
import { hash32 } from './random.js';

/**
 * Everything needed to show and grade one question, frozen when it is first
 * shown. Attempts store these so that rebuilding the content (an edited
 * formula, a new authored scenario) never changes a question someone is
 * answering or reviewing: a record of what was shown, not a source of truth.
 */
export interface QuestionSnapshot {
  /** The instance, trimmed to this question's part (and without the value table). */
  instance: ProblemInstance;
  /** The grading fields of the part. */
  part: GradablePart;
  /** Hash of the scenario the snapshot was made from. */
  scenarioHash: string;
  /** Shown with the source's own numbers (by choice, fixed problem, or fallback). */
  sourceValues: boolean;
}

/** The source values for one question: `canonical.vars` merged with the matching canonical part's overrides. */
export function sourceRandoms(scenario: Scenario, partId: string, label?: string): Record<string, number | string> {
  const cp =
    (label !== undefined ? scenario.canonical.parts.find((c) => c.source === label) : undefined) ??
    scenario.canonical.parts.find((c) => c.id === partId);
  const pinned = { ...scenario.canonical.vars, ...cp?.vars };
  const random = new Set(scenario.vars.map((v) => v.name));
  return Object.fromEntries(Object.entries(pinned).filter(([k]) => random.has(k)));
}

function gradable(scenario: Scenario, partId: string): GradablePart {
  const p = scenario.parts.find((x) => x.id === partId);
  if (!p) throw new Error(`scenario ${scenario.id} has no part "${partId}"`);
  const out: GradablePart = { id: p.id, answerType: p.answerType, tolerance: p.tolerance };
  if (p.unit !== undefined) out.unit = p.unit;
  if (p.integer) out.integer = true;
  if (p.unitPenalty !== undefined) out.unitPenalty = p.unitPenalty;
  if (p.exactUnit) out.exactUnit = true;
  return out;
}

function trim(instance: ProblemInstance, partId: string): ProblemInstance {
  return { ...instance, values: {}, parts: instance.parts.filter((p) => p.partId === partId) };
}

/** Retries after an unsatisfiable draw before falling back to the source values. */
const RETRIES = 5;

/**
 * Build a question's snapshot. `seed === null` means the source's own
 * numbers; otherwise the scenario is instantiated at `seed`, retried with
 * derived seeds if its constraints cannot be met, and finally shown with the
 * source values rather than not at all.
 */
export function materialize(question: Pick<CatalogQuestion, 'partId' | 'label'>, scenario: Scenario, seed: number | null, scenarioHash: string): QuestionSnapshot {
  const part = gradable(scenario, question.partId);
  const atSource = (): QuestionSnapshot => ({
    instance: trim(instantiateAt(scenario, sourceRandoms(scenario, question.partId, question.label)), question.partId),
    part,
    scenarioHash,
    sourceValues: true,
  });
  if (seed === null) return atSource();
  for (let k = 0; k <= RETRIES; k++) {
    try {
      const s = k === 0 ? seed : hash32(`${seed}#${k}`);
      return { instance: trim(instantiate(scenario, s), question.partId), part, scenarioHash, sourceValues: false };
    } catch (e) {
      if (!(e instanceof ConstraintUnsatisfiableError)) throw e;
    }
  }
  return atSource();
}
