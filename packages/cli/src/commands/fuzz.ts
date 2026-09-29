import { ConstraintUnsatisfiableError, CoreError, sampleScenario, buildInstance, type Scenario } from '@pt/core';
import { type Context, fmtNumber, loadScenario, paint } from '../context.js';

export interface FuzzOptions {
  n?: number;
  start?: number;
  json?: boolean;
  /**
   * Answers more than `band` times larger or smaller in magnitude than the
   * part's printed (canonical) answer are flagged. Default 1e6. Parts without
   * a canonical answer use the absolute band [1e-30, 1e30].
   */
  band?: number;
}

export interface FuzzPartStats {
  partId: string;
  min: number;
  max: number;
  zeros: number;
  outOfBand: number;
  nonInteger: number;
}

export interface FuzzResult {
  scenarioId: string;
  seeds: number;
  ok: boolean;
  failures: { seed: number; name: string; code: string; message: string }[];
  unsatisfiable: number;
  draws: number;
  /** Fraction of draws rejected by constraints / domain errors. */
  rejectionRate: number;
  rejections: Record<string, number>;
  distinctInstances: number;
  parts: FuzzPartStats[];
  warnings: string[];
}

/**
 * Instantiate across N seeds (§7): no NaN/∞, constraints satisfiable within
 * budget, answers inside a sane magnitude band, templates resolve. Reports
 * the constraint rejection rate — a high rate means badly chosen ranges.
 */
export function fuzzScenario(s: Scenario, opts: FuzzOptions = {}): FuzzResult {
  const n = opts.n ?? 500;
  const start = opts.start ?? 0;
  const band = opts.band ?? 1e6;
  // The printed answer sets the scale: 10^39 J is sane for binary stars, not for a push.
  const scale = new Map(
    s.parts.map((p) => {
      const ref = Math.abs(s.canonical.parts.find((c) => c.id === p.id)?.answer ?? 0);
      return [p.id, ref > 0 ? { lo: ref / band, hi: ref * band } : { lo: 1e-30, hi: 1e30 }];
    }),
  );
  const failures: FuzzResult['failures'] = [];
  const rejections: Record<string, number> = {};
  const distinct = new Set<string>();
  const parts = new Map<string, FuzzPartStats>(
    s.parts.map((p) => [p.id, { partId: p.id, min: Infinity, max: -Infinity, zeros: 0, outOfBand: 0, nonInteger: 0 }]),
  );
  let draws = 0;
  let accepted = 0;
  let unsatisfiable = 0;

  for (let seed = start; seed < start + n; seed++) {
    try {
      const sample = sampleScenario(s, seed);
      draws += sample.draws;
      accepted++;
      for (const [k, v] of Object.entries(sample.rejections)) rejections[k] = (rejections[k] ?? 0) + v;
      const inst = buildInstance(s, seed, sample.values);
      distinct.add(JSON.stringify(sample.randoms));
      for (const p of inst.parts) {
        const st = parts.get(p.partId)!;
        const x = p.modelAnswer;
        st.min = Math.min(st.min, x);
        st.max = Math.max(st.max, x);
        if (x === 0) st.zeros++;
        else if (Math.abs(x) > scale.get(p.partId)!.hi || Math.abs(x) < scale.get(p.partId)!.lo) st.outOfBand++;
        if (p.integer && Math.abs(x - Math.round(x)) > 1e-9 * Math.max(1, Math.abs(x))) st.nonInteger++;
      }
    } catch (e) {
      if (e instanceof ConstraintUnsatisfiableError) {
        unsatisfiable++;
        draws += Number(e.params.maxDraws ?? 0);
        for (const [k, v] of Object.entries((e.params.rejections as Record<string, number>) ?? {})) {
          rejections[k] = (rejections[k] ?? 0) + v;
        }
      }
      if (e instanceof CoreError) failures.push({ seed, name: e.name, code: e.code, message: e.message });
      else throw e;
    }
  }

  const rejectionRate = draws === 0 ? 0 : 1 - accepted / draws;
  const warnings: string[] = [];
  if (rejectionRate > 0.5) {
    warnings.push(`${(rejectionRate * 100).toFixed(0)}% of draws are rejected; consider narrowing the variable ranges`);
  }
  for (const st of parts.values()) {
    if (st.zeros > 0) warnings.push(`part ${st.partId}: model answer is exactly 0 for ${st.zeros} seed(s)`);
  }
  if (distinct.size < Math.min(n, 10)) warnings.push(`only ${distinct.size} distinct instance(s) in ${n} seeds`);

  const partStats = [...parts.values()];
  const ok =
    failures.length === 0 && partStats.every((p) => p.outOfBand === 0 && p.nonInteger === 0);
  return {
    scenarioId: s.id,
    seeds: n,
    ok,
    failures,
    unsatisfiable,
    draws,
    rejectionRate,
    rejections,
    distinctInstances: distinct.size,
    parts: partStats,
    warnings,
  };
}

export async function runFuzz(ctx: Context, arg: string, opts: FuzzOptions = {}): Promise<number> {
  const s = await loadScenario(ctx, arg);
  const r = fuzzScenario(s, opts);
  const o = ctx.output;
  if (opts.json) {
    o.out(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  o.out(`${r.ok ? paint(o, 'green', '✓') : paint(o, 'red', '✗')} ${paint(o, 'bold', s.id)}: ${r.seeds} seeds, ${r.distinctInstances} distinct`);
  o.out(`  draws ${r.draws}, rejection rate ${(r.rejectionRate * 100).toFixed(1)}%`);
  for (const [k, v] of Object.entries(r.rejections).sort((a, b) => b[1] - a[1])) {
    o.out(`    ${String(v).padStart(6)} × ${k}`);
  }
  for (const p of r.parts) {
    const flags = [
      p.outOfBand ? paint(o, 'red', `${p.outOfBand} out of band`) : '',
      p.nonInteger ? paint(o, 'red', `${p.nonInteger} non-integer`) : '',
    ]
      .filter(Boolean)
      .join(', ');
    o.out(`  ${p.partId}: ${fmtNumber(p.min)} … ${fmtNumber(p.max)}${flags ? ` (${flags})` : ''}`);
  }
  if (r.unsatisfiable) o.out(paint(o, 'red', `  ${r.unsatisfiable} seed(s) exhausted maxSampleAttempts`));
  const shown = new Set<string>();
  for (const f of r.failures) {
    if (shown.has(f.code)) continue;
    shown.add(f.code);
    const count = r.failures.filter((x) => x.code === f.code).length;
    o.out(paint(o, 'red', `  seed ${f.seed}${count > 1 ? ` (+${count - 1} more)` : ''}: ${f.name} ${f.message}`));
  }
  for (const w of r.warnings) o.out(`  ${paint(o, 'yellow', '!')} ${w}`);
  return r.ok ? 0 : 1;
}
