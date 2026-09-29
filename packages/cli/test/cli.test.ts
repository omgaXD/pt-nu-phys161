import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { main, memoryOutput } from '../src/index.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function tempCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pt-cli-'));
  temps.push(dir);
  cpSync(join(FIXTURES, 'corpus'), join(dir, 'corpus'), { recursive: true });
  return dir;
}

async function pt(...args: string[]) {
  const o = memoryOutput();
  const code = await main(args, o);
  return { code, out: o.text(), err: o.stderr.join('\n') };
}

describe('pt check (M8)', () => {
  it('is green over every corpus scenario', async () => {
    const r = await pt('--root', FIXTURES, 'check');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^21 scenario\(s\) OK$/m);
    for (let i = 1; i <= 14; i++) expect(r.out).toContain(`✓ c${String(i).padStart(2, '0')}-`);
  });

  it('fails (exit 1) on a transcription error and says which part', async () => {
    const root = tempCorpus();
    const file = join(root, 'corpus/scenarios/c03-luggage-ramp.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('answer: -mu * N * d', 'answer: -mu * N'));
    const r = await pt('--root', root, 'check');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/✗ c03-luggage-ramp/);
    expect(r.out).toMatch(/✗ work-by-friction \(P13\): computed -54\.5\d+ expected -190\.796 J/);
    expect(r.out).toMatch(/1 of 21 scenario\(s\) failing/);
  });

  it('reports unreadable files as failures', async () => {
    const root = tempCorpus();
    writeFileSync(join(root, 'corpus/scenarios/broken.yaml'), 'id: broken\nnarrative: [\n');
    const r = await pt('--root', root, 'check');
    expect(r.code).toBe(1);
    expect(r.out).toContain('✗ corpus/scenarios/broken.yaml');
  });

  it('checks explicit ids and YAML file paths; --json is machine-readable', async () => {
    const file = join(FIXTURES, 'corpus/scenarios/c01-push-work.yaml');
    const r = await pt('--root', FIXTURES, 'check', 'c11-railroad-cars', file, '--json');
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out) as { ok: boolean; scenarios: { id: string; ok: boolean }[] };
    expect(json.scenarios.map((s) => [s.id, s.ok])).toEqual([
      ['c11-railroad-cars', true],
      ['c01-push-work', true],
    ]);
    expect((await pt('--root', FIXTURES, 'check', 'no-such-scenario')).code).toBe(1);
  });

  it('can tolerate drafts', async () => {
    const root = tempCorpus();
    const file = join(root, 'corpus/scenarios/c01-push-work.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('answer: F * d', 'answer: F * d * 2') + 'draft: true\n');
    expect((await pt('--root', root, 'check')).code).toBe(1);
    expect((await pt('--root', root, 'check', '--allow-drafts')).code).toBe(0);
  });
});

describe('pt gen / variants / fuzz (M8)', () => {
  it('gen prints the instance and model answers', async () => {
    const r = await pt('--root', FIXTURES, 'gen', 'c03-luggage-ramp', '--seed', '42');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^c03-luggage-ramp @ seed 42$/m);
    expect(r.out).toMatch(/A luggage handler pulls a 16-kg suitcase/);
    expect(r.out).toMatch(/\(a\) Calculate the work done on the suitcase by the force \$F\$\. \[answer J\]/);
    expect(r.out).toMatch(/answer \(c\) work-by-gravity: 309\.17519 J/);
  });

  it('gen --canonical evaluates at the source values; --json emits the instance', async () => {
    const r = await pt('--root', FIXTURES, 'gen', 'c03-luggage-ramp', '--canonical');
    expect(r.out).toMatch(/work-by-gravity: 372\.49614 J/);
    const j = await pt('--root', FIXTURES, 'gen', 'c11-railroad-cars', '--seed', '0', '--json');
    const inst = JSON.parse(j.out) as { seed: number; parts: { integer?: boolean }[] };
    expect(inst.seed).toBe(0);
    expect(inst.parts[0]!.integer).toBe(true);
    expect((await pt('--root', FIXTURES, 'gen', 'c01-push-work')).code).toBe(1); // needs --seed
  });

  it('variants prints the count and breakdown', async () => {
    const r = await pt('--root', FIXTURES, 'variants', 'c03-luggage-ramp');
    expect(r.out).toContain('c03-luggage-ramp: 2,088,450 variant(s)');
    expect(r.out).toMatch(/mu\s+21\s+range 0\.25\.\.0\.45 step 0\.01/);
    const j = JSON.parse((await pt('--root', FIXTURES, 'variants', 'c01-push-work', '--json')).out) as { total: number };
    expect(j.total).toBe(141 * 41 * 601);
  });

  it('fuzz reports the constraint rejection rate', async () => {
    const r = await pt('--root', FIXTURES, 'fuzz', 'c08-bucket-box-gravel', '-n', '200', '--json');
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out) as { ok: boolean; rejectionRate: number; rejections: Record<string, number>; failures: unknown[] };
    expect(j.ok).toBe(true);
    expect(j.failures).toEqual([]);
    expect(j.rejectionRate).toBeGreaterThan(0.1);
    expect(Object.keys(j.rejections).every((k) => k.startsWith('constraint #'))).toBe(true);
  });

  it('fuzz fails on unsatisfiable constraints and non-integer integer answers', async () => {
    const root = tempCorpus();
    const file = join(root, 'corpus/scenarios/c11-railroad-cars.yaml');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('answer: n0 * k', 'answer: n0 * k / 7'));
    const r = await pt('--root', root, 'fuzz', 'c11-railroad-cars', '-n', '50');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/non-integer/);
    writeFileSync(file, text.replace('vars:', 'constraints: ["k > 100"]\nmaxSampleAttempts: 5\nvars:'));
    const u = await pt('--root', root, 'fuzz', 'c11-railroad-cars', '-n', '10');
    expect(u.code).toBe(1);
    expect(u.out).toMatch(/10 seed\(s\) exhausted maxSampleAttempts/);
  });
});

describe('pt lint / fmt (M8)', () => {
  it('lint is clean on the corpus', async () => {
    const r = await pt('--root', FIXTURES, 'lint', 'corpus');
    expect(r.code).toBe(0);
    expect(r.out).toBe('corpus: no errors');
  });

  it('finds the documented problems', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pt-lint-'));
    temps.push(root);
    const set = join(root, 'demo');
    mkdirSync(join(set, 'scenarios'), { recursive: true });
    mkdirSync(join(set, 'figures'), { recursive: true });
    writeFileSync(join(set, 'set.yaml'), 'title: Demo\nsections: [Work]\norder: [a, ghost]\n');
    writeFileSync(join(set, 'figures', 'orphan.png'), 'x');
    const base = (id: string, extra = ''): string =>
      `id: ${id}\nnarrative: A mass {m:unit}.\nvars:\n  - { name: m, kind: range, min: 1, max: 5, unit: kg }\n` +
      `parts:\n  - id: p\n    prompt: What is it?\n    answer: m\n    unit: kg\n${extra}`;
    writeFileSync(
      join(set, 'scenarios', 'a.yaml'),
      base('a', 'canonical:\n  vars: { m: 2 }\n  parts: [ { id: p, answer: 2, unit: kg } ]\nsection: Torque\n' +
        'figure: { id: f, src: figures/missing.png, alt: "" }\n'),
    );
    writeFileSync(join(set, 'scenarios', 'b.yaml'), base('b'));
    writeFileSync(join(set, 'scenarios', 'c.yaml'), base('a'));
    const r = await pt('--root', root, 'lint', 'demo', '--json');
    expect(r.code).toBe(1);
    const codes = (JSON.parse(r.out) as { findings: { code: string; file: string }[] }).findings.map((f) => `${f.code} ${f.file}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'figure-alt-missing demo/scenarios/a.yaml',
        'figure-file-missing demo/scenarios/a.yaml',
        'unknown-section demo/scenarios/a.yaml',
        'tolerance-missing demo/scenarios/a.yaml',
        'slot-missing demo/scenarios/a.yaml',
        'canonical-missing demo/scenarios/b.yaml',
        'id-file-mismatch demo/scenarios/c.yaml',
        'duplicate-id demo/scenarios/c.yaml',
        'figure-unreferenced demo/figures/orphan.png',
        'not-in-order demo/set.yaml',
        'order-unknown demo/set.yaml',
      ]),
    );
  });

  it('fmt --check passes on the corpus and fmt rewrites hand-formatted files', async () => {
    expect((await pt('--root', FIXTURES, 'fmt', '--check')).code).toBe(0);
    const root = tempCorpus();
    const file = join(root, 'corpus/scenarios/c01-push-work.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('tags: [ work, baseline ]', 'tags: [work,   baseline]'));
    expect((await pt('--root', root, 'fmt', '--check')).code).toBe(1);
    expect((await pt('--root', root, 'fmt')).code).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain('tags: [ work, baseline ]');
    expect((await pt('--root', root, 'fmt', '--check')).code).toBe(0);
  });
});

describe('pt program', () => {
  it('prints help', async () => {
    const r = await pt('--help');
    expect(r.code).toBe(0);
    for (const cmd of ['check', 'gen', 'fuzz', 'variants', 'lint', 'import', 'group', 'agent-task']) expect(r.out).toContain(cmd);
  });

  it('rejects bad arguments', async () => {
    expect((await pt('gen', 'x', '--seed', 'abc')).code).not.toBe(0);
    expect((await pt('nope')).code).not.toBe(0);
  });
});
