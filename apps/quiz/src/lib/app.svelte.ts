import { asset } from '$app/paths';
import type { Asset } from '$app/types';
import { parseScenario, type Scenario } from '@pt/core';
import {
  applyAttempt,
  applyQuestion,
  type Attempt,
  type AttemptAction,
  type BundleIndex,
  BundleIndexSchema,
  type BundleSet,
  BundleSetSchema,
  type CatalogSet,
  type HistoryEntry,
  isFinished,
  isLocked,
  type Mastery,
  materialize,
  memoryStorage,
  type QuestionSnapshot,
  type QuizConfig,
  QuizStorage,
  reduceAttempt,
  snapshotAtStart,
  type StorageLike,
  startAttempt,
} from '@pt/quiz';

/** A path under the static directory (content is generated, so not in SvelteKit's Asset union). */
export const contentUrl = (path: string): string => asset(`/content/${path}` as Asset);

/** localStorage when it works (private modes may throw), else memory. */
function browserStorage(): StorageLike {
  try {
    const s = window.localStorage;
    const probe = 'pt:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(contentUrl(path));
  if (!res.ok) throw new Error(`could not load ${path} (${res.status})`);
  return res.json();
}

export interface Prefs {
  config?: QuizConfig;
}

/**
 * The whole client state: content (loaded once), the attempt in progress,
 * mastery and history. Attempts change only through `reduceAttempt`, so the
 * state is replaced, never mutated (`$state.raw`).
 */
export class QuizApp {
  ready = $state(false);
  error = $state<string | null>(null);
  /** A one-off message for the next page (e.g. "Time is up"). */
  notice = $state<string | null>(null);
  index = $state.raw<BundleIndex | null>(null);
  sets = $state.raw<Record<string, BundleSet>>({});
  attempt = $state.raw<Attempt | null>(null);
  mastery = $state.raw<Mastery>({});
  history = $state.raw<HistoryEntry[]>([]);
  /** The attempt that just finished (review works even if storage failed). */
  lastFinished = $state.raw<Attempt | null>(null);

  storage: QuizStorage = new QuizStorage(memoryStorage());
  // Parsed scenarios; a plain cache, not reactive state.
  private parsed: Record<string, Scenario | null> = {};
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  async init(): Promise<void> {
    if (this.ready) return;
    try {
      this.storage = new QuizStorage(browserStorage());
      const index = BundleIndexSchema.parse(await fetchJson('index.json'));
      const loaded = await Promise.all(index.sets.map(async (s) => BundleSetSchema.parse(await fetchJson(`sets/${s.id}.json`))));
      this.index = index;
      this.sets = Object.fromEntries(loaded.map((s) => [s.setId, s]));
      this.mastery = this.storage.mastery();
      this.history = this.storage.history();
      const current = this.storage.loadCurrent();
      if (current) {
        this.attempt = current;
        this.dispatch({ type: 'tick', now: Date.now() });
        if (this.attempt && !isFinished(this.attempt)) this.ensureSnapshot(this.attempt.page);
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.ready = true;
  }

  /** The loaded sets in index order, as the selection logic sees them. */
  catalog(): CatalogSet[] {
    return (this.index?.sets ?? []).flatMap((s) => {
      const b = this.sets[s.id];
      return b ? [{ setId: s.id, questions: b.questions }] : [];
    });
  }

  setTitle(setId: string): string {
    return this.index?.sets.find((s) => s.id === setId)?.title ?? setId;
  }

  scenario(setId: string, scenarioId: string): Scenario | null {
    const key = `${setId}/${scenarioId}`;
    if (!(key in this.parsed)) {
      const raw = this.sets[setId]?.scenarios[scenarioId];
      const parse = (): Scenario | null => {
        try {
          return raw ? parseScenario(raw.scenario) : null;
        } catch {
          return null;
        }
      };
      this.parsed[key] = parse();
    }
    return this.parsed[key] ?? null;
  }

  resolveSrc(setId: string): (src: string) => string {
    return (src) => contentUrl(`assets/${setId}/${src}`);
  }

  /** Build question i's snapshot from the current content (null if it no longer exists). */
  snapshotFor(a: Attempt, i: number): QuestionSnapshot | null {
    const q = a.questions[i];
    if (!q) return null;
    const s = this.scenario(q.setId, q.scenarioId);
    if (!s || !s.parts.some((p) => p.id === q.partId)) return null;
    try {
      return materialize(q, s, q.seed, this.sets[q.setId]?.scenarios[q.scenarioId]?.hash ?? '');
    } catch {
      return null;
    }
  }

  private withSnapshot(a: Attempt, i: number): Attempt {
    if (a.snapshots[i] || a.unavailable[i]) return a;
    const snap = this.snapshotFor(a, i);
    return reduceAttempt(a, snap ? { type: 'snapshot', index: i, snapshot: snap } : { type: 'unavailable', index: i });
  }

  ensureSnapshot(i: number): void {
    if (!this.attempt) return;
    const next = this.withSnapshot(this.attempt, i);
    if (next !== this.attempt) {
      this.attempt = next;
      this.save();
    }
  }

  /** Start a new attempt (replacing any attempt in progress). */
  start(config: QuizConfig): { ok: true } | { ok: false; message: string } {
    if (!this.index) return { ok: false, message: 'Content is not loaded.' };
    const { attempt } = startAttempt({ config, catalog: this.catalog(), contentVersion: this.index.version, now: Date.now(), mastery: this.mastery });
    if (attempt.questions.length === 0) return { ok: false, message: 'No problems match this selection.' };
    let a = attempt;
    const upFront = snapshotAtStart(a) ? a.questions.map((_, i) => i) : [0];
    for (const i of upFront) a = this.withSnapshot(a, i);
    if (this.attempt && !isFinished(this.attempt)) this.storage.abandonCurrent();
    this.attempt = a;
    this.notice = null;
    this.save();
    try {
      this.storage.savePrefs({ config } satisfies Prefs);
    } catch {
      // Preferences are a convenience.
    }
    return { ok: true };
  }

  prefs(): Prefs {
    return this.storage.prefs<Prefs>() ?? {};
  }

  dispatch(action: AttemptAction): void {
    const before = this.attempt;
    if (!before) return;
    let next = reduceAttempt(before, action);
    if (next === before) return;
    if (action.type === 'goto') next = this.withSnapshot(next, next.page);

    if ((action.type === 'check' || action.type === 'reveal') && !isLocked(before, action.index) && isLocked(next, action.index)) {
      this.mastery = applyQuestion(this.mastery, next, action.index, action.now);
      this.persist(() => this.storage.saveMastery(this.mastery));
    }
    this.attempt = next;
    if (isFinished(next) && !isFinished(before)) this.complete(next);
    else if (action.type === 'answer') this.saveSoon();
    else this.save();
  }

  private complete(a: Attempt): void {
    clearTimeout(this.saveTimer);
    this.mastery = applyAttempt(this.mastery, a);
    this.lastFinished = a;
    this.persist(() => {
      this.storage.saveMastery(this.mastery);
      this.storage.archive(a);
    });
    this.history = this.storage.history();
    this.attempt = null;
    if (a.finishReason === 'timeout') this.notice = 'Time is up: your attempt was submitted automatically.';
  }

  /** Finished attempt by id, for review. */
  finished(id: string): Attempt | null {
    if (this.lastFinished?.id === id) return this.lastFinished;
    return this.storage.loadAttempt(id);
  }

  abandon(): void {
    clearTimeout(this.saveTimer);
    this.storage.abandonCurrent();
    this.attempt = null;
  }

  clearHistory(): void {
    this.storage.clearHistory();
    this.history = [];
    this.lastFinished = null;
  }

  resetMastery(): void {
    this.storage.clearMastery();
    this.mastery = {};
  }

  /** Submit when the deadline passes, even if the timer is not on screen. */
  watchDeadline(): () => void {
    const a = this.attempt;
    if (!a || a.endsAt === null || isFinished(a)) return () => {};
    const tick = (): void => this.dispatch({ type: 'tick', now: Date.now() });
    const t = setTimeout(tick, Math.max(0, a.endsAt - Date.now()) + 25);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  private persist(write: () => void): void {
    try {
      write();
    } catch (e) {
      this.error = `Could not save your progress in this browser (${e instanceof Error ? e.message : String(e)}).`;
    }
  }

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  /** Write the attempt in progress now (also on page hide). */
  save(): void {
    clearTimeout(this.saveTimer);
    const a = this.attempt;
    if (a && !isFinished(a)) this.persist(() => this.storage.saveCurrent(a));
  }
}

export const app = new QuizApp();
