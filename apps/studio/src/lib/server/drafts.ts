import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioInput } from '@pt/core';
import { parse as parseYaml } from 'yaml';
import { contentRoots } from './repository.js';

interface DraftFile {
  label: string;
  number: number;
  text: string;
  literals: { name: string; value: number; constant?: boolean; suggest: { min: number; max: number; step: number; decimals?: number } }[];
  scenario: Record<string, unknown>;
}

function draftDir(setId: string): string | undefined {
  return contentRoots()
    .map((r) => join(r, setId, 'drafts'))
    .find((d) => existsSync(d));
}

/** Imported drafts of a set (file-backed content only; see `pt import`). */
export function listDrafts(setId: string): { label: string; number: number; text: string }[] {
  const dir = draftDir(setId);
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => parseYaml(readFileSync(join(dir, f), 'utf8')) as DraftFile)
    .map((d) => ({ label: d.label, number: d.number, text: d.text }))
    .sort((a, b) => a.number - b.number);
}

/**
 * A draft's scenario, made editable: TODO ranges become the importer's
 * suggestions and the TODO answer becomes a placeholder formula, so the editor
 * can instantiate it immediately (it will fail its canonical check until the
 * author writes the real formula).
 */
export function scenarioFromDraft(setId: string, label: string): ScenarioInput | undefined {
  const dir = draftDir(setId);
  if (!dir) return undefined;
  const file = readdirSync(dir).find((f) => f.replace(/\.yaml$/, '').replace(/^P0*/, 'P') === label);
  if (!file) return undefined;
  const d = parseYaml(readFileSync(join(dir, file), 'utf8')) as DraftFile;
  const s = structuredClone(d.scenario) as Record<string, unknown> & { vars: Record<string, unknown>[]; parts: Record<string, unknown>[] };
  s.vars = s.vars.map((v) => {
    const lit = d.literals.find((l) => l.name === v.name);
    const suggest: DraftFile['literals'][number]['suggest'] = lit?.suggest ?? { min: 1, max: 10, step: 1 };
    return {
      ...v,
      min: v.min === 'TODO' ? suggest.min : v.min,
      max: v.max === 'TODO' ? suggest.max : v.max,
      step: v.step === 'TODO' ? suggest.step : v.step,
      ...(suggest.decimals !== undefined && { decimals: suggest.decimals }),
    };
  });
  s.parts = s.parts.map((p) => ({ ...p, answer: p.answer === 'TODO' ? '0' : p.answer }));
  const figure = s.figure as { alt?: string } | undefined;
  if (figure?.alt?.startsWith('TODO')) figure.alt = 'Describe the figure.';
  return s as unknown as ScenarioInput;
}
