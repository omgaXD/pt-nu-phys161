/** Open/closed state of the two side drawers and of the course-index sections, remembered like Moodle's user preferences. */

const KEY = 'pt-quiz-drawers';

interface Saved {
  left: boolean;
  right: boolean;
  /** Course-index sections the user collapsed (all start expanded). */
  collapsed: string[];
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { left?: unknown; right?: unknown; collapsed?: unknown };
    const collapsed = Array.isArray(v.collapsed) ? v.collapsed.filter((s): s is string => typeof s === 'string') : [];
    return { left: v.left !== false, right: v.right !== false, collapsed };
  } catch {
    return { left: true, right: true, collapsed: [] };
  }
}

class Drawers {
  left = $state(true);
  right = $state(true);
  collapsed = $state<string[]>([]);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    const v = load();
    this.left = v.left;
    this.right = v.right;
    this.collapsed = v.collapsed;
  }

  set(side: 'left' | 'right', open: boolean): void {
    this[side] = open;
    this.save();
  }

  isExpanded(section: string): boolean {
    return !this.collapsed.includes(section);
  }

  setExpanded(section: string, expanded: boolean): void {
    this.collapsed = expanded ? this.collapsed.filter((s) => s !== section) : [...this.collapsed.filter((s) => s !== section), section];
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ left: this.left, right: this.right, collapsed: this.collapsed }));
    } catch {
      // Private mode or blocked storage: the state just isn't remembered.
    }
  }
}

export const drawers = new Drawers();
