import { type Attempt, summarizeAttempt } from './attempt.js';
import type { PresetId } from './config.js';
import type { Mastery } from './mastery.js';
import type { QuestionSnapshot } from './materialize.js';
import { AttemptSchema } from './transfer.js';

/** The subset of the Web Storage API used here (window.localStorage, or a fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A finished attempt in the history list. */
export interface HistoryEntry {
  id: string;
  preset: PresetId | 'custom';
  sets: string[];
  startedAt: number;
  finishedAt: number;
  finishReason: 'submitted' | 'timeout';
  marks: number;
  total: number;
  questions: number;
  /** The full attempt (for review) is still stored. */
  full: boolean;
}

export interface QuizStorageOptions {
  /** Finished attempts kept in full for review (older ones keep only their summary). Default 10. */
  keepFull?: number;
  /** Key prefix. Default `pt:v1:`. */
  prefix?: string;
}

function isQuotaError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(e.message));
}

/**
 * Everything the quiz keeps in the browser: the attempt in progress, finished
 * attempts (history, with full data for the last few), per-problem mastery and
 * preferences. Snapshots are stored under their own key because they change
 * rarely while answers change on every keystroke.
 */
export class QuizStorage {
  private readonly keepFull: number;
  private readonly prefix: string;
  /** Number of snapshots last written per attempt (skip rewriting unchanged snapshots). */
  private readonly written = new Map<string, number>();

  constructor(
    private readonly storage: StorageLike,
    opts: QuizStorageOptions = {},
  ) {
    this.keepFull = opts.keepFull ?? 10;
    this.prefix = opts.prefix ?? 'pt:v1:';
  }

  private key(name: string): string {
    return this.prefix + name;
  }

  private read<T>(name: string): T | null {
    try {
      const s = this.storage.getItem(this.key(name));
      return s === null ? null : (JSON.parse(s) as T);
    } catch {
      return null;
    }
  }

  private updateHistory(next: (stored: HistoryEntry[]) => HistoryEntry[]): void {
    for (;;) {
      try {
        this.storage.setItem(this.key('history'), JSON.stringify(next(this.history())));
        return;
      } catch (e) {
        if (!isQuotaError(e) || !this.evictOldest()) throw e;
      }
    }
  }

  /** Write, evicting the oldest full attempts from history until it fits. */
  private write(name: string, value: unknown): void {
    const text = JSON.stringify(value);
    for (;;) {
      try {
        this.storage.setItem(this.key(name), text);
        return;
      } catch (e) {
        if (!isQuotaError(e) || !this.evictOldest()) throw e;
      }
    }
  }

  private evictOldest(): boolean {
    const history = this.history();
    const victim = [...history].reverse().find((h) => h.full);
    if (!victim) return false;
    this.removeFull(victim.id);
    this.storage.setItem(this.key('history'), JSON.stringify(history.map((h) => (h.id === victim.id ? { ...h, full: false } : h))));
    return true;
  }

  private removeFull(id: string): void {
    this.storage.removeItem(this.key(`attempt:${id}`));
    this.storage.removeItem(this.key(`snap:${id}`));
    this.written.delete(id);
  }

  private saveAttempt(a: Attempt): void {
    const count = a.snapshots.filter(Boolean).length;
    if (this.written.get(a.id) !== count) {
      this.write(`snap:${a.id}`, a.snapshots);
      this.written.set(a.id, count);
    }
    this.write(`attempt:${a.id}`, { ...a, snapshots: null });
  }

  /** The stored attempt with these snapshots, checked and brought up to date; null when missing or damaged. */
  private parseAttempt(id: string, snapshots: readonly (QuestionSnapshot | null)[]): Attempt | null {
    const a = this.read<Omit<Attempt, 'snapshots'> & { snapshots: null }>(`attempt:${id}`);
    if (!a || a.format !== 1 || !Array.isArray(a.questions)) return null;
    const r = AttemptSchema.safeParse({ ...a, snapshots: a.questions.map((_, i) => snapshots[i] ?? null) });
    // Snapshots and grading results are checked for shape only; they are what this app wrote.
    return r.success ? (r.data as unknown as Attempt) : null;
  }

  loadAttempt(id: string): Attempt | null {
    const snapshots = this.read<(QuestionSnapshot | null)[]>(`snap:${id}`) ?? [];
    const a = this.parseAttempt(id, snapshots);
    if (a) this.written.set(id, snapshots.filter(Boolean).length);
    return a;
  }

  /** Whether a finished attempt is still stored, undamaged, so its review opens (snapshots are rebuilt when missing). */
  reviewable(id: string): boolean {
    const a = this.parseAttempt(id, []);
    return a !== null && a.finishedAt !== null;
  }

  // ---- The attempt in progress ------------------------------------------

  loadCurrent(): Attempt | null {
    const id = this.read<string>('current');
    return id === null ? null : this.loadAttempt(id);
  }

  saveCurrent(a: Attempt): void {
    this.saveAttempt(a);
    this.write('current', a.id);
  }

  /** Drop the attempt in progress without recording it. */
  abandonCurrent(): void {
    const id = this.read<string>('current');
    if (id !== null) this.removeFull(id);
    this.storage.removeItem(this.key('current'));
  }

  /** Move a finished attempt into the history. */
  archive(a: Attempt): void {
    if (a.finishedAt === null || a.finishReason === null) throw new Error('only finished attempts are archived');
    const s = summarizeAttempt(a);
    const entry: HistoryEntry = {
      id: a.id,
      preset: a.preset,
      sets: a.config.sets,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      finishReason: a.finishReason,
      marks: s.marks,
      total: s.total,
      questions: a.questions.length,
      full: true,
    };
    this.saveAttempt(a);
    // Recomputed from what is stored on every try: writing may evict older attempts.
    this.updateHistory((stored) => {
      let full = 0;
      return [entry, ...stored.filter((h) => h.id !== a.id)].map((h) => {
        if (!h.full || ++full <= this.keepFull) return h;
        this.removeFull(h.id);
        return { ...h, full: false };
      });
    });
    if (this.read<string>('current') === a.id) this.storage.removeItem(this.key('current'));
  }

  /** Store a change to a finished attempt (a flag set in the review), if it is still kept in full. */
  updateFinished(a: Attempt): void {
    if (a.finishedAt === null || !this.history().some((h) => h.id === a.id && h.full)) return;
    this.saveAttempt(a);
  }

  // ---- History, mastery, preferences ------------------------------------

  history(): HistoryEntry[] {
    return this.read<HistoryEntry[]>('history') ?? [];
  }

  clearHistory(): void {
    for (const h of this.history()) this.removeFull(h.id);
    this.storage.removeItem(this.key('history'));
  }

  /** The history and every finished attempt still kept in full (for a saved-state file). */
  exportHistory(): { entries: HistoryEntry[]; attempts: Attempt[] } {
    const entries = this.history();
    const attempts = entries.flatMap((h) => {
      const a = h.full ? this.loadAttempt(h.id) : null;
      return a ? [a] : [];
    });
    return { entries, attempts };
  }

  /**
   * Replace the history with `entries` (newest first). An entry keeps its full
   * data when `attempts` has it or it is already stored here; past `keepFull`,
   * only the summary is kept, as in `archive`.
   */
  importHistory(entries: readonly HistoryEntry[], attempts: readonly Attempt[]): void {
    const given = new Map(attempts.filter((a) => a.finishedAt !== null).map((a) => [a.id, a]));
    const storedFull = new Set(this.history().flatMap((h) => (h.full ? [h.id] : [])));
    let full = 0;
    const next = entries.map((h): HistoryEntry => {
      const has = given.has(h.id) || storedFull.has(h.id);
      return { ...h, full: has && ++full <= this.keepFull };
    });
    const keep = new Set(next.flatMap((h) => (h.full ? [h.id] : [])));
    for (const id of storedFull) if (!keep.has(id) || given.has(id)) this.removeFull(id);
    this.updateHistory(() => next);
    // Newest first: if space runs out, writing evicts the oldest full attempts.
    for (const h of next) {
      const a = given.get(h.id);
      if (!a || !this.history().find((x) => x.id === h.id)?.full) continue;
      this.saveAttempt(a);
      if (!this.history().find((x) => x.id === h.id)?.full) this.removeFull(h.id);
    }
  }

  mastery(): Mastery {
    return this.read<Mastery>('mastery') ?? {};
  }

  saveMastery(m: Mastery): void {
    this.write('mastery', m);
  }

  clearMastery(): void {
    this.storage.removeItem(this.key('mastery'));
  }

  prefs<T>(): T | null {
    return this.read<T>('prefs');
  }

  savePrefs(p: unknown): void {
    this.write('prefs', p);
  }
}

/** An in-memory StorageLike (tests, and a fallback when localStorage is unavailable). */
export function memoryStorage(quota = Number.POSITIVE_INFINITY): StorageLike & { size(): number; keys(): string[] } {
  const m = new Map<string, string>();
  const size = (): number => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      const before = m.get(k);
      m.set(k, v);
      if (size() > quota) {
        if (before === undefined) m.delete(k);
        else m.set(k, before);
        const e = new Error('quota exceeded');
        e.name = 'QuotaExceededError';
        throw e;
      }
    },
    removeItem: (k) => {
      m.delete(k);
    },
    size,
    keys: () => [...m.keys()],
  };
}
