import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Throwaway content root and static directory the e2e build uses (reset on every run). */
export const E2E_ROOT = join(tmpdir(), 'pt-quiz-e2e');
export const E2E_STATIC = join(tmpdir(), 'pt-quiz-e2e-static');
export const PORT = 5399;
/** Served under a sub-path, as on GitHub Pages, so absolute URLs would break the tests. */
export const BASE = '/pt';
