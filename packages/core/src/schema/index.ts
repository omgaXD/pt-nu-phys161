import type { z } from 'zod';
import { ValidationError } from '../errors.js';
import { type Scenario, ScenarioSchema, type ScenarioInput } from './scenario.js';
import { type SetDoc, type SetDocInput, SetDocSchema } from './set.js';

export * from './defaults.js';
export * from './scenario.js';
export * from './set.js';

export interface SchemaIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

function toIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    code: i.code,
    message: i.message,
  }));
}

export function formatIssues(issues: readonly SchemaIssue[]): string {
  return issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('\n');
}

export type SafeParse<T> = { ok: true; value: T } | { ok: false; issues: SchemaIssue[] };

export function safeParseScenario(input: unknown): SafeParse<Scenario> {
  const r = ScenarioSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: toIssues(r.error) };
}

/** Validate and apply defaults. Throws `ValidationError` (code `invalid-scenario`). */
export function parseScenario(input: unknown): Scenario {
  const r = safeParseScenario(input);
  if (!r.ok) {
    const id = typeof input === 'object' && input && 'id' in input ? String(input.id) : undefined;
    throw new ValidationError('invalid-scenario', `invalid scenario${id ? ` "${id}"` : ''}:\n${formatIssues(r.issues)}`, {
      id,
      issues: r.issues,
    });
  }
  return r.value;
}

export function safeParseSetDoc(input: unknown): SafeParse<SetDoc> {
  const r = SetDocSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: toIssues(r.error) };
}

export function parseSetDoc(input: unknown): SetDoc {
  const r = safeParseSetDoc(input);
  if (!r.ok) {
    throw new ValidationError('invalid-set', `invalid set:\n${formatIssues(r.issues)}`, { issues: r.issues });
  }
  return r.value;
}

/**
 * The compact, storable form of a scenario: schema defaults that carry no
 * information (`answerType: numeric`, empty `derived`, `tolerance: {}`...)
 * are dropped so stored files stay close to what an author writes.
 * `parseScenario(toStorable(s))` deep-equals `s`.
 */
export function toStorable(s: Scenario): ScenarioInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue;
    if ((k === 'derived' || k === 'constraints') && Array.isArray(v) && v.length === 0) continue;
    if (k === 'source' && isEmptySource(v)) {
      out[k] = { document: (v as { document: string }).document };
      continue;
    }
    if (k === 'parts') {
      out[k] = (v as Scenario['parts']).map(storablePart);
      continue;
    }
    out[k] = v;
  }
  return out as ScenarioInput;
}

function isEmptySource(v: unknown): boolean {
  return typeof v === 'object' && v !== null && Array.isArray((v as { labels?: unknown }).labels)
    ? (v as { labels: unknown[] }).labels.length === 0
    : false;
}

function storablePart(p: Scenario['parts'][number]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (k === 'answerType' && v === 'numeric') continue;
    if (k === 'tolerance' && Object.keys(v as object).length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function toStorableSet(s: SetDoc): SetDocInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as SetDocInput;
}
