/** One cell of a `<NavGrid>`: unanswered / answered (or, in review, an outcome), optionally flagged and/or current. */
export interface NavItem {
  id: string;
  label: string;
  answered?: boolean;
  /** Review / checked state; takes precedence over `answered`. `notanswered`: left blank in a finished attempt. */
  outcome?: 'correct' | 'partial' | 'incorrect' | 'notanswered';
  flagged?: boolean;
  current?: boolean;
  /** Tooltip, e.g. "Question 3 - Answer saved". */
  title?: string;
}
