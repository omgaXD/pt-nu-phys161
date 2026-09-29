// Reset the e2e content root: a copy of the corpus plus an empty "e2e" set.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(tmpdir(), 'pt-studio-e2e');
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/corpus');
rmSync(root, { recursive: true, force: true });
cpSync(fixtures, join(root, 'corpus'), { recursive: true });
mkdirSync(join(root, 'e2e', 'scenarios'), { recursive: true });
writeFileSync(join(root, 'e2e', 'set.yaml'), 'id: e2e\ntitle: E2E set\nsections: [ Work, Statics ]\n');
// Imported drafts (the `pt import` → Studio authoring loop), via the built CLI.
const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '../../../packages/cli/dist/bin.js');
if (!existsSync(cli)) throw new Error('build the CLI first: pnpm -r build');
execFileSync(process.execPath, [cli, '--root', root, 'import', join(here, '../../../packages/cli/test/fixtures/source.html'), '--set', 'demo'], {
  stdio: 'inherit',
});
console.log(`e2e content root ready at ${root}`);
