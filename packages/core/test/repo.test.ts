import { InMemoryRepository } from '../src/index.ts';
import { describeRepositoryConformance } from '../src/testing/index.ts';

describeRepositoryConformance('InMemoryRepository', async (seed) => ({ repo: new InMemoryRepository(seed) }));
