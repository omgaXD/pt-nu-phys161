import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseSetDoc, toStorableSet } from '@pt/core';
import { newDocumentText, type Pattern } from '@pt/store-fs';
import { buildDraft, type Draft, draftFileName } from '../import/draft.js';
import { htmlToBlocks, type SourceBlock } from '../import/html.js';
import { markdownToBlocks } from '../import/markdown.js';
import { splitProblems } from '../import/problems.js';
import { CliError, type Context, paint } from '../context.js';

export interface ImportOptions {
  set: string;
  title?: string;
  /** Copy referenced images into <set>/figures (default true). */
  figures?: boolean;
  force?: boolean;
  /** Document name recorded in `source.document` (default: file name). */
  document?: string;
}

export interface ImportResult {
  drafts: number;
  written: number;
  skipped: number;
  withFigure: number;
  imagesCopied: number;
  sections: string[];
  missingAnswers: string[];
  /** Problems with a picture inside their text (needs a manual fix). */
  inlineImages: string[];
}

async function readBlocks(file: string): Promise<SourceBlock[]> {
  const ext = extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return htmlToBlocks(readFileSync(file, 'utf8'));
  if (ext === '.md' || ext === '.markdown') return markdownToBlocks(readFileSync(file, 'utf8'));
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.convertToHtml({ path: file });
    return htmlToBlocks(value);
  }
  throw new CliError(`unsupported file type "${ext}" (expected .html, .docx or .md)`);
}

function documentName(file: string): string {
  let name = basename(file);
  while (/\.(html?|docx|md|markdown)$/i.test(name)) name = name.replace(/\.[^.]+$/, '');
  return name.replace(/[^\w.-]+/g, '_');
}

/** Draft files: the embedded scenario uses scenario house style; source records stay compact. */
const DRAFT_FLOW_PATHS: Pattern[] = [
  ['source'],
  ['answer'],
  ['figures', '*'],
  ['literals', '*', 'suggest'],
  ['scenario', 'source'],
  ['scenario', 'figure'],
  ['scenario', 'vars', '*'],
  ['scenario', 'derived', '*'],
  ['scenario', 'parts', '*', 'tolerance'],
  ['scenario', 'canonical', 'vars'],
  ['scenario', 'canonical', 'parts', '*'],
];

const DATA_URI = /^data:image\/(png|jpe?g|gif|svg\+xml|webp);base64,(.+)$/;

/**
 * Split a source document into one draft YAML per problem (§7):
 * `P<n>.` starts a problem, the trailing "(answer unit)" becomes the canonical
 * answer, numeric literals become draft variables with TODO ranges, and
 * images become figure stubs (copied into the set's figures/ directory).
 */
export async function importDocument(ctx: Context, file: string, opts: ImportOptions): Promise<ImportResult> {
  const src = resolve(file);
  if (!existsSync(src)) throw new CliError(`no such file: ${file}`);
  const blocks = await readBlocks(src);
  const { problems, sections, title } = splitProblems(blocks);
  if (problems.length === 0) throw new CliError('no problems found (expected paragraphs starting with "P<n>.")');

  const setDir = join(ctx.root, opts.set);
  const document = opts.document ?? documentName(src);
  const setFile = join(setDir, 'set.yaml');
  if (!existsSync(setFile)) {
    mkdirSync(setDir, { recursive: true });
    const set = parseSetDoc({ id: opts.set, title: opts.title ?? title ?? opts.set, source: { document }, sections });
    writeFileSync(setFile, newDocumentText(toStorableSet(set), { commentBefore: ` Imported from ${basename(src)}. Drafts are in drafts/.` }));
  }

  const result: ImportResult = {
    drafts: problems.length,
    written: 0,
    skipped: 0,
    withFigure: 0,
    imagesCopied: 0,
    sections,
    missingAnswers: [],
    inlineImages: [],
  };
  const copied = new Set<string>();
  let dataImages = 0;

  for (const p of problems) {
    const figures: Draft['figures'] = [];
    const roleOf = (img: string): Draft['figures'][number]['role'] =>
      p.sectionImages?.includes(img) ? 'section' : p.inlineImages?.includes(img) ? 'inline' : undefined;
    for (const img of [...(p.sectionImages ?? []), ...p.images]) {
      const role = roleOf(img);
      const data = DATA_URI.exec(img);
      let name: string;
      if (data) {
        name = `${document}-img${++dataImages}.${data[1] === 'svg+xml' ? 'svg' : data[1]}`;
        if (opts.figures !== false) {
          mkdirSync(join(setDir, 'figures'), { recursive: true });
          writeFileSync(join(setDir, 'figures', name), Buffer.from(data[2]!, 'base64'));
          result.imagesCopied++;
        }
        figures.push({ src: `figures/${name}`, original: '(embedded image)', ...(role && { role }) });
        continue;
      }
      name = basename(decodeURIComponent(img));
      const from = resolve(dirname(src), decodeURIComponent(img));
      if (opts.figures !== false && !copied.has(from) && existsSync(from)) {
        mkdirSync(join(setDir, 'figures'), { recursive: true });
        copyFileSync(from, join(setDir, 'figures', name));
        copied.add(from);
        result.imagesCopied++;
      }
      figures.push({ src: `figures/${name}`, original: img, ...(role && { role }) });
    }
    if (figures.some((f) => f.role === undefined)) result.withFigure++;
    if (!p.answer) result.missingAnswers.push(p.label);
    if (p.inlineImages?.length) result.inlineImages.push(p.label);

    const draft = buildDraft(p, { setId: opts.set, document, file: basename(src), figures });
    const out = join(setDir, 'drafts', draftFileName(p.number));
    if (existsSync(out) && !opts.force) {
      result.skipped++;
      continue;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      newDocumentText(draft, {
        commentBefore: ` Draft imported from ${basename(src)} — not yet a scenario.\n Resolve the TODOs, move \`scenario\` to ../scenarios/<id>.yaml, run \`pt check\`.`,
        flowPaths: DRAFT_FLOW_PATHS,
      }),
    );
    result.written++;
  }
  return result;
}

export async function runImport(ctx: Context, file: string, opts: ImportOptions): Promise<number> {
  const r = await importDocument(ctx, file, opts);
  const o = ctx.output;
  o.out(`${paint(o, 'green', '✓')} ${r.drafts} problem(s) → ${r.written} draft(s) written${r.skipped ? `, ${r.skipped} kept (use --force to overwrite)` : ''}`);
  o.out(`  ${r.withFigure} figure stub(s), ${r.imagesCopied} image(s) copied, ${r.sections.length} section(s)`);
  if (r.missingAnswers.length) {
    o.out(paint(o, 'yellow', `  ! no printed answer found for ${r.missingAnswers.join(', ')}`));
  }
  if (r.inlineImages.length) {
    o.out(paint(o, 'yellow', `  ! picture inside the text of ${r.inlineImages.join(', ')} (shown as [image]; fix by hand)`));
  }
  o.out(`  drafts: ${join(ctx.root, opts.set, 'drafts')}`);
  return 0;
}
