import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenario, toStorable } from '@pt/core';
import { updateDocumentText } from '@pt/store-fs';
import { CliError, type Context, paint } from '../context.js';

/**
 * Rewrite scenario files in canonical form (what the repository writes), so
 * saving from Studio later produces no formatting noise. `targets` are set ids
 * or scenario ids (default: everything). `--check` only reports.
 */
export async function runFmt(ctx: Context, targets: string | string[] | undefined, opts: { check?: boolean } = {}): Promise<number> {
  const o = ctx.output;
  const list = targets === undefined ? [] : Array.isArray(targets) ? targets : [targets];
  const sets = new Set((await ctx.repo.listSets()).map((s) => s.id));
  const all = await ctx.repo.listScenarios({});
  const rows = list.length === 0 ? all : all.filter((r) => list.includes(r.setId) || list.includes(r.id));
  const unknown = list.filter((t) => !sets.has(t) && !all.some((r) => r.id === t));
  if (unknown.length > 0) throw new CliError(`no set or scenario ${unknown.join(', ')}`);
  const changed: string[] = [];
  for (const row of rows) {
    const file = join(ctx.root, row.setId, 'scenarios', `${row.id}.yaml`);
    const before = readFileSync(file, 'utf8');
    const s = await ctx.repo.getScenario(row.id);
    if (updateDocumentText(before, toStorable(parseScenario(s))) === before) continue;
    changed.push(`${row.setId}/scenarios/${row.id}.yaml`);
    if (!opts.check) await ctx.repo.putScenario(s);
  }
  for (const f of changed) o.out(`${opts.check ? paint(o, 'yellow', 'would format') : paint(o, 'green', 'formatted')} ${f}`);
  o.out(`${rows.length} file(s) checked, ${changed.length} ${opts.check ? 'not formatted' : 'formatted'}`);
  return opts.check && changed.length > 0 ? 1 : 0;
}
