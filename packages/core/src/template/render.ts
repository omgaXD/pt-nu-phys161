import { CoreError, TemplateError } from '../errors.js';
import type { Evaluator, Value } from '../expr/evaluate.js';
import { type Formatted, formatValue, type NumberFormat } from '../numbers/format.js';
import { isDegreeUnit, unitToTex } from '../units/index.js';
import { type MathBodyToken, type TemplateToken, tokenizeTemplate } from './tokenize.js';

/** Where a slot lives in a rendered prompt. */
export interface Slot {
  index: number;
  kind: 'value' | 'unit' | 'combined';
}

export interface VarMeta extends NumberFormat {
  unit?: string | undefined;
}

export interface RenderContext {
  values: Readonly<Record<string, Value>>;
  meta: Readonly<Record<string, VarMeta>>;
  evaluator: Evaluator;
  /** Figure id, if the scenario has one ({@fig} is an error otherwise). */
  figureId?: string | undefined;
}

export type TemplateField = 'narrative' | 'prompt' | 'caption' | 'overlay' | 'hint' | 'solution';

export interface RenderOptions {
  field: TemplateField;
  /**
   * For prompts: whether the part expects a unit. `{_u}` is dropped when it
   * does not, and missing slots are appended when it does (§2.3).
   */
  hasUnit?: boolean;
}

export interface RenderedTemplate {
  html: string;
  slots: Slot[];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Placeholder markup. Core never typesets math or mounts inputs: it emits these
 * flat, non-nesting spans and the UI replaces them (see `splitRenderedHtml`).
 * Math stays swappable between KaTeX and MathJax (§11).
 */
export function mathHtml(tex: string, display: boolean): string {
  const t = escapeHtml(tex);
  return `<span class="pt-math" data-display="${display ? 'block' : 'inline'}" data-tex="${t}">${t}</span>`;
}

function slotHtml(slot: Slot): string {
  return `<span class="pt-slot" data-slot="${slot.index}" data-kind="${slot.kind}"></span>`;
}

function figureHtml(id: string): string {
  return `<span class="pt-figure" data-figure="${escapeHtml(id)}"></span>`;
}

function textHtml(s: string): string {
  // A blank line is a paragraph break; other whitespace collapses as in HTML.
  return s
    .split(/\n[ \t]*\n\s*/)
    .map(escapeHtml)
    .join('<br><br>');
}

function templateError(code: string, message: string, params: Record<string, unknown>): TemplateError {
  return new TemplateError(code, message, params);
}

function lookup(ctx: RenderContext, name: string, field: TemplateField, at: number): Formatted & { unit?: string } {
  if (!Object.hasOwn(ctx.values, name)) {
    throw templateError('unknown-identifier', `unknown variable {${name}} in ${field}`, {
      field,
      name,
      position: at,
    });
  }
  const meta = ctx.meta[name] ?? {};
  const f = formatValue(ctx.values[name]!, meta);
  return meta.unit !== undefined ? { ...f, unit: meta.unit } : f;
}

function evalInline(ctx: RenderContext, src: string, field: TemplateField, at: number): Formatted {
  try {
    const v = ctx.evaluator.evaluate(src, ctx.values);
    return formatValue(v);
  } catch (e) {
    if (e instanceof CoreError) {
      throw templateError('expression-error', `{= ${src}} in ${field}: ${e.message}`, {
        field,
        position: at,
        cause: e.toJSON(),
      });
    }
    throw e;
  }
}

/** A value (with optional unit) placed in running text. */
function valueInText(f: Formatted, unit: string | undefined): string {
  if (unit === undefined) return f.math ? mathHtml(f.tex, false) : escapeHtml(f.text);
  if (isDegreeUnit(unit)) return f.math ? mathHtml(`${f.tex}^{\\circ}`, false) : `${escapeHtml(f.text)}°`;
  const simpleUnit = /^[\p{L}µΩ]+$/u.test(unit.trim());
  if (!f.math && simpleUnit) return `${escapeHtml(f.text)}\u00a0${escapeHtml(unit.trim())}`;
  return mathHtml(`${f.tex}\\ ${unitToTex(unit)}`, false);
}

function valueInMath(f: Formatted, unit: string | undefined): string {
  if (unit === undefined) return f.tex;
  if (isDegreeUnit(unit)) return `${f.tex}^{\\circ}`;
  return `${f.tex}\\ ${unitToTex(unit)}`;
}

function renderMathBody(body: MathBodyToken[], ctx: RenderContext, field: TemplateField): string {
  let tex = '';
  for (const t of body) {
    switch (t.kind) {
      case 'text':
        tex += t.text;
        break;
      case 'var': {
        const f = lookup(ctx, t.name, field, t.start);
        tex += valueInMath(f, t.withUnit ? f.unit : undefined);
        break;
      }
      case 'expr':
        tex += evalInline(ctx, t.src, field, t.start).tex;
        break;
      default:
        throw templateError('token-in-math', `${t.kind} tokens are not allowed inside math`, {
          field,
          position: t.start,
        });
    }
  }
  return tex;
}

/**
 * Render a template to placeholder HTML. Throws `TemplateError` on unknown
 * identifiers or failing inline expressions so callers can show the problem.
 */
export function renderTemplate(src: string, ctx: RenderContext, opts: RenderOptions): RenderedTemplate {
  const { tokens } = tokenizeTemplate(src);
  const field = opts.field;
  const isPrompt = field === 'prompt';
  const hasUnit = opts.hasUnit ?? false;

  // Resolve slot layout first: {_0}{_u} adjacent → combined.
  const slotPlan = new Map<TemplateToken, Slot | null>();
  let sawValue = false;
  let sawUnit = false;
  tokens.forEach((t, i) => {
    if (t.kind === 'slot') {
      const next = tokens[i + 1];
      const combined = hasUnit && next?.kind === 'unitSlot' && next.start === t.end;
      slotPlan.set(t, { index: t.index, kind: combined ? 'combined' : 'value' });
      if (combined) slotPlan.set(next, null);
      if (t.index === 0) {
        sawValue = true;
        if (combined) sawUnit = true;
      }
    } else if (t.kind === 'unitSlot' && !slotPlan.has(t)) {
      slotPlan.set(t, hasUnit ? { index: 0, kind: 'unit' } : null);
      if (hasUnit) sawUnit = true;
    }
  });

  let html = '';
  const slots: Slot[] = [];
  const emitSlot = (slot: Slot): void => {
    slots.push(slot);
    html += slotHtml(slot);
  };

  for (const t of tokens) {
    switch (t.kind) {
      case 'text':
        html += textHtml(t.text);
        break;
      case 'var': {
        const f = lookup(ctx, t.name, field, t.start);
        html += valueInText(f, t.withUnit ? f.unit : undefined);
        break;
      }
      case 'expr':
        html += valueInText(evalInline(ctx, t.src, field, t.start), undefined);
        break;
      case 'math':
        html += mathHtml(renderMathBody(t.body, ctx, field), t.display);
        break;
      case 'figure':
        if (field !== 'narrative' && field !== 'prompt') {
          throw templateError('figure-not-allowed', `{@fig} is not allowed in ${field}`, { field, position: t.start });
        }
        if (!ctx.figureId) {
          throw templateError('no-figure', '{@fig} used but the scenario has no figure', { field, position: t.start });
        }
        html += figureHtml(ctx.figureId);
        break;
      case 'slot':
      case 'unitSlot': {
        if (!isPrompt) {
          throw templateError('slot-not-allowed', `answer slots are only allowed in prompts, not ${field}`, {
            field,
            position: t.start,
          });
        }
        const plan = slotPlan.get(t);
        if (plan) emitSlot(plan);
        break;
      }
    }
  }

  if (isPrompt) {
    if (!sawValue) {
      html += ' ';
      emitSlot({ index: 0, kind: hasUnit && !sawUnit ? 'combined' : 'value' });
      if (hasUnit) sawUnit = true;
    }
    if (hasUnit && !sawUnit) emitSlot({ index: 0, kind: 'unit' });
  }
  return { html: html.trim(), slots };
}

// ---- Consuming the placeholder HTML ------------------------------------------

export type HtmlSegment =
  | { type: 'html'; html: string }
  | { type: 'math'; tex: string; display: boolean }
  | { type: 'slot'; index: number; kind: Slot['kind'] }
  | { type: 'figure'; id: string };

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const PLACEHOLDER_RE = /<span class="pt-(math|slot|figure)"([^>]*)>[^<]*<\/span>/g;

function attr(attrs: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? unescapeHtml(m[1]!) : '';
}

/**
 * Split rendered HTML into plain-HTML runs and placeholders, so a component
 * library can render math, inputs and figures in place without DOM surgery.
 * Plain runs never contain unbalanced tags (the renderer emits no wrappers).
 */
export function splitRenderedHtml(html: string): HtmlSegment[] {
  const out: HtmlSegment[] = [];
  let last = 0;
  for (const m of html.matchAll(PLACEHOLDER_RE)) {
    if (m.index > last) out.push({ type: 'html', html: html.slice(last, m.index) });
    const attrs = m[2]!;
    if (m[1] === 'math') {
      out.push({ type: 'math', tex: attr(attrs, 'data-tex'), display: attr(attrs, 'data-display') === 'block' });
    } else if (m[1] === 'slot') {
      out.push({ type: 'slot', index: Number(attr(attrs, 'data-slot')), kind: attr(attrs, 'data-kind') as Slot['kind'] });
    } else {
      out.push({ type: 'figure', id: attr(attrs, 'data-figure') });
    }
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ type: 'html', html: html.slice(last) });
  return out;
}
