import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

const conditions = ['@pt/source', 'svelte', 'browser', 'module', 'development|production'];

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: { conditions },
  test: {
    name: 'ui',
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
