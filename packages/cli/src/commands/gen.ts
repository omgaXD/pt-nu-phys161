import { instantiate, instantiateAt, type ProblemInstance } from '@pt/core';
import { CliError, type Context, fmtNumber, loadScenario, paint } from '../context.js';
import { instanceToPlain } from '../plain.js';

export interface GenOptions {
  seed?: number;
  json?: boolean;
  /** Evaluate at the canonical source values instead of a seed. */
  canonical?: boolean;
}

/** Print the rendered instance and model answers for one seed. */
export async function runGen(ctx: Context, arg: string, opts: GenOptions = {}): Promise<number> {
  const s = await loadScenario(ctx, arg);
  let inst: ProblemInstance;
  if (opts.canonical) {
    const randoms = Object.fromEntries(Object.entries(s.canonical.vars).filter(([k]) => s.vars.some((v) => v.name === k)));
    inst = instantiateAt(s, randoms);
  } else {
    if (opts.seed === undefined) throw new CliError('--seed <n> is required (or --canonical)');
    inst = instantiate(s, opts.seed);
  }
  const o = ctx.output;
  if (opts.json) {
    o.out(JSON.stringify(inst, null, 2));
    return 0;
  }
  o.out(paint(o, 'bold', `${s.id} @ ${opts.canonical ? 'canonical values' : `seed ${opts.seed}`}`));
  o.out('');
  o.out(instanceToPlain(inst));
  o.out('');
  o.out(paint(o, 'dim', 'values: ') + Object.entries(inst.values).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' '));
  inst.parts.forEach((p, i) => {
    const flags = [p.answerType !== 'numeric' ? p.answerType : '', p.integer ? 'integer' : ''].filter(Boolean).join(', ');
    o.out(
      `${paint(o, 'cyan', `answer (${String.fromCharCode(97 + i)}) ${p.partId}:`)} ${fmtNumber(p.modelAnswer)}${p.unit ? ` ${p.unit}` : ''}${flags ? paint(o, 'dim', ` [${flags}]`) : ''}`,
    );
  });
  return 0;
}
