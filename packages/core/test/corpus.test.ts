import { describe, expect, it } from 'vitest';
import { checkCanonical, diagnoseScenario, instantiate } from '../src/index.ts';
import { loadCorpus } from './corpus.ts';

const corpus = loadCorpus();

describe('reference corpus', () => {
  it('has the 14 corpus problems C1\u2013C14', () => {
    const ids = corpus.map((s) => s.id);
    for (let i = 1; i <= 14; i++) {
      expect(ids.some((id) => id.startsWith(`c${String(i).padStart(2, '0')}-`))).toBe(true);
    }
  });

  describe.each(corpus.map((s) => [s.id, s] as const))('%s', (_id, scenario) => {
    it('has no semantic errors', () => {
      const errors = diagnoseScenario(scenario).filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('reproduces every printed source answer (canonical check)', () => {
      const report = checkCanonical(scenario);
      for (const p of report.parts) {
        expect(p.error, `${p.partId}: ${p.error?.message}`).toBeUndefined();
        expect(p.derivedMismatches, p.partId).toEqual([]);
        expect(
          { part: p.partId, ok: p.ok, computed: p.computed, expected: p.expectedInPartUnit },
        ).toMatchObject({ ok: true });
      }
      expect(report.ok).toBe(true);
    });

    it('instantiates across seeds', () => {
      for (let seed = 0; seed < 200; seed++) {
        const inst = instantiate(scenario, seed);
        for (const part of inst.parts) expect(Number.isFinite(part.modelAnswer)).toBe(true);
      }
    });
  });
});
