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
}

const LABEL_RE = /^P(\d+)\.\s*/;

/** Normalise a printed unit: "kg m^2", "N m", "days" → "day"… */
export function normalizePrintedUnit(unit: string): string | undefined {
  const u = unit
    .replace(/[·⋅*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!u) return undefined;
  return u;
}

/** Pull the trailing "(value unit)" off a problem statement. */
export function splitAnswer(text: string): { question: string; answer?: PrintedAnswer } {
  const m = /\(\s*([-+]?\d[\d.]*(?:[eE][-+]?\d+)?)\s*([^()]*?)\s*\)\s*$/.exec(text);
  if (!m) return { question: text.trim() };
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return { question: text.trim() };
  const unit = normalizePrintedUnit(m[2]!);
  return {
    question: text.slice(0, m.index).trim(),
    answer: { value, ...(unit !== undefined && { unit }), raw: `${m[1]}${m[2] ? ` ${m[2]}` : ''}`.trim() },
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

  for (const b of blocks) {
    if (b.kind === 'heading') {
      finish();
      if (problems.length === 0 && section === undefined && title === undefined && sections.length === 0 && /exam|test|quiz|set|chapter/i.test(b.text)) {
        title = b.text;
        continue;
      }
      section = b.text;
      if (!sections.includes(section)) sections.push(section);
      continue;
    }
    const m = LABEL_RE.exec(b.text);
    if (m) {
      finish();
      current = {
        label: `P${m[1]}`,
        number: Number(m[1]),
        ...(section !== undefined && { section }),
        text: b.text.slice(m[0].length),
        raw: b.raw.replace(/^P\d+\.\s*/, ''),
        question: '',
        images: [...b.images],
      };
      continue;
    }
    if (current) {
      if (b.text) {
        current.text = `${current.text} ${b.text}`.trim();
        current.raw = `${current.raw}\n${b.raw}`.trim();
      }
      current.images.push(...b.images);
    }
  }
  finish();
  return { problems, sections, ...(title !== undefined && { title }) };
}
