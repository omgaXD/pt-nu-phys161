// Shared Vitest settings: resolve workspace packages to their TypeScript
// sources (the "@pt/source" export condition) so tests never need a build.
import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';

const conditions = ['@pt/source', 'module', 'node', 'development|production'];

export function sharedConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(
    defineConfig({
      resolve: { conditions },
      ssr: { resolve: { conditions, externalConditions: ['@pt/source'] } },
      test: { include: ['test/**/*.test.ts'] },
    }),
    overrides,
  );
}
