import { NotFoundError } from '@pt/core';
import { error } from '@sveltejs/kit';
import { scenarioFromDraft } from '$lib/server/drafts.js';
import { getRepository } from '$lib/server/repository.js';
import type { PageServerLoad } from './$types';

/** Open an imported draft in the editor as a new scenario. */
export const load: PageServerLoad = async ({ params }) => {
  const repo = await getRepository();
  let set;
  try {
    set = await repo.getSet(params.setId);
  } catch (e) {
    if (e instanceof NotFoundError) error(404, e.message);
    throw e;
  }
  const scenario = scenarioFromDraft(set.id, params.label);
  if (!scenario) error(404, `No draft ${params.label} in ${set.id}`);
  return { setId: set.id, setTitle: set.title, sections: set.sections, scenario, draft: params.label };
};
