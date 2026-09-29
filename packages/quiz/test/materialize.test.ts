import { gradePart, instantiate, instantiateAt, responseFromFields } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { materialize, sourceRandoms } from '../src/index.ts';
import { corpus, corpusById, corpusCatalog } from './helpers.ts';

const catalog = corpusCatalog();

describe('materialize', () => {
  it('grades a snapshot exactly like the live instance (every corpus question, 50 seeds)', () => {
    for (const q of catalog.questions) {
      const s = corpusById.get(q.scenarioId)!;
      const part = s.parts.find((p) => p.id === q.partId)!;
      for (let seed = 0; seed < 50; seed++) {
        const snap = materialize(q, s, seed, 'h');
        expect(snap.instance.parts).toHaveLength(1);
        expect(snap.instance.values).toEqual({});
        const live = instantiate(s, seed);
        const ip = live.parts.find((p) => p.partId === q.partId)!;
        expect(snap.instance.parts[0]).toEqual(ip);
        expect(snap.instance.narrativeHtml).toBe(live.narrativeHtml);
        for (const typed of [String(ip.modelAnswer), `${ip.modelAnswer * 1.2}`, '']) {
          const fields = { value: ip.unit ? `${typed} ${ip.unit}` : typed, unit: '' };
          expect(gradePart(snap.part, snap.instance.parts[0]!, responseFromFields(ip, fields))).toEqual(
            gradePart(part, live, responseFromFields(ip, fields)),
          );
        }
      }
    }
  });

  it('with the source values, every printed answer scores full marks', () => {
    for (const q of catalog.questions) {
      const s = corpusById.get(q.scenarioId)!;
      const snap = materialize(q, s, null, 'h');
      expect(snap.sourceValues).toBe(true);
      const cp = s.canonical.parts.find((c) => c.source === q.label)!;
      const ip = snap.instance.parts[0]!;
      const typed = cp.unit ? `${cp.answer} ${cp.unit}` : String(cp.answer);
      expect(gradePart(snap.part, ip, responseFromFields(ip, { value: typed, unit: '' })).fraction, `${q.label} ${typed}`).toBe(1);
    }
  });

  it('uses each sibling problem its own source values', () => {
    const roller = corpusById.get('c13-printing-roller')!;
    expect(sourceRandoms(roller, 'omega-average', 'P116')).toMatchObject({ gamma: 2.9, beta: 0.41 });
    expect(sourceRandoms(roller, 'omega-at-t', 'P115')).toMatchObject({ gamma: 3.2, beta: 0.43 });
    expect(sourceRandoms(roller, 'omega-at-t')).toMatchObject({ gamma: 3.2 });
  });

  it('falls back to derived seeds, then to the source values, when constraints cannot be met', () => {
    const s = structuredClone(corpus.find((x) => x.id === 'c01-push-work')!);
    s.constraints = ['m < 0'];
    s.maxSampleAttempts = 3;
    const q = catalog.questions.find((x) => x.scenarioId === 'c01-push-work')!;
    const snap = materialize(q, s, 7, 'h');
    expect(snap.sourceValues).toBe(true);
    expect(snap.instance.parts[0]!.modelAnswer).toBeCloseTo(instantiateAt(s, s.canonical.vars).parts[0]!.modelAnswer);
  });

  it('keeps the grading fields of the part', () => {
    const q = catalog.questions.find((x) => x.label === 'P88')!;
    const snap = materialize(q, corpusById.get(q.scenarioId)!, 1, 'h');
    expect(snap.part).toMatchObject({ id: q.partId, integer: true });
  });
});
