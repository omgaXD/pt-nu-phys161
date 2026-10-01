# Physics Trainer — core

Building blocks for randomized physics problems (see [PLAN.md](PLAN.md)): a declarative
problem format, a deterministic evaluation core, storage adapters, an authoring CLI, a
Svelte 5 component library, **Studio** (a local problem editor) and **Quiz**, a static,
Moodle-style quiz runner over the PHYS161 Exams 1–4.

```
packages/core       @pt/core       schema, expressions, units, instantiation, grading, repository interface (no I/O, no framework)
packages/store-fs   @pt/store-fs   YAML-on-disk ProblemRepository (comment-preserving, byte-stable writes)
packages/store-sql  @pt/store-sql  Drizzle/SQLite schema + stubbed SqlRepository
packages/cli        @pt/cli        the `pt` binary: check, gen, fuzz, variants, lint, fmt, import, group, agent-task, coverage, bundle
packages/quiz       @pt/quiz       quiz logic: configuration + presets, selection, attempt state machine, mastery, storage (no framework, no I/O)
packages/ui         @pt/ui         Svelte 5 components (KaTeX math, answer fields, results, shell, editors) + Moodle theme
apps/studio                        SvelteKit editor (+ /dev component gallery)
apps/quiz                          static SvelteKit quiz runner (adapter-static)
content/sets/                      PHYS161 Exams 1–4: imported drafts, figures, authored scenarios
fixtures/corpus/                   the reference corpus — the integration test suite
extra/fixed/                       the exam source documents (Google Docs HTML + images), input to `pt import`
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
pnpm quiz             # the quiz runner (bundles content/sets first)
```

Browser tests (Playwright, Chromium):

```bash
pnpm --filter @pt/studio exec playwright install chromium
pnpm --filter @pt/studio test:e2e
pnpm --filter @pt/quiz-app test:e2e
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
pt import "extra/fixed/PHYS161 Exam 3.html" --set phys161-exam3 --document PHYS161_Exam3 --title "PHYS161 Exam 3"
pt group phys161-exam2            # proposed multi-part scenarios (shared figure / similar text)
pt agent-task P12 --set phys161-exam2   # JSON packet for an LLM: source, literals, answer, schema, rules
# … write content/sets/phys161-exam2/scenarios/<id>.yaml (by hand, by agent, or in Studio) …
pt check                          # schema + diagnostics + canonical check (exit 1 on failure)
pt fuzz <id> -n 500               # NaN/∞, unsatisfiable constraints, magnitude band, rejection rate
pt lint phys161-exam2             # alt text, tolerances, figures, ids, slots, canonical blocks, source labels
pt fmt                            # rewrite files in the canonical form the repository writes
pt coverage [set] [--strict]      # per source problem: authored (randomized), fixed (source values) or missing
pt bundle --out <dir> [--strict]  # the quiz app's static content: index.json, sets/<id>.json, figures
```

### Fixed problems and the authoring loop

A draft becomes playable before anyone writes its formula: `pt bundle` (and `pt coverage`)
turn every draft with a printed answer into a **fixed** scenario — each variable pinned to its
printed value (as a one-option `choice`, with the precision the source printed), the printed
answer as the formula, `exactUnit` for "express in …" prompts, `integer` for counts. An
**authored** scenario replaces it as soon as one of its `canonical.parts[].source` labels names
the problem. Randomizing the four exams is therefore incremental, one section at a time:

```bash
pt group phys161-exam1                        # families of problems that share a situation
pt agent-task P12 --set phys161-exam1         # packet for an LLM (or a person)
# … write content/sets/phys161-exam1/scenarios/<id>.yaml …
pt check <id> && pt fuzz <id> -n 500          # reproduces the printed answers; no failures
pt lint phys161-exam1 && pt coverage phys161-exam1 --strict   # labels moved from fixed to authored
```

Problems that share a situation (the `pt group` clusters, plus each authored scenario's labels)
form a **family**; a sampled quiz never draws two problems of one family.

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

## Quiz

`apps/quiz` is a static site (no server, no accounts): `pt bundle` writes the content to
`apps/quiz/static/content/` (git-ignored), and instantiation and grading run in the browser.
Attempts, history and progress live in the browser's `localStorage`. Build with
`pnpm --filter @pt/quiz-app build`; set `BASE_PATH=/<sub-path>` to serve it from a sub-path.
The GitHub Pages workflow (`.github/workflows/pages.yml`) runs only when started by hand: a
deployed site shows every problem and answer to anyone with the URL.

- **Start page:** one configuration model (sets and sections, randomized or source numbers,
  include not-yet-randomized problems, skip solved ones, a difficulty range, all or a sample of
  N spread uniformly / across sections / across sets, source or shuffled order, immediate or
  deferred feedback, tries, a "Show correct answer" button, a time limit, a seed) with three
  presets that set it in one click — **Ordered** (every problem in order, Check after each),
  **Exam** (7 problems from different sections, 40 minutes, marks at the end) and **Chaotic**
  (Ordered, shuffled). Any edit shows *Custom*. *Copy link* encodes the configuration and seed:
  the same link reproduces the same questions and numbers.
- **Attempt:** Moodle's layout — one question per page, the question card, a quiz navigation
  block, a sticky `Time left 0:39:59` timer that submits at the deadline (also after a reload),
  flags, Check / tries / Show correct answer in immediate mode, a summary page with *Submit all
  and finish*, and a review with marks, a grade out of 10, feedback and the correct answers.
- **Progress:** the attempt in progress survives reloads; finished attempts are listed with
  their reviews; solved problems are remembered per source problem (`set/label`, so solving a
  fixed problem still counts once it is randomized).

`@pt/quiz` holds all of this logic (no Svelte, no DOM) and is unit-tested; `apps/quiz` is the
UI. Each question's numbers come from `hash(attempt seed, set/label)`, so they do not depend on
its position in the quiz.

### Deploying the quiz (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main` (and by hand). It runs the CI
checks, builds the [`Dockerfile`](Dockerfile) (the static build served by Caddy on :8080, see
[`deploy/Caddyfile`](deploy/Caddyfile)), pushes it to `ghcr.io/<owner>/<repo>` tagged with the
commit SHA and `latest`, then SSHes into the server, writes `docker-compose.yml` (from
[`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml)) and `.env` into
`DEPLOY_DIR`, runs `docker compose up -d`, and fails if the container isn't running 10 seconds
later. Like the Pages workflow, it makes every problem and answer public on `DOMAIN`.

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

## Decisions, deviations and additions (relative to PLAN.md)

- **Attempts keep snapshots.** An attempt stores each question's rendered instance (trimmed to
  its part) when it is first shown. This is the one deliberate exception to "never persist
  generated values" (§0.3): it is a record of what the student saw, so rebuilding the content
  (a corrected formula) never changes a question someone is answering or reviewing. The seed
  remains the identity; the snapshot is a cache of it.
- **Units:** `K`, `°C` (never converted to `K`), `mol`, `atm`/`bar` (pressure), `cal`/`kcal`
  (energy), `dB` and `%` are known; `Part.exactUnit` forbids conversion ("express in km/h").
- **Import:** the four PHYS161 sources import cleanly (`P.76.` labels, problems styled as
  headings, answers like `(0,00133459 kg)`, `(3 446 932.845 J)`, `(862.9 J/(kg K))`,
  `(45)]`); section reference sheets and pictures inside text are recorded as figure roles.
  Exam 3 P51 has its symbol as a picture and needs a hand fix before it is playable.

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
- **Difficulty is authored, not computed.** `Part.difficulty` (1–5) is rated by the author or
  agent by the reasoning a part takes (`pt agent-task` carries the rubric; `pt lint` warns when it
  is missing). A score from the answer formula agreed with the existing ratings only roughly
  (61% exactly) and underrates problems whose final formula is short but whose reasoning is not
  (loop minimum height, Doppler beats), so there is none. Fixed problems have no rating until they are authored.
  The quiz filters by a difficulty range (unrated problems only if asked) and shows a question's
  difficulty, as dots, only once it is settled: in review, or with immediate feedback once it is
  solved, its answer shown, or out of tries. Never during an attempt otherwise.
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
  P114, P129, P132). Figures use a placeholder asset with real alt text. The same 21 scenarios
  are also Exam 2's first authored content (`content/sets/phys161-exam2/scenarios/`,
  `phys161-e2-*`, with the real figures).

## Deferred (recorded, not resolved)

Persistence backend (FS now; the SQL schema is ready and the conformance suite defines done),
KaTeX vs MathJax, an `algebraic` answer type, and i18n (core returns error codes, and `@pt/ui` maps them to overridable English
messages).
