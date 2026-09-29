import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { forceLinting, linter } from '@codemirror/lint';
import { EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { FUNCTION_NAMES, type TemplateToken, tokenizeTemplate } from '@pt/core';
import type { EditorDiagnostic } from './diagnostics.js';

/** Mutable inputs the editor reads lazily (so prop changes need no reconfigure). */
export interface EditorContext {
  names: string[];
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  mode: 'formula' | 'template';
  ctx: EditorContext;
  ariaLabel: string;
  diagnostics: (doc: string) => EditorDiagnostic[];
  onChange: (doc: string) => void;
}

function completions(ctx: EditorContext, mode: EditorOptions['mode']) {
  return (cc: CompletionContext): CompletionResult | null => {
    if (mode === 'template') {
      const m = cc.matchBefore(/\{[A-Za-z_]\w*$|\{$/);
      if (!m) return null;
      const options: Completion[] = ctx.names.map((n) => ({ label: n, type: 'variable', apply: `${n}}` }));
      return { from: m.from + 1, options, validFor: /^\w*$/ };
    }
    const word = cc.matchBefore(/[A-Za-z_]\w*/);
    if (!word || (word.from === word.to && !cc.explicit)) return null;
    const options: Completion[] = [
      ...ctx.names.map((n) => ({ label: n, type: 'variable' })),
      ...FUNCTION_NAMES.map((f) => ({ label: f, type: 'function', apply: `${f}(` })),
      { label: 'pi', type: 'constant' },
    ];
    return { from: word.from, options, validFor: /^\w*$/ };
  };
}

const tokenMarks = {
  var: Decoration.mark({ class: 'cm-pt-var' }),
  unknownVar: Decoration.mark({ class: 'cm-pt-var cm-pt-unknown' }),
  expr: Decoration.mark({ class: 'cm-pt-expr' }),
  slot: Decoration.mark({ class: 'cm-pt-slot' }),
  figure: Decoration.mark({ class: 'cm-pt-figure' }),
  math: Decoration.mark({ class: 'cm-pt-math' }),
};

/** Highlight {tokens}, $math$, slots and figure placeholders; flag unknown names. */
function templateHighlighter(ctx: EditorContext): Extension {
  const build = (view: EditorView): DecorationSet => {
    const doc = view.state.doc.toString();
    const known = new Set(ctx.names);
    const marks: { from: number; to: number; deco: Decoration }[] = [];
    const visit = (t: TemplateToken): void => {
      if (t.end <= t.start) return;
      switch (t.kind) {
        case 'var':
          marks.push({ from: t.start, to: t.end, deco: known.has(t.name) ? tokenMarks.var : tokenMarks.unknownVar });
          break;
        case 'expr':
          marks.push({ from: t.start, to: t.end, deco: tokenMarks.expr });
          break;
        case 'slot':
        case 'unitSlot':
          marks.push({ from: t.start, to: t.end, deco: tokenMarks.slot });
          break;
        case 'figure':
          marks.push({ from: t.start, to: t.end, deco: tokenMarks.figure });
          break;
        case 'math':
          marks.push({ from: t.start, to: t.end, deco: tokenMarks.math });
          t.body.forEach(visit);
          break;
        default:
          break;
      }
    };
    tokenizeTemplate(doc).tokens.forEach(visit);
    marks.sort((a, b) => a.from - b.from || a.to - b.to);
    const builder = new RangeSetBuilder<Decoration>();
    for (const m of marks) builder.add(m.from, m.to, m.deco);
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.transactions.length) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const theme = EditorView.theme({
  '&': { fontSize: '0.95em', border: '1px solid var(--pt-border, #8a8f98)', borderRadius: '4px', background: 'var(--pt-input-bg, #fff)' },
  '&.cm-focused': { outline: '2px solid var(--pt-accent, #0f6cbf)', outlineOffset: '1px' },
  '.cm-content': { fontFamily: 'var(--pt-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', padding: '4px 0' },
  '.cm-pt-var': { color: 'var(--pt-accent, #0f6cbf)', fontWeight: '600' },
  '.cm-pt-unknown': { color: 'var(--pt-bad, #b3261e)', textDecoration: 'underline wavy' },
  '.cm-pt-expr': { color: '#6d3fb4' },
  '.cm-pt-slot, .cm-pt-figure': { background: 'rgba(15,108,191,0.12)', borderRadius: '3px' },
  '.cm-pt-math': { background: 'rgba(0,0,0,0.04)' },
});

export function createEditor(opts: EditorOptions): EditorView {
  const extensions: Extension[] = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    autocompletion({ override: [completions(opts.ctx, opts.mode)], icons: false }),
    linter((view) => opts.diagnostics(view.state.doc.toString()), { delay: 150 }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
    EditorView.contentAttributes.of({ 'aria-label': opts.ariaLabel, spellcheck: 'false' }),
    theme,
  ];
  if (opts.mode === 'formula') {
    // Formulas are one line: drop newlines instead of inserting them.
    extensions.push(EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)));
  } else {
    extensions.push(EditorView.lineWrapping, templateHighlighter(opts.ctx));
  }
  return new EditorView({ parent: opts.parent, state: EditorState.create({ doc: opts.doc, extensions }) });
}

/** Replace the document if it differs (external value change). */
export function syncDoc(view: EditorView, value: string): void {
  const current = view.state.doc.toString();
  if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
}

export { forceLinting };
