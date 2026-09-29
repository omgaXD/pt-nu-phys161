import { NotFoundError, type ScenarioInput } from '@pt/core';
import { error } from '@sveltejs/kit';
import { getRepository } from '$lib/server/repository.js';
import type { PageServerLoad } from './$types';

function skeleton(setId: string, section: string | undefined): ScenarioInput {
  return {
    id: `${setId}-new`,
    ...(section !== undefined && { section }),
    narrative: 'A block of mass {m:unit} hangs at rest from a rope.',
    vars: [{ name: 'm', kind: 'range', min: 1, max: 10, step: 0.5, decimals: 1, unit: 'kg' }],
    derived: [{ name: 'g', expr: '9.8', unit: 'm/s^2' }],
    parts: [{ id: 'tension', prompt: 'What is the tension in the rope? {_0}{_u}', answer: 'm * g', unit: 'N', tolerance: { rel: 0.01 } }],
    canonical: { vars: { m: 2, g: 9.8 }, parts: [{ id: 'tension', answer: 19.6, unit: 'N' }] },
  };
}

export const load: PageServerLoad = async ({ params }) => {
  const repo = await getRepository();
  let set;
  try {
    set = await repo.getSet(params.setId);
  } catch (e) {
    if (e instanceof NotFoundError) error(404, e.message);
    throw e;
  }
  return { setId: set.id, setTitle: set.title, sections: set.sections, scenario: skeleton(set.id, set.sections[0]) };
};
