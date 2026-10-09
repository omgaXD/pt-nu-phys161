import { existsSync, readdirSync } from 'node:fs';
import {
  AUTHOR_FUNCTIONS,
  checkCanonical,
  diagnoseScenario,
  SI_CLASSES,
  ScenarioSchema,
  STUDENT_FUNCTIONS,
  toStorable,
} from '@pt/core';
import { toJSONSchema } from 'zod';
import { type Draft, loadDrafts } from '../import/draft.js';
import { CliError, type Context } from '../context.js';
import { groupDrafts } from './group.js';

const TEMPLATE_SYNTAX = {
  '{name}': 'interpolate a variable, formatted per its decimals/sigfigs',
  '{name:unit}': 'value followed by the variable unit',
  '{= expr }': 'inline computed expression',
  '{_0}': 'answer input slot; {_u} unit slot; {_0}{_u} one combined number+unit field',
  '{@fig}': 'place the scenario figure here',
  '$...$': 'TeX math (KaTeX); {name} works inside math; TeX groups after \\cmd, ^, _ or } are left alone',
};

const INSTRUCTIONS = [
  'Turn the source problem into a parametric scenario that validates against `schema` (a JSON Schema of the YAML file).',
  'Keep the source wording in narrative/prompt; replace each problem parameter by a {variable}.',
  'Declare every parameter in `vars` with a range (min/max/step) around the source value, or a choice; use decimals/sigfigs so displayed values are clean.',
  'Physical constants (g = 9.8 m/s^2) go in `derived` as constants, not in `vars`.',
  'Write `answer` formulas using only the listed functions; use rad(theta) for degrees; solve(f(x) = ..., lo, hi) for inverse problems.',
  'Keep `canonical.vars` equal to the source values and `canonical.parts[].answer` equal to the printed answer — this is how the result is verified.',
  'Give every `canonical.parts[]` entry a `source` label (P12…) and list exactly those labels in `source.labels`: one source problem per part (the drafts in `siblings` may merge into one multi-part scenario).',
  'Set `exactUnit: true` on parts whose prompt asks for a specific unit ("express in km/h", "in cm^3"), so a converted unit is not accepted.',
  'When there is a figure, look at the file under `figures[].src` (relative to the set directory) and describe it in `figure.alt`.',
  'If a random draw could change which physics applies (static vs kinetic friction, a root leaving its bracket), add `constraints`.',
  'Omit `unit` for dimensionless answers; set `integer: true` for counts.',
  'Set `difficulty` on every part by the reasoning it takes, not the length of the formula: 1 one formula, direct plug-in; 2 one principle plus a conversion or one intermediate step; 3 two principles or a multi-step chain; 4 several principles or a non-obvious setup; 5 a long chain, or an inverse/numerical solution.',
  'Describe the figure in `figure.alt` (required) when there is one.',
  'Return only the scenario document (YAML or JSON). It is accepted when `pt check <file>` passes and `pt fuzz <file>` reports no failures.',
];

function findDraft(root: string, label: string, setId?: string): { setId: string; draft: Draft; all: Draft[] } | undefined {
  const sets = setId ? [setId] : existsSync(root) ? readdirSync(root).sort() : [];
  const found: { setId: string; draft: Draft; all: Draft[] }[] = [];
  for (const s of sets) {
    const all = loadDrafts(root, s).map((d) => d.draft);
    const draft = all.find((d) => d.label.toLowerCase() === label.toLowerCase());
    if (draft) found.push({ setId: s, draft, all });
  }
  if (found.length > 1) {
    throw new CliError(`${label} exists in several sets (${found.map((f) => f.setId).join(', ')}); pass --set <id>`);
  }
  return found[0];
}

/**
 * Emit a compact JSON packet for an LLM: the source text, detected
 * literals, printed answer and current draft, plus the exact schema the
 * result must satisfy and how it will be verified.
 */
export async function buildAgentTask(ctx: Context, id: string, opts: { set?: string } = {}): Promise<Record<string, unknown>> {
  const common = {
    schema: toJSONSchema(ScenarioSchema, { io: 'input', unrepresentable: 'any' }),
    templateSyntax: TEMPLATE_SYNTAX,
    functions: { student: STUDENT_FUNCTIONS, authoring: AUTHOR_FUNCTIONS, constants: ['pi', 'e'], indexing: '1-based' },
    units: Object.fromEntries(SI_CLASSES.map((c) => [c.id, Object.keys(c.units)])),
    instructions: INSTRUCTIONS,
  };

  if (/^p\d+$/i.test(id)) {
    const found = findDraft(ctx.root, id, opts.set);
    if (!found) throw new CliError(`no draft ${id} (run \`pt import\` first)`);
    const { draft, all, setId } = found;
    const group = groupDrafts(setId, all).find((g) => g.labels.includes(draft.label));
    return {
      task: 'author-scenario',
      setId,
      source: {
        document: draft.source.document,
        label: draft.label,
        section: draft.section,
        raw: draft.raw,
        text: draft.text,
      },
      printedAnswer: draft.answer ?? null,
      literals: draft.literals,
      figures: draft.figures,
      siblings: group ? { labels: group.labels, reasons: group.reasons, proposedId: group.proposedId, asks: group.asks } : null,
      draft: draft.scenario,
      verify: `pt check <file> && pt fuzz <file> -n 500`,
      ...common,
    };
  }

  const s = await ctx.repo.getScenario(id);
  const report = checkCanonical(s);
  return {
    task: report.ok ? 'review-scenario' : 'fix-scenario',
    scenarioId: s.id,
    scenario: toStorable(s),
    canonical: report,
    diagnostics: diagnoseScenario(s),
    verify: `pt check ${s.id} && pt fuzz ${s.id} -n 500`,
    ...common,
  };
}

export async function runAgentTask(ctx: Context, id: string, opts: { set?: string } = {}): Promise<number> {
  ctx.output.out(JSON.stringify(await buildAgentTask(ctx, id, opts), null, 2));
  return 0;
}

