import { type AnswerType, splitCombinedAnswer, tryParseUnit, unitToTex, validateAnswer } from '@pt/core';

export type FieldValidation = { ok: true; latex: string } | { ok: false; error: string };

/**
 * Validate a value field, or a combined "number unit" field. Null means there
 * is nothing to show: a bare number in a combined field gets neither preview
 * nor warning, as in Moodle, so the missing unit is not hinted at.
 */
export function validateField(input: string, answerType: AnswerType, withUnit: boolean): FieldValidation | null {
  if (!withUnit) {
    const r = validateAnswer(input, answerType);
    return r.ok ? { ok: true, latex: r.latex } : { ok: false, error: r.error };
  }
  const { value, unit } = splitCombinedAnswer(input, answerType);
  if (unit === '') {
    // No usable unit. A valid number followed by unit-like text means the
    // unit is what's wrong ("191.88 m/s/s"), not the number.
    const m = /^(.*?[\d).\s])\s*([\p{L}µ°Ω].*)$/u.exec(input.trim());
    if (m && validateAnswer(m[1]!, answerType).ok) return { ok: false, error: 'unit-syntax' };
    const r = validateAnswer(value, answerType);
    return r.ok ? null : { ok: false, error: r.error };
  }
  const r = validateAnswer(value, answerType);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, latex: `${r.latex}\\ ${unitToTex(unit)}` };
}

export function validateUnitField(input: string): FieldValidation {
  if (input.trim() === '') return { ok: false, error: 'unit-missing' };
  return tryParseUnit(input) ? { ok: true, latex: unitToTex(input) } : { ok: false, error: 'unit-syntax' };
}
