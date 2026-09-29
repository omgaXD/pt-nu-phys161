import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenario, toStorable } from '@pt/core';
import { updateDocumentText } from '@pt/store-fs';
import { type Context, paint } from '../context.js';

/**
 * Rewrite scenario files in canonical form (what the repository writes), so
 * saving from Studio later produces no formatting noise. `--check` only reports.
 */
export async function runFmt(ctx: Context, setId: string | undefined, opts: { check?: boolean } = {}): Promise<number> {
  const o = ctx.output;
  const rows = await ctx.repo.listScenarios(setId ? { setId } : {});
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
