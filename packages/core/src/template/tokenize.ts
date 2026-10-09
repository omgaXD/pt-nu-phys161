import { IDENTIFIER_RE } from '../expr/names.js';

/**
 * Template syntax, one grammar for narrative, prompt, caption,
 * overlay text, hint and solution:
 *
 *   {name}        value, formatted per its decimals/sigfigs
 *   {name:unit}   value followed by its unit
 *   {= expr }     inline computed expression
 *   {_0} {_1}     answer input slot;  {_u} unit slot;  {_0}{_u} combined field
 *   {@fig}        the scenario figure
 *   $...$ $$...$$ math (TeX); `\$` is a literal dollar sign
 *
 * Inside math, a `{` directly after a TeX command (`\frac{`), `}`, `^` or `_`
 * opens a TeX group rather than a token, so `\hat{\imath}` and `x^{2}` work.
 * Any other `{` that does not form a valid token is literal text.
 */
export type TemplateToken =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'var'; name: string; withUnit: boolean; start: number; end: number }
  | { kind: 'expr'; src: string; start: number; end: number }
  | { kind: 'slot'; index: number; start: number; end: number }
  | { kind: 'unitSlot'; start: number; end: number }
  | { kind: 'figure'; start: number; end: number }
  | { kind: 'math'; display: boolean; body: MathBodyToken[]; start: number; end: number };

export type MathBodyToken = Extract<
  TemplateToken,
  { kind: 'text' } | { kind: 'var' } | { kind: 'expr' } | { kind: 'slot' } | { kind: 'unitSlot' } | { kind: 'figure' }
>;

export interface TemplateDiagnostic {
  code: 'unclosed-math' | 'unclosed-expr';
  start: number;
  end: number;
}

export interface TokenizedTemplate {
  tokens: TemplateToken[];
  diagnostics: TemplateDiagnostic[];
}

type BraceToken = Exclude<TemplateToken, { kind: 'text' } | { kind: 'math' }>;

/** Try to read a `{...}` token at `i` (which must point at `{`). */
function readBrace(src: string, i: number, diagnostics: TemplateDiagnostic[]): BraceToken | null {
  if (src[i + 1] === '=') {
    const close = src.indexOf('}', i + 2);
    if (close < 0) {
      diagnostics.push({ code: 'unclosed-expr', start: i, end: src.length });
      return null;
    }
    return { kind: 'expr', src: src.slice(i + 2, close).trim(), start: i, end: close + 1 };
  }
  const close = src.indexOf('}', i + 1);
  if (close < 0) return null;
  const inner = src.slice(i + 1, close);
  if (inner === '_u') return { kind: 'unitSlot', start: i, end: close + 1 };
  if (/^_\d+$/.test(inner)) return { kind: 'slot', index: Number(inner.slice(1)), start: i, end: close + 1 };
  if (inner === '@fig') return { kind: 'figure', start: i, end: close + 1 };
  const m = /^([A-Za-z][A-Za-z0-9_]*)(:unit)?$/.exec(inner);
  if (m && IDENTIFIER_RE.test(m[1]!)) {
    return { kind: 'var', name: m[1]!, withUnit: m[2] !== undefined, start: i, end: close + 1 };
  }
  return null;
}

/** In math, is the `{` at i a TeX group opener rather than a template token? */
function isTexGroup(src: string, i: number, mathStart: number): boolean {
  if (i === mathStart) return false;
  const prev = src[i - 1]!;
  if (prev === '}' || prev === '^' || prev === '_') return true;
  if (/[A-Za-z]/.test(prev)) {
    let j = i - 1;
    while (j > mathStart && /[A-Za-z]/.test(src[j - 1]!)) j--;
    return j > mathStart && src[j - 1] === '\\';
  }
  return false;
}

export function tokenizeTemplate(src: string): TokenizedTemplate {
  const tokens: TemplateToken[] = [];
  const diagnostics: TemplateDiagnostic[] = [];
  let text = '';
  let textStart = 0;
  let i = 0;

  const flushText = (into: { kind: string }[], end: number): void => {
    if (text) into.push({ kind: 'text', text, start: textStart, end } as TemplateToken);
    text = '';
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\' && src[i + 1] === '$') {
      if (!text) textStart = i;
      text += '$';
      i += 2;
      continue;
    }
    if (c === '$') {
      const display = src[i + 1] === '$';
      const delim = display ? '$$' : '$';
      const bodyStart = i + delim.length;
      // Find the closing delimiter, skipping escaped dollars.
      let j = bodyStart;
      let close = -1;
      while (j < src.length) {
        if (src[j] === '\\' && src[j + 1] === '$') {
          j += 2;
          continue;
        }
        if (src.startsWith(delim, j)) {
          close = j;
          break;
        }
        j++;
      }
      if (close < 0) {
        diagnostics.push({ code: 'unclosed-math', start: i, end: src.length });
        if (!text) textStart = i;
        text += src.slice(i);
        break;
      }
      flushText(tokens, i);
      tokens.push({
        kind: 'math',
        display,
        body: tokenizeMathBody(src, bodyStart, close, diagnostics),
        start: i,
        end: close + delim.length,
      });
      i = close + delim.length;
      textStart = i;
      continue;
    }
    if (c === '{') {
      const tok = readBrace(src, i, diagnostics);
      if (tok) {
        flushText(tokens, i);
        tokens.push(tok);
        i = tok.end;
        textStart = i;
        continue;
      }
    }
    if (!text) textStart = i;
    text += c;
    i++;
  }
  flushText(tokens, src.length);
  return { tokens, diagnostics };
}

function tokenizeMathBody(src: string, start: number, end: number, diagnostics: TemplateDiagnostic[]): MathBodyToken[] {
  const out: MathBodyToken[] = [];
  let text = '';
  let textStart = start;
  let i = start;
  while (i < end) {
    const c = src[i]!;
    if (c === '\\' && src[i + 1] === '$') {
      if (!text) textStart = i;
      text += '\\$';
      i += 2;
      continue;
    }
    if (c === '{' && !isTexGroup(src, i, start)) {
      const tok = readBrace(src.slice(0, end), i, diagnostics);
      if (tok) {
        if (text) out.push({ kind: 'text', text, start: textStart, end: i });
        text = '';
        out.push(tok);
        i = tok.end;
        textStart = i;
        continue;
      }
    }
    if (!text) textStart = i;
    text += c;
    i++;
  }
  if (text) out.push({ kind: 'text', text, start: textStart, end });
  return out;
}

/** Every identifier a template reads, including those inside `{= expr }` (by name only). */
export function templateVarNames(tokens: readonly TemplateToken[]): string[] {
  const out = new Set<string>();
  const visit = (t: TemplateToken): void => {
    if (t.kind === 'var') out.add(t.name);
    if (t.kind === 'math') t.body.forEach(visit);
  };
  tokens.forEach(visit);
  return [...out];
}
