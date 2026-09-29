/** One cell of a `<NavGrid>`: unanswered / answered, optionally flagged and/or current. */
export interface NavItem {
  id: string;
  label: string;
  answered?: boolean;
  flagged?: boolean;
  current?: boolean;
}
