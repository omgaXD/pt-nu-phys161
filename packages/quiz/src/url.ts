import {
  type DifficultyFilter,
  difficultyFilter,
  type ModeFields,
  PRESET_IDS,
  type PresetFields,
  PRESETS,
  type PresetId,
  type QuizConfig,
  QuizConfigSchema,
} from './config.js';
import { compareLabels } from './selection.js';

/**
 * Share links: a configuration (and seed) as URL parameters. The link names
 * the nearest preset and lists only the fields that differ from it, so
 * `?p=exam&sets=phys161-exam1&seed=42` is a complete, reproducible exam.
 * Per set, `sec.<set>=a,b` picks sections (empty: none) and `ex.<set>=P3,P16`
 * leaves problems out. A difficulty range other than the preset's is
 * `diff=2-4` (with `unrated=1` to keep unrated problems; `diff=1-5` for none).
 */
type Codec = { param: string; encode(v: unknown): string; decode(s: string): unknown };

const bool = (param: string): Codec => ({ param, encode: (v) => (v ? '1' : '0'), decode: (s) => (s === '1' ? true : s === '0' ? false : s) });
const intOr = (param: string, word: string, wordValue: unknown): Codec => ({
  param,
  encode: (v) => (v === wordValue ? word : String(v)),
  decode: (s) => (s === word ? wordValue : /^\d+$/.test(s) ? Number(s) : s),
});
const text = (param: string): Codec => ({ param, encode: String, decode: (s) => s });

const FIELDS: Record<keyof ModeFields, Codec> = {
  values: text('values'),
  includeFixed: bool('fixed'),
  count: intOr('n', 'all', 'all'),
  draw: text('draw'),
  order: text('order'),
  feedback: text('fb'),
  maxTries: intOr('tries', 'inf', null),
  allowReveal: bool('reveal'),
  timeLimitMinutes: intOr('time', 'none', null),
};
const FIELD_KEYS = Object.keys(FIELDS) as (keyof ModeFields)[];

function differing(config: ModeFields, preset: PresetId): (keyof ModeFields)[] {
  return FIELD_KEYS.filter((k) => config[k] !== PRESETS[preset][k]);
}

function sameRange(a: DifficultyFilter | undefined, b: DifficultyFilter | undefined): boolean {
  const x = difficultyFilter(a);
  const y = difficultyFilter(b);
  return x === y || (!!x && !!y && x.min === y.min && x.max === y.max && x.unrated === y.unrated);
}

/** The fields a link must list on top of the preset: mode fields, plus one for the difficulty range. */
function distance(config: PresetFields, preset: PresetId): number {
  return differing(config, preset).length + (sameRange(config.difficulty, PRESETS[preset].difficulty) ? 0 : 1);
}

/** The preset a configuration is closest to (fewest differing fields). */
export function nearestPreset(config: PresetFields): PresetId {
  let best: PresetId = PRESET_IDS[0];
  for (const id of PRESET_IDS) if (distance(config, id) < distance(config, best)) best = id;
  return best;
}

export function encodeConfig(config: QuizConfig, contentVersion?: string): URLSearchParams {
  const q = new URLSearchParams();
  const preset = nearestPreset(config);
  q.set('p', preset);
  q.set('sets', config.sets.join(','));
  for (const setId of config.sets) {
    const sections = config.sections[setId];
    if (sections) q.set(`sec.${setId}`, [...sections].sort().join(','));
    const excluded = config.exclude[setId];
    if (excluded && excluded.length > 0) q.set(`ex.${setId}`, [...excluded].sort(compareLabels).join(','));
  }
  if (!sameRange(config.difficulty, PRESETS[preset].difficulty)) {
    const range = difficultyFilter(config.difficulty) ?? { min: 1, max: 5, unrated: false };
    q.set('diff', `${range.min}-${range.max}`);
    if (range.unrated) q.set('unrated', '1');
  }
  for (const k of differing(config, preset)) q.set(FIELDS[k].param, FIELDS[k].encode(config[k]));
  if (config.seed !== undefined) q.set('seed', String(config.seed));
  if (contentVersion) q.set('cv', contentVersion);
  return q;
}

export type DecodedConfig = { ok: true; config: QuizConfig; contentVersion?: string } | { ok: false; issues: string[] };

/** Read a configuration from URL parameters; `null` when the URL carries none. */
export function decodeConfig(params: URLSearchParams): DecodedConfig | null {
  const p = params.get('p');
  if (p === null && !params.has('sets')) return null;
  const issues: string[] = [];
  const preset = (PRESET_IDS as readonly string[]).includes(p ?? 'ordered') ? ((p ?? 'ordered') as PresetId) : null;
  if (!preset) issues.push(`unknown preset "${p}"`);

  const sets = (params.get('sets') ?? '').split(',').filter(Boolean);
  const sections: Record<string, string[]> = {};
  const exclude: Record<string, string[]> = {};
  for (const [key, value] of params) {
    if (key.startsWith('sec.')) sections[key.slice(4)] = value.split(',').filter(Boolean);
    if (key.startsWith('ex.')) exclude[key.slice(3)] = value.split(',').filter(Boolean);
  }
  const raw: Record<string, unknown> = { ...PRESETS[preset ?? 'ordered'], sets, sections, exclude };
  for (const k of FIELD_KEYS) {
    const s = params.get(FIELDS[k].param);
    if (s !== null) raw[k] = FIELDS[k].decode(s);
  }
  const diff = params.get('diff');
  if (diff !== null) {
    const m = /^(\d)-(\d)$/.exec(diff);
    if (m) raw.difficulty = { min: Number(m[1]), max: Number(m[2]), unrated: params.get('unrated') === '1' };
    else issues.push(`difficulty: "${diff}" is not a range like 2-4`);
  }
  const seed = params.get('seed');
  if (seed !== null) raw.seed = /^\d+$/.test(seed) ? Number(seed) : seed;

  const r = QuizConfigSchema.safeParse(raw);
  if (!r.success) issues.push(...r.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`));
  if (issues.length > 0 || !r.success) return { ok: false, issues };
  // The full range is no range.
  const { difficulty, ...rest } = r.data;
  const config = difficultyFilter(difficulty) ? r.data : rest;
  const cv = params.get('cv');
  return { ok: true, config, ...(cv !== null && { contentVersion: cv }) };
}
