/**
 * KaTeX typesets every formula twice, as hidden MathML (for screen readers) and
 * as the visible HTML, and a plain copy picks up both. This copies a selection
 * that holds math as text with each formula replaced by its TeX source: $…$
 * inline, $$…$$ display. Install once per page; returns the uninstaller.
 */
export function copyMathAsTex(doc: Document = document): () => void {
  const onCopy = (event: ClipboardEvent): void => {
    const selection = doc.getSelection();
    if (event.defaultPrevented || !event.clipboardData || !selection) return;
    if (selection.rangeCount !== 1 || selection.isCollapsed) return;

    // A selection that starts or ends inside a formula takes all of it.
    const range = selection.getRangeAt(0).cloneRange();
    const first = closestFormula(range.startContainer);
    if (first) range.setStartBefore(first);
    const last = closestFormula(range.endContainer);
    if (last) range.setEndAfter(last);

    const fragment = range.cloneContents();
    const formulas = fragment.querySelectorAll('.katex');
    if (formulas.length === 0) return;
    for (const el of formulas) {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? '';
      el.replaceWith(el.closest('.katex-display') ? `$$${tex}$$` : `$${tex}$`);
    }

    // Laid out (offscreen), innerText breaks lines at blocks the way a native copy does.
    const box = doc.createElement('div');
    box.style.cssText = 'position: fixed; top: 0; left: -100000px;';
    box.append(fragment);
    doc.body.append(box);
    const text = box.innerText;
    box.remove();

    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  };
  doc.addEventListener('copy', onCopy);
  return () => doc.removeEventListener('copy', onCopy);
}

function closestFormula(node: Node): Element | null {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest('.katex') ?? null;
}
