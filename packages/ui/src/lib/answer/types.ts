import { type FieldContents, responseFromFields } from '@pt/core';

/** What the answer inputs of one part currently hold (see `FieldContents` in @pt/core). */
export type PartAnswer = FieldContents;

export const emptyAnswer = (): PartAnswer => ({ value: '', unit: '' });

/** Turn field contents into the response shape `gradePart` expects. */
export const toResponse = responseFromFields;
