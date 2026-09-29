import { describeRepositoryConformance } from '@pt/core/testing';
import { FsRepository } from '../src/index.ts';
import { tempDir, writeSeed } from './helpers.ts';

describeRepositoryConformance('FsRepository', async (seed) => {
  const { dir, cleanup } = tempDir();
  writeSeed(dir, seed);
  return { repo: new FsRepository({ root: dir }), cleanup };
});
