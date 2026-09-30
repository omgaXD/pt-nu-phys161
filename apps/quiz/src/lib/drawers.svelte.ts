/** Open/closed state of the two side drawers, remembered like Moodle's user preference. */

const KEY = 'pt-quiz-drawers';

function load(): { left: boolean; right: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { left?: unknown; right?: unknown };
    return { left: v.left !== false, right: v.right !== false };
  } catch {
    return { left: true, right: true };
  }
}

class Drawers {
  left = $state(true);
  right = $state(true);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    const v = load();
    this.left = v.left;
    this.right = v.right;
  }

  set(side: 'left' | 'right', open: boolean): void {
    this[side] = open;
    try {
      localStorage.setItem(KEY, JSON.stringify({ left: this.left, right: this.right }));
    } catch {
      // Private mode or blocked storage: the state just isn't remembered.
    }
  }
}

export const drawers = new Drawers();
