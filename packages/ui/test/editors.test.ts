import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { evaluatePreview, formulaDiagnostics, FormulaInput, TemplateEditor, templateDiagnostics } from '../src/lib/index.ts';

describe('formula diagnostics', () => {
  it('underlines unknown identifiers at their positions', () => {
    expect(formulaDiagnostics('F * dd + F', ['F', 'd'])).toEqual([{ from: 4, to: 6, severity: 'error', message: 'unknown identifier "dd"' }]);
    expect(formulaDiagnostics('', [])).toEqual([]);
    expect(formulaDiagnostics('m * g', ['m', 'g'])).toEqual([]);
  });

  it('points at syntax errors', () => {
    const [d] = formulaDiagnostics('F * (d +', ['F', 'd']);
    expect(d).toMatchObject({ severity: 'error' });
    expect(d!.from).toBeGreaterThanOrEqual(0);
    expect(formulaDiagnostics('frob(2)', [])[0]).toMatchObject({ from: 0, to: 4 });
    expect(formulaDiagnostics('x = 3', ['x'])[0]!.message).toMatch(/assignment/);
  });

  it('evaluates live against the scope', () => {
    expect(evaluatePreview('F * d', { F: 165, d: 3.1 })).toEqual({ ok: true, text: '511.5' });
    expect(evaluatePreview('[vx, vy]', { vx: 2, vy: -3 })).toEqual({ ok: true, text: '2 î \u2212 3 ĵ' });
    expect(evaluatePreview('sqrt(-1)', {})).toMatchObject({ ok: false });
    expect(evaluatePreview('', {})).toBeNull();
  });
});

describe('template diagnostics', () => {
  it('flags unknown {names}, bad inline expressions and unclosed math', () => {
    const src = 'Mass {m} and {mass}; twice {= 2 * mm }; $x';
    expect(templateDiagnostics(src, ['m'])).toEqual([
      { from: 40, to: 42, severity: 'error', message: 'unclosed $ math' },
      { from: 13, to: 19, severity: 'error', message: 'unknown variable "mass"' },
      { from: 34, to: 36, severity: 'error', message: 'unknown identifier "mm"' },
    ]);
    expect(src.slice(34, 36)).toBe('mm');
    expect(templateDiagnostics('$\\alpha = {alpha}\\,\\mathrm{J}$ {_0}{_u} {@fig}', ['alpha'])).toEqual([]);
  });
});

describe('FormulaInput', () => {
  it('mounts CodeMirror and shows the live value', async () => {
    const { container } = render(FormulaInput, { value: 'F * d', scope: { F: 165, d: 3.1 }, label: 'Answer formula' });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.cm-content')).toHaveAttribute('aria-label', 'Answer formula');
    expect(container.querySelector('.cm-content')).toHaveTextContent('F * d');
    expect(screen.getByText('= 511.5')).toBeInTheDocument();
  });

  it('marks errors and follows external value changes', async () => {
    const { container, rerender } = render(FormulaInput, { value: 'F * q', scope: { F: 2 } });
    expect(container.querySelector('.pt-formula-input')).toHaveClass('has-error');
    expect(container.querySelector('.pt-formula-value.error')).toHaveTextContent('unknown identifier q');
    await rerender({ value: 'F * 3', scope: { F: 2 } });
    await waitFor(() => expect(container.querySelector('.cm-content')).toHaveTextContent('F * 3'));
    expect(screen.getByText('= 6')).toBeInTheDocument();
  });

  it('reports edits made in the editor', async () => {
    const onchange = vi.fn();
    const { container } = render(FormulaInput, { value: 'F', scope: { F: 1 }, onchange });
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
    view.dispatch({ changes: { from: 1, insert: ' * 2' } });
    expect(onchange).toHaveBeenLastCalledWith('F * 2');
    view.dispatch({ changes: { from: 5, insert: '\nnope' } }); // formulas are one line
    expect(view.state.doc.toString()).toBe('F * 2');
  });
});

describe('TemplateEditor', () => {
  it('highlights tokens and lists unknown identifiers', async () => {
    const { container } = render(TemplateEditor, { value: 'A {m:unit} block and {ghost}. {_0}{_u}', names: ['m'] });
    await waitFor(() => expect(container.querySelector('.cm-pt-var')).not.toBeNull());
    expect(container.querySelector('.cm-pt-unknown')).toHaveTextContent('{ghost}');
    expect(container.querySelector('.cm-pt-slot')).not.toBeNull();
    expect(container.querySelector('.pt-template-problems')).toHaveTextContent('unknown variable "ghost"');
  });
});
