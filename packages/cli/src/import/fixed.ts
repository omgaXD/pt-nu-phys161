import { checkCanonical, diagnoseScenario, instantiate, safeParseScenario, type Scenario, tryParseUnit } from '@pt/core';
import type { Draft } from './draft.js';
import { writtenDecimals } from './literals.js';

/**
 * A draft played with the source's own numbers: every variable is pinned to
 * its printed value and the answer is the printed answer. This makes a
 * problem usable before anyone writes its formula; an authored scenario that
 * covers the same source label replaces it.
 */
export type FixedResult =
  | { ok: true; scenario: Scenario }
  | { ok: false; reason: FixedFailure; message: string };

export type FixedFailure = 'no-answer' | 'inline-image' | 'invalid' | 'unit-unparseable' | 'canonical-fail';

/** Fixed scenarios never collide with authored ids (Studio keeps the draft's id). */
export const FIXED_ID_PREFIX = 'fixed.';

/**
 * Significant figures of a number written in scientific notation, from its
 * mantissa as written: "1.60×10^8" has 3, "8.5E+37" has 2.
 */
export function writtenSigfigs(text: string): number | undefined {
  const m = /^[-+]?(\d+(?:\.\d+)?)\s*(?:[×x·⋅*]\s*10\^|[eE])/.exec(text.trim());
  if (!m) return undefined;
  const digits = m[1]!.replace('.', '').replace(/^0+/, '');
  return Math.max(1, digits.length);
}

/** Presentation of a pinned value: as many decimals (or significant figures) as the source printed. */
function presentation(text: string | undefined): { decimals?: number; sigfigs?: number } {
  if (text === undefined) return {};
  const decimals = writtenDecimals(text);
  if (decimals !== undefined) return { decimals };
  const sigfigs = writtenSigfigs(text);
  return sigfigs !== undefined ? { sigfigs } : {};
}

const HOW_MANY = /\bhow many\b/i;
const EXACT_UNIT = /\b(express|convert|in units(?: of)?\b|answer in|give (?:the|your) answer in|in (?:km\/h|cm|mm|g\/cm|cm\^|in\^|hectares|liters|L\b))/i;

type RawScenario = Record<string, unknown> & {
  vars?: { name: string; unit?: string }[];
  parts: Record<string, unknown>[];
  figure?: Record<string, unknown>;
};

export function fixedScenarioFromDraft(draft: Draft): FixedResult {
  if (!draft.answer) return { ok: false, reason: 'no-answer', message: `${draft.label} has no printed answer` };
  if (draft.figures.some((f) => f.role === 'inline')) {
    return { ok: false, reason: 'inline-image', message: `${draft.label} has a picture inside its text` };
  }
  const { value, unit } = draft.answer;
  if (unit !== undefined && tryParseUnit(unit) === null) {
    return { ok: false, reason: 'unit-unparseable', message: `${draft.label}: cannot parse the printed unit "${unit}"` };
  }

  const s = structuredClone(draft.scenario) as RawScenario;
  s.id = `${FIXED_ID_PREFIX}${String(s.id)}`;
  s.vars = (s.vars ?? []).map((v) => {
    const lit = draft.literals.find((l) => l.name === v.name);
    return {
      name: v.name,
      kind: 'choice',
      options: [lit?.value ?? 0],
      ...presentation(lit?.text),
      ...(v.unit !== undefined && { unit: v.unit }),
    };
  });

  const prompt = String(s.parts[0]?.prompt ?? '');
  const integer = unit === undefined && Number.isInteger(value) && HOW_MANY.test(prompt);
  s.parts = s.parts.map((p) => {
    const { answer: _todo, tolerance: _tol, ...rest } = p;
    return {
      ...rest,
      answer: String(value),
      ...(integer ? { integer: true } : { tolerance: { rel: 0.01 } }),
      ...(unit !== undefined && EXACT_UNIT.test(String(p.prompt ?? '')) && { exactUnit: true }),
    };
  });
  if (s.figure && String(s.figure.alt ?? '').startsWith('TODO')) s.figure.alt = `Figure for ${draft.label}`;

  const parsed = safeParseScenario(s);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    return { ok: false, reason: 'invalid', message: `${draft.label}: ${first ? `${first.path.join('.')}: ${first.message}` : 'invalid'}` };
  }
  const scenario = parsed.value;
  const error = diagnoseScenario(scenario).find((d) => d.severity === 'error');
  if (error) return { ok: false, reason: 'invalid', message: `${draft.label}: ${error.path.join('.')}: ${error.message}` };
  if (!checkCanonical(scenario).ok) {
    return { ok: false, reason: 'canonical-fail', message: `${draft.label}: the printed answer does not reproduce` };
  }
  try {
    instantiate(scenario, 0);
  } catch (e) {
    return { ok: false, reason: 'invalid', message: `${draft.label}: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, scenario };
}
