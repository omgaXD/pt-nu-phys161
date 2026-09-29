import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { type Literal, detectLiterals } from './literals.js';
import type { PrintedAnswer, SourceProblem } from './problems.js';

/**
 * A draft is an imported source problem that is not yet a scenario: the
 * source text (raw and normalised), the printed answer, detected literals
 * and a draft scenario with TODOs. Drafts live in `<set>/drafts/` so the
 * repository never mistakes them for scenarios.
 */
export const DraftSchema = z.object({
  label: z.string(),
  number: z.number(),
  section: z.string().optional(),
  source: z.object({ document: z.string(), file: z.string() }),
  raw: z.string(),
  text: z.string(),
  answer: z.object({ value: z.number(), unit: z.string().optional(), raw: z.string() }).optional(),
  figures: z
    .array(
      z.object({
        src: z.string(),
        original: z.string(),
        /**
         * `section`: a reference sheet placed before the section's first problem;
         * `inline`: a picture inside the running text (usually a symbol).
         * Absent: the problem's own figure.
         */
        role: z.enum(['section', 'inline']).optional(),
      }),
    )
    .default([]),
  literals: z.array(
    z.object({
      name: z.string(),
      value: z.number(),
      unit: z.string().optional(),
      text: z.string(),
      constant: z.boolean().optional(),
      suggest: z.object({ min: z.number(), max: z.number(), step: z.number(), decimals: z.number().optional() }),
    }),
  ),
  scenario: z.record(z.string(), z.unknown()),
});

export type Draft = z.infer<typeof DraftSchema>;

export const TODO = 'TODO';

export function draftFileName(number: number): string {
  return `P${String(number).padStart(3, '0')}.yaml`;
}

export function draftScenarioId(setId: string, number: number): string {
  return `${setId}-p${String(number).padStart(3, '0')}`;
}

const QUESTION_START = /^(find|calculate|determine|compute|what|how|at what|through (how|what)|by what|which|when|where|estimate|give|show)\b/i;
const FOLLOW_UP = /^(provide|give|express|round|assume|take|taking|ignore|neglect)\b/i;

/** Split a statement into sentences without breaking decimals ("9.8 m"). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Narrative/prompt split: the prompt is the last question sentence plus any
 * immediately following instructions ("Provide the answer in radians.");
 * everything else, in order, is the shared narrative.
 */
export function splitNarrative(text: string): { narrative: string; prompt: string } {
  const ss = sentences(text);
  let q = -1;
  ss.forEach((s, i) => {
    if (s.endsWith('?') || QUESTION_START.test(s)) q = i;
  });
  if (q < 0) return { narrative: ss.slice(0, -1).join(' '), prompt: ss.at(-1) ?? '' };
  let end = q + 1;
  // Instructions about the answer ("Provide the answer in radians."); template tokens like {x:unit} don't count.
  const instructs = (s: string): boolean => FOLLOW_UP.test(s) && /answer|unit|radian|decimal|degree/i.test(s.replace(/\{[^}]*\}/g, ''));
  while (end < ss.length && instructs(ss[end]!)) end++;
  return {
    narrative: [...ss.slice(0, q), ...ss.slice(end)].join(' '),
    prompt: ss.slice(q, end).join(' '),
  };
}

const GREEK_TEX: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  θ: 'theta',
  λ: 'lambda',
  μ: 'mu',
  ρ: 'rho',
  σ: 'sigma',
  τ: 'tau',
  φ: 'phi',
  ω: 'omega',
  Δ: 'Delta',
};

/**
 * Escape template syntax in source text; subscripted symbols (μ_k, M_1) and
 * leftover superscripts (x^4, 10^-5) become math.
 */
export function escapeTemplate(s: string): string {
  return (
    s
      .replace(/\$/g, '\\$')
      .replace(/\{/g, '(')
      .replace(/\}/g, ')')
      .replace(/(?<![\w\\])([A-Za-zα-ωΔ])_(\w+)/gu, (_m, head: string, sub: string) => {
        const h = GREEK_TEX[head] ? `\\${GREEK_TEX[head]}` : head;
        return `$${h}_{${sub}}$`;
      })
      .replace(/\^(\(([^()]*)\)|[-+]?[\w.]+)/g, (_m, all: string, inner: string | undefined) => `$^{${inner ?? all}}$`)
      // "$M_{1}$$^{2}$" → "$M_{1}^{2}$" (two adjacent math runs would read as $$ display math).
      .replace(/\$\$\^\{/g, '^{')
  );
}

/** Replace each literal by a template token; "9.8 m/s^2" becomes {g:unit}. */
export function templatize(question: string, literals: readonly Literal[]): string {
  let out = '';
  let pos = 0;
  for (const l of literals) {
    out += escapeTemplate(question.slice(pos, l.start));
    if (l.unitEnd !== undefined) {
      out += `{${l.name}:unit}`;
      pos = l.unitEnd;
    } else {
      out += `{${l.name}}`;
      pos = l.end;
    }
  }
  return out + escapeTemplate(question.slice(pos));
}

export interface BuildDraftOptions {
  setId: string;
  document: string;
  file: string;
  /** Figure paths relative to the set, when the problem has images. */
  figures: Draft['figures'];
}

/** Build the draft (and its TODO scenario) for one source problem. */
export function buildDraft(p: SourceProblem, opts: BuildDraftOptions): Draft {
  const literals = detectLiterals(p.question);
  const templ = templatize(p.question, literals);
  const { narrative, prompt } = splitNarrative(templ);
  const answer: PrintedAnswer | undefined = p.answer;
  const figure = opts.figures.find((f) => f.role === undefined);

  const vars = literals
    .filter((l) => !l.constant)
    .map((l) => ({ name: l.name, kind: 'range', min: TODO, max: TODO, step: TODO, ...(l.unit !== undefined && { unit: l.unit }) }));
  const derived = literals
    .filter((l) => l.constant)
    .map((l) => ({ name: l.name, expr: String(l.value), ...(l.unit !== undefined && { unit: l.unit }) }));

  const part: Record<string, unknown> = {
    id: 'answer',
    prompt: `${prompt} ${answer?.unit ? '{_0}{_u}' : '{_0}'}`.trim(),
    answer: TODO,
    ...(answer?.unit !== undefined && { unit: answer.unit }),
    tolerance: { rel: 0.01 },
  };

  const scenario: Record<string, unknown> = {
    id: draftScenarioId(opts.setId, p.number),
    source: { document: opts.document, labels: [p.label] },
    ...(p.section !== undefined && { section: p.section }),
    ...(figure && { figure: { id: 'fig', src: figure.src, alt: `${TODO}: describe the figure` } }),
    narrative: `${narrative}${figure ? ' {@fig}' : ''}`.trim(),
    vars,
    ...(derived.length > 0 && { derived }),
    parts: [part],
    canonical: {
      vars: Object.fromEntries(literals.map((l) => [l.name, l.value])),
      parts: [
        {
          id: 'answer',
          answer: answer?.value ?? TODO,
          ...(answer?.unit !== undefined && { unit: answer.unit }),
          source: p.label,
        },
      ],
    },
  };

  return {
    label: p.label,
    number: p.number,
    ...(p.section !== undefined && { section: p.section }),
    source: { document: opts.document, file: opts.file },
    raw: p.raw,
    text: p.text,
    ...(answer && { answer }),
    figures: opts.figures,
    literals: literals.map((l) => ({
      name: l.name,
      value: l.value,
      ...(l.unit !== undefined && { unit: l.unit }),
      text: l.text,
      ...(l.constant && { constant: true }),
      suggest: l.suggest,
    })),
    scenario,
  };
}

export interface LoadedDraft {
  file: string;
  draft: Draft;
}

/** Read every draft of a set (sorted by problem number). */
export function loadDrafts(root: string, setId: string): LoadedDraft[] {
  const dir = join(root, setId, 'drafts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => ({ file: join(dir, f), draft: DraftSchema.parse(parseYaml(readFileSync(join(dir, f), 'utf8'))) }))
    .sort((a, b) => a.draft.number - b.draft.number);
}
