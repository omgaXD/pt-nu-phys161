import katex from 'katex';

/**
 * The single place math is typeset. Swapping KaTeX for MathJax later (§11)
 * means changing this function; components only ever call `renderTex`.
 */
export function renderTex(tex: string, display = false): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    strict: 'ignore',
    output: 'htmlAndMathml',
    trust: false,
  });
}
