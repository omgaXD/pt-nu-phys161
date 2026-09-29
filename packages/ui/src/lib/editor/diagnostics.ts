import {
  CoreError,
  createEvaluator,
  formatValue,
  FUNCTION_NAMES,
  type Scope,
  tokenizeTemplate,
  type TemplateToken,
} from '@pt/core';

export interface EditorDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

const evaluator = createEvaluator();

function occurrences(src: string, name: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const re = new RegExp(`(?<![\\w.])${name.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}(?![\\w])`, 'g');
  for (const m of src.matchAll(re)) out.push({ from: m.index, to: m.index + name.length });
  return out;
}

/** Problems in a formula: syntax errors (with position) and unknown identifiers. */
export function formulaDiagnostics(src: string, known: readonly string[], offset = 0): EditorDiagnostic[] {
  if (src.trim() === '') return [];
  const shift = (d: EditorDiagnostic): EditorDiagnostic => ({ ...d, from: d.from + offset, to: d.to + offset });
  try {
    const c = evaluator.compile(src);
    const knownSet = new Set(known);
    return c.identifiers
      .filter((n) => !knownSet.has(n))
      .flatMap((n) =>
        occurrences(src, n).map((r) => ({ ...r, severity: 'error' as const, message: `unknown identifier "${n}"` })),
      )
      .map(shift);
  } catch (e) {
    if (!(e instanceof CoreError)) throw e;
    const ids = (e.params.identifiers as string[] | undefined) ?? [];
    if (ids.length > 0) {
      const hits = ids.flatMap((n) => occurrences(src, n).map((r) => ({ ...r, severity: 'error' as const, message: e.message })));
      if (hits.length > 0) return hits.map(shift);
    }
    const pos = typeof e.params.position === 'number' ? Math.min(e.params.position, src.length - 1) : 0;
    const whole = typeof e.params.position !== 'number';
    return [shift({ from: whole ? 0 : pos, to: whole ? src.length : pos + 1, severity: 'error', message: e.message })];
  }
}

/** Problems in a template: unclosed math/expressions, unknown {names}, bad {= expr}. */
export function templateDiagnostics(src: string, known: readonly string[]): EditorDiagnostic[] {
  const { tokens, diagnostics } = tokenizeTemplate(src);
  const knownSet = new Set(known);
  const out: EditorDiagnostic[] = diagnostics.map((d) => ({
    from: d.start,
    to: d.end,
    severity: 'error',
    message: d.code === 'unclosed-math' ? 'unclosed $ math' : 'unclosed {= expression',
  }));
  const visit = (t: TemplateToken): void => {
    if (t.kind === 'var' && !knownSet.has(t.name)) {
      out.push({ from: t.start, to: t.end, severity: 'error', message: `unknown variable "${t.name}"` });
    } else if (t.kind === 'expr') {
      const inner = src.slice(t.start + 2, t.end - 1);
      const lead = inner.length - inner.trimStart().length;
      out.push(...formulaDiagnostics(t.src, known, t.start + 2 + lead));
    } else if (t.kind === 'math') {
      t.body.forEach(visit);
    }
  };
  tokens.forEach(visit);
  return out;
}

export type EvaluationPreview = { ok: true; text: string } | { ok: false; message: string } | null;

/** Evaluate a formula against the current scope for the live `= value` readout. */
export function evaluatePreview(src: string, scope: Scope): EvaluationPreview {
  if (src.trim() === '') return null;
  try {
    return { ok: true, text: formatValue(evaluator.evaluate(src, scope)).text };
  } catch (e) {
    if (e instanceof CoreError) return { ok: false, message: e.message };
    throw e;
  }
}

export const KNOWN_FUNCTIONS: readonly string[] = FUNCTION_NAMES;
