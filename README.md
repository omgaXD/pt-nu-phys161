# Physics Trainer — core

Building blocks for randomized physics problems (see [PLAN.md](PLAN.md)): a declarative
problem format, a deterministic evaluation core, storage adapters, an authoring CLI, a
Svelte 5 component library, and **Studio**, a local problem editor.

The quiz/exam runner is deliberately not here yet. Everything below is built so that adding
it later is assembly, not redesign.

```
packages/core       @pt/core       schema, expressions, units, instantiation, grading, repository interface (no I/O, no framework)
packages/store-fs   @pt/store-fs   YAML-on-disk ProblemRepository (comment-preserving, byte-stable writes)
packages/store-sql  @pt/store-sql  Drizzle/SQLite schema + stubbed SqlRepository
packages/cli        @pt/cli        the `pt` binary: check, gen, fuzz, variants, lint, fmt, import, group, agent-task
packages/ui         @pt/ui         Svelte 5 components (KaTeX math, answer fields, results, shell, editors)
apps/studio                        SvelteKit editor (+ /dev component gallery)
content/sets/                      authored content (phys161-exam2: 150 imported drafts)
fixtures/corpus/                   the reference corpus — the integration test suite
```

## Quick start

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm -r build
pnpm -r test          # unit + integration tests in every package
pnpm lint
pnpm -r typecheck
pnpm pt check --root fixtures   # every corpus problem reproduces its printed answer
pnpm studio           # http://localhost:5173
```

Studio browser tests (Playwright, Chromium):

```bash
pnpm --filter @pt/studio exec playwright install chromium
pnpm --filter @pt/studio test:e2e
```

## The problem format

One YAML file per **scenario** (a physical situation with shared narrative, variables and
figure) with one or more **parts** (questions). See
[fixtures/corpus/scenarios/c03-luggage-ramp.yaml](fixtures/corpus/scenarios/c03-luggage-ramp.yaml)
for a complete multi-part example. Every scenario has a **canonical** block recording the
source's literal values and printed answers; `pt check` pins the variables to those values and
asserts the formulas reproduce the answers. That is what makes bulk (and agent-assisted)
authoring safe.

Templates (`narrative`, `prompt`, captions, overlays, hints, solutions) share one syntax:
`{name}`, `{name:unit}`, `{= expr}`, `{_0}` / `{_u}` / `{_0}{_u}` answer slots, `{@fig}`, and
`$…$` / `$$…$$` math.

**Determinism is the contract.** `(scenarioId, seed) → instance` is pure. Three scenarios are
pinned by 10 000-seed fingerprints in `packages/core/test/instantiate.test.ts`; if one changes,
generated problems changed identity.

## Authoring workflow

```bash
pt import source.html --set phys161-exam2 --document PHYS161_Exam2   # 150 drafts + figure stubs
pt group phys161-exam2            # proposed multi-part scenarios (shared figure / similar text)
pt agent-task P12                 # JSON packet for an LLM: source, literals, answer, schema, rules
# … write content/sets/phys161-exam2/scenarios/<id>.yaml (by hand, by agent, or in Studio) …
pt check                          # schema + diagnostics + canonical check (exit 1 on failure)
pt fuzz <id> -n 500               # NaN/∞, unsatisfiable constraints, magnitude band, rejection rate
pt lint phys161-exam2             # alt text, tolerances, figures, ids, slots, canonical blocks
pt fmt                            # rewrite files in the canonical form the repository writes
```

`pt` resolves scenarios by id through the repository (`--root`, env `PT_ROOT`, default
`content/sets`) or accepts a path to a YAML file. Every command has `--json` for agents.

## Studio

**Local-only, no authentication.** Do not expose it on a network.

- `/`: sets. `/sets/<id>`: scenarios filtered by section, tag, difficulty, canonical status or
  text, plus imported drafts ("open as new scenario" pre-fills the editor from a draft).
- `/sets/<id>/<scenario>`: the three-pane editor. Text on the left; variables, derived values,
  constraints, answer formulas and canonical values in the middle; live preview (seed scrubber,
  at-source toggle), canonical check and problems on the right. Every keystroke re-instantiates
  client-side; errors show inline while the last good preview stays. Save (Ctrl/⌘-S) writes
  through the repository, and a failing scenario is saved with `draft: true`.
- `/dev`: every `@pt/ui` component rendered against the corpus.

Storage is chosen by `PT_STORE=fs|memory` (default `fs`). Roots come from `PT_ROOT` (a path
list); by default Studio shows `content/sets` and `fixtures` together.

## Decisions, deviations and additions (relative to PLAN.md)

- **mathjs is the parser only.** Expressions are parsed by a mathjs instance built from the
  parse factory alone (so `evaluate`, `import`, `createUnit` etc. do not exist in it), then
  converted to a small plain AST and evaluated by a whitelisted interpreter. This gives exact
  node, depth, step and wall-clock budgets (even inside `solve`/`iterate` loops) and typed
  errors, with no mathjs runtime reachable. `solve` and `iterate` take an inline lambda,
  `solve(f(r) = …, lo, hi)`, which is the only function-definition form allowed and only for
  authors. Array indexing is 1-based, as in mathjs.
- **Canonical checks per part.** `canonical.parts[].vars` may override `canonical.vars`, so
  every part of a multi-part scenario is checked against its own source problem (P12/P13/P14,
  P115–P118). A key naming a derived value (`g: 9.8`) is *asserted*, not overridden. Source
  values that violate a constraint are reported as warnings, not failures (P12's suitcase is
  already moving). Values the randomization cannot reach are also warnings.
- **Extra schema fields:** `Part.integer` (asked for by C11), `Scenario.title`,
  `Scenario.draft` (Studio's "saved while failing") and `SetDoc.order`. `ProblemRepository`
  also has `putSet`, and `putScenario(s, { setId })` for creating scenarios.
- **Random draws** use MT19937 from pure-rand, with the uniform-integer mapping implemented in
  core, so the seed→value mapping depends on this code only. Retries use
  `(seed·0x9E3779B1 + k) mod 2³²`.
- **Rendering stays math-engine agnostic.** Core emits HTML with flat placeholders for math,
  slots and figures; `@pt/ui` renders them (KaTeX behind `renderTex`). Figure overlay labels
  are an HTML layer positioned in percentages and sized in container units rather than SVG
  `<text>`, so labels can contain math and still stay in place under scaling.
- **Unit table:** `min`, `h`, `day(s)` are in the `s` class; `rpm` is in the `Hz` class
  (1/60 Hz); `L` is its own class; `rev` and `°` are in the `rad` class; `eV` is in the `J`
  class. `N` vs `kg m/s^2`, `J` vs `N m` and `L` vs `m^3` are deliberately *not*
  interchangeable.
- **Vitest 4+ replaced `vitest.workspace.ts`** with `test.projects` in the root
  `vitest.config.ts`.
- **CLI-only dependencies** beyond the approved list: `htmlparser2` (HTML import) and `mammoth`
  (`.docx` → HTML, same pipeline). `pt fmt` was added to normalise files.
- **Drafts** from `pt import` live in `<set>/drafts/`, so the repository never mistakes them
  for scenarios. Each draft keeps the raw source (`<sup>`/`<sub>` preserved), the normalised
  text, the printed answer, detected literals with suggested ranges, and a TODO scenario.
- **Corpus:** the 14 problems (C1–C14) plus 7 companions the plan cites (P50, P80, P93, P98,
  P114, P129, P132). Figures use a placeholder asset with real alt text. The real images are
  in `content/sets/phys161-exam2/figures/`, copied by `pt import`.

## Deferred (recorded, not resolved)

Persistence backend (FS now; the SQL schema is ready and the conformance suite defines done),
quiz/exam modes and scoring policy, KaTeX vs MathJax, an `algebraic` answer type, figure
sourcing, and i18n (core returns error codes, and `@pt/ui` maps them to overridable English
messages).
