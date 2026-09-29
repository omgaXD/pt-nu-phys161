import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assetRef, toStorable } from '@pt/core';
import {
  BUNDLE_FORMAT,
  type BundleIndex,
  BundleIndexSchema,
  type BundleSection,
  type BundleSet,
  BundleSetSchema,
  type BundleSetSummary,
  sectionSlug,
} from '@pt/quiz';
import { buildSetCatalog, type CatalogIssue, STRICT_ISSUES } from '../bundle/catalog.js';
import { CliError, type Context, paint } from '../context.js';

export interface BundleOptions {
  /** Output directory (index.json, sets/, assets/). */
  out: string;
  /** Include fixed-values questions for problems without an authored scenario (default true). */
  fixed?: boolean;
  /** Fail on inconsistent content instead of skipping it. */
  strict?: boolean;
  json?: boolean;
}

export interface BundleResult {
  index: BundleIndex;
  issues: { setId: string; issue: CatalogIssue }[];
  files: number;
}

const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/**
 * Write the quiz app's static content: every playable question of the chosen
 * sets (authored parts, else fixed fallbacks), the scenarios they use, and
 * their figures. Byte-stable: no timestamps, deterministic order, so an
 * unchanged content tree gives an unchanged bundle (and content version).
 */
export async function writeBundle(ctx: Context, setIds: string[], opts: BundleOptions): Promise<BundleResult> {
  const out = resolve(opts.out);
  const known = (await ctx.repo.listSets()).map((s) => s.id).sort();
  const ids = setIds.length > 0 ? setIds : known;
  for (const id of ids) if (!known.includes(id)) throw new CliError(`no set "${id}" under ${ctx.root}`);

  for (const stale of ['index.json', 'sets', 'assets']) rmSync(join(out, stale), { recursive: true, force: true });

  const summaries: BundleSetSummary[] = [];
  const issues: BundleResult['issues'] = [];
  let files = 0;

  for (const setId of ids) {
    const c = await buildSetCatalog(ctx.repo, ctx.root, setId, { fixed: opts.fixed !== false });
    for (const issue of c.issues) issues.push({ setId, issue });

    const used = [...new Set(c.questions.map((q) => q.scenarioId))].sort();
    const scenarios: BundleSet['scenarios'] = {};
    const figures = new Set(c.references.map((r) => r.src));
    for (const id of used) {
      const s = c.scenarios.get(id)!;
      const storable = toStorable(s);
      scenarios[id] = { hash: sha(JSON.stringify(storable)), scenario: storable };
      if (s.figure) figures.add(s.figure.src);
    }
    const body = { questions: c.questions, scenarios, references: c.references };
    const version = sha(JSON.stringify(body));
    const set: BundleSet = BundleSetSchema.parse({ format: BUNDLE_FORMAT, setId, version, ...body });
    write(join(out, 'sets', `${setId}.json`), JSON.stringify(set));
    files++;

    for (const src of [...figures].sort()) {
      const asset = await ctx.repo.resolveAsset(assetRef(setId, src));
      write(join(out, 'assets', setId, src), await asset.read());
      files++;
    }

    const sections = new Map<string, BundleSection>();
    const row = (name: string | undefined): BundleSection => {
      const id = sectionSlug(name);
      let r = sections.get(id);
      if (!r) sections.set(id, (r = { id, name: name ?? 'Other', questions: 0, authored: 0, fixed: 0 }));
      return r;
    };
    for (const name of c.set.sections) row(name);
    for (const q of c.questions) {
      const r = row(q.section);
      r.questions++;
      r[q.kind]++;
    }
    const authored = c.questions.filter((q) => q.kind === 'authored').length;
    summaries.push({
      id: setId,
      title: c.set.title,
      ...(c.set.source?.document !== undefined && { document: c.set.source.document }),
      version,
      questions: c.questions.length,
      authored,
      fixed: c.questions.length - authored,
      missing: c.missing.length,
      sections: [...sections.values()].filter((s) => s.questions > 0),
    });
  }

  const index: BundleIndex = BundleIndexSchema.parse({
    format: BUNDLE_FORMAT,
    version: sha(summaries.map((s) => `${s.id}:${s.version}`).join('\n')),
    sets: summaries,
  });
  write(join(out, 'index.json'), JSON.stringify(index));
  files++;
  return { index, issues, files };
}

export async function runBundle(ctx: Context, setIds: string[], opts: BundleOptions): Promise<number> {
  const r = await writeBundle(ctx, setIds, opts);
  const failing = r.issues.filter((x) => STRICT_ISSUES.has(x.issue.code));
  const code = opts.strict && failing.length > 0 ? 1 : 0;
  const o = ctx.output;
  if (opts.json) {
    o.out(JSON.stringify({ ok: failing.length === 0, version: r.index.version, sets: r.index.sets, issues: r.issues, files: r.files }, null, 2));
    return code;
  }
  for (const s of r.index.sets) {
    o.out(`${paint(o, 'green', '✓')} ${s.id}: ${s.questions} question(s) (${s.authored} randomized, ${s.fixed} source values)${s.missing ? paint(o, 'yellow', `, ${s.missing} not playable`) : ''}`);
  }
  for (const { setId, issue } of r.issues) {
    const bad = STRICT_ISSUES.has(issue.code);
    o.out(paint(o, bad ? 'red' : 'yellow', `  ${bad ? '✗' : '!'} ${setId}: ${issue.message} [${issue.code}]`));
  }
  o.out(`  ${r.files} file(s) → ${resolve(opts.out)} (content version ${r.index.version})`);
  return code;
}
