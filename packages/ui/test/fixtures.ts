import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { instantiateAt, parseScenario, type ProblemInstance, type Scenario } from '@pt/core';
import { parse } from 'yaml';

const CORPUS = join(import.meta.dirname, '../../../fixtures/corpus/scenarios');

export function scenario(id: string): Scenario {
  return parseScenario(parse(readFileSync(join(CORPUS, `${id}.yaml`), 'utf8')));
}

/** The instance at the scenario's canonical source values. */
export function canonicalInstance(s: Scenario): ProblemInstance {
  const randoms = Object.fromEntries(Object.entries(s.canonical.vars).filter(([k]) => s.vars.some((v) => v.name === k)));
  return instantiateAt(s, randoms);
}
