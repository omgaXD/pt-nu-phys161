import type { Scenario } from '../schema/scenario.js';
import type { SetDoc } from '../schema/set.js';

export interface SetSummary {
  id: string;
  title: string;
  sections: string[];
  scenarioCount: number;
}

/** Listing row. Never carries storage details (paths, row ids, ORM objects). */
export interface ScenarioSummary {
  id: string;
  setId: string;
  title: string;
  section?: string;
  tags: string[];
  /** Difficulties of the parts that declare one. */
  difficulties: number[];
  partCount: number;
  hasFigure: boolean;
  sourceLabels: string[];
  draft: boolean;
}

/**
 * Deliberately rich enough to push filtering down to SQL later, while
 * trivially implementable in memory today.
 */
export interface ScenarioQuery {
  setId?: string;
  section?: string;
  /** Matched against scenario tags ∪ part tags. */
  tags?: string[];
  tagMode?: 'any' | 'all';
  /** Matches when any part's difficulty lies in [min, max]. */
  difficulty?: { min?: number; max?: number };
  /** Case-insensitive substring over id, title, narrative, prompts, tags, source labels. */
  text?: string;
  limit?: number;
  /** Keyset pagination: the id of the last row of the previous page. */
  cursor?: string;
}

export interface AssetHandle {
  /** The opaque reference that was resolved. */
  ref: string;
  mediaType: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export interface PutScenarioOptions {
  /** Target set for a new scenario (optional when the repository has one set). */
  setId?: string;
}

/**
 * The storage-uncertainty hedge: everything above this interface is
 * independent of files vs database.
 */
export interface ProblemRepository {
  listSets(): Promise<SetSummary[]>;
  getSet(id: string): Promise<SetDoc>;
  putSet(set: SetDoc): Promise<void>;
  listScenarios(q?: ScenarioQuery): Promise<ScenarioSummary[]>;
  getScenario(id: string): Promise<Scenario>;
  putScenario(s: Scenario, opts?: PutScenarioOptions): Promise<void>;
  deleteScenario(id: string): Promise<void>;
  /** Figure files. `ref` comes from `assetRef(setId, figure.src)`. */
  resolveAsset(ref: string): Promise<AssetHandle>;
}
