import { join } from 'node:path';
import { toStorable } from '@pt/core';
import { FsRepository } from '@pt/store-fs';
import { workspaceRoot } from '$lib/server/repository.js';
import type { PageServerLoad } from './$types';

/** The gallery always renders against the reference corpus fixtures. */
export const load: PageServerLoad = async () => {
  const repo = new FsRepository({ root: join(workspaceRoot(), 'fixtures') });
  const ids = ['c01-push-work', 'c03-luggage-ramp', 'c04-meteor', 'c06-vector-work', 'c07-quartic-potential', 'c10-bounce-energy-fraction', 'c11-railroad-cars'];
  const scenarios = await Promise.all(ids.map(async (id) => toStorable(await repo.getScenario(id))));
  return { scenarios };
};
