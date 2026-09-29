import {
  type AssetHandle,
  CoreError,
  type ProblemRepository,
  type PutScenarioOptions,
  type Scenario,
  type ScenarioQuery,
  type ScenarioSummary,
  type SetDoc,
  type SetSummary,
} from '@pt/core';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { schema } from './schema.js';

export class NotImplementedError extends CoreError {}

function notImplemented(method: string): never {
  throw new NotImplementedError('not-implemented', `SqlRepository.${method} is not implemented yet`, { method });
}

/**
 * ProblemRepository over SQLite via Drizzle — a stub (§4). The schema is final
 * enough that switching storage later is filling in these method bodies; the
 * shared conformance suite (`@pt/core/testing`) defines "done".
 */
export class SqlRepository implements ProblemRepository {
  constructor(readonly db: BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>) {}

  async listSets(): Promise<SetSummary[]> {
    return notImplemented('listSets');
  }

  async getSet(_id: string): Promise<SetDoc> {
    return notImplemented('getSet');
  }

  async putSet(_set: SetDoc): Promise<void> {
    return notImplemented('putSet');
  }

  async listScenarios(_q?: ScenarioQuery): Promise<ScenarioSummary[]> {
    return notImplemented('listScenarios');
  }

  async getScenario(_id: string): Promise<Scenario> {
    return notImplemented('getScenario');
  }

  async putScenario(_s: Scenario, _opts?: PutScenarioOptions): Promise<void> {
    return notImplemented('putScenario');
  }

  async deleteScenario(_id: string): Promise<void> {
    return notImplemented('deleteScenario');
  }

  async resolveAsset(_ref: string): Promise<AssetHandle> {
    return notImplemented('resolveAsset');
  }
}
