# Physics Trainer — PHYS161

Randomized physics problems and a Moodle-style quiz to practise them on. The repository holds
the problems of the four PHYS161 exam sets, the tools that turned the exam documents into
randomized problems, an editor for writing them, and the quiz app that serves them as a static
site.

The code is MIT-licensed ([LICENSE](LICENSE)): take any part of it for your own projects.
Credit is appreciated but optional. Bug reports and suggestions go to
[GitHub Issues](https://github.com/omgaXD/pt-nu-phys161/issues).

- [For developers](#for-developers): what each module does, and how to lift one out
- [Features](#features): what the quiz, the editor and the tools do

---

## For developers

A TypeScript monorepo: pnpm workspaces, Node 22+, pnpm 10, Svelte 5 / SvelteKit for the UI,
Vitest and Playwright for tests.

### Modules at a glance

| Module | What it is | Depends on |
| --- | --- | --- |
| [`packages/core`](packages/core) — `@pt/core` | Problem format, expression language, units, instantiation, grading, repository interface. No I/O, no framework. | mathjs (parser only), pure-rand, zod |
| [`packages/store-fs`](packages/store-fs) — `@pt/store-fs` | The problem repository over YAML files on disk | core, yaml |
| [`packages/store-sql`](packages/store-sql) — `@pt/store-sql` | Drizzle/SQLite schema for the same repository; the methods are stubs | core, drizzle-orm |
| [`packages/quiz`](packages/quiz) — `@pt/quiz` | Quiz logic: configuration and presets, question draw, the attempt state machine, progress, storage, share links, state files. No I/O, no framework. | core, pure-rand, zod |
| [`packages/ui`](packages/ui) — `@pt/ui` | Svelte 5 components: math, problem text, answer fields, feedback, quiz shell pieces, editor widgets, and a Moodle theme | core, KaTeX, CodeMirror |
| [`packages/cli`](packages/cli) — `@pt/cli` | The `pt` binary: import, check, fuzz, lint, coverage, bundle… | core, quiz, store-fs |
| [`apps/studio`](apps/studio) | Local SvelteKit problem editor | core, store-fs, ui |
| [`apps/quiz`](apps/quiz) | Static SvelteKit quiz (adapter-static) | core, quiz, ui |

Data, not code:

```
content/sets/<set>/     the PHYS161 Exam 1–4 sets: set.yaml, scenarios/, drafts/, figures/
fixtures/corpus/        21 reference scenarios that span the feature space (the integration test suite)
extra/fixed/            the exam source documents (Google Docs HTML + images), the input to `pt import`
deploy/                 Caddyfile and production docker-compose for the quiz
```

Dependencies only point one way: `core` ← `store-*`, `quiz`, `ui` ← `cli` ← apps.

### Running it

```bash
pnpm install
pnpm -r build
pnpm studio           # the editor, http://localhost:5173
pnpm quiz             # the quiz (bundles content/sets first)
```

```bash
pnpm -r test                     # unit + integration tests in every package
pnpm lint
pnpm -r typecheck
pnpm pt check --root fixtures    # every corpus problem reproduces its printed answer
pnpm --filter @pt/studio exec playwright install chromium
pnpm --filter @pt/studio test:e2e
pnpm --filter @pt/quiz-app test:e2e
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above, plus
`pt check` and `pt coverage --strict` over `content/sets`.

### Reusing a package

The packages are private workspace packages, not published to npm. To use one elsewhere, copy
its directory along with the packages it depends on (table above); `@pt/core` stands alone.

Each package's `exports` has a `@pt/source` condition pointing at `src/*.ts` and a `default`
pointing at `dist/`. The workspace's Vite, Vitest and tsconfig (`customConditions`) resolve
`@pt/source`, so nothing needs building during development. In your own project, either build
the package (`pnpm --filter @pt/core build`) or add `@pt/source` to your bundler's resolve
conditions.

### `@pt/core` — problems, instances, responses, grades

Everything about a problem that is not storage or UI. It never mentions quizzes, exams or
attempts, imports no Node built-ins, frameworks or sibling packages, and does no I/O;
[`test/boundaries.test.ts`](packages/core/test/boundaries.test.ts) enforces both. Take it if you
want randomized numeric problems with unit-aware grading and nothing else.

| Directory | Purpose |
| --- | --- |
| `schema/` | Zod schemas for scenario and set documents, the single source of the types. `parseScenario`, `safeParseScenario`, `parseSetDoc`. Objects are strict: a misspelt key is an error. |
| `expr/` | The expression language. Source is parsed by a mathjs instance built from the parse factory alone, converted to a small plain AST and run by a whitelisted interpreter with node, depth, step and wall-clock budgets. No mathjs runtime is reachable. `createEvaluator`; `validateAnswer` decides what a student may type for an answer type and returns TeX for a live preview; `toTex`. |
| `units/` | Unit parser and table. `areCompatible(from, to)` returns a conversion factor or `false`: units match class by class (`km/h` ↔ `m/s`) or by SI dimensions (`J` ≡ `N m` ≡ `kg m^2 s^-2`). |
| `instantiate/` | `instantiate(scenario, seed)` → `ProblemInstance`, pure and deterministic; `instantiateAt(scenario, values)` for pinned values; seeded sampling with constraint rejection (MT19937 with core's own uniform-integer mapping); variant counting. |
| `template/` | Tokenizer and renderer for the template syntax. Output is HTML with flat placeholders for math, answer slots and figures, so any renderer can fill them in (`splitRenderedHtml`). |
| `grade/` | `gradePart`, `gradeScenario`: relative/absolute tolerance, unit conversion, unit penalty, `exactUnit`, integer answers, and combined "number unit" fields (`191.88 J`). Failures are error codes, never English. |
| `canonical/` | `checkCanonical(scenario)`: pins the source document's values and checks every part reproduces the printed answer. |
| `diagnose/` | `diagnoseScenario`: checks beyond the schema (unknown or forward-referenced identifiers, template names, units) with a path and character offset, which is what editors underline. |
| `numbers/` | Rounding, significant figures, display formatting; `phpFloatString` reproduces how Moodle prints a float. |
| `repo/` | The `ProblemRepository` interface (sets, scenarios, filtered and paginated listings, assets), `InMemoryRepository`, and query helpers. |
| `errors.ts` | `CoreError` and subclasses, each with a stable `code` and `params`. |
| `testing/` | `@pt/core/testing`: the conformance suite (Vitest) every `ProblemRepository` implementation must pass. |

```ts
import { parse } from 'yaml';
import { checkCanonical, gradeScenario, instantiate, parseScenario } from '@pt/core';

const scenario = parseScenario(parse(yamlText)); // validates and applies defaults
const instance = instantiate(scenario, 42);      // same scenario + seed → same problem, always
instance.narrativeHtml;                          // "A mass of 83.0 kg is pushed … by a force of 72.2 N …"
instance.parts[0].modelAnswer;                   // 129.96

gradeScenario(scenario, instance, { work: { value: '129.96', unit: 'N m' } }).fraction; // 1 (N m is accepted for J)
gradeScenario(scenario, instance, { work: { combined: '129.96 kJ' } }).fraction;       // 0 (converted: 129 960 J)
checkCanonical(scenario).ok;                     // the source's numbers reproduce its printed answer
```

### `@pt/store-fs` and `@pt/store-sql` — storage

`FsRepository({ root })` implements `ProblemRepository` over a directory tree:

```
<root>/<setId>/set.yaml
<root>/<setId>/scenarios/<scenarioId>.yaml
<root>/<setId>/figures/…
```

Writes merge into the existing YAML document, so comments and formatting survive, and are
byte-stable (write → read → write changes nothing). Files are written atomically (temp file +
rename). Files that fail to load are skipped in listings and reported as diagnostics. No path
ever crosses the interface. `updateDocumentText` / `newDocumentText` in
[`yaml-doc.ts`](packages/store-fs/src/yaml-doc.ts) are usable on their own if you want
comment-preserving YAML writes.

`@pt/store-sql` holds a Drizzle/SQLite schema (sets, scenarios, tags, parts, assets) and a
`SqlRepository` whose methods throw `NotImplementedError`. Filling them in until
`describeRepositoryConformance` passes is all a database backend needs; nothing above the
repository interface would change.

### `@pt/quiz` — taking quizzes

The logic behind the quiz app, with no Svelte and no DOM. Storage is injected.

| File | Purpose |
| --- | --- |
| `config.ts` | `QuizConfig`, one model for every way of taking a quiz (sets, sections, excluded problems, values, sample size and spread, order, feedback, tries, reveal, time limit, seed), and the five presets as values of it. `applyPreset`, `matchPreset`. |
| `selection.ts` | Choosing sections and single problems, and keeping the two consistent; `leaveOutSolved`. |
| `draw.ts` | `selectQuestions`: the pool the configuration allows, a sample spread over problems, sections or sets (never two problems of one family), then the order. |
| `random.ts` | `hash32`, `questionSeed`, seeded streams and shuffle. A question's numbers come from `hash(attempt seed, set/label)`, so they don't depend on its position. |
| `materialize.ts` | `materialize`: builds the snapshot of one question (its instance and grading fields), falling back to the source's numbers if constraints can't be met. |
| `attempt.ts` | `startAttempt` and `reduceAttempt`, a pure reducer over `answer`, `check`, `reveal`, `reset`, `flag`, `goto`, `tick`, `finish`; `questionState`, `summarizeAttempt`. Attempts are plain JSON. |
| `mastery.ts` | Per-problem progress keyed by `set/label`, so a problem stays solved after it is randomized. |
| `storage.ts` | `QuizStorage` over any `localStorage`-like object: the current attempt, history (the last 10 kept in full), mastery, preferences, quota handling. |
| `url.ts` | `encodeConfig` / `decodeConfig`: share links that name the nearest preset and only the fields that differ. |
| `transfer.ts` | Export/import state files with schema validation and merging. |
| `bundle.ts` | The static content format the app loads (`index.json`, `sets/<id>.json`). |

```ts
import { parseScenario } from '@pt/core';
import { BundleSetSchema, defaultConfig, materialize, reduceAttempt, startAttempt } from '@pt/quiz';

const set = BundleSetSchema.parse(await (await fetch('content/sets/phys161-exam2.json')).json());
const config = { ...defaultConfig([set.setId], 'exam'), seed: 42 }; // 7 questions, 40 minutes
let { attempt } = startAttempt({ config, catalog: [set], contentVersion: set.version, now: Date.now() });
attempt.questions.forEach((q, index) => {
  const { scenario, hash } = set.scenarios[q.scenarioId]!;
  attempt = reduceAttempt(attempt, { type: 'snapshot', index, snapshot: materialize(q, parseScenario(scenario), q.seed, hash) });
});
attempt = reduceAttempt(attempt, { type: 'answer', index: 0, answer: { value: '191.88 J', unit: '' } });
attempt = reduceAttempt(attempt, { type: 'finish', now: Date.now(), reason: 'submitted' });
attempt.marks; // 0..1 per question
```

### `@pt/ui` — Svelte 5 components

Presentational only: everything renders from a `ProblemInstance` (or a `Scenario`, for editor
components) plus callbacks, with no data fetching, stores or routing.

- **Math:** `MathInline`, `MathBlock`, `renderTex`, the one place math is typeset (KaTeX now;
  swap this function for MathJax).
- **Problem:** `ProblemBody` (narrative, prompts, answer fields in their slots, figure),
  `Figure` (image with overlay labels positioned in percentages, so labels can hold math and
  stay in place when scaled), `RichHtml`.
- **Answers:** `AnswerField` (debounced validation with a TeX preview, in separate or combined
  "number unit" mode), `UnitField`, `NumericKeypad`, `validateField`, `toResponse`.
- **Results:** `PartFeedback`, `CorrectAnswer`, `GradeBadge`, `OutcomeIcon`, `DifficultyDots`.
- **Shell:** `QuestionCard`, `NavGrid`, `FlagToggle`, `CountdownTimer`.
- **Editor:** `TemplateEditor`, `FormulaInput` (CodeMirror with autocomplete and inline
  diagnostics), `VariableTable`, `SeedScrubber`, `CanonicalPanel`.
- **Styles:** `@pt/ui/styles.css` (base), `@pt/ui/themes/moodle.css` (Moodle Boost look,
  scoped under `.pt-theme-moodle`, so it changes nothing until an element opts in).

User-facing strings are overridable: error codes from core map to English through
`DEFAULT_MESSAGES`, and components take a `messages` prop.

```svelte
<script lang="ts">
  import '@pt/ui/styles.css';
  import '@pt/ui/themes/moodle.css';
  import { gradePart, instantiate, type PartResult, type Scenario } from '@pt/core';
  import { PartFeedback, ProblemBody, toResponse, type PartAnswer } from '@pt/ui';

  let { scenario, seed }: { scenario: Scenario; seed: number } = $props();
  const instance = $derived(instantiate(scenario, seed));
  let answers = $state<Record<string, PartAnswer>>({});
  let result = $state<PartResult>();

  function check() {
    const part = scenario.parts[0];
    result = gradePart(part, instance, toResponse(instance.parts[0], answers[part.id]));
  }
</script>

<div class="pt-theme-moodle">
  <ProblemBody {instance} bind:answers resolveSrc={(src) => `/figures/${src}`} />
  <button onclick={check}>Check</button>
  {#if result}<PartFeedback {result} />{/if}
</div>
```

### `@pt/cli` — the `pt` binary

Authoring and verification. Run it as `pnpm pt <command>` after a build. Scenarios are resolved
by id through the repository (`--root`, env `PT_ROOT`, default `content/sets`), or given as a
path to a YAML file. Commands that report take `--json`, for agents and scripts. Every command
is also exported as a function (`runCheck`, `fuzzScenario`, `importDocument`, `runBundle`…)
for use from code.

| Command | Does |
| --- | --- |
| `import <file> --set <id>` | Splits an exam document (`.html`, `.docx` via mammoth, or `.md`) into one draft YAML per problem: raw and normalised text, printed answer, detected literals with suggested ranges, figures. |
| `group <set>` | Proposes multi-part scenarios from drafts that share a figure or similar text. |
| `agent-task <label>` | A JSON packet for an LLM (or a person) to author one problem: source text, literals, printed answer, schema, rules, difficulty rubric. |
| `check [id]` | Schema, diagnostics and the canonical check; exits 1 on failure. |
| `gen <id> --seed <n>` | Prints the rendered instance and model answers. |
| `fuzz <id> -n 500` | Instantiates across many seeds: NaN/∞, unsatisfiable constraints, rejection rate. |
| `variants <id>` | Number of distinct variants and the per-variable breakdown. |
| `lint <set>` | Alt text, tolerances, figures, ids, slots, canonical blocks, source labels, difficulty. |
| `fmt` | Rewrites files in the form the repository writes (`--check` to only report). |
| `coverage [set]` | Per source problem: authored (randomized), fixed (source numbers) or missing. |
| `bundle --out <dir>` | Writes the quiz app's static content: `index.json`, `sets/<id>.json`, figures. |

Inside: `src/import/` (HTML/Markdown parsing, problem splitting, literal detection, drafts and
fixed scenarios), `src/bundle/catalog.ts` (which scenario part answers each source problem),
`src/commands/`.

### `apps/studio` — the editor

**Local-only, no authentication: do not expose it on a network.** SvelteKit with adapter-node.

- `src/lib/server/repository.ts` picks the store: `PT_STORE=fs|memory` (default `fs`), roots
  from `PT_ROOT` (a path list; by default `content/sets` and `fixtures` together).
- `src/lib/server/multi.ts` shows several repositories as one: reads fan out, writes go to the
  owner of the set.
- Routes: `/` sets; `/sets/<id>` scenario list and imported drafts; `/sets/<id>/<scenario>` the
  editor; `/sets/<id>/new`, `/sets/<id>/drafts/<label>`; `/dev` every `@pt/ui` component
  rendered against the corpus; `/api/scenarios/<id>` and `/assets/…` for the client.

### `apps/quiz` — the quiz

A static SvelteKit site (adapter-static): no server, no accounts. `pt bundle` writes the content
to `apps/quiz/static/content/` (git-ignored); instantiation and grading run in the browser, and
everything the user does is kept in `localStorage`.

- `src/lib/app.svelte.ts`: app state (loading the bundle, the current attempt, history,
  progress, preferences) on top of `@pt/quiz`'s `QuizStorage`.
- `src/routes/`: `/` start page, `/attempt` and `/attempt/summary`, `/review`, `/about`.
- `src/lib/components/`: the Moodle page frame with its drawers, question view, quiz navigation,
  timer, state export/import.
- `src/lib/repo.ts`: the repository URL used for the Feedback link.

Build with `pnpm --filter @pt/quiz-app build`; set `BASE_PATH=/<sub-path>` to serve from a
sub-path. A deployed site shows every problem and its answer to anyone with the URL.

### The problem format

One YAML file per **scenario**: a physical situation with shared narrative, variables and
figure, and one or more **parts** (questions).

```yaml
id: c01-push-work
title: Work pushing a mass on a frictionless surface
source: { document: PHYS161_Exam2, labels: [ P1 ] }
section: Work
narrative: >-
  A mass of {m:unit} is pushed (not pulled) horizontally a distance of {d:unit} by a force of
  {F:unit} on a horizontal frictionless surface.
vars:
  - { name: m, kind: range, min: 20, max: 90, step: 0.5, decimals: 1, unit: kg }
  - { name: d, kind: range, min: 1, max: 5, step: 0.1, decimals: 1, unit: m }
  - { name: F, kind: range, min: 40, max: 100, step: 0.1, decimals: 1, unit: N }
parts:
  - id: work
    prompt: "Determine the work necessary to push the mass. {_0}{_u}"
    answer: F * d
    unit: J
    tolerance: { rel: 0.01 }
    difficulty: 1
canonical:
  vars: { m: 66.5, d: 2.6, F: 73.8 }
  parts:
    - { id: work, answer: 191.88, unit: J, source: P1 }
```

- **Variables:** `range` (min, max, step, `decimals` or `sigfigs`) or `choice`; `derived`
  values are evaluated in order after them; `constraints` are boolean expressions that reject
  a draw.
- **Templates** (`narrative`, `prompt`, captions, overlays, hints, solutions): `{name}`,
  `{name:unit}`, `{= expr}`, answer slots `{_0}` / `{_u}` (`{_0}{_u}` is one combined field),
  `{@fig}`, and `$…$` / `$$…$$` math.
- **Answer types:** `number` (a plain number), `numeric` (arithmetic, `pi`, `e`),
  `numericalFormula` (also functions such as `sqrt`, `sin`, `log`), as in Moodle's
  qtype_formulas. Authors additionally get `norm`, `dot`, `cross`, `clamp`, and
  `solve(f(r) = …, lo, hi)` / `iterate` with an inline lambda.
- **Parts** also take `unitPenalty`, `exactUnit` ("express in km/h"), `integer`, `mark`,
  `difficulty` (1–5, rated by the author), `tags`, `hint`, `solution`.
- **Canonical block:** the source's literal values and printed answers. `pt check` pins the
  variables to them and asserts the formulas reproduce the answers. A per-part `vars` override
  checks each part of a multi-part scenario against its own source problem; a key naming a
  derived value (`g: 9.8`) is asserted, not overridden.

[`fixtures/corpus/scenarios/c03-luggage-ramp.yaml`](fixtures/corpus/scenarios/c03-luggage-ramp.yaml)
is a complete multi-part example with a figure, overlays, a derived value, a constraint and
per-part canonical values.

### Design rules worth knowing before changing things

- **Determinism is the contract.** `(scenarioId, seed) → instance` is pure. Three scenarios
  are pinned by 10 000-seed fingerprints in
  [`instantiate.test.ts`](packages/core/test/instantiate.test.ts); if one changes, generated
  problems changed identity. Share links rely on `hash32` in `@pt/quiz` never changing too.
- **Generated values are never the source of truth**, with one exception: an attempt stores a
  snapshot of each question when it is first shown, so rebuilding the content (a corrected
  formula) never changes a question someone is answering or reviewing.
- **The source corpus is the test suite.** Every authored problem must reproduce the answer
  printed in the exam document.
- **Core returns codes, not text.** UI copy lives in `@pt/ui` and the apps.
- **Units** `N` vs `kg m/s^2`, `J` vs `N m` and `L` vs `m^3` convert by SI dimensions;
  `°C` is never converted to `K`; `rpm` is in the `Hz` class, `rev` and `°` in the `rad`
  class, `eV` in the `J` class.

### Authoring workflow

A draft becomes playable before anyone writes a formula: `pt bundle` turns every draft with a
printed answer into a **fixed** scenario (every variable pinned to its printed value, the
printed answer as the formula). An **authored** scenario replaces it as soon as one of its
`canonical.parts[].source` labels names the problem, so randomizing a set is incremental:

```bash
pt import extra/fixed/PHYS161_Exam2_new.docx.html --set phys161-exam2 --document PHYS161_Exam2 --title "PHYS161 Exam 2"
pt group phys161-exam2                          # families of problems that share a situation
pt agent-task P12 --set phys161-exam2           # packet for an LLM (or a person)
# … write content/sets/phys161-exam2/scenarios/<id>.yaml by hand, by agent, or in Studio …
pt check <id> && pt fuzz <id> -n 500            # reproduces the printed answers; no failures
pt lint phys161-exam2 && pt coverage phys161-exam2 --strict
```

Problems that share a situation (the `pt group` clusters, plus each authored scenario's labels)
form a **family**; a sampled quiz never draws two problems of one family.

### Deploying the quiz

**GitHub Pages:** [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs only when
started by hand.

**Own server:** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every
push to `main` (and by hand). It runs the CI checks, builds the [`Dockerfile`](Dockerfile) (the
static build served by Caddy on :8080, see [`deploy/Caddyfile`](deploy/Caddyfile)), pushes it
to `ghcr.io/<owner>/<repo>` tagged with the commit SHA and `latest`, then over SSH writes
`docker-compose.yml` (from [`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml))
and `.env` into `DEPLOY_DIR`, runs `docker compose up -d`, and fails if the container isn't
running 10 seconds later.

The container publishes no ports: it joins the external `caddy` network and
[caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy) serves it on `DOMAIN`
over HTTPS. The server needs Docker with the compose plugin (SSH user in the `docker` group,
`sudo systemctl enable docker`), caddy-docker-proxy on a network named `caddy`, and a DNS
record for `DOMAIN`.

In *Settings → Environments → `production`*:

| Name | Kind | |
| --- | --- | --- |
| `SSH_PRIVATE_KEY` | secret | a deploy key authorized on the server |
| `GHCR_PAT` | secret | classic PAT with only `read:packages` (the server pulls the image with it) |
| `SSH_HOST`, `SSH_USER` | variable | |
| `SSH_KNOWN_HOSTS` | variable | output of `ssh-keyscan -p <port> <host>` |
| `DOMAIN` | variable | the quiz's hostname, e.g. `quiz.example.com` |
| `SSH_PORT` | variable | optional, default `22` |
| `DEPLOY_DIR` | variable | optional, default `~/pt-quiz`; created if missing |
| `GHCR_USERNAME` | variable | optional, owner of the PAT; default is the repo owner |

Values must not contain single quotes or newlines. To roll back, re-run an older successful
*Deploy* run, or set `IMAGE` in the server's `.env` to an older SHA and run
`docker compose up -d`.

### Not done yet

The SQL backend (schema only), an `algebraic` answer type (symbolic answers compared by
sampling), and translations (core already returns error codes; `@pt/ui` maps them to
overridable English).

---

## Features

### Content

- **PHYS161 Exams 1–3:** all 150 problems of each are randomized: same situation, new numbers
  every attempt, each checked against the answer printed in the exam document.
- **PHYS161 Exam 4:** all 99 problems are playable with the exam's own numbers; randomizing
  them is not done yet.
- Figures from the exam documents, and per-section reference sheets (e.g. a
  moment-of-inertia table) that open from the question.

### Quiz

- **Looks and behaves like Moodle:** the theme, one question per page, the question card, the
  answer box with its live formula preview, the quiz navigation block, flags, the `Time left`
  timer, the summary page with *Submit all and finish*, and the review page.
- **Presets:** *Exam* (7 shuffled problems from different sections, 40 minutes, marks at the
  end), *Nightmare* (Exam with difficulty 3–5 only), *Practice* (every problem in order, Check
  after each), *Chaotic* (Practice, shuffled) and *Easy to Hard* (Practice, easiest first).
- **Everything is adjustable:** sets, sections, single problems picked on number tiles,
  randomized or the source's own numbers, whether to include not-yet-randomized problems, a
  difficulty range, all problems or a sample of N spread over problems, sections or sets,
  order (source, shuffled, easy-to-hard, hard-to-easy), feedback after each answer or only at
  the end, a number of tries, a *Show correct answer* button, a time limit, a seed. Any change
  shows *Custom*.
- **Answers:** a number, arithmetic or a formula depending on the question, with the unit in
  its own field or in the same one. Units convert (`N m` for `J`, `km/h` for `m/s`) unless the
  question asks for a specific unit; a right number with a wrong unit gets partial credit.
- **Feedback:** with *Check*, a verdict per question, tries left and *Reset* to start it again;
  in the review, marks, a grade out of 10, feedback and the correct answers. A question's
  difficulty is shown only once it is settled.
- **Share links:** *Copy link* encodes the configuration and seed; the same link gives the same
  questions with the same numbers on any device.
- **Progress:** the attempt in progress survives reloads (the timer keeps running and submits
  at the deadline); finished attempts are listed with their marks, grade and review; solved
  problems are remembered, and *Leave out solved* drops them from the selection.
- **Export / import state:** download a `.json` file with progress, the current quiz, history
  and settings, and import any of those in another browser or device, keeping or replacing
  what is already there.
- **Static and private:** no server and no account; everything stays in the browser.

### Studio (the editor)

- Lists of sets and scenarios, filtered by section, tag, difficulty, canonical status or text,
  plus imported drafts; opening a draft starts a new scenario pre-filled from it.
- A three-pane editor: text on the left; variables, derived values, constraints, answer
  formulas and canonical values in the middle; a live preview on the right with a seed
  scrubber, an at-source toggle, the canonical check and problems.
- Every keystroke re-instantiates in the browser; errors show inline while the last good
  preview stays. Formula fields autocomplete names and show their current value.
- Save with Ctrl/⌘-S; a scenario that fails its canonical check is saved as a draft.

### Authoring tools

- Import exam documents (`.html`, `.docx`, `.md`) into one draft per problem, with literals
  and printed answers detected.
- Group drafts into multi-part scenarios, and hand a problem to an LLM as a self-contained task.
- Check that every problem reproduces its printed answer, fuzz it across seeds, count its
  variants, lint a set, format files, report coverage, and bundle everything for the quiz.
