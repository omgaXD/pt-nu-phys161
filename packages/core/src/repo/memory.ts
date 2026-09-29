import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { parseScenario, parseSetDoc } from '../schema/index.js';
import type { Scenario, ScenarioInput } from '../schema/scenario.js';
import type { SetDoc, SetDocInput } from '../schema/set.js';
import { matchesQuery, mediaTypeFor, orderIds, paginate, parseAssetRef, summarize } from './query.js';
import type {
  AssetHandle,
  ProblemRepository,
  PutScenarioOptions,
  ScenarioQuery,
  ScenarioSummary,
  SetSummary,
} from './types.js';

export interface SeedSet {
  set: SetDocInput;
  scenarios?: ScenarioInput[];
  /** Asset path (relative to the set) → bytes or UTF-8 text. */
  assets?: Record<string, Uint8Array | string>;
}

interface SetEntry {
  doc: SetDoc;
  scenarios: Map<string, Scenario>;
  assets: Map<string, Uint8Array>;
}

const encoder = new TextEncoder();

/** A complete ProblemRepository in memory. Returned objects are copies. */
export class InMemoryRepository implements ProblemRepository {
  private readonly sets = new Map<string, SetEntry>();

  constructor(seed: readonly SeedSet[] = []) {
    for (const s of seed) {
      const doc = parseSetDoc(s.set);
      const entry: SetEntry = { doc, scenarios: new Map(), assets: new Map() };
      this.sets.set(doc.id, entry);
      for (const input of s.scenarios ?? []) {
        const sc = parseScenario(input);
        if (this.locate(sc.id)) throw new ConflictError('duplicate-scenario', `duplicate scenario id "${sc.id}"`);
        entry.scenarios.set(sc.id, sc);
      }
      for (const [path, data] of Object.entries(s.assets ?? {})) {
        entry.assets.set(path, typeof data === 'string' ? encoder.encode(data) : data.slice());
      }
    }
  }

  private locate(id: string): SetEntry | undefined {
    for (const entry of this.sets.values()) if (entry.scenarios.has(id)) return entry;
    return undefined;
  }

  private sortedSets(): SetEntry[] {
    return [...this.sets.values()].sort((a, b) => a.doc.id.localeCompare(b.doc.id));
  }

  async listSets(): Promise<SetSummary[]> {
    return this.sortedSets().map((e) => ({
      id: e.doc.id,
      title: e.doc.title,
      sections: [...e.doc.sections],
      scenarioCount: e.scenarios.size,
    }));
  }

  async getSet(id: string): Promise<SetDoc> {
    const e = this.sets.get(id);
    if (!e) throw new NotFoundError('set-not-found', `no set "${id}"`, { id });
    return structuredClone(e.doc);
  }

  async putSet(set: SetDoc): Promise<void> {
    const doc = parseSetDoc(set);
    const existing = this.sets.get(doc.id);
    if (existing) existing.doc = doc;
    else this.sets.set(doc.id, { doc, scenarios: new Map(), assets: new Map() });
  }

  async listScenarios(q: ScenarioQuery = {}): Promise<ScenarioSummary[]> {
    const rows: ScenarioSummary[] = [];
    for (const e of this.sortedSets()) {
      for (const id of orderIds(e.doc, [...e.scenarios.keys()])) {
        const s = e.scenarios.get(id)!;
        if (matchesQuery(s, e.doc.id, q)) rows.push(summarize(s, e.doc.id));
      }
    }
    return paginate(rows, q);
  }

  async getScenario(id: string): Promise<Scenario> {
    const e = this.locate(id);
    if (!e) throw new NotFoundError('scenario-not-found', `no scenario "${id}"`, { id });
    return structuredClone(e.scenarios.get(id)!);
  }

  async putScenario(s: Scenario, opts: PutScenarioOptions = {}): Promise<void> {
    const sc = parseScenario(s);
    const current = this.locate(sc.id);
    let target: SetEntry | undefined;
    if (current) {
      if (opts.setId !== undefined && opts.setId !== current.doc.id) {
        throw new ConflictError('scenario-in-other-set', `scenario "${sc.id}" belongs to set "${current.doc.id}"`, {
          id: sc.id,
          setId: current.doc.id,
        });
      }
      target = current;
    } else if (opts.setId !== undefined) {
      target = this.sets.get(opts.setId);
      if (!target) throw new NotFoundError('set-not-found', `no set "${opts.setId}"`, { id: opts.setId });
    } else if (this.sets.size === 1) {
      target = [...this.sets.values()][0];
    } else {
      throw new ValidationError('set-required', 'setId is required to create a scenario', { id: sc.id });
    }
    target!.scenarios.set(sc.id, sc);
    if (!current && target!.doc.order && !target!.doc.order.includes(sc.id)) target!.doc.order.push(sc.id);
  }

  async deleteScenario(id: string): Promise<void> {
    const e = this.locate(id);
    if (!e) throw new NotFoundError('scenario-not-found', `no scenario "${id}"`, { id });
    e.scenarios.delete(id);
    if (e.doc.order) e.doc.order = e.doc.order.filter((x) => x !== id);
  }

  async resolveAsset(ref: string): Promise<AssetHandle> {
    const { setId, path } = parseAssetRef(ref);
    const bytes = this.sets.get(setId)?.assets.get(path);
    if (!bytes) throw new NotFoundError('asset-not-found', `no asset "${ref}"`, { ref });
    return { ref, mediaType: mediaTypeFor(path), size: bytes.byteLength, read: async () => bytes.slice() };
  }
}
