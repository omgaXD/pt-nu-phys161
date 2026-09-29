import { NotFoundError, type ScenarioQuery } from '@pt/core';
import { error } from '@sveltejs/kit';
import { listDrafts } from '$lib/server/drafts.js';
import { getRepository } from '$lib/server/repository.js';
import { scenarioStatus } from '$lib/server/status.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  const repo = await getRepository();
  let set;
  try {
    set = await repo.getSet(params.setId);
  } catch (e) {
    if (e instanceof NotFoundError) error(404, `No set "${params.setId}"`);
    throw e;
  }

  const f = {
    section: url.searchParams.get('section') ?? '',
    tag: url.searchParams.get('tag') ?? '',
    difficulty: url.searchParams.get('difficulty') ?? '',
    status: url.searchParams.get('status') ?? '',
    text: url.searchParams.get('q') ?? '',
  };
  const q: ScenarioQuery = { setId: set.id };
  if (f.section) q.section = f.section;
  if (f.tag) q.tags = [f.tag];
  if (f.difficulty) q.difficulty = { min: Number(f.difficulty), max: Number(f.difficulty) };
  if (f.text) q.text = f.text;

  const all = await repo.listScenarios({ setId: set.id });
  const rows = [];
  const tags = new Set<string>();
  for (const summary of await repo.listScenarios(q)) {
    const s = await repo.getScenario(summary.id);
    const status = scenarioStatus(s);
    if (f.status && status !== f.status) continue;
    rows.push({ ...summary, status });
  }
  for (const summary of all) summary.tags.forEach((t) => tags.add(t));

  const drafts = listDrafts(set.id);
  const taken = new Set(all.flatMap((r) => r.sourceLabels));
  return {
    set,
    rows,
    total: all.length,
    tags: [...tags].sort(),
    filters: f,
    drafts: drafts.filter((d) => !taken.has(d.label)),
  };
};
