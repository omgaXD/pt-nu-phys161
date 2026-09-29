import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  type AssetHandle,
  ConflictError,
  ID_RE,
  matchesQuery,
  mediaTypeFor,
  NotFoundError,
  orderIds,
  paginate,
  parseAssetRef,
  parseScenario,
  parseSetDoc,
  type ProblemRepository,
  type PutScenarioOptions,
  type Scenario,
  type ScenarioQuery,
  type ScenarioSummary,
  type SchemaIssue,
  type SetDoc,
  type SetSummary,
  safeParseScenario,
  summarize,
  toStorable,
  toStorableSet,
  ValidationError,
} from '@pt/core';
import { parse as parseYaml } from 'yaml';
import { newDocumentText, updateDocumentText } from './yaml-doc.js';

export interface FsRepositoryOptions {
  /** Directory whose children are set directories (each containing set.yaml). */
  root: string;
}

/** A file that could not be loaded; listings skip it, diagnostics report it. */
export interface FileDiagnostic {
  setId: string;
  /** Path relative to the repository root. */
  file: string;
  code: string;
  message: string;
  issues?: SchemaIssue[];
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  result: { ok: true; scenario: Scenario } | { ok: false; diagnostic: FileDiagnostic };
}

const SET_FILE = 'set.yaml';
const SCENARIO_DIR = 'scenarios';

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Write via a temp file + rename so readers never see a half-written file. */
async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, text, 'utf8');
  try {
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/**
 * ProblemRepository over a directory tree (§4):
 *
 *   <root>/<setId>/set.yaml
 *   <root>/<setId>/scenarios/<scenarioId>.yaml
 *   <root>/<setId>/figures/…            (asset refs are relative to the set dir)
 *
 * One YAML file per scenario. Writes merge into the existing document so
 * comments and formatting survive, and are byte-stable (write→read→write).
 * No file path ever crosses the interface.
 */
export class FsRepository implements ProblemRepository {
  readonly root: string;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: FsRepositoryOptions) {
    this.root = resolve(opts.root);
  }

  // ---- paths (private: never leak across the interface) -------------------

  private setDir(setId: string): string {
    if (!ID_RE.test(setId)) throw new ValidationError('invalid-set-id', `invalid set id "${setId}"`, { id: setId });
    return join(this.root, setId);
  }

  private scenarioPath(setId: string, id: string): string {
    if (!ID_RE.test(id)) throw new ValidationError('invalid-scenario-id', `invalid scenario id "${id}"`, { id });
    return join(this.setDir(setId), SCENARIO_DIR, `${id}.yaml`);
  }

  private rel(path: string): string {
    return path.slice(this.root.length + 1);
  }

  // ---- reading -------------------------------------------------------------

  private async setIds(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch {
      return [];
    }
    const ids: string[] = [];
    for (const name of entries.sort()) {
      if (ID_RE.test(name) && (await exists(join(this.root, name, SET_FILE)))) ids.push(name);
    }
    return ids;
  }

  private async readSet(setId: string): Promise<SetDoc> {
    const file = join(this.setDir(setId), SET_FILE);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      throw new NotFoundError('set-not-found', `no set "${setId}"`, { id: setId });
    }
    const raw = (parseYaml(text) ?? {}) as Record<string, unknown>;
    if (raw.id !== undefined && raw.id !== setId) {
      throw new ValidationError('set-id-mismatch', `set.yaml id "${String(raw.id)}" does not match directory "${setId}"`, {
        id: setId,
      });
    }
    return parseSetDoc({ ...raw, id: setId });
  }

  private async scenarioFiles(setId: string): Promise<string[]> {
    const dir = join(this.setDir(setId), SCENARIO_DIR);
    try {
      return (await readdir(dir))
        .filter((f) => f.endsWith('.yaml'))
        .sort()
        .map((f) => join(dir, f));
    } catch {
      return [];
    }
  }

  private async loadFile(setId: string, file: string): Promise<CacheEntry['result']> {
    const st = await stat(file);
    const hit = this.cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.result;

    const expectedId = file.slice(file.lastIndexOf(sep) + 1, -'.yaml'.length);
    const fail = (code: string, message: string, issues?: SchemaIssue[]): CacheEntry['result'] => ({
      ok: false,
      diagnostic: { setId, file: this.rel(file), code, message, ...(issues && { issues }) },
    });
    let result: CacheEntry['result'];
    try {
      const raw = parseYaml(await readFile(file, 'utf8')) as unknown;
      const parsed = safeParseScenario(raw);
      if (!parsed.ok) result = fail('invalid-scenario', 'scenario does not match the schema', parsed.issues);
      else if (parsed.value.id !== expectedId) {
        result = fail('scenario-id-mismatch', `id "${parsed.value.id}" does not match file name "${expectedId}.yaml"`);
      } else result = { ok: true, scenario: parsed.value };
    } catch (e) {
      result = fail('yaml-syntax', e instanceof Error ? e.message : String(e));
    }
    this.cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, result });
    return result;
  }

  private async loadSetScenarios(setId: string): Promise<Scenario[]> {
    const out: Scenario[] = [];
    for (const f of await this.scenarioFiles(setId)) {
      const r = await this.loadFile(setId, f);
      if (r.ok) out.push(r.scenario);
    }
    return out;
  }

  /** The set holding scenario `id`, if any. */
  private async locate(id: string): Promise<string | undefined> {
    if (!ID_RE.test(id)) return undefined;
    for (const setId of await this.setIds()) {
      if (await exists(this.scenarioPath(setId, id))) return setId;
    }
    return undefined;
  }

  /** Problems with files on disk (invalid YAML, schema errors, id mismatches). */
  async diagnostics(setId?: string): Promise<FileDiagnostic[]> {
    const out: FileDiagnostic[] = [];
    for (const s of setId ? [setId] : await this.setIds()) {
      for (const f of await this.scenarioFiles(s)) {
        const r = await this.loadFile(s, f);
        if (!r.ok) out.push(r.diagnostic);
      }
    }
    return out;
  }

  async listSets(): Promise<SetSummary[]> {
    const out: SetSummary[] = [];
    for (const id of await this.setIds()) {
      const doc = await this.readSet(id);
      out.push({ id, title: doc.title, sections: doc.sections, scenarioCount: (await this.loadSetScenarios(id)).length });
    }
    return out;
  }

  async getSet(id: string): Promise<SetDoc> {
    return this.readSet(id);
  }

  async putSet(set: SetDoc): Promise<void> {
    const doc = parseSetDoc(set);
    const file = join(this.setDir(doc.id), SET_FILE);
    const value = toStorableSet(doc);
    const text = (await exists(file)) ? updateDocumentText(await readFile(file, 'utf8'), value) : newDocumentText(value);
    await writeAtomic(file, text);
  }

  async listScenarios(q: ScenarioQuery = {}): Promise<ScenarioSummary[]> {
    const rows: ScenarioSummary[] = [];
    for (const setId of await this.setIds()) {
      if (q.setId !== undefined && q.setId !== setId) continue;
      const set = await this.readSet(setId);
      const scenarios = new Map((await this.loadSetScenarios(setId)).map((s) => [s.id, s]));
      for (const id of orderIds(set, [...scenarios.keys()])) {
        const s = scenarios.get(id)!;
        if (matchesQuery(s, setId, q)) rows.push(summarize(s, setId));
      }
    }
    return paginate(rows, q);
  }

  async getScenario(id: string): Promise<Scenario> {
    const setId = await this.locate(id);
    if (!setId) throw new NotFoundError('scenario-not-found', `no scenario "${id}"`, { id });
    const r = await this.loadFile(setId, this.scenarioPath(setId, id));
    if (!r.ok) {
      throw new ValidationError(r.diagnostic.code, `${r.diagnostic.file}: ${r.diagnostic.message}`, {
        id,
        ...(r.diagnostic.issues && { issues: r.diagnostic.issues }),
      });
    }
    return structuredClone(r.scenario);
  }

  async putScenario(s: Scenario, opts: PutScenarioOptions = {}): Promise<void> {
    const sc = parseScenario(s);
    const current = await this.locate(sc.id);
    let setId: string;
    if (current) {
      if (opts.setId !== undefined && opts.setId !== current) {
        throw new ConflictError('scenario-in-other-set', `scenario "${sc.id}" belongs to set "${current}"`, {
          id: sc.id,
          setId: current,
        });
      }
      setId = current;
    } else if (opts.setId !== undefined) {
      await this.readSet(opts.setId); // NotFoundError if absent
      setId = opts.setId;
    } else {
      const ids = await this.setIds();
      if (ids.length !== 1) throw new ValidationError('set-required', 'setId is required to create a scenario', { id: sc.id });
      setId = ids[0]!;
    }

    const file = this.scenarioPath(setId, sc.id);
    const value = toStorable(sc);
    const text = current ? updateDocumentText(await readFile(file, 'utf8'), value) : newDocumentText(value);
    await writeAtomic(file, text);

    if (!current) {
      const set = await this.readSet(setId);
      if (set.order && !set.order.includes(sc.id)) await this.putSet({ ...set, order: [...set.order, sc.id] });
    }
  }

  async deleteScenario(id: string): Promise<void> {
    const setId = await this.locate(id);
    if (!setId) throw new NotFoundError('scenario-not-found', `no scenario "${id}"`, { id });
    const file = this.scenarioPath(setId, id);
    await unlink(file);
    this.cache.delete(file);
    const set = await this.readSet(setId);
    if (set.order?.includes(id)) await this.putSet({ ...set, order: set.order.filter((x) => x !== id) });
  }

  async resolveAsset(ref: string): Promise<AssetHandle> {
    const { setId, path } = parseAssetRef(ref);
    const base = this.setDir(setId);
    const mediaType = mediaTypeFor(path);
    // Only figure media are assets; set.yaml, scenarios and drafts never are.
    if (mediaType === 'application/octet-stream') throw new NotFoundError('asset-not-found', `no asset "${ref}"`, { ref });
    const file = resolve(base, path);
    if (!file.startsWith(base + sep)) {
      throw new ValidationError('invalid-asset-ref', `asset reference escapes its set: "${ref}"`, { ref });
    }
    let size: number;
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      size = st.size;
    } catch {
      throw new NotFoundError('asset-not-found', `no asset "${ref}"`, { ref });
    }
    return {
      ref,
      mediaType,
      size,
      read: async () => new Uint8Array(await readFile(file)),
    };
  }
}
