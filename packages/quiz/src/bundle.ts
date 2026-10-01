import { DifficultySchema } from '@pt/core';
import { z } from 'zod';

/**
 * The static content bundle the quiz app loads (written by `pt bundle`):
 *
 *   index.json          sets, sections and counts
 *   sets/<setId>.json   the set's questions (source order) and the scenarios they use
 *   assets/<setId>/…    figures
 */
export const BUNDLE_FORMAT = 1;

/** Section names become URL-safe ids: "Newton's 2nd law" → "newtons-2nd-law". */
export function sectionSlug(name: string | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'other';
}

export const CatalogQuestionSchema = z.object({
  /** `${setId}/${label}`: stable while a problem moves from fixed to authored. */
  key: z.string(),
  setId: z.string(),
  /** Source problem label, e.g. "P12". */
  label: z.string(),
  number: z.number(),
  section: z.string().optional(),
  /** authored: randomized scenario; fixed: the source's own numbers. */
  kind: z.enum(['authored', 'fixed']),
  scenarioId: z.string(),
  partId: z.string(),
  /** Variants of one situation share a family; a sampled draw takes one per family. */
  family: z.string(),
  /** Short title for listings (the scenario's, else the start of its text); absent in older bundles. */
  title: z.string().optional(),
  /** The part's authored difficulty (1–5); absent = unrated (fixed problems, unrated parts). Internal: shown only once a question is settled or reviewed. */
  difficulty: DifficultySchema.optional(),
});
export type CatalogQuestion = z.infer<typeof CatalogQuestionSchema>;

export const BundleSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  questions: z.number().int(),
  authored: z.number().int(),
  fixed: z.number().int(),
});
export type BundleSection = z.infer<typeof BundleSectionSchema>;

export const BundleSetSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  document: z.string().optional(),
  version: z.string(),
  questions: z.number().int(),
  authored: z.number().int(),
  fixed: z.number().int(),
  /** Source problems that are not playable yet (no answer, a picture in the text…). */
  missing: z.number().int(),
  sections: z.array(BundleSectionSchema),
});
export type BundleSetSummary = z.infer<typeof BundleSetSummarySchema>;

export const BundleIndexSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  /** Content version: changes whenever any set changes. */
  version: z.string(),
  sets: z.array(BundleSetSummarySchema),
});
export type BundleIndex = z.infer<typeof BundleIndexSchema>;

export const SectionReferenceSchema = z.object({ section: z.string(), src: z.string(), alt: z.string() });
export type SectionReference = z.infer<typeof SectionReferenceSchema>;

export const BundleSetSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  setId: z.string(),
  version: z.string(),
  /** Source order. */
  questions: z.array(CatalogQuestionSchema),
  /** Storable scenarios (validated with `parseScenario` when used), with a content hash each. */
  scenarios: z.record(z.string(), z.object({ hash: z.string(), scenario: z.unknown() })),
  /** Reference sheets for whole sections (e.g. a moment-of-inertia table). */
  references: z.array(SectionReferenceSchema).default([]),
});
export type BundleSet = z.infer<typeof BundleSetSchema>;

/** A set's questions as the selection logic sees them. */
export interface CatalogSet {
  setId: string;
  questions: readonly CatalogQuestion[];
}
