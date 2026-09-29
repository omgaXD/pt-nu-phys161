import type { SourceBlock } from './html.js';

export interface PrintedAnswer {
  value: number;
  unit?: string;
  /** As printed, e.g. "1.152E+16 J". */
  raw: string;
}

export interface SourceProblem {
  /** "P12" */
  label: string;
  number: number;
  section?: string;
  /** Normalised full text including the printed answer. */
  text: string;
  /** Source text with <sup>/<sub> preserved. */
  raw: string;
  /** Text with the trailing "(answer unit)" removed. */
  question: string;
  answer?: PrintedAnswer;
  images: string[];
  /** Images set inside the running text (a symbol pasted as a picture). */
  inlineImages?: string[];
  /**
   * Images that sat between a section heading and its first problem: a
   * reference sheet for the whole section, not this problem's figure.
   */
  sectionImages?: string[];
}

/** `P12.`, and the `P.76.` / `P 76 .` variants some exports use. */
export const LABEL_RE = /^P\.?\s*(\d+)\s*\.\s*/;

/** Normalise a printed unit: "kg m^2", "N m", "days" → "day"… */
export function normalizePrintedUnit(unit: string): string | undefined {
  const u = unit
    .replace(/[·⋅*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\/ /g, '/')
    .trim();
  if (!u) return undefined;
  return u;
}

/** Section heading text as a clean name: "Friction:" → "Friction", curly quotes → straight. */
export function cleanSectionName(heading: string): string {
  return heading
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s*:\s*$/, '')
    .trim();
}

// A printed value: digit groups ("3 446 932.845"), a decimal comma ("0,00133459"),
// or an ordinary number with optional exponent ("1.152E+16").
const PRINTED_VALUE = /^([-+]?\d{1,3}(?: \d{3})+(?:\.\d+)?|[-+]?0,\d+|[-+]?\d[\d.]*(?:[eE][-+]?\d+)?)(?![\d,])\s*(.*)$/s;

/**
 * Pull the trailing "(value unit)" off a problem statement. The closing
 * bracket may be followed by stray punctuation ("(6.8926 m).", "(45)]"), and
 * the unit may itself contain brackets ("J/(kg K)").
 */
export function splitAnswer(text: string): { question: string; answer?: PrintedAnswer } {
  const trimmed = text.replace(/[\s.\]]+$/, '');
  if (!trimmed.endsWith(')')) return { question: text.trim() };
  let depth = 0;
  let open = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const c = trimmed[i];
    if (c === ')') depth++;
    else if (c === '(' && --depth === 0) {
      open = i;
      break;
    }
  }
  if (open < 0) return { question: text.trim() };
  const inner = trimmed
    .slice(open + 1, -1)
    .replace(/\.\s*$/, '')
    .trim();
  const m = PRINTED_VALUE.exec(inner);
  if (!m) return { question: text.trim() };
  const valueText = m[1]!;
  const value = Number(valueText.replace(/ /g, '').replace(',', '.'));
  if (!Number.isFinite(value)) return { question: text.trim() };
  const unitText = m[2]!.trim();
  // The unit must look like a unit, not prose: "(24)" or "(24 cars)" are fine, "(3 of them)" is not.
  if (unitText && !/^[\p{L}°%µΩ][\p{L}\d°%µΩ^/()·⋅*\s.-]*$/u.test(unitText)) return { question: text.trim() };
  const unit = normalizePrintedUnit(unitText);
  return {
    question: trimmed.slice(0, open).trim(),
    answer: { value, ...(unit !== undefined && { unit }), raw: `${valueText}${unitText ? ` ${unitText}` : ''}` },
  };
}

/**
 * Split blocks into problems on `P<n>.` (§7). Paragraphs that do not start a
 * new problem continue the current one; images attach to the problem they
 * follow; headings set the section. A leading document title is ignored.
 */
export function splitProblems(blocks: readonly SourceBlock[]): { problems: SourceProblem[]; sections: string[]; title?: string } {
  const problems: SourceProblem[] = [];
  const sections: string[] = [];
  let title: string | undefined;
  let section: string | undefined;
  let current: SourceProblem | null = null;

  const finish = (): void => {
    if (!current) return;
    const { question, answer } = splitAnswer(current.text);
    current.question = question;
    if (answer) current.answer = answer;
    problems.push(current);
    current = null;
  };

  // Images between a heading and the section's first problem.
  let pendingSectionImages: string[] = [];

  for (const b of blocks) {
    const m = LABEL_RE.exec(b.text);
    // A problem styled as a heading is still a problem.
    if (b.kind === 'heading' && !m) {
      finish();
      const name = cleanSectionName(b.text);
      if (problems.length === 0 && section === undefined && title === undefined && sections.length === 0 && /exam|test|quiz|set|chapter/i.test(name)) {
        title = name;
        continue;
      }
      section = name;
      if (!sections.includes(section)) sections.push(section);
      continue;
    }
    if (m) {
      finish();
      current = {
        label: `P${m[1]}`,
        number: Number(m[1]),
        ...(section !== undefined && { section }),
        text: b.text.slice(m[0].length),
        raw: b.raw.replace(LABEL_RE, ''),
        question: '',
        images: [...b.images],
        ...(b.inlineImages && { inlineImages: [...b.inlineImages] }),
        ...(pendingSectionImages.length > 0 && { sectionImages: pendingSectionImages }),
      };
      pendingSectionImages = [];
      continue;
    }
    if (current) {
      if (b.text) {
        current.text = `${current.text} ${b.text}`.trim();
        current.raw = `${current.raw}\n${b.raw}`.trim();
      }
      current.images.push(...b.images);
      if (b.inlineImages) (current.inlineImages ??= []).push(...b.inlineImages);
    } else if (section !== undefined) {
      pendingSectionImages.push(...b.images);
    }
  }
  finish();
  return { problems, sections, ...(title !== undefined && { title }) };
}
