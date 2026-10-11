import { sveltekit } from '@sveltejs/kit/vite';
import { defaultClientConditions, defaultServerConditions, loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages (@pt/*) to their TypeScript sources.
const source = '@pt/source';

export default defineConfig(({ mode }) => {
  // The project's repository (e.g. https://github.com/<owner>/<repo>), from the environment or .env.
  const { PUBLIC_REPO_URL } = loadEnv(mode, process.cwd(), 'PUBLIC_');
  return {
    plugins: [sveltekit()],
    define: { __REPO_URL__: JSON.stringify(PUBLIC_REPO_URL || null) },
    resolve: { conditions: [source, ...defaultClientConditions] },
    ssr: {
      resolve: {
        conditions: [source, ...defaultServerConditions],
        externalConditions: [source],
      },
      noExternal: [/^@pt\//],
    },
    test: {
      name: 'quiz-app',
      include: ['test/**/*.test.ts'],
    },
  };
});
