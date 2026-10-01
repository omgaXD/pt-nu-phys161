import { difficultyFilter, type PresetId, type QuestionState, type QuizConfig } from '@pt/quiz';
import type { NavItem } from '@pt/ui';

export const PRESET_INFO: Record<PresetId, { name: string; blurb: string }> = {
  ordered: { name: 'Ordered', blurb: 'Every problem of the selected sets in order, one at a time, with a Check button.' },
  exam: { name: 'Exam', blurb: 'Seven problems from different sections, 40 minutes, marks only at the end.' },
  chaotic: { name: 'Chaotic', blurb: 'Like Ordered, but in random order.' },
};

export function presetName(p: PresetId | 'custom'): string {
  return p === 'custom' ? 'Custom quiz' : PRESET_INFO[p].name;
}

/** Moodle's wording for question states. */
export const STATE_TEXT: Record<QuestionState, string> = {
  notyetanswered: 'Not yet answered',
  answersaved: 'Answer saved',
  correct: 'Correct',
  partiallycorrect: 'Partially correct',
  incorrect: 'Incorrect',
  revealed: 'Correct answer shown',
  notanswered: 'Not answered',
  unavailable: 'Unavailable',
};

export function navState(state: QuestionState): Pick<NavItem, 'answered' | 'outcome'> {
  switch (state) {
    case 'correct':
      return { answered: true, outcome: 'correct' };
    case 'partiallycorrect':
      return { answered: true, outcome: 'partial' };
    case 'incorrect':
    case 'revealed':
      return { answered: true, outcome: 'incorrect' };
    case 'answersaved':
      return { answered: true };
    default:
      return { answered: false };
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} min` : '', `${sec} sec${sec === 1 ? '' : 's'}`];
  return parts.filter(Boolean).slice(0, 2).join(' ');
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatMark(x: number): string {
  return x.toFixed(2);
}

/** One line describing a configuration: "7 questions · 40 min · feedback at the end". */
export function describeConfig(c: QuizConfig, questions: number): string {
  const d = difficultyFilter(c.difficulty);
  return [
    `${questions} question${questions === 1 ? '' : 's'}`,
    c.order === 'shuffled' ? 'shuffled' : 'in order',
    c.values === 'source' ? 'source values' : 'randomized values',
    ...(d ? [`difficulty ${d.min === d.max ? d.min : `${d.min}–${d.max}`}${d.unrated ? ' (+ unrated)' : ''}`] : []),
    c.timeLimitMinutes !== null ? `${c.timeLimitMinutes} min` : 'no time limit',
    c.feedback === 'immediate'
      ? `Check after each${c.maxTries !== null ? ` (${c.maxTries} ${c.maxTries === 1 ? 'try' : 'tries'})` : ''}`
      : 'feedback at the end',
  ].join(' · ');
}
