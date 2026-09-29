import type { ScenarioInput } from '../schema/scenario.js';
import type { SeedSet } from '../repo/memory.js';

/** C1 (P1) — the baseline scenario, used by the conformance suite. */
export const C1: ScenarioInput = {
  id: 'c01-push-work',
  title: 'Work pushing a mass on a frictionless surface',
  source: { document: 'PHYS161', labels: ['P1'] },
  section: 'Work',
  tags: ['work', 'baseline'],
  narrative:
    'A mass of {m:unit} is pushed (not pulled) horizontally a distance of {d:unit} by a force of {F:unit} on a horizontal frictionless surface.',
  vars: [
    { name: 'm', kind: 'range', min: 20, max: 90, step: 0.5, decimals: 1, unit: 'kg' },
    { name: 'd', kind: 'range', min: 1, max: 5, step: 0.1, decimals: 1, unit: 'm' },
    { name: 'F', kind: 'range', min: 40, max: 100, step: 0.1, decimals: 1, unit: 'N' },
  ],
  parts: [
    {
      id: 'work',
      prompt: 'Determine the work necessary to push the mass. {_0}{_u}',
      answer: 'F * d',
      unit: 'J',
      tolerance: { rel: 0.01 },
      difficulty: 1,
    },
  ],
  canonical: {
    vars: { m: 66.5, d: 2.6, F: 73.8 },
    parts: [{ id: 'work', answer: 191.88, unit: 'J', source: 'P1' }],
  },
};

function simple(id: string, section: string, extra: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    id,
    section,
    narrative: `Scenario ${id}: a block of mass {m:unit}.`,
    vars: [{ name: 'm', kind: 'range', min: 1, max: 5, step: 1, unit: 'kg' }],
    parts: [{ id: 'p', prompt: 'Weight? {_0}{_u}', answer: 'm * 9.8', unit: 'N', tolerance: { rel: 0.01 } }],
    canonical: { vars: { m: 2 }, parts: [{ id: 'p', answer: 19.6, unit: 'N' }] },
    ...extra,
  };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/**
 * The dataset every repository implementation is seeded with before running
 * the conformance suite: two sets, varied sections/tags/difficulties, assets.
 */
export function conformanceSeed(): SeedSet[] {
  return [
    {
      set: {
        id: 'alpha',
        title: 'Alpha set',
        sections: ['Work', 'Energy'],
        order: ['c01-push-work', 'a-energy-2', 'a-energy-1'],
      },
      scenarios: [
        C1,
        simple('a-energy-1', 'Energy', {
          tags: ['energy', 'spring'],
          parts: [
            {
              id: 'p',
              prompt: 'Weight? {_0}{_u}',
              answer: 'm * 9.8',
              unit: 'N',
              tolerance: { rel: 0.01 },
              difficulty: 3,
              tags: ['hard'],
            },
          ],
        }),
        simple('a-energy-2', 'Energy', {
          tags: ['energy'],
          figure: { id: 'fig', src: 'figures/block.png', alt: 'A block on a table.' },
        }),
      ],
      assets: {
        'figures/block.png': PNG_BYTES,
        'figures/diagram.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      },
    },
    {
      set: { id: 'beta', title: 'Beta set', sections: ['Torque'] },
      scenarios: [
        simple('b-torque-1', 'Torque', { tags: ['torque', 'spring'], title: 'Torque on a wrench' }),
        simple('b-torque-2', 'Torque', { tags: ['torque'] }),
      ],
    },
  ];
}
