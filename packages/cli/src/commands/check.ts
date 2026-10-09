import { type CanonicalReport, checkCanonical, type Diagnostic, diagnoseScenario, type Scenario } from '@pt/core';
import { type Context, fmtNumber, loadScenario, paint } from '../context.js';

export interface CheckOptions {
  json?: boolean;
  /** Restrict to one set when no scenario ids are given. */
  set?: string;
  /** Do not fail on scenarios marked `draft: true`. */
  allowDrafts?: boolean;
}

export interface ScenarioCheck {
  id: string;
  draft: boolean;
  ok: boolean;
  /** Schema or load error (the scenario could not be checked at all). */
  error?: string;
  diagnostics: Diagnostic[];
  canonical?: CanonicalReport;
}

export interface CheckResult {
  ok: boolean;
  scenarios: ScenarioCheck[];
}

function checkOne(s: Scenario): ScenarioCheck {
  const diagnostics = diagnoseScenario(s);
  const canonical = checkCanonical(s);
  const ok = canonical.ok && !diagnostics.some((d) => d.severity === 'error');
  return { id: s.id, draft: s.draft ?? false, ok, diagnostics, canonical };
}

/**
 * Validate schema, run semantic diagnostics and the canonical check.
 * Exit code 1 if anything fails — this is the CI gate.
 */
export async function runCheck(ctx: Context, ids: string[], opts: CheckOptions = {}): Promise<number> {
  const results: ScenarioCheck[] = [];
  if (ids.length === 0) {
    for (const d of await ctx.repo.diagnostics(opts.set)) {
      const issues = d.issues?.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      results.push({ id: d.file, draft: false, ok: false, error: `${d.message}${issues ? ` — ${issues}` : ''}`, diagnostics: [] });
    }
    for (const row of await ctx.repo.listScenarios(opts.set ? { setId: opts.set } : {})) {
      results.push(checkOne(await ctx.repo.getScenario(row.id)));
    }
  } else {
    for (const arg of ids) {
      try {
        results.push(checkOne(await loadScenario(ctx, arg)));
      } catch (e) {
        results.push({ id: arg, draft: false, ok: false, error: e instanceof Error ? e.message : String(e), diagnostics: [] });
      }
    }
  }

  const failing = results.filter((r) => !r.ok && !(opts.allowDrafts && r.draft));
  const result: CheckResult = { ok: failing.length === 0, scenarios: results };
  if (opts.json) {
    ctx.output.out(JSON.stringify(result, null, 2));
  } else {
    printCheck(ctx, result);
  }
  return result.ok ? 0 : 1;
}

function printCheck(ctx: Context, result: CheckResult): void {
  const o = ctx.output;
  const tick = paint(o, 'green', '✓');
  const cross = paint(o, 'red', '✗');
  const warn = paint(o, 'yellow', '!');
  for (const s of result.scenarios) {
    const label = s.draft ? `${s.id} ${paint(o, 'dim', '(draft)')}` : s.id;
    o.out(`${s.ok ? tick : cross} ${paint(o, 'bold', label)}`);
    if (s.error) o.out(`    ${paint(o, 'red', s.error)}`);
    for (const d of s.diagnostics) {
      const mark = d.severity === 'error' ? cross : warn;
      o.out(`    ${mark} ${d.path.join('.')}: ${d.message} ${paint(o, 'dim', `[${d.code}]`)}`);
    }
    for (const p of s.canonical?.parts ?? []) {
      const src = p.source ? ` (${p.source})` : '';
      const unit = p.expectedUnit ?? '';
      if (p.error) {
        o.out(`    ${cross} ${p.partId}${src}: ${p.error.message}`);
        continue;
      }
      const rel = p.relError === null ? '' : paint(o, 'dim', ` rel ${p.relError.toExponential(1)}`);
      const line = `${p.partId}${src}: computed ${fmtNumber(p.computed)} expected ${fmtNumber(p.expectedInPartUnit)} ${unit}`.trimEnd();
      o.out(`    ${p.ok ? tick : cross} ${line}${rel}`);
      for (const m of p.derivedMismatches) {
        o.out(`      ${cross} ${m.name} = ${String(m.actual)}, source says ${String(m.expected)}`);
      }
    }
    for (const w of s.canonical?.warnings ?? []) {
      const text =
        w.code === 'canonical-violates-constraint'
          ? `source values of ${w.partId} violate constraint ${w.constraint}`
          : `source value ${w.name} = ${w.value} is not reachable by the randomization`;
      o.out(`    ${warn} ${paint(o, 'dim', text)}`);
    }
  }
  const n = result.scenarios.length;
  const bad = result.scenarios.filter((s) => !s.ok).length;
  o.out('');
  o.out(bad === 0 ? paint(o, 'green', `${n} scenario(s) OK`) : paint(o, 'red', `${bad} of ${n} scenario(s) failing`));
}

