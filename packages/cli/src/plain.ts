import { type ProblemInstance, splitRenderedHtml } from '@pt/core';

function unescape(s: string): string {
  return s
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ');
}

/** Rendered placeholder HTML → readable terminal text (math kept as $TeX$). */
export function htmlToPlain(html: string, opts: { unit?: string; figureAlt?: string } = {}): string {
  return splitRenderedHtml(html)
    .map((seg) => {
      switch (seg.type) {
        case 'html':
          return unescape(seg.html);
        case 'math':
          return seg.display ? `\n$$${seg.tex}$$\n` : `$${seg.tex}$`;
        case 'slot':
          if (seg.kind === 'unit') return '[unit]';
          if (seg.kind === 'combined') return `[answer ${opts.unit ?? ''}]`.replace(' ]', ']');
          return '[answer]';
        case 'figure':
          return `[figure${opts.figureAlt ? `: ${opts.figureAlt}` : ''}]`;
      }
    })
    .join('');
}

export function instanceToPlain(inst: ProblemInstance): string {
  const lines: string[] = [];
  lines.push(htmlToPlain(inst.narrativeHtml, { figureAlt: inst.figure?.alt }));
  if (inst.figure) {
    const overlays = inst.figure.overlays.map((o) => `${o.id}: ${htmlToPlain(o.html)}`).join(', ');
    lines.push(`  (figure ${inst.figure.src}${overlays ? `; overlays ${overlays}` : ''})`);
  }
  inst.parts.forEach((p, i) => {
    lines.push('');
    lines.push(`(${String.fromCharCode(97 + i)}) ${htmlToPlain(p.promptHtml, { unit: p.unit, figureAlt: inst.figure?.alt })}`);
  });
  return lines.join('\n');
}
