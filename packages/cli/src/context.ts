import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { parseScenario, type Scenario } from '@pt/core';
import { FsRepository } from '@pt/store-fs';
import { parse as parseYaml } from 'yaml';

/** Where command output goes; injected so commands are testable. */
export interface Output {
  out(line?: string): void;
  err(line?: string): void;
  /** Colourise when writing to a terminal. */
  color: boolean;
}

export const consoleOutput = (): Output => ({
  out: (line = '') => process.stdout.write(`${line}\n`),
  err: (line = '') => process.stderr.write(`${line}\n`),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
});

/** Collects output in memory (tests). */
export function memoryOutput(): Output & { stdout: string[]; stderr: string[]; text(): string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    color: false,
    out: (line = '') => stdout.push(line),
    err: (line = '') => stderr.push(line),
    text: () => stdout.join('\n'),
  };
}

type Style = 'green' | 'red' | 'yellow' | 'dim' | 'bold' | 'cyan';

export function paint(o: Output, style: Style, text: string): string {
  return o.color ? styleText(style, text) : text;
}

export const DEFAULT_ROOT = 'content/sets';

export interface Context {
  root: string;
  repo: FsRepository;
  output: Output;
}

export function createContext(root: string | undefined, output: Output): Context {
  const r = resolve(root ?? process.env.PT_ROOT ?? DEFAULT_ROOT);
  return { root: r, repo: new FsRepository({ root: r }), output };
}

/** Is this argument a path to a YAML file rather than a scenario id? */
export function isFileArg(arg: string): boolean {
  return /\.ya?ml$/i.test(arg) && existsSync(arg);
}

/** Load a scenario by id (through the repository) or by YAML file path. */
export async function loadScenario(ctx: Context, arg: string): Promise<Scenario> {
  if (isFileArg(arg)) return parseScenario(parseYaml(readFileSync(arg, 'utf8')));
  return ctx.repo.getScenario(arg);
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export function fmtNumber(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  if (x !== 0 && (Math.abs(x) >= 1e6 || Math.abs(x) < 1e-3)) return x.toExponential(6).replace(/\.?0+e/, 'e');
  return String(Number(x.toPrecision(8)));
}
