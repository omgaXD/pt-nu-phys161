/**
 * Open/closed state of the two side drawers, the course-index sections and the start page's
 * collapsible blocks, remembered like Moodle's user preferences.
 */

const KEY = 'pt-quiz-drawers';

interface Saved {
  left: boolean;
  right: boolean;
  /** Course-index sections the user collapsed (all start expanded). */
  collapsed: string[];
  /** Blocks that start collapsed and the user expanded. */
  opened: string[];
}

function load(): Saved {
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { left?: unknown; right?: unknown; collapsed?: unknown; opened?: unknown };
    return { left: v.left !== false, right: v.right !== false, collapsed: strings(v.collapsed), opened: strings(v.opened) };
  } catch {
    return { left: true, right: true, collapsed: [], opened: [] };
  }
}

class Drawers {
  left = $state(true);
  right = $state(true);
  collapsed = $state<string[]>([]);
  opened = $state<string[]>([]);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    const v = load();
    this.left = v.left;
    this.right = v.right;
    this.collapsed = v.collapsed;
    this.opened = v.opened;
  }

  set(side: 'left' | 'right', open: boolean): void {
    this[side] = open;
    this.save();
  }

  /** A course-index section (expanded until collapsed), or a block that starts collapsed (`byDefault` false). */
  isExpanded(section: string, byDefault = true): boolean {
    return byDefault ? !this.collapsed.includes(section) : this.opened.includes(section);
  }

  setExpanded(section: string, expanded: boolean, byDefault = true): void {
    const without = (list: string[]): string[] => list.filter((s) => s !== section);
    if (byDefault) this.collapsed = expanded ? without(this.collapsed) : [...without(this.collapsed), section];
    else this.opened = expanded ? [...without(this.opened), section] : without(this.opened);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ left: this.left, right: this.right, collapsed: this.collapsed, opened: this.opened }));
    } catch {
      // Private mode or blocked storage: the state just isn't remembered.
    }
  }
}

export const drawers = new Drawers();
