import { NotFoundError, toStorable } from '@pt/core';
import { error } from '@sveltejs/kit';
import { getRepository } from '$lib/server/repository.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const repo = await getRepository();
  try {
    const [set, scenario] = await Promise.all([repo.getSet(params.setId), repo.getScenario(params.scenarioId)]);
    return { setId: set.id, setTitle: set.title, sections: set.sections, scenario: toStorable(scenario) };
  } catch (e) {
    if (e instanceof NotFoundError) error(404, e.message);
    throw e;
  }
};
