import { z } from 'zod';
import { ID_RE } from './scenario.js';

/** A named collection of scenarios with ordered sections. */
export const SetDocSchema = z.strictObject({
  id: z.string().regex(ID_RE),
  title: z.string().min(1),
  description: z.string().optional(),
  source: z.strictObject({ document: z.string().min(1) }).optional(),
  /** Ordered section names; `scenario.section` refers to one of these. */
  sections: z.array(z.string().min(1)).default([]),
  /** Display order of scenario ids; unlisted scenarios follow, sorted by id. */
  order: z.array(z.string()).optional(),
});

export type SetDoc = z.infer<typeof SetDocSchema>;
export type SetDocInput = z.input<typeof SetDocSchema>;
