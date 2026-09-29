import { Parser } from 'htmlparser2';
import { normalizeText } from './normalize.js';

/** A paragraph-level unit of the source document. */
export interface SourceBlock {
  kind: 'heading' | 'paragraph';
  /** Normalised text: superscripts as ^n, subscripts as _n, typography cleaned. */
  text: string;
  /** Lossless-enough source text: sup/sub kept as <sup>/<sub>, nothing else. */
  raw: string;
  /** `src` attributes of images inside the block, in order. */
  images: string[];
  /**
   * Images set inside running text (text on both sides), e.g. a symbol pasted
   * as a picture: "the value of the [img]?". Also listed in `images`.
   */
  inlineImages?: string[];
}

type Shift = 'super' | 'sub' | null;

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote', 'title']);
const SKIP_TAGS = new Set(['script', 'style', 'head', 'noscript', 'template']);

/** Map CSS classes to vertical-align from `<style>` rules like `.c8{vertical-align:super}`. */
export function classShifts(css: string): Map<string, Shift> {
  const out = new Map<string, Shift>();
  for (const m of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const va = /vertical-align\s*:\s*(super|sub)/.exec(m[2]!);
    if (va) out.set(m[1]!, va[1] as Shift);
  }
  return out;
}

function inlineShift(style: string | undefined): Shift {
  const va = style ? /vertical-align\s*:\s*(super|sub)/.exec(style) : null;
  return va ? (va[1] as Shift) : null;
}

function elementShift(name: string, attrs: Record<string, string>, shifts: Map<string, Shift>): Shift {
  if (name === 'sup') return 'super';
  if (name === 'sub') return 'sub';
  let shift = inlineShift(attrs.style);
  for (const c of (attrs.class ?? '').split(/\s+/)) shift ??= shifts.get(c) ?? null;
  return shift;
}

/**
 * Parse an HTML export (Google Docs, mammoth, hand-written) into blocks.
 * Superscripts and subscripts come from <sup>/<sub>, inline styles, or CSS
 * classes; the exporter splits them into separate spans (`m/s` + `2`), so
 * they are re-joined here as `m/s^2`.
 */
export function htmlToBlocks(html: string): SourceBlock[] {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const shifts = classShifts(css);
  const blocks: SourceBlock[] = [];

  let skipDepth = 0;
  type Open = { kind: SourceBlock['kind']; runs: { text: string; shift: Shift }[]; images: { src: string; at: number }[] };
  let current: Open | null = null;
  const shiftStack: Shift[] = [];
  const tagStack: string[] = [];

  const open = (kind: SourceBlock['kind']): void => {
    flush();
    current = { kind, runs: [], images: [] };
  };
  const flush = (): void => {
    if (!current) return;
    const { runs, images } = current;
    const hasText = (from: number, to: number): boolean => runs.slice(from, to).some((r) => r.text.trim() !== '');
    const inline = images.filter((i) => hasText(0, i.at) && hasText(i.at, runs.length));
    // Keep a visible marker where an inline picture sat in the text.
    const marked = [...runs];
    for (const i of [...inline].reverse()) marked.splice(i.at, 0, { text: '[image]', shift: null });
    const { text, raw } = joinRuns(marked);
    if (text || images.length) {
      blocks.push({ kind: current.kind, text, raw, images: images.map((i) => i.src), ...(inline.length > 0 && { inlineImages: inline.map((i) => i.src) }) });
    }
    current = null;
  };
  const shiftNow = (): Shift => [...shiftStack].reverse().find((s) => s !== null) ?? null;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        tagStack.push(name);
        if (SKIP_TAGS.has(name)) {
          skipDepth++;
          return;
        }
        if (skipDepth) return;
        if (BLOCK_TAGS.has(name)) {
          const cls = attrs.class ?? '';
          const heading = /^h[1-6]$/.test(name) || /\b(sub)?title\b/.test(cls);
          open(heading ? 'heading' : 'paragraph');
        }
        shiftStack.push(elementShift(name, attrs, shifts));
        if (name === 'br') current?.runs.push({ text: '\n', shift: null });
        if (name === 'img' && attrs.src) {
          current ??= { kind: 'paragraph', runs: [], images: [] };
          current.images.push({ src: attrs.src, at: current.runs.length });
        }
      },
      ontext(text) {
        if (skipDepth) return;
        current ??= { kind: 'paragraph', runs: [], images: [] };
        current.runs.push({ text, shift: shiftNow() });
      },
      onclosetag(name) {
        tagStack.pop();
        if (SKIP_TAGS.has(name)) {
          skipDepth--;
          return;
        }
        if (skipDepth) return;
        shiftStack.pop();
        if (BLOCK_TAGS.has(name)) flush();
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  flush();
  return blocks;
}

/** Join text runs: super/sub runs become ^x / _x (text) and <sup>/<sub> (raw). */
function joinRuns(runs: { text: string; shift: Shift }[]): { text: string; raw: string } {
  let text = '';
  let raw = '';
  // Merge adjacent runs with the same shift first (exporters split arbitrarily).
  const merged: { text: string; shift: Shift }[] = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && last.shift === r.shift) last.text += r.text;
    else merged.push({ ...r });
  }
  for (const r of merged) {
    const t = r.text.replace(/\u00a0/g, ' ');
    if (r.shift === null) {
      text += t;
      raw += t;
      continue;
    }
    const inner = t.trim();
    if (!inner) {
      text += t;
      raw += t;
      continue;
    }
    const simple = /^[-\u2212+]?[\w.]+$/.test(inner);
    const marker = r.shift === 'super' ? '^' : '_';
    text += simple ? `${marker}${inner.replace('\u2212', '-')}` : `${marker}(${inner})`;
    raw += r.shift === 'super' ? `<sup>${inner}</sup>` : `<sub>${inner}</sub>`;
  }
  return { text: normalizeText(text), raw: raw.replace(/\s+/g, ' ').trim() };
}
