import { getRepository } from '$lib/server/repository.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const repo = await getRepository();
  return { sets: await repo.listSets(), store: process.env.PT_STORE ?? 'fs' };
};
