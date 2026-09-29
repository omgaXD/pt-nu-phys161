import type { InstancePart, PartResponse } from '@pt/core';

/** What the answer inputs of one part currently hold. */
export interface PartAnswer {
  /** The value field, or the whole "number unit" text in combined mode. */
  value: string;
  /** The separate unit field (empty in combined mode). */
  unit: string;
}

export const emptyAnswer = (): PartAnswer => ({ value: '', unit: '' });

/** Turn field contents into the response shape `gradePart` expects. */
export function toResponse(part: Pick<InstancePart, 'slots'>, answer: PartAnswer | undefined): PartResponse | undefined {
  if (!answer || (answer.value.trim() === '' && answer.unit.trim() === '')) return undefined;
  if (part.slots.some((s) => s.kind === 'combined')) return { combined: answer.value };
  return { value: answer.value, unit: answer.unit };
}
