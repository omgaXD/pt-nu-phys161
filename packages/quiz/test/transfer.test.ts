import { describe, expect, it } from 'vitest';
import {
  type Attempt,
  createStateFile,
  defaultConfig,
  type HistoryEntry,
  type MasteryEntry,
  materialize,
  memoryStorage,
  mergeHistory,
  mergeMastery,
  parseStateFile,
  QuizStorage,
  reduceAttempt,
  resumeAttempt,
  startAttempt,
} from '../src/index.ts';
import { corpusById, corpusCatalog } from './helpers.ts';

const catalog = [corpusCatalog()];

function attempt(id: string, preset: 'ordered' | 'exam' = 'exam', now = 1000): Attempt {
  let { attempt: a } = startAttempt({ config: { ...defaultConfig(['corpus'], preset), seed: 3 }, catalog, contentVersion: 'v', now, id });
  a.questions.forEach((q, index) => {
    a = reduceAttempt(a, { type: 'snapshot', index, snapshot: materialize(q, corpusById.get(q.scenarioId)!, q.seed, 'h') });
  });
  return a;
}

function finished(id: string, now = 5000): Attempt {
  return reduceAttempt(attempt(id), { type: 'finish', now, reason: 'submitted' });
}

const entry = (lastAt: number, solved: boolean, attempts = 1, lastAttemptId = `a${lastAt}`): MasteryEntry => ({
  attempts,
  solved,
  lastFraction: solved ? 1 : 0,
  lastAt,
  lastAttemptId,
});

const summary = (id: string, finishedAt: number, full = true): HistoryEntry => ({
  id,
  preset: 'exam',
  sets: ['corpus'],
  startedAt: 0,
  finishedAt,
  finishReason: 'submitted',
  marks: 0,
  total: 7,
  questions: 7,
  full,
});

describe('saved-state files', () => {
  it('round-trip the attempt in progress, progress, history and preferences', () => {
    let a = attempt('cur', 'ordered');
    const ip = a.snapshots[0]!.instance.parts[0]!;
    a = reduceAttempt(a, { type: 'answer', index: 0, answer: { value: `${ip.modelAnswer} ${ip.unit ?? ''}`.trim(), unit: '' } });
    a = reduceAttempt(a, { type: 'check', index: 0, now: 1500 });
    a = reduceAttempt(a, { type: 'goto', page: 2 });
    const done = finished('old');
    const file = createStateFile({
      now: 2000,
      contentVersion: 'v',
      mastery: { 'corpus/P1': entry(1500, true) },
      attempt: a,
      history: { entries: [summary('old', 5000)], attempts: [done] },
      prefs: { config: a.config },
    });
    const parsed = parseStateFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file).toEqual(JSON.parse(JSON.stringify(file)));
    expect(parsed.file.attempt!.page).toBe(2);
    expect(parsed.file.attempt!.checks[0]).toHaveLength(1);
  });

  it('leave out what is empty or finished', () => {
    const file = createStateFile({ now: 1, contentVersion: null, mastery: {}, attempt: finished('f'), history: { entries: [], attempts: [] }, prefs: null });
    expect(Object.keys(file).sort()).toEqual(['contentVersion', 'exportedAt', 'format', 'kind']);
    expect(parseStateFile(JSON.stringify(file)).ok).toBe(true);
  });

  it('reject what is not one, with a readable message', () => {
    const msg = (text: string): string => {
      const r = parseStateFile(text);
      return r.ok ? 'ok' : r.message;
    };
    expect(msg('{nope')).toMatch(/not JSON/);
    expect(msg('{"kind":"something-else","format":1}')).toMatch(/not a saved quiz state/);
    expect(msg('{"kind":"pt-quiz-state","format":2,"exportedAt":1,"contentVersion":null}')).toMatch(/newer version/);

    const a = attempt('bad');
    const broken = { ...createStateFile({ now: 1, contentVersion: 'v', mastery: {}, attempt: a, history: { entries: [], attempts: [] }, prefs: null }) };
    expect(msg(JSON.stringify({ ...broken, attempt: { ...a, answers: a.answers.slice(1) } }))).toMatch(/damaged \(attempt\.answers/);
    expect(msg(JSON.stringify({ ...broken, attempt: { ...a, page: a.questions.length } }))).toMatch(/damaged \(attempt\.page/);
    expect(msg(JSON.stringify({ ...broken, attempt: finished('done') }))).toMatch(/already finished/);
  });
});

describe('merging', () => {
  it('progress: solved on either side stays solved, the newer result wins, attempts are not added up', () => {
    const here = { 's/P1': entry(10, true, 3), 's/P2': entry(30, false, 1), 's/P3': entry(5, false) };
    const incoming = { 's/P1': entry(20, false, 2), 's/P2': entry(25, true, 4), 's/P4': entry(1, true) };
    const m = mergeMastery(here, incoming);
    expect(m['s/P1']).toEqual({ ...entry(20, false, 3), solved: true });
    expect(m['s/P2']).toEqual({ ...entry(30, false, 4), solved: true });
    expect(m['s/P3']).toEqual(here['s/P3']);
    expect(m['s/P4']).toEqual(incoming['s/P4']);
    expect(mergeMastery(m, m)).toEqual(m);
  });

  it('history: one entry per attempt, the full one preferred, newest first', () => {
    const merged = mergeHistory([summary('a', 10, false), summary('b', 30)], [summary('a', 10, true), summary('c', 20)]);
    expect(merged.map((h) => [h.id, h.full])).toEqual([
      ['b', true],
      ['c', true],
      ['a', true],
    ]);
  });
});

describe('resumeAttempt', () => {
  it('keeps the time that was left at export', () => {
    const a = { ...attempt('t', 'exam', 1000), endsAt: 1000 + 40 * 60_000 };
    const exportedAt = 1000 + 17 * 60_000;
    const r = resumeAttempt(a, exportedAt, 1_000_000_000);
    expect(r.endsAt! - 1_000_000_000).toBe(23 * 60_000);
    expect(exportedAt - a.startedAt).toBe(1_000_000_000 - r.startedAt);
    // The importing browser's clock may be behind the exporting one's.
    expect(resumeAttempt(a, exportedAt, 0).endsAt).toBe(23 * 60_000);
  });

  it('leaves an untimed attempt without a deadline', () => {
    expect(resumeAttempt(attempt('u', 'ordered'), 5000, 9000).endsAt).toBeNull();
  });
});

describe('QuizStorage history export and import', () => {
  it('exports the entries with the full attempts still kept', () => {
    const s = new QuizStorage(memoryStorage(), { keepFull: 1 });
    s.archive(finished('h1', 100));
    s.archive(finished('h2', 200));
    const { entries, attempts } = s.exportHistory();
    expect(entries.map((h) => [h.id, h.full])).toEqual([
      ['h2', true],
      ['h1', false],
    ]);
    expect(attempts.map((a) => a.id)).toEqual(['h2']);
  });

  it('imports entries and attempts, keeping keepFull of them in full and dropping replaced data', () => {
    const mem = memoryStorage();
    const s = new QuizStorage(mem, { keepFull: 2 });
    s.archive(finished('here', 100));
    const incoming = [finished('n1', 300), finished('n2', 200)];
    s.importHistory([summary('n1', 300), summary('n2', 200), summary('n3', 150, false)], incoming);
    expect(s.history().map((h) => [h.id, h.full])).toEqual([
      ['n1', true],
      ['n2', true],
      ['n3', false],
    ]);
    expect(s.loadAttempt('n2')).toEqual(incoming[1]);
    expect(s.loadAttempt('here')).toBeNull();
    expect(mem.keys().filter((k) => k.includes('here'))).toEqual([]);
  });

  it('merged imports keep the full data already stored here', () => {
    const s = new QuizStorage(memoryStorage(), { keepFull: 10 });
    const here = finished('here', 100);
    s.archive(here);
    s.importHistory(mergeHistory(s.history(), [summary('n1', 300)]), [finished('n1', 300)]);
    expect(s.history().map((h) => [h.id, h.full])).toEqual([
      ['n1', true],
      ['here', true],
    ]);
    expect(s.loadAttempt('here')).toEqual(here);
  });

  it('marks an entry summary-only when its attempt is not in the file', () => {
    const s = new QuizStorage(memoryStorage());
    s.importHistory([summary('gone', 100, true)], []);
    expect(s.history()).toEqual([summary('gone', 100, false)]);
  });
});
