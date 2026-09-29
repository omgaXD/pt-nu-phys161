import {
  type AssetHandle,
  NotFoundError,
  paginate,
  parseAssetRef,
  type ProblemRepository,
  type PutScenarioOptions,
  type Scenario,
  type ScenarioQuery,
  type ScenarioSummary,
  type SetDoc,
  type SetSummary,
  ValidationError,
} from '@pt/core';

/**
 * Several repositories seen as one (Studio shows content/sets and the
 * reference corpus side by side). Reads fan out; writes go to the repository
 * that owns the set or scenario. Set ids must be unique across members.
 */
export class MultiRepository implements ProblemRepository {
  constructor(private readonly members: readonly ProblemRepository[]) {}

  private async ownerOfSet(setId: string): Promise<ProblemRepository> {
    for (const m of this.members) {
      if ((await m.listSets()).some((s) => s.id === setId)) return m;
    }
    throw new NotFoundError('set-not-found', `no set "${setId}"`, { id: setId });
  }

  private async ownerOfScenario(id: string): Promise<ProblemRepository | undefined> {
    for (const m of this.members) {
      try {
        await m.getScenario(id);
        return m;
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e;
      }
    }
    return undefined;
  }

  async listSets(): Promise<SetSummary[]> {
    const sets = (await Promise.all(this.members.map((m) => m.listSets()))).flat();
    return sets.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getSet(id: string): Promise<SetDoc> {
    return (await this.ownerOfSet(id)).getSet(id);
  }

  async putSet(set: SetDoc): Promise<void> {
    const owner = await this.ownerOfSet(set.id).catch(() => this.members[0]!);
    await owner.putSet(set);
  }

  async listScenarios(q: ScenarioQuery = {}): Promise<ScenarioSummary[]> {
    const { limit: _l, cursor: _c, ...filters } = q;
    const rows = (await Promise.all(this.members.map((m) => m.listScenarios(filters)))).flat();
    // Same order as a single repository: sets by id, each set in its own order.
    rows.sort((a, b) => a.setId.localeCompare(b.setId)); // stable: keeps each set's order
    return paginate(rows, q);
  }

  async getScenario(id: string): Promise<Scenario> {
    const owner = await this.ownerOfScenario(id);
    if (!owner) throw new NotFoundError('scenario-not-found', `no scenario "${id}"`, { id });
    return owner.getScenario(id);
  }

  async putScenario(s: Scenario, opts: PutScenarioOptions = {}): Promise<void> {
    const owner = (await this.ownerOfScenario(s.id)) ?? (opts.setId ? await this.ownerOfSet(opts.setId) : undefined);
    if (!owner) throw new ValidationError('set-required', 'setId is required to create a scenario', { id: s.id });
    await owner.putScenario(s, opts);
  }

  async deleteScenario(id: string): Promise<void> {
    const owner = await this.ownerOfScenario(id);
    if (!owner) throw new NotFoundError('scenario-not-found', `no scenario "${id}"`, { id });
    await owner.deleteScenario(id);
  }

  async resolveAsset(ref: string): Promise<AssetHandle> {
    return (await this.ownerOfSet(parseAssetRef(ref).setId)).resolveAsset(ref);
  }
}
