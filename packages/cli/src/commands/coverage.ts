import { buildSetCatalog, type CatalogIssue, type MissingProblem, type SetCatalog, STRICT_ISSUES } from '../bundle/catalog.js';
import { CliError, type Context, paint } from '../context.js';

export interface SectionCoverage {
  section: string;
  problems: number;
  authored: number;
  fixed: number;
  missing: number;
}

export interface SetCoverage {
  setId: string;
  title: string;
  problems: number;
  authored: number;
  fixed: number;
  sections: SectionCoverage[];
  /** label → "authored scenario#part" | "fixed" */
  labels: Record<string, string>;
  missing: MissingProblem[];
  issues: CatalogIssue[];
}

export function summarizeCoverage(c: SetCatalog): SetCoverage {
  const sections = new Map<string, SectionCoverage>();
  const row = (name: string | undefined): SectionCoverage => {
    const key = name ?? '(no section)';
    let r = sections.get(key);
    if (!r) sections.set(key, (r = { section: key, problems: 0, authored: 0, fixed: 0, missing: 0 }));
    return r;
  };
  for (const s of c.set.sections) row(s);
  const labels: Record<string, string> = {};
  for (const q of c.questions) {
    const r = row(q.section);
    r.problems++;
    r[q.kind]++;
    labels[q.label] = q.kind === 'authored' ? `authored ${q.scenarioId}#${q.partId}` : 'fixed';
  }
  for (const m of c.missing) {
    const r = row(m.section);
    r.problems++;
    r.missing++;
    labels[m.label] = `missing (${m.reason})`;
  }
  const authored = c.questions.filter((q) => q.kind === 'authored').length;
  return {
    setId: c.set.id,
    title: c.set.title,
    problems: c.questions.length + c.missing.length,
    authored,
    fixed: c.questions.length - authored,
    sections: [...sections.values()].filter((s) => s.problems > 0),
    labels,
    missing: c.missing,
    issues: c.issues,
  };
}

/**
 * Which source problems are playable, and how: authored (randomized),
 * fixed (source values) or missing. `--strict` fails on inconsistent content
 * (broken files, failing checks, label conflicts, orphan parts, unknown labels).
 */
export async function runCoverage(ctx: Context, setId: string | undefined, opts: { json?: boolean; strict?: boolean } = {}): Promise<number> {
  const sets = setId ? [setId] : (await ctx.repo.listSets()).map((s) => s.id);
  if (setId && !sets.length) throw new CliError(`no set "${setId}"`);
  const reports: SetCoverage[] = [];
  for (const id of sets) reports.push(summarizeCoverage(await buildSetCatalog(ctx.repo, ctx.root, id)));
  const failing = reports.some((r) => r.issues.some((i) => STRICT_ISSUES.has(i.code)));
  const code = opts.strict && failing ? 1 : 0;

  const o = ctx.output;
  if (opts.json) {
    o.out(JSON.stringify({ ok: !failing, sets: reports }, null, 2));
    return code;
  }
  for (const r of reports) {
    o.out(paint(o, 'bold', `${r.setId} — ${r.title}: ${r.problems} problem(s), ${r.authored} authored, ${r.fixed} fixed, ${r.missing.length} missing`));
    const width = Math.max(...r.sections.map((s) => s.section.length), 7);
    for (const s of r.sections) {
      const bar = `${paint(o, 'green', String(s.authored).padStart(4))} authored ${String(s.fixed).padStart(4)} fixed${s.missing ? paint(o, 'yellow', ` ${s.missing} missing`) : ''}`;
      o.out(`  ${s.section.padEnd(width)} ${String(s.problems).padStart(4)}  ${bar}`);
    }
    for (const m of r.missing) o.out(paint(o, 'yellow', `  ! ${m.message}`));
    for (const i of r.issues) o.out(paint(o, STRICT_ISSUES.has(i.code) ? 'red' : 'yellow', `  ${STRICT_ISSUES.has(i.code) ? '✗' : '!'} ${i.message} [${i.code}]`));
  }
  return code;
}
