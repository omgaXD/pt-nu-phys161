// Root entry point: `pnpm vitest` from the repo root runs every project.
// (Vitest 4+ replaced `vitest.workspace.ts` with `test.projects`.)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
