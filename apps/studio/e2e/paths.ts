import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Throwaway content root the e2e Studio runs against (reset on every run). */
export const E2E_ROOT = join(tmpdir(), 'pt-studio-e2e');
export const PORT = 5299;
