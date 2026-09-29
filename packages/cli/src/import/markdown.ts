import type { SourceBlock } from './html.js';
import { normalizeText } from './normalize.js';

/**
 * Markdown sources: `#` headings are sections, blank lines separate
 * paragraphs, `![alt](src)` are images, `<sup>`/`<sub>` and `^` are kept.
 */
export function markdownToBlocks(md: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  for (const chunk of md.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
      if (h) blocks.push({ kind: 'heading', text: normalizeText(h[1]!), raw: h[1]!.trim(), images: [] });
    }
    const body = lines.filter((l) => !/^#{1,6}\s/.test(l.trim())).join(' ');
    const images = [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]!);
    const textPart = body.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    const text = normalizeText(
      textPart.replace(/<sup>(.*?)<\/sup>/g, '^$1').replace(/<sub>(.*?)<\/sub>/g, '_$1').replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1'),
    );
    if (text || images.length) blocks.push({ kind: 'paragraph', text, raw: textPart.trim(), images });
  }
  return blocks;
}
