import { sveltekit } from '@sveltejs/kit/vite';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages (@pt/*) to their TypeScript sources.
const source = '@pt/source';

export default defineConfig({
  plugins: [sveltekit()],
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
});
