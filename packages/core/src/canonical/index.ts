import { CoreError } from '../errors.js';
import type { Evaluator } from '../expr/evaluate.js';
import { withinTolerance } from '../grade/index.js';
import {
  type ConstraintResult,
  defaultEvaluator,
  evaluateAnswers,
  evaluateConstraints,
  evaluateDerived,
  rangeGrid,
} from '../instantiate/index.js';
import type { Scenario } from '../schema/scenario.js';
import { areCompatible } from '../units/index.js';

export interface CanonicalPartResult {
  partId: string;
  source?: string;
  /** Printed answer, in its printed unit. */
  expected: number;
  expectedUnit?: string;
  /** Printed answer converted to the part's unit. */
  expectedInPartUnit: number | null;
  /** Model answer computed from the source values, in the part's unit. */
  computed: number | null;
  relError: number | null;
  ok: boolean;
  /**
   * Constraints that reject the source values. Reported as a warning, not a
   * failure: the source problem simply lies outside the randomized family.
   */
  constraintFailures: ConstraintResult[];
  /** Asserted derived values (`canonical.vars.g: 9.8`) that did not match. */
  derivedMismatches: { name: string; expected: number | string; actual: unknown }[];
  error?: { code: string; message: string };
}

export type CanonicalWarning =
  | { code: 'canonical-off-grid' | 'canonical-not-an-option'; name: string; value: number | string }
  | { code: 'canonical-violates-constraint'; partId: string; constraint: string };

export interface CanonicalReport {
  scenarioId: string;
  ok: boolean;
  parts: CanonicalPartResult[];
  /** Source values the randomization can never produce (informational). */
  warnings: CanonicalWarning[];
}

function onGrid(scenario: Scenario, name: string, value: number | string): CanonicalWarning | null {
  const v = scenario.vars.find((x) => x.name === name);
  if (!v) return null;
  if (v.kind === 'choice') {
    return v.options.includes(value) ? null : { code: 'canonical-not-an-option', name, value };
  }
  if (typeof value !== 'number') return { code: 'canonical-off-grid', name, value };
  const grid = rangeGrid(v);
  for (let k = 0; k < Math.min(grid.count, 1_000_000); k++) {
    if (Math.abs(grid.valueAt(k) - value) <= 1e-9 * Math.max(1, Math.abs(value))) return null;
  }
  return { code: 'canonical-off-grid', name, value };
}

/**
 * Pin the random variables to the source values and assert every canonical
 * part reproduces its printed answer within the part's tolerance.
 */
export function checkCanonical(scenario: Scenario, ev: Evaluator = defaultEvaluator()): CanonicalReport {
  const randomNames = new Set(scenario.vars.map((v) => v.name));
  const derivedNames = new Set(scenario.derived.map((d) => d.name));

  const parts = scenario.canonical.parts.map((cp): CanonicalPartResult => {
    const part = scenario.parts.find((p) => p.id === cp.id);
    const result: CanonicalPartResult = {
      partId: cp.id,
      expected: cp.answer,
      expectedInPartUnit: null,
      computed: null,
      relError: null,
      ok: false,
      constraintFailures: [],
      derivedMismatches: [],
    };
    if (cp.source !== undefined) result.source = cp.source;
    if (cp.unit !== undefined) result.expectedUnit = cp.unit;
    if (!part) return { ...result, error: { code: 'unknown-part', message: `no part "${cp.id}"` } };

    const pinned = { ...scenario.canonical.vars, ...cp.vars };
    const randoms: Record<string, number | string> = {};
    const asserted: [string, number | string][] = [];
    for (const [k, v] of Object.entries(pinned)) {
      if (randomNames.has(k)) randoms[k] = v;
      else if (derivedNames.has(k)) asserted.push([k, v]);
    }

    // Unit of the printed answer vs the part's unit (printed without a unit: assume the part's).
    let factor: number | false;
    if (part.unit === undefined) factor = cp.unit === undefined ? 1 : false;
    else factor = cp.unit === undefined ? 1 : areCompatible(cp.unit, part.unit);
    if (factor === false) {
      return {
        ...result,
        error: { code: 'unit-mismatch', message: `printed unit "${cp.unit ?? ''}" is not compatible with "${part.unit ?? ''}"` },
      };
    }
    result.expectedInPartUnit = cp.answer * factor;

    try {
      const derived = evaluateDerived(scenario, randoms, ev);
      if (!derived.ok) {
        return {
          ...result,
          error: { code: 'derived-domain-error', message: `derived value failed: ${derived.rejection.reason}` },
        };
      }
      for (const [name, expected] of asserted) {
        const actual = derived.values[name];
        const same =
          typeof expected === 'number' && typeof actual === 'number'
            ? Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected))
            : actual === expected;
        if (!same) result.derivedMismatches.push({ name, expected, actual });
      }
      result.constraintFailures = evaluateConstraints(scenario, derived.values, ev).filter((c) => !c.ok);
      const computed = evaluateAnswers({ parts: [part] }, derived.values, ev)[part.id]!;
      result.computed = computed;
      const exp = result.expectedInPartUnit;
      result.relError = exp === 0 ? Math.abs(computed) : Math.abs(computed - exp) / Math.abs(exp);
      result.ok = withinTolerance(exp, computed, part) && result.derivedMismatches.length === 0;
    } catch (e) {
      if (e instanceof CoreError) return { ...result, error: { code: e.code, message: e.message } };
      throw e;
    }
    return result;
  });

  const warnings: CanonicalWarning[] = parts.flatMap((p) =>
    p.constraintFailures.map((c) => ({ code: 'canonical-violates-constraint' as const, partId: p.partId, constraint: c.expr })),
  );
  const seen = new Set<string>();
  const allPinned = [scenario.canonical.vars, ...scenario.canonical.parts.map((p) => p.vars ?? {})];
  for (const pinned of allPinned) {
    for (const [name, value] of Object.entries(pinned)) {
      const key = `${name}=${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const w = onGrid(scenario, name, value);
      if (w) warnings.push(w);
    }
  }

  return { scenarioId: scenario.id, ok: parts.every((p) => p.ok), parts, warnings };
}
