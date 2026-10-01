/** Moodle's core/toast: short messages at the top of the window, e.g. after an action. */

export type ToastKind = 'success' | 'info' | 'warning' | 'danger';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** Hidden by the user (a close button) rather than after a delay. */
  closeButton: boolean;
}

/** Moodle's default delay before a toast hides itself. */
const DELAY = 4000;

class Toasts {
  list = $state<Toast[]>([]);
  private next = 0;

  /** Show a message; it hides itself after a few seconds unless it has a close button. */
  add(text: string, kind: ToastKind = 'success', opts: { closeButton?: boolean } = {}): void {
    const toast: Toast = { id: this.next++, kind, text, closeButton: opts.closeButton ?? false };
    this.list = [...this.list, toast];
    if (!toast.closeButton) setTimeout(() => this.remove(toast.id), DELAY);
  }

  remove(id: number): void {
    this.list = this.list.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
