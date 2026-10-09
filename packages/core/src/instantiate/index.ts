import { ConstraintUnsatisfiableError, CoreError, DomainError, InstantiationError } from '../errors.js';
import { createEvaluator, type Evaluator, type Value } from '../expr/evaluate.js';
import { effectiveMaxSampleAttempts } from '../schema/defaults.js';
import type { AnswerType, Scenario } from '../schema/scenario.js';
import { type RenderContext, renderTemplate, type Slot, type TemplateField, type VarMeta } from '../template/render.js';
import { assertSeed, drawRandoms, drawSeed } from './sample.js';

export {
  assertSeed,
  countVariants,
  drawRandoms,
  drawSeed,
  MAX_SEED,
  quantize,
  rangeGrid,
  uniformIndex,
  type VariantBreakdown,
  variantBreakdown,
  varCount,
} from './sample.js';

// ---- Instance shape ---------------------------------------------------------

export interface RenderedOverlay {
  id: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  html: string;
}

export interface RenderedFigure {
  id: string;
  /** As authored; resolve through the repository (`assetRef`). */
  src: string;
  alt: string;
  captionHtml?: string;
  overlays: RenderedOverlay[];
}

export interface InstancePart {
  partId: string;
  promptHtml: string;
  slots: Slot[];
  modelAnswer: number;
  unit?: string;
  answerType: AnswerType;
  integer?: boolean;
  exactUnit?: boolean;
  hintHtml?: string;
  solutionHtml?: string;
}

/** A plain, JSON-serialisable generated problem. `(scenarioId, seed)` is its identity. */
export interface ProblemInstance {
  scenarioId: string;
  /** The seed, or -1 for an instance evaluated at pinned values (canonical/preview). */
  seed: number;
  /** Quantized randoms + derived values. */
  values: Record<string, Value>;
  narrativeHtml: string;
  figure?: RenderedFigure;
  parts: InstancePart[];
}

// ---- Error locations ---------------------------------------------------------

export type ExprLocation =
  | { kind: 'derived'; name: string }
  | { kind: 'constraint'; index: number; expr: string }
  | { kind: 'answer'; partId: string }
  | { kind: 'template'; field: TemplateField; partId?: string; overlayId?: string };

function locationLabel(loc: ExprLocation): string {
  switch (loc.kind) {
    case 'derived':
      return `derived "${loc.name}"`;
    case 'constraint':
      return `constraint #${loc.index + 1} (${loc.expr})`;
    case 'answer':
      return `answer of part "${loc.partId}"`;
    case 'template':
      return `${loc.field}${loc.partId ? ` of part "${loc.partId}"` : ''}${loc.overlayId ? ` overlay "${loc.overlayId}"` : ''}`;
  }
}

function wrapError(e: unknown, location: ExprLocation): never {
  if (e instanceof CoreError) {
    throw new InstantiationError(e.name === 'TemplateError' ? 'template-error' : 'expression-error', `${locationLabel(location)}: ${e.message}`, {
      location,
      cause: e.toJSON(),
    });
  }
  throw e;
}

// ---- Evaluation steps --------------------------------------------------------

let sharedEvaluator: Evaluator | undefined;
/** The default authoring evaluator (lambdas allowed, generous budgets). */
export function defaultEvaluator(): Evaluator {
  sharedEvaluator ??= createEvaluator();
  return sharedEvaluator;
}

export interface Rejection {
  location: ExprLocation;
  /** `falsy` for a constraint that evaluated false, else the DomainError code. */
  reason: string;
}

/**
 * Evaluate derived variables in declaration order, after the randoms. A domain
 * error (sqrt of a negative, division by zero) rejects the draw; any other
 * error is an authoring bug and is thrown.
 */
export function evaluateDerived(
  scenario: Pick<Scenario, 'derived'>,
  randoms: Readonly<Record<string, number | string>>,
  ev: Evaluator = defaultEvaluator(),
): { ok: true; values: Record<string, Value> } | { ok: false; rejection: Rejection; values: Record<string, Value> } {
  const values: Record<string, Value> = { ...randoms };
  for (const d of scenario.derived) {
    const location: ExprLocation = { kind: 'derived', name: d.name };
    try {
      values[d.name] = ev.evaluate(d.expr, values);
    } catch (e) {
      if (e instanceof DomainError) return { ok: false, rejection: { location, reason: e.code }, values };
      wrapError(e, location);
    }
  }
  return { ok: true, values };
}

export interface ConstraintResult {
  index: number;
  expr: string;
  ok: boolean;
  /** Present when evaluation raised a DomainError. */
  error?: string;
}

function truthy(v: Value): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  throw new DomainError('type', 'constraint must evaluate to a boolean or number');
}

export function evaluateConstraints(
  scenario: Pick<Scenario, 'constraints'>,
  values: Readonly<Record<string, Value>>,
  ev: Evaluator = defaultEvaluator(),
): ConstraintResult[] {
  return scenario.constraints.map((expr, index) => {
    try {
      return { index, expr, ok: truthy(ev.evaluate(expr, values)) };
    } catch (e) {
      if (e instanceof DomainError) return { index, expr, ok: false, error: e.code };
      return wrapError(e, { kind: 'constraint', index, expr });
    }
  });
}

/** Evaluate every part's answer formula to a finite number. */
export function evaluateAnswers(
  scenario: Pick<Scenario, 'parts'>,
  values: Readonly<Record<string, Value>>,
  ev: Evaluator = defaultEvaluator(),
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of scenario.parts) {
    const location: ExprLocation = { kind: 'answer', partId: p.id };
    let v: Value;
    try {
      v = ev.evaluate(p.answer, values);
    } catch (e) {
      wrapError(e, location);
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new InstantiationError('answer-not-number', `${locationLabel(location)} did not evaluate to a finite number`, {
        location,
        got: Array.isArray(v) ? 'array' : typeof v,
      });
    }
    out[p.id] = v === 0 ? 0 : v;
  }
  return out;
}

export interface SampleResult {
  /** Quantized randoms + derived values of the accepted draw. */
  values: Record<string, Value>;
  randoms: Record<string, number | string>;
  /** Number of draws taken (1 = first draw accepted). */
  draws: number;
  /** Why earlier draws were rejected, keyed by location label. */
  rejections: Record<string, number>;
}

/**
 * Draw the randoms, quantize, derive, and retry with derived sub-seeds
 * until every constraint holds. Throws `ConstraintUnsatisfiableError` naming
 * the most frequently failing constraint when the budget runs out.
 */
export function sampleScenario(
  scenario: Scenario,
  seed: number,
  ev: Evaluator = defaultEvaluator(),
): SampleResult {
  assertSeed(seed);
  const maxDraws = effectiveMaxSampleAttempts(scenario);
  const rejections: Record<string, number> = {};
  for (let k = 0; k < maxDraws; k++) {
    const randoms = drawRandoms(scenario.vars, drawSeed(seed, k));
    const derived = evaluateDerived(scenario, randoms, ev);
    let rejection: Rejection | undefined;
    if (derived.ok) {
      const failed = evaluateConstraints(scenario, derived.values, ev).find((c) => !c.ok);
      if (failed) {
        rejection = {
          location: { kind: 'constraint', index: failed.index, expr: failed.expr },
          reason: failed.error ?? 'falsy',
        };
      }
    } else {
      rejection = derived.rejection;
    }
    if (!rejection) return { values: derived.values, randoms, draws: k + 1, rejections };
    const key = locationLabel(rejection.location);
    rejections[key] = (rejections[key] ?? 0) + 1;
  }
  const [worst] = Object.entries(rejections).sort((a, b) => b[1] - a[1]);
  throw new ConstraintUnsatisfiableError(
    'constraints-unsatisfiable',
    `no draw satisfied the constraints in ${maxDraws} tries; most frequent failure: ${worst?.[0]}`,
    { scenarioId: scenario.id, seed, maxDraws, failing: worst?.[0], rejections },
  );
}

// ---- Rendering ---------------------------------------------------------------

function varMeta(scenario: Scenario): Record<string, VarMeta> {
  const meta: Record<string, VarMeta> = {};
  for (const v of scenario.vars) meta[v.name] = { decimals: v.decimals, sigfigs: v.sigfigs, unit: v.unit };
  for (const d of scenario.derived) meta[d.name] = { unit: d.unit };
  return meta;
}

function render(
  src: string,
  ctx: RenderContext,
  field: TemplateField,
  location: ExprLocation,
  hasUnit?: boolean,
): ReturnType<typeof renderTemplate> {
  try {
    return renderTemplate(src, ctx, { field, ...(hasUnit !== undefined && { hasUnit }) });
  } catch (e) {
    return wrapError(e, location);
  }
}

/** Steps 6–7: answers and rendering, for already-computed values. */
export function buildInstance(
  scenario: Scenario,
  seed: number,
  values: Record<string, Value>,
  ev: Evaluator = defaultEvaluator(),
): ProblemInstance {
  const answers = evaluateAnswers(scenario, values, ev);
  const ctx: RenderContext = { values, meta: varMeta(scenario), evaluator: ev, figureId: scenario.figure?.id };

  const narrativeHtml = render(scenario.narrative, ctx, 'narrative', { kind: 'template', field: 'narrative' }).html;

  let figure: RenderedFigure | undefined;
  if (scenario.figure) {
    const f = scenario.figure;
    figure = {
      id: f.id,
      src: f.src,
      alt: f.alt,
      overlays: (f.overlays ?? []).map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        anchor: o.anchor ?? 'middle',
        html: render(o.text, ctx, 'overlay', { kind: 'template', field: 'overlay', overlayId: o.id }).html,
      })),
    };
    if (f.caption !== undefined) {
      figure.captionHtml = render(f.caption, ctx, 'caption', { kind: 'template', field: 'caption' }).html;
    }
  }

  const parts: InstancePart[] = scenario.parts.map((p) => {
    const prompt = render(p.prompt, ctx, 'prompt', { kind: 'template', field: 'prompt', partId: p.id }, p.unit !== undefined);
    const part: InstancePart = {
      partId: p.id,
      promptHtml: prompt.html,
      slots: prompt.slots,
      modelAnswer: answers[p.id]!,
      answerType: p.answerType,
    };
    if (p.unit !== undefined) part.unit = p.unit;
    if (p.integer) part.integer = true;
    if (p.exactUnit) part.exactUnit = true;
    if (p.hint !== undefined) {
      part.hintHtml = render(p.hint, ctx, 'hint', { kind: 'template', field: 'hint', partId: p.id }).html;
    }
    if (p.solution !== undefined) {
      part.solutionHtml = render(p.solution, ctx, 'solution', { kind: 'template', field: 'solution', partId: p.id }).html;
    }
    return part;
  });

  const instance: ProblemInstance = { scenarioId: scenario.id, seed, values, narrativeHtml, parts };
  if (figure) instance.figure = figure;
  return instance;
}

export interface InstantiateOptions {
  evaluator?: Evaluator;
}

/**
 * `(scenario, seed) → instance`, pure and stable forever. The seed is the
 * entire identity of a generated problem; never persist the generated values.
 */
export function instantiate(scenario: Scenario, seed: number, opts: InstantiateOptions = {}): ProblemInstance {
  const ev = opts.evaluator ?? defaultEvaluator();
  const { values } = sampleScenario(scenario, seed, ev);
  return buildInstance(scenario, seed, values, ev);
}

/**
 * Evaluate a scenario at explicitly pinned random values (canonical source
 * values, or values chosen in the editor). Constraints are not enforced here;
 * see `evaluateConstraints`.
 */
export function instantiateAt(
  scenario: Scenario,
  randoms: Readonly<Record<string, number | string>>,
  opts: InstantiateOptions = {},
): ProblemInstance {
  const ev = opts.evaluator ?? defaultEvaluator();
  const derived = evaluateDerived(scenario, randoms, ev);
  if (!derived.ok) {
    throw new InstantiationError('derived-domain-error', `${locationLabel(derived.rejection.location)}: ${derived.rejection.reason}`, {
      location: derived.rejection.location,
      reason: derived.rejection.reason,
    });
  }
  return buildInstance(scenario, -1, derived.values, ev);
}
