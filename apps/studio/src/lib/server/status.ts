import { checkCanonical, diagnoseScenario, type Scenario } from '@pt/core';

export type ScenarioStatus = 'pass' | 'fail' | 'draft';

/** Canonical-check status shown in listings and used by the status filter. */
export function scenarioStatus(s: Scenario): ScenarioStatus {
  if (s.draft) return 'draft';
  const ok = checkCanonical(s).ok && !diagnoseScenario(s).some((d) => d.severity === 'error');
  return ok ? 'pass' : 'fail';
}
