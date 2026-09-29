import { Command, InvalidArgumentError } from 'commander';
import { runAgentTask } from './commands/agent-task.js';
import { runCheck } from './commands/check.js';
import { runFmt } from './commands/fmt.js';
import { runFuzz } from './commands/fuzz.js';
import { runGen } from './commands/gen.js';
import { runGroup } from './commands/group.js';
import { runImport } from './commands/import.js';
import { runLint } from './commands/lint.js';
import { runVariants } from './commands/variants.js';
import { CliError, consoleOutput, type Context, createContext, DEFAULT_ROOT, type Output } from './context.js';

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError('must be a non-negative integer');
  return n;
}

/**
 * Build the `pt` program. Every command resolves to an exit code; output goes
 * through `output` so the whole CLI is testable in-process.
 */
export function buildProgram(output: Output = consoleOutput(), onExit: (code: number) => void = (c) => (process.exitCode = c)): Command {
  const program = new Command()
    .name('pt')
    .description('Physics trainer authoring & verification tools')
    .option('--root <dir>', `content root containing set directories (env PT_ROOT, default ${DEFAULT_ROOT})`)
    .showHelpAfterError()
    .configureOutput({ writeOut: (s) => output.out(s.trimEnd()), writeErr: (s) => output.err(s.trimEnd()) })
    .exitOverride();

  const run =
    <A extends unknown[]>(fn: (ctx: Context, ...args: A) => Promise<number>) =>
    async (...args: A): Promise<void> => {
      const cmd = args.at(-1) as Command;
      const ctx = createContext(cmd.optsWithGlobals<{ root?: string }>().root, output);
      try {
        onExit(await fn(ctx, ...args));
      } catch (e) {
        output.err(e instanceof Error ? e.message : String(e));
        onExit(e instanceof CliError ? e.exitCode : 2);
      }
    };

  program
    .command('check')
    .description('validate schema, run diagnostics and the canonical check; exit non-zero on failure')
    .argument('[scenarios...]', 'scenario ids or YAML files (default: every scenario under --root)')
    .option('--set <id>', 'only this set')
    .option('--allow-drafts', 'do not fail on scenarios marked draft')
    .option('--json', 'machine-readable output')
    .action(run((ctx, ids: string[], opts) => runCheck(ctx, ids, opts)));

  program
    .command('gen')
    .description('print the rendered instance and model answers for a seed')
    .argument('<scenario>', 'scenario id or YAML file')
    .option('--seed <n>', 'seed', int)
    .option('--canonical', 'evaluate at the canonical source values')
    .option('--json', 'print the ProblemInstance as JSON')
    .action(run((ctx, arg: string, opts) => runGen(ctx, arg, opts)));

  program
    .command('fuzz')
    .description('instantiate across many seeds and report failures and the constraint rejection rate')
    .argument('<scenario>', 'scenario id or YAML file')
    .option('-n, --n <count>', 'number of seeds', int, 500)
    .option('--start <seed>', 'first seed', int, 0)
    .option('--json', 'machine-readable output')
    .action(run((ctx, arg: string, opts) => runFuzz(ctx, arg, opts)));

  program
    .command('variants')
    .description('print the variant count and per-variable breakdown')
    .argument('<scenario>', 'scenario id or YAML file')
    .option('--json', 'machine-readable output')
    .action(run((ctx, arg: string, opts) => runVariants(ctx, arg, opts)));

  program
    .command('lint')
    .description('authoring lint for a set: alt text, tolerances, figures, ids, slots, canonical blocks')
    .argument('<set>', 'set id')
    .option('--json', 'machine-readable output')
    .action(run((ctx, setId: string, opts) => runLint(ctx, setId, opts)));

  program
    .command('fmt')
    .description('rewrite scenario files in canonical form (what the repository writes)')
    .argument('[set]', 'set id (default: all)')
    .option('--check', 'report files that are not formatted; exit 1 if any')
    .action(run((ctx, setId: string | undefined, opts) => runFmt(ctx, setId, opts)));

  program
    .command('import')
    .description('split a source document into one draft YAML per problem')
    .argument('<file>', 'source .html, .docx or .md')
    .requiredOption('--set <id>', 'target set id')
    .option('--title <title>', 'set title when the set is created')
    .option('--document <name>', 'document name recorded in source.document (default: the file name)')
    .option('--no-figures', 'do not copy referenced images into the set')
    .option('--force', 'overwrite existing drafts')
    .action(run((ctx, file: string, opts) => runImport(ctx, file, opts)));

  program
    .command('group')
    .description('propose multi-part scenarios from drafts sharing a figure or narrative')
    .argument('<set>', 'set id')
    .option('--threshold <x>', 'narrative similarity threshold 0..1', Number, 0.6)
    .option('--json', 'machine-readable output')
    .action(run((ctx, setId: string, opts) => runGroup(ctx, setId, opts)));

  program
    .command('agent-task')
    .description('emit a JSON packet for an LLM: source text, literals, printed answer, draft, schema')
    .argument('<id>', 'draft label (e.g. P12) or scenario id')
    .option('--set <id>', 'set to look in (default: search all)')
    .action(run((ctx, id: string, opts) => runAgentTask(ctx, id, opts)));

  return program;
}

/** Parse argv and run; resolves to the exit code. */
export async function main(argv: string[], output: Output = consoleOutput()): Promise<number> {
  let code = 0;
  const program = buildProgram(output, (c) => (code = c));
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (e) {
    const err = e as { exitCode?: number; code?: string };
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') return 0;
    return err.exitCode ?? 2;
  }
  return code;
}
