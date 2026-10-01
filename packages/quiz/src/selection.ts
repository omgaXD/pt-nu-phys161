import { type CatalogQuestion, sectionSlug } from './bundle.js';
import type { QuizConfig } from './config.js';

/**
 * Choosing content inside a set: sections, then problems within them. A set
 * selects every section unless `sections` lists some (an empty list selects
 * none); `exclude` names problems left out of the selected sections. These
 * helpers keep the two consistent: a section's exclusions go when it is
 * toggled, and leaving out its last problem turns the section off.
 */
type Selection = Pick<QuizConfig, 'sections' | 'exclude'>;

/** Source order for problem labels ("P2" before "P10"). */
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

export function isSectionOn(config: Selection, setId: string, sectionId: string): boolean {
  const chosen = config.sections[setId];
  return !chosen || chosen.includes(sectionId);
}

export function isProblemOn(config: Selection, q: CatalogQuestion): boolean {
  return isSectionOn(config, q.setId, sectionSlug(q.section)) && !(config.exclude[q.setId] ?? []).includes(q.label);
}

export interface SectionSelection {
  selected: number;
  total: number;
  state: 'all' | 'some' | 'none';
}

/** How much of a section is selected (`questions`: the set's questions). */
export function sectionSelection(config: Selection, setId: string, sectionId: string, questions: readonly CatalogQuestion[]): SectionSelection {
  const inSection = questions.filter((q) => sectionSlug(q.section) === sectionId);
  if (!isSectionOn(config, setId, sectionId)) return { selected: 0, total: inSection.length, state: 'none' };
  const selected = inSection.filter((q) => isProblemOn(config, q)).length;
  return { selected, total: inSection.length, state: selected === inSection.length ? 'all' : selected === 0 ? 'none' : 'some' };
}

function withSections<C extends Selection>(config: C, setId: string, chosen: string[] | undefined): C {
  const sections = { ...config.sections };
  if (chosen) sections[setId] = chosen;
  else delete sections[setId];
  return { ...config, sections };
}

function withExcluded<C extends Selection>(config: C, setId: string, labels: readonly string[]): C {
  const exclude = { ...config.exclude };
  if (labels.length > 0) exclude[setId] = [...new Set(labels)].sort(compareLabels);
  else delete exclude[setId];
  return { ...config, exclude };
}

function labelsIn(questions: readonly CatalogQuestion[], sectionId: string): string[] {
  return questions.filter((q) => sectionSlug(q.section) === sectionId).map((q) => q.label);
}

/** Turn a section on (every problem in it) or off. `sectionIds`: the set's sections; `questions`: its questions. */
export function toggleSection<C extends Selection>(
  config: C,
  setId: string,
  sectionId: string,
  on: boolean,
  sectionIds: readonly string[],
  questions: readonly CatalogQuestion[],
): C {
  const current = sectionIds.filter((s) => isSectionOn(config, setId, s));
  const next = on ? sectionIds.filter((s) => s === sectionId || current.includes(s)) : current.filter((s) => s !== sectionId);
  const dropped = new Set(labelsIn(questions, sectionId));
  const c = withSections(config, setId, next.length === sectionIds.length ? undefined : next);
  return withExcluded(c, setId, (config.exclude[setId] ?? []).filter((l) => !dropped.has(l)));
}

/** Every section of a set (with every problem), or none. */
export function setAllSections<C extends Selection>(config: C, setId: string, on: boolean): C {
  return withExcluded(withSections(config, setId, on ? undefined : []), setId, []);
}

/**
 * Include or leave out one problem. Including one from a section that is off
 * turns the section on with just that problem; leaving out a section's last
 * problem turns the section off.
 */
export function toggleProblem<C extends Selection>(
  config: C,
  q: CatalogQuestion,
  on: boolean,
  sectionIds: readonly string[],
  questions: readonly CatalogQuestion[],
): C {
  const sectionId = sectionSlug(q.section);
  const inSection = labelsIn(questions, sectionId);
  const excluded = config.exclude[q.setId] ?? [];
  if (!isSectionOn(config, q.setId, sectionId)) {
    if (!on) return config;
    const c = toggleSection(config, q.setId, sectionId, true, sectionIds, questions);
    return withExcluded(c, q.setId, [...(c.exclude[q.setId] ?? []), ...inSection.filter((l) => l !== q.label)]);
  }
  if (on) return withExcluded(config, q.setId, excluded.filter((l) => l !== q.label));
  const next = [...excluded, q.label];
  if (inSection.every((l) => next.includes(l))) return toggleSection(config, q.setId, sectionId, false, sectionIds, questions);
  return withExcluded(config, q.setId, next);
}
