import { variantBreakdown } from '@pt/core';
import { type Context, loadScenario, paint } from '../context.js';

/** Print how many distinct problems a scenario can generate. */
export async function runVariants(ctx: Context, arg: string, opts: { json?: boolean } = {}): Promise<number> {
  const s = await loadScenario(ctx, arg);
  const b = variantBreakdown(s);
  const o = ctx.output;
  if (opts.json) {
    o.out(JSON.stringify({ scenarioId: s.id, ...b, constrained: s.constraints.length > 0 }, null, 2));
    return 0;
  }
  o.out(`${paint(o, 'bold', s.id)}: ${b.total.toLocaleString('en-US')} variant(s)${b.total === Number.MAX_SAFE_INTEGER ? ' (clamped)' : ''}`);
  const width = Math.max(0, ...b.vars.map((v) => v.name.length));
  for (const v of b.vars) {
    const def = s.vars.find((x) => x.name === v.name)!;
    const spec =
      def.kind === 'range'
        ? `range ${def.min}..${def.max}${def.step !== undefined ? ` step ${def.step}` : ''}`
        : `choice of ${def.options.length}`;
    o.out(`  ${v.name.padEnd(width)}  ${String(v.count).padStart(8)}  ${paint(o, 'dim', spec)}`);
  }
  if (s.constraints.length > 0) {
    o.out(paint(o, 'dim', `  (before constraints; see \`pt fuzz ${s.id}\` for the rejection rate)`));
  }
  return 0;
}
