import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { diagnoseScenario, parseSetDoc, safeParseScenario, type Scenario, type SetDoc, tokenizeTemplate } from '@pt/core';
import { parse as parseYaml } from 'yaml';
import { loadDrafts } from '../import/draft.js';
import { CliError, type Context, paint } from '../context.js';

export interface LintFinding {
  severity: 'error' | 'warning';
  code: string;
  /** Path relative to the repository root. */
  file: string;
  message: string;
}

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

function hasValueSlot(prompt: string): boolean {
  return tokenizeTemplate(prompt).tokens.some((t) => t.kind === 'slot' && t.index === 0);
}

/**
 * Authoring lint for one set (§7). Works on the files as written, so it can
 * see what the schema's defaults would otherwise hide (a missing tolerance).
 */
export function lintSet(root: string, setId: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const setDir = join(root, setId);
  const rel = (p: string): string => relative(root, p);
  const add = (severity: LintFinding['severity'], code: string, file: string, message: string): void => {
    findings.push({ severity, code, file: rel(file), message });
  };

  const setFile = join(setDir, 'set.yaml');
  if (!existsSync(setFile)) throw new CliError(`no set "${setId}" under ${root}`);
  let set: SetDoc;
  try {
    set = parseSetDoc({ id: setId, ...(parseYaml(readFileSync(setFile, 'utf8')) as Raw) });
  } catch (e) {
    add('error', 'invalid-set', setFile, e instanceof Error ? e.message : String(e));
    return findings;
  }

  // Scenario ids in other sets, for duplicate detection.
  const elsewhere = new Map<string, string>();
  for (const other of existsSync(root) ? readdirSync(root) : []) {
    if (other === setId) continue;
    for (const f of listFiles(join(root, other, 'scenarios'))) {
      if (f.endsWith('.yaml')) elsewhere.set(f.slice(f.lastIndexOf('/') + 1, -5), other);
    }
  }

  const scenarioFiles = listFiles(join(setDir, 'scenarios')).filter((f) => f.endsWith('.yaml')).sort();
  const referencedFigures = new Set<string>();
  const ids = new Map<string, string>();
  const parsed: { s: Scenario; file: string }[] = [];

  for (const file of scenarioFiles) {
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, 'utf8'));
    } catch (e) {
      add('error', 'yaml-syntax', file, e instanceof Error ? e.message.split('\n')[0]! : String(e));
      continue;
    }
    if (!isRecord(raw)) {
      add('error', 'not-a-mapping', file, 'file does not contain a YAML mapping');
      continue;
    }
    const fileId = file.slice(file.lastIndexOf('/') + 1, -5);
    const id = typeof raw.id === 'string' ? raw.id : fileId;
    if (id !== fileId) add('error', 'id-file-mismatch', file, `id "${id}" does not match the file name`);
    if (ids.has(id)) add('error', 'duplicate-id', file, `id "${id}" is also used by ${ids.get(id)}`);
    ids.set(id, rel(file));
    if (elsewhere.has(id)) add('error', 'duplicate-id', file, `id "${id}" is also used in set "${elsewhere.get(id)}"`);

    if (!('canonical' in raw)) {
      add('error', 'canonical-missing', file, 'no canonical block: the source values and printed answers are required');
    }
    const figure = raw.figure;
    if (isRecord(figure)) {
      if (typeof figure.alt !== 'string' || figure.alt.trim() === '') add('error', 'figure-alt-missing', file, 'figure has no alt text');
      if (typeof figure.src === 'string') {
        referencedFigures.add(figure.src);
        if (!existsSync(join(setDir, figure.src))) add('error', 'figure-file-missing', file, `figure file ${figure.src} does not exist`);
      }
    }
    if (typeof raw.section === 'string' && !set.sections.includes(raw.section)) {
      add('warning', 'unknown-section', file, `section "${raw.section}" is not listed in set.yaml`);
    }
    const parts = Array.isArray(raw.parts) ? raw.parts.filter(isRecord) : [];
    for (const p of parts) {
      const pid = String(p.id ?? '?');
      if (!('tolerance' in p) && p.integer !== true) add('warning', 'tolerance-missing', file, `part ${pid} has no tolerance (default rel 0.01 applies)`);
      if (!('difficulty' in p)) add('warning', 'difficulty-missing', file, `part ${pid} has no difficulty (it cannot be filtered by difficulty)`);
      if (typeof p.prompt === 'string' && !hasValueSlot(p.prompt)) {
        add('warning', 'slot-missing', file, `part ${pid} prompt has no {_0} slot (it will be appended)`);
      }
    }

    const r = safeParseScenario(raw);
    if (!r.ok) {
      for (const i of r.issues) add('error', 'schema', file, `${i.path.join('.') || '(root)'}: ${i.message}`);
      continue;
    }
    parsed.push({ s: r.value, file });
    for (const d of diagnoseScenario(r.value)) add(d.severity, d.code, file, `${d.path.join('.')}: ${d.message}`);
  }

  // Source labels (§2.4): each canonical part names the source problem it reproduces.
  const drafts = loadDrafts(root, setId).map((d) => d.draft);
  const draftLabels = new Set(drafts.map((d) => d.label));
  for (const d of drafts) for (const f of d.figures) referencedFigures.add(f.src);
  const claimed = new Map<string, string>();
  for (const { s, file } of parsed) {
    const partLabels = s.canonical.parts.flatMap((cp) => (cp.source !== undefined ? [cp.source] : []));
    for (const label of new Set(partLabels)) {
      if (draftLabels.size > 0 && !draftLabels.has(label)) add('error', 'label-unknown', file, `source label ${label} is not a problem of this set`);
      const other = claimed.get(label);
      if (other !== undefined && other !== s.id) add('error', 'label-conflict', file, `source label ${label} is also claimed by scenario "${other}"`);
      claimed.set(label, s.id);
    }
    const listed = [...(s.source?.labels ?? [])].sort();
    const fromParts = [...new Set(partLabels)].sort();
    if (fromParts.length > 0 && listed.join() !== fromParts.join()) {
      add('warning', 'labels-mismatch', file, `source.labels [${listed.join(', ')}] differ from the canonical parts' sources [${fromParts.join(', ')}]`);
    }
    if (s.source && set.source && s.source.document !== set.source.document) {
      add('warning', 'document-mismatch', file, `source document "${s.source.document}" differs from the set's "${set.source.document}"`);
    }
  }

  for (const f of listFiles(join(setDir, 'figures'))) {
    const ref = relative(setDir, f);
    if (!referencedFigures.has(ref)) add('warning', 'figure-unreferenced', f, `figure ${ref} is not used by any scenario or draft`);
  }
  if (set.order) {
    for (const id of ids.keys()) {
      if (!set.order.includes(id)) add('warning', 'not-in-order', setFile, `scenario "${id}" is not listed in order`);
    }
    for (const id of set.order) {
      if (!ids.has(id)) add('warning', 'order-unknown', setFile, `order lists unknown scenario "${id}"`);
    }
  }
  return findings;
}

export async function runLint(ctx: Context, setId: string, opts: { json?: boolean } = {}): Promise<number> {
  const findings = lintSet(ctx.root, setId);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const o = ctx.output;
  if (opts.json) {
    o.out(JSON.stringify({ setId, ok: errors === 0, findings }, null, 2));
    return errors === 0 ? 0 : 1;
  }
  for (const f of findings) {
    const mark = f.severity === 'error' ? paint(o, 'red', 'error') : paint(o, 'yellow', 'warn ');
    o.out(`${mark} ${f.file}: ${f.message} ${paint(o, 'dim', `[${f.code}]`)}`);
  }
  const warnings = findings.length - errors;
  o.out(
    errors === 0
      ? paint(o, 'green', `${setId}: no errors${warnings ? `, ${warnings} warning(s)` : ''}`)
      : paint(o, 'red', `${setId}: ${errors} error(s), ${warnings} warning(s)`),
  );
  return errors === 0 ? 0 : 1;
}
