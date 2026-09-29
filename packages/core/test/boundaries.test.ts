// Guiding constraints §0.2 and §1: @pt/core knows nothing about how problems
// will be delivered, and does no I/O.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist') return [];
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

// Assembled so this file does not itself contain the words.
const FORBIDDEN = ['qu' + 'iz', 'ex' + 'am', 'att' + 'empt', 'sess' + 'ion'];
const WORD_RE = new RegExp(`\\b(${FORBIDDEN.join('|')})(s|zes|es)?\\b`, 'i');

describe('@pt/core boundaries', () => {
  it('never mentions delivery concepts (problems, instances, responses, grades only)', () => {
    const hits = files(ROOT)
      .filter((f) => /\.(ts|json|md)$/.test(f))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => WORD_RE.test(line)),
      )
      .map(({ f, i, line }) => `${f.slice(ROOT.length + 1)}:${i}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });

  it('source imports no Node built-ins, frameworks or sibling packages', () => {
    const bad = files(join(ROOT, 'src'))
      .filter((f) => f.endsWith('.ts'))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)]
          .map((m) => m[1]!)
          .filter((spec) => /^(node:|fs$|path$|svelte|@sveltejs|katex|@pt\/)/.test(spec))
          .map((spec) => `${f}: ${spec}`),
      );
    expect(bad).toEqual([]);
  });
});
