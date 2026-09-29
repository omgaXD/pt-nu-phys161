// Reset the e2e content: the reference corpus (authored, randomized) plus the
// demo import (drafts → fixed questions), bundled into a separate static dir.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const root = join(tmpdir(), 'pt-quiz-e2e');
const statics = join(tmpdir(), 'pt-quiz-e2e-static');
const cli = join(repo, 'packages/cli/dist/bin.js');
if (!existsSync(cli)) throw new Error('build the CLI first: pnpm -r build');

for (const d of [root, statics]) rmSync(d, { recursive: true, force: true });
cpSync(join(repo, 'fixtures/corpus'), join(root, 'corpus'), { recursive: true });
const pt = (...args) => execFileSync(process.execPath, [cli, '--root', root, ...args], { stdio: 'inherit' });
pt('import', join(repo, 'packages/cli/test/fixtures/source.html'), '--set', 'demo', '--title', 'Demo set');
mkdirSync(statics, { recursive: true });
copyFileSync(join(here, '../static/favicon.svg'), join(statics, 'favicon.svg'));
pt('bundle', '--out', join(statics, 'content'), '--strict');
console.log(`e2e content ready in ${statics}`);
