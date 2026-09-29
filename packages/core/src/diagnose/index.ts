import { CoreError } from '../errors.js';
import type { Evaluator } from '../expr/evaluate.js';
import { defaultEvaluator, varCount } from '../instantiate/index.js';
import type { Scenario } from '../schema/scenario.js';
import { type TemplateToken, tokenizeTemplate } from '../template/tokenize.js';
import { DEFAULT_UNIT_TABLE, tryParseUnit } from '../units/index.js';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** Path into the scenario document, e.g. ['parts', 0, 'answer']. */
  path: (string | number)[];
  /** Character offset within the field, when known. */
  position?: number;
}

type Path = Diagnostic['path'];

/**
 * Semantic checks beyond the schema: formulas parse and only read variables
 * that exist (derived values only earlier ones), templates reference known
 * names, units parse. Everything the editor underlines comes from here.
 */
export function diagnoseScenario(s: Scenario, ev: Evaluator = defaultEvaluator()): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (severity: Severity, code: string, message: string, path: Path, position?: number): void => {
    out.push({ severity, code, message, path, ...(position !== undefined && { position }) });
  };

  const randomNames = s.vars.map((v) => v.name);
  const allNames = new Set([...randomNames, ...s.derived.map((d) => d.name)]);
  const unitOf = new Map<string, string | undefined>([
    ...s.vars.map((v) => [v.name, v.unit] as const),
    ...s.derived.map((d) => [d.name, d.unit] as const),
  ]);

  const checkExpr = (src: string, known: ReadonlySet<string>, path: Path): void => {
    try {
      const c = ev.compile(src);
      const unknown = c.identifiers.filter((n) => !known.has(n));
      if (unknown.length > 0) {
        const later = unknown.filter((n) => allNames.has(n));
        if (later.length > 0) {
          add('error', 'forward-reference', `uses ${later.join(', ')} before it is defined`, path);
        }
        const missing = unknown.filter((n) => !allNames.has(n));
        if (missing.length > 0) add('error', 'unknown-identifier', `unknown identifier ${missing.join(', ')}`, path);
      }
    } catch (e) {
      if (!(e instanceof CoreError)) throw e;
      add('error', e.code, e.message, path, typeof e.params.position === 'number' ? e.params.position : undefined);
    }
  };

  const checkUnit = (unit: string | undefined, path: Path): void => {
    if (unit === undefined) return;
    const u = tryParseUnit(unit);
    if (!u) {
      add('error', 'unit-syntax', `cannot parse unit "${unit}"`, path);
      return;
    }
    const unknown = Object.keys(u).filter((n) => !DEFAULT_UNIT_TABLE.lookup(n));
    if (unknown.length > 0) {
      add('warning', 'unit-unknown', `unit ${unknown.join(', ')} is not in the unit table; only an identical unit will match`, path);
    }
  };

  // Variables ----------------------------------------------------------------
  s.vars.forEach((v, i) => {
    checkUnit(v.unit, ['vars', i, 'unit']);
    try {
      const n = varCount(v);
      if (n < 2) add('warning', 'single-variant', `"${v.name}" can only take one value`, ['vars', i]);
    } catch (e) {
      if (!(e instanceof CoreError)) throw e;
      add('error', e.code, e.message, ['vars', i]);
    }
  });
  const seen = new Set(randomNames);
  s.derived.forEach((d, i) => {
    checkExpr(d.expr, seen, ['derived', i, 'expr']);
    checkUnit(d.unit, ['derived', i, 'unit']);
    seen.add(d.name);
  });
  s.constraints.forEach((c, i) => checkExpr(c, allNames, ['constraints', i]));

  // Templates ------------------------------------------------------------------
  const checkTemplate = (src: string, path: Path, field: 'narrative' | 'prompt' | 'other', hasUnit = false): TemplateToken[] => {
    const { tokens, diagnostics } = tokenizeTemplate(src);
    for (const d of diagnostics) add('error', d.code, d.code === 'unclosed-math' ? 'unclosed $ math' : 'unclosed {= expression', path, d.start);
    const visit = (t: TemplateToken, inMath: boolean): void => {
      switch (t.kind) {
        case 'var':
          if (!allNames.has(t.name)) add('error', 'unknown-identifier', `unknown variable {${t.name}}`, path, t.start);
          else if (t.withUnit && !unitOf.get(t.name)) {
            add('warning', 'no-unit', `{${t.name}:unit} but "${t.name}" declares no unit`, path, t.start);
          }
          break;
        case 'expr':
          checkExpr(t.src, allNames, path);
          break;
        case 'figure':
          if (field === 'other') add('error', 'figure-not-allowed', '{@fig} is only allowed in narrative and prompts', path, t.start);
          else if (!s.figure) add('error', 'no-figure', '{@fig} used but the scenario has no figure', path, t.start);
          break;
        case 'slot':
        case 'unitSlot':
          if (inMath) add('error', 'token-in-math', 'answer slots cannot be inside math', path, t.start);
          else if (field !== 'prompt') add('error', 'slot-not-allowed', 'answer slots are only allowed in prompts', path, t.start);
          else if (t.kind === 'slot' && t.index > 0) {
            add('warning', 'multi-slot', `{_${t.index}}: only one answer per part is graded`, path, t.start);
          } else if (t.kind === 'unitSlot' && !hasUnit) {
            add('warning', 'unit-slot-dimensionless', '{_u} in a part without a unit is not rendered', path, t.start);
          }
          break;
        case 'math':
          t.body.forEach((b) => visit(b, true));
          break;
        default:
          break;
      }
    };
    tokens.forEach((t) => visit(t, false));
    return tokens;
  };

  checkTemplate(s.narrative, ['narrative'], 'narrative');
  if (s.figure) {
    if (s.figure.caption !== undefined) checkTemplate(s.figure.caption, ['figure', 'caption'], 'other');
    s.figure.overlays?.forEach((o, i) => checkTemplate(o.text, ['figure', 'overlays', i, 'text'], 'other'));
  }

  // Parts ------------------------------------------------------------------------
  s.parts.forEach((p, i) => {
    checkTemplate(p.prompt, ['parts', i, 'prompt'], 'prompt', p.unit !== undefined);
    checkExpr(p.answer, allNames, ['parts', i, 'answer']);
    checkUnit(p.unit, ['parts', i, 'unit']);
    if (p.hint !== undefined) checkTemplate(p.hint, ['parts', i, 'hint'], 'other');
    if (p.solution !== undefined) checkTemplate(p.solution, ['parts', i, 'solution'], 'other');
    if (p.integer && (p.tolerance.rel !== undefined || p.tolerance.abs !== undefined)) {
      add('warning', 'integer-tolerance', 'tolerance is ignored for integer answers', ['parts', i, 'tolerance']);
    }
    if (p.unit === undefined && p.unitPenalty !== undefined) {
      add('warning', 'penalty-without-unit', 'unitPenalty has no effect on a dimensionless part', ['parts', i, 'unitPenalty']);
    }
  });
  s.canonical.parts.forEach((cp, i) => checkUnit(cp.unit, ['canonical', 'parts', i, 'unit']));

  return out;
}
