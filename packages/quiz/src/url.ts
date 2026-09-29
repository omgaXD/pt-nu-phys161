import { type ModeFields, PRESET_IDS, PRESETS, type PresetId, type QuizConfig, QuizConfigSchema } from './config.js';

/**
 * Share links: a configuration (and seed) as URL parameters. The link names
 * the nearest preset and lists only the fields that differ from it, so
 * `?p=exam&sets=phys161-exam1&seed=42` is a complete, reproducible exam.
 * `skipSolved` is never encoded: it depends on the viewer's own progress.
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

/** The preset a configuration is closest to (fewest differing mode fields). */
export function nearestPreset(config: ModeFields): PresetId {
  let best: PresetId = PRESET_IDS[0];
  for (const id of PRESET_IDS) if (differing(config, id).length < differing(config, best).length) best = id;
  return best;
}

export function encodeConfig(config: QuizConfig, contentVersion?: string): URLSearchParams {
  const q = new URLSearchParams();
  const preset = nearestPreset(config);
  q.set('p', preset);
  q.set('sets', config.sets.join(','));
  for (const setId of config.sets) {
    const sections = config.sections[setId];
    if (sections && sections.length > 0) q.set(`sec.${setId}`, [...sections].sort().join(','));
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
  for (const [key, value] of params) {
    if (key.startsWith('sec.')) sections[key.slice(4)] = value.split(',').filter(Boolean);
  }
  const raw: Record<string, unknown> = { ...PRESETS[preset ?? 'ordered'], sets, sections, skipSolved: false };
  for (const k of FIELD_KEYS) {
    const s = params.get(FIELDS[k].param);
    if (s !== null) raw[k] = FIELDS[k].decode(s);
  }
  const seed = params.get('seed');
  if (seed !== null) raw.seed = /^\d+$/.test(seed) ? Number(seed) : seed;

  const r = QuizConfigSchema.safeParse(raw);
  if (!r.success) issues.push(...r.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`));
  if (issues.length > 0 || !r.success) return { ok: false, issues };
  const cv = params.get('cv');
  return { ok: true, config: r.data, ...(cv !== null && { contentVersion: cv }) };
}
