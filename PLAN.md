# Physics Quiz Trainer — Core Implementation Plan

**Target:** TypeScript + SvelteKit monorepo.
**Scope of this plan:** the *building blocks only* — declarative problem representation, evaluation core, authoring CLI, and a Svelte component library. Plus one small app: the problem **editor** (Studio).

**Explicitly out of scope right now:** the quiz/exam runner app, quiz modes, session state, scoring rules, review pages, auth, deployment. Those depend on decisions not yet made. Everything below must be built so that adding them later is assembly, not redesign.

---

## 0. Guiding constraints

1. **Storage is undecided.** File-backed (YAML/JSON) and database-backed must both be viable. Nothing above the repository layer may know which is in use. Default implementation is filesystem; a DB adapter must be droppable in with zero changes to `@pt/core`.
2. **Quiz format is undecided.** `@pt/core` must not contain the words "quiz", "exam", "attempt", or "session". It deals in *problems*, *instances*, *responses*, and *grades*. The runner will be built on top later.
3. **Determinism is the contract.** `(problemId, seed) → instance` must be pure and stable forever. A seed is the entire identity of a generated problem. Never persist generated values as the source of truth.
4. **The source corpus is the test suite.** Each authored problem carries its original literal values and its original printed answer. CI asserts they reproduce. This is how 150 problems get authored quickly without silent transcription bugs.
5. **Figures are first-class.** ~28% of problems have one, and they are shared between sibling problems.

---

## 1. Repository layout

```
physics-trainer/
├── package.json                  # pnpm workspaces
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
├── packages/
│   ├── core/          @pt/core        # zero framework deps, zero I/O
│   ├── store-fs/      @pt/store-fs    # YAML/JSON repository implementation
│   ├── store-sql/     @pt/store-sql   # stub: Drizzle + SQLite, schema only
│   ├── ui/            @pt/ui          # Svelte 5 component library
│   └── cli/           @pt/cli         # authoring & verification tooling
├── apps/
│   └── studio/                        # SvelteKit — problem editor
├── content/
│   └── sets/phys161-exam2/            # authored problems live here by default
└── fixtures/
    └── corpus/                        # the reference problems from §9
```

**Package manager:** pnpm. **Node:** 22+. **Module system:** ESM only.

### Dependencies (approved, use these rather than hand-rolling)

| Package | Used for | Notes |
|---|---|---|
| `mathjs` | expression parsing + evaluation substrate | Use `math.parse` for AST, `math.create` with a **restricted function set**. Do not use `math.Unit` — see §5. |
| `pure-rand` | seeded PRNG | Provides Mersenne Twister; keeps the door open for PHP `mt_srand` parity later. |
| `zod` | schema validation, single source of truth for types | Derive TS types via `z.infer`. |
| `yaml` | human-editable problem files | `eemeli/yaml`, preserves comments on round-trip. |
| `katex` | math rendering | Fast, synchronous, no MathJax startup cost. Keep rendering behind a `<MathInline>` component so it can be swapped for MathJax later if 1:1 fidelity demands it. |
| `vitest` | tests | |
| `commander` | CLI | |
| `@codemirror/*` | formula/template editing in Studio | |
| `drizzle-orm` | store-sql stub only | |

Do not add a state-management library. Svelte 5 runes are sufficient.

---

## 2. The declarative problem representation

This is the most important deliverable. Get it right before writing anything else.

### 2.1 Model

```
Set          — a named collection (e.g. "PHYS161 Exam 2"), ordered sections
  Section    — "Work", "Kinetic energy", "Torque", … (from the source document)
    Scenario — one physical situation: shared narrative, shared variables, shared figure
      Part   — one question asked about that scenario, with its own answer & unit
```

A `Scenario` with exactly one `Part` is the common case; do not special-case it.

### 2.2 Zod schema (`packages/core/src/schema/`)

Implement these. Field names are deliberate — keep them.

```ts
// ---- Variables -------------------------------------------------------------
type RandomVar = {
  name: string;              // identifier usable in formulas
  kind: "range" | "choice";
  // range:
  min?: number; max?: number; step?: number;
  // choice:
  options?: (number | string)[];
  // presentation & quantization
  decimals?: number;         // round to N decimals BEFORE use (see §3.2)
  sigfigs?: number;          // alternative to decimals
  unit?: string;             // unit shown next to the value in the prompt
  label?: string;            // human name for the editor UI
};

type DerivedVar = {
  name: string;
  expr: string;              // evaluated after randoms, in declaration order
  unit?: string;
};

// ---- Figures ---------------------------------------------------------------
type Figure = {
  id: string;
  src: string;               // asset path, resolved by the repository
  alt: string;               // REQUIRED, non-empty
  caption?: string;          // may contain {var} interpolation
  overlays?: {               // variable-bound labels drawn over the image
    id: string;
    x: number; y: number;    // 0..1 fractional coordinates
    text: string;            // interpolated, e.g. "θ = {theta}°"
    anchor?: "start" | "middle" | "end";
  }[];
};

// ---- Parts -----------------------------------------------------------------
type AnswerType = "number" | "numeric" | "numericalFormula";

type Part = {
  id: string;
  prompt: string;            // markup with {var} and {_0} {_u} answer slots
  answerType: AnswerType;    // default "numeric"
  answer: string;            // formula for the model answer
  unit?: string;             // expected unit; omit for dimensionless
  unitPenalty?: number;      // 0..1, default 0.1
  tolerance: {
    rel?: number;            // default 0.01
    abs?: number;            // used when |model| is below `absBelow`
    absBelow?: number;       // default 1e-12
  };
  mark?: number;             // weight within the scenario, default 1
  tags?: string[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  hint?: string;
  solution?: string;         // worked solution markup, shown in review modes
};

// ---- Scenario --------------------------------------------------------------
type Scenario = {
  id: string;                // stable, e.g. "phys161-e2-luggage-ramp"
  source?: { document: string; labels: string[] };  // e.g. ["P12","P13","P14"]
  section?: string;
  narrative: string;         // shared text with {var} interpolation
  figure?: Figure;
  vars: RandomVar[];
  derived: DerivedVar[];
  constraints: string[];     // boolean expressions; see §3.3
  maxSampleAttempts?: number;// default 200
  parts: Part[];
  canonical: CanonicalCheck; // see §2.4 — REQUIRED
  tags?: string[];
};
```

### 2.3 Template syntax

One syntax, used in `narrative`, `prompt`, `caption`, `overlays[].text`, `hint`, `solution`:

| Token | Meaning |
|---|---|
| `{name}` | interpolate a variable, formatted per its `decimals`/`sigfigs` |
| `{name:unit}` | interpolate value followed by its unit |
| `{= expr }` | inline computed expression (same evaluator, read-only) |
| `{_0}`, `{_1}` | answer input slot (index within the part) |
| `{_u}` | unit input slot |
| `{_0}{_u}` | adjacent with no space → single combined number+unit field |
| `{@fig}` | place the scenario figure here |
| `$...$`, `$$...$$` | math, rendered by KaTeX |

Missing `{_0}` / `{_u}` in a prompt → append them at the end automatically.

### 2.4 The canonical check — **do not skip this**

Every scenario records the exact numbers and answers from the source document:

```yaml
canonical:
  vars:  { m: 24, theta: 29, F: 165, mu: 0.36, d: 3.1, g: 9.8 }
  parts:
    - id: work-by-F
      answer: 511.5
      unit: J
    - id: work-by-friction
      answer: -190.796
      unit: J
```

`pt check` pins the random variables to `canonical.vars`, evaluates every part, and asserts the result matches `canonical.parts[].answer` within tolerance. A transcription error in a formula fails CI immediately.

This turns bulk authoring of 150 problems from "hope it's right" into a verifiable pipeline, and it is the mechanism that makes agent-assisted authoring safe.

### 2.5 Worked example

```yaml
id: phys161-e2-luggage-ramp
source: { document: PHYS161_Exam2, labels: [P12, P13, P14] }
section: Work
figure:
  id: ramp
  src: figures/luggage-ramp.png
  alt: A suitcase being pulled up an inclined ramp by a force parallel to the ramp.
  overlays:
    - { id: angle, x: 0.22, y: 0.78, text: "{theta}°" }
narrative: >
  A luggage handler pulls a {m}-kg suitcase up a ramp inclined at {theta}° above the
  horizontal by a force $F$ of magnitude {F} N that acts parallel to the ramp. The
  coefficient of kinetic friction between the ramp and the suitcase is $\mu_k$ = {mu}.
  The suitcase travels {d} m along the ramp. {@fig}
vars:
  - { name: m,     kind: range, min: 14,  max: 30,  step: 1,    unit: kg }
  - { name: theta, kind: range, min: 22,  max: 36,  step: 1,    unit: "°" }
  - { name: F,     kind: range, min: 150, max: 220, step: 5,    unit: N }
  - { name: mu,    kind: range, min: 0.25, max: 0.45, step: 0.01, decimals: 2 }
  - { name: d,     kind: range, min: 2.5, max: 5.0, step: 0.1,  decimals: 1, unit: m }
derived:
  - { name: g, expr: "9.8" }
  - { name: N, expr: "m * g * cos(theta * pi / 180)" }
constraints:
  - "F > m * g * sin(theta*pi/180) + mu * N"   # must actually move up the ramp
parts:
  - id: work-by-F
    prompt: "Calculate the work done on the suitcase by the force $F$. {_0}{_u}"
    answer: "F * d"
    unit: J
    tolerance: { rel: 0.01 }
  - id: work-by-friction
    prompt: "Calculate the work done on the suitcase by the friction force. {_0}{_u}"
    answer: "-mu * N * d"
    unit: J
    tolerance: { rel: 0.01 }
  - id: work-by-gravity
    prompt: >
      Calculate the magnitude of the work done on the suitcase by the
      gravitational force. {_0}{_u}
    answer: "m * g * sin(theta * pi / 180) * d"
    unit: J
    tolerance: { rel: 0.01 }
canonical:
  vars: { m: 18, theta: 31, F: 170, mu: 0.32, d: 4.1 }
  parts:
    - { id: work-by-gravity, answer: 372.49613729795, unit: J }
```

---

## 3. Evaluation core (`@pt/core`)

### 3.1 Expression layer (`src/expr/`)

Build a thin, **locked-down** wrapper over mathjs. Do not expose raw mathjs anywhere else in the codebase.

```ts
createEvaluator(opts): Evaluator
evaluator.compile(src: string): Compiled      // cached by source string
evaluator.evaluate(compiled, scope): number | number[] | string
```

Requirements:

- Create an isolated mathjs instance with `create(...)` and **import only the allowed functions**. Remove `import`, `createUnit`, `evaluate`, `parse`, `simplify`, `derivative` from the runtime scope.
- Allowed: arithmetic, `^` and `**` (both exponentiation), unary minus, parentheses, `pi`, `e`, `sqrt`, `abs`, `exp`, `log`, `log10`, `ln`, `sin cos tan asin acos atan atan2`, `sinh cosh tanh`, `min max`, `round floor ceil`, `sign`, `hypot`, `sum`, `factorial`, and array literals with indexing.
- Add project helpers: `deg(x)`, `rad(x)`, `norm([...])`, `clamp(x,lo,hi)`, `solve(f, lo, hi)` (bisection root-finder — needed for P95, P132, P114-style inverse problems), `iterate(f, x0, n)`.
- **No assignment, no function definition, no variable mutation** in any user-supplied expression. Reject at AST level.
- Every evaluation runs under a **node-count and depth budget** and a wall-clock guard. Untrusted input reaches this layer from the answer fields.
- Errors are typed: `ParseError | UnknownIdentifierError | BudgetExceededError | DomainError`. Never throw raw mathjs errors upward.

### 3.2 Answer-type acceptance checks

Walk the parsed AST; do not regex. These govern what a student may type.

| `answerType` | Allow | Reject |
|---|---|---|
| `number` | a single numeric literal, optional leading sign, optional `e`-notation, plus `pi`/`e` | any operator |
| `numeric` | the above + `+ - * / ^ ** ( )` | **function calls, identifiers** |
| `numericalFormula` | the above + the allowed function list | identifiers other than constants |

Expose `validateAnswer(src, answerType): { ok: true; latex: string } | { ok: false; error: string }`. The `latex` is for the live preview in the answer field.

`numeric` is the default and matches the source exam's behaviour: `0.01*1.70 + 0.01*5.60` is accepted, `sqrt(0.017^2+0.056^2)` is not.

### 3.3 Instantiation (`src/instantiate/`)

```ts
instantiate(scenario: Scenario, seed: number): ProblemInstance
```

Algorithm — implement exactly:

1. Seed a Mersenne Twister from `seed` via `pure-rand`.
2. For each `vars[i]` **in declaration order**:
   - `range`: draw a uniform integer `k ∈ [0, floor((max-min)/step)]`, value = `min + k*step`.
   - `choice`: draw a uniform index into `options`.
3. **Quantize immediately** using `decimals`/`sigfigs`, or by cleaning float error from the step arithmetic if neither is given. *The quantized value is the only value that exists from here on* — it is what the prompt shows and what the answer is computed from. This prevents "prompt says 0.32, answer computed from 0.32000000000000006".
4. Evaluate `derived` in declaration order, with randoms in scope.
5. Evaluate every expression in `constraints`. If any is falsy, **re-draw from step 1 with a derived sub-seed** (`seed*0x9E3779B1 + attempt`) and retry, up to `maxSampleAttempts`. On exhaustion throw `ConstraintUnsatisfiableError` naming the failing constraint — `pt fuzz` surfaces this during authoring.
6. Evaluate each part's `answer` formula → `modelAnswer: number`.
7. Render `narrative`, each `prompt`, the figure caption and overlays.

`ProblemInstance` is a plain serializable object:

```ts
type ProblemInstance = {
  scenarioId: string;
  seed: number;
  values: Record<string, number | string>;   // quantized randoms + derived
  narrativeHtml: string;
  figure?: RenderedFigure;
  parts: {
    partId: string;
    promptHtml: string;
    slots: { index: number; kind: "value" | "unit" | "combined" }[];
    modelAnswer: number;
    unit?: string;
  }[];
};
```

Variant count: `Π` over `vars` of `floor((max-min)/step)+1` or `options.length`. Expose `countVariants(scenario)`, clamped to `Number.MAX_SAFE_INTEGER`.

### 3.4 Grading (`src/grade/`)

```ts
gradePart(part, instance, response): PartResult
gradeScenario(scenario, instance, responses): ScenarioResult
```

```
valueOk   = |student·conversionFactor − model| ≤ max(relTol·|model|, absTol-if-applicable)
unitOk    = unit compatible with part.unit (see §5), or part has no unit
fraction  = (valueOk ? 1 : 0) × (unitOk ? 1 : 1 − unitPenalty)
scenario  = Σ(mark_i × fraction_i) / Σ(mark_i)
```

Any parse failure, acceptance-check failure, or evaluation error in the student's input ⇒ `fraction` contribution of 0, with `unitOk` still evaluated independently.

`PartResult` must carry enough for any future review UI: `{ fraction, valueOk, unitOk, parsedLatex, modelAnswer, studentValue, conversionFactor, error? }`. Do not bake presentation decisions in.

---

## 4. Repository abstraction (`src/repo/`) — the storage-uncertainty hedge

```ts
interface ProblemRepository {
  listSets(): Promise<SetSummary[]>;
  getSet(id: string): Promise<SetDoc>;
  listScenarios(q: ScenarioQuery): Promise<ScenarioSummary[]>;
  getScenario(id: string): Promise<Scenario>;
  putScenario(s: Scenario): Promise<void>;
  deleteScenario(id: string): Promise<void>;
  resolveAsset(ref: string): Promise<AssetHandle>;   // figure files
}

type ScenarioQuery = {
  setId?: string; section?: string;
  tags?: string[]; tagMode?: "any" | "all";
  difficulty?: { min?: number; max?: number };
  text?: string;
  limit?: number; cursor?: string;
};
```

Rules:

- `ScenarioQuery` is deliberately rich enough to push filtering down to SQL later, while remaining trivially implementable in memory today.
- `@pt/core` ships `InMemoryRepository`. `@pt/store-fs` ships `FsRepository`. `@pt/store-sql` ships a Drizzle schema plus `SqlRepository` **stubbed with `notImplemented()`** and a passing schema-shape test — enough that switching later is filling in method bodies.
- Write a **shared conformance test suite** exported from `@pt/core/testing` that any repository implementation must pass. Run it against in-memory and fs now; against sql when it's built.
- Never leak file paths, row ids, or ORM objects across this boundary.

**Filesystem layout** (`@pt/store-fs`):

```
content/sets/<setId>/
  set.yaml                    # title, sections, ordering
  scenarios/<scenarioId>.yaml
  figures/<file>.png|svg
```

One file per scenario, YAML, comment-preserving on write. Asset refs in YAML are relative to the set directory.

---

## 5. Units (`src/units/`)

Implement a **dimension-class** engine. Do **not** use `mathjs`'s `Unit` — it is far more permissive than the target behaviour and will accept answers the real system rejects.

Parse a unit string into `Record<string, number>` (name → exponent):

- Space = multiplication: `kg m/s` → `{kg:1, m:1, s:-1}`
- `^` for exponents, incl. `m s^(-1)` and `m s^-1`
- At most one `/`; the right side may be parenthesized; its exponents are negated
- Duplicate names ⇒ parse error
- Permutation-invariant: `m s^(-1)` ≡ `m/s`

Compatibility: two units match if they have **the same number of named components** and, for each, the exponents are equal after converting the name within its dimension class; otherwise, if every component is known, they match when their **SI dimensions agree** (each class records the dimensions of its SI coherent unit; angles are their own dimension). Conversion factor is `Π f_i^e_i`. Moodle converts this generously (observed: `N m` and `kg m^2 s^-2` accepted for `J`).

Class table (extend as needed; seed with SI):

```
m:   k c d m µ n p f
s:   m µ n p f
g:   k m µ n p f
N:   M k m µ n p f
J:   k M G T P m µ n p f      and   J = 6.24150947e18 eV
W:   k M G T P m µ n p f
Pa:  k M G T P
Hz:  k M G T P E
rad, rev, °                   (with rev = 2π rad, ° = π/180 rad)
```

Consequences to preserve deliberately, and to assert in tests:

- `5000 mm` ≡ `5 m` ✅
- `N` ≡ `kg m/s^2`, `J` ≡ `N m` ≡ `kg m^2 s^-2` ✅ — same SI dimensions
- `10 cm` for an answer of `10 m` ❌ — converted first (0.1 m), then compared
- `rad/s` vs `s^-1` ❌ — angles are a dimension of their own
- `72 km/h` vs `20 m/s` ❌ unless `h` is added to the `s` class

Add `min`, `h`, `day`, `rpm`, `L` to the table — the corpus needs them (P16 seconds, P26 W, P98 rpm, P29 litres, P114 days, P92 km/s).

API: `parseUnit(s)`, `areCompatible(a, b) → number | false`, `formatUnit(u)`.

---

## 6. Svelte component library (`@pt/ui`)

Svelte 5 runes. Components are **presentational and prop-driven** — no data fetching, no stores, no routing. Every one must render from a `ProblemInstance` plus callbacks, so the runner can wire them however it ends up working.

### Problem rendering
- `<ProblemBody instance part />` — renders interpolated HTML with math, figure, and answer slots in place.
- `<MathInline tex />`, `<MathBlock tex />` — KaTeX, isolated so it can be swapped.
- `<Figure figure values />` — image with SVG overlay labels bound to instantiated values. Must be responsive and keep overlays positioned under scaling.

### Answer entry
- `<AnswerField bind:value answerType withUnit validate debounce={300} />`
  - runs `validateAnswer` on a debounce
  - `aria-invalid` + error styling on failure
  - renders a live KaTeX preview of the parsed expression below the field
  - supports combined number+unit mode and separate-unit mode
- `<UnitField bind:value />`
- `<NumericKeypad />` — optional, mobile.

### Result display
- `<PartFeedback result />`, `<GradeBadge fraction />`, `<CorrectAnswer part instance />`

### Shell primitives (presentational only, no logic)
- `<QuestionCard>` — slotted header / body / footer, mirroring the target DOM structure so styling later is a find-and-replace rather than a rewrite.
- `<CountdownTimer endsAt onExpire />`
- `<NavGrid items onSelect />` — states: unanswered / answered / flagged / current.
- `<FlagToggle bind:flagged />`

### Editor components (used by Studio, but live here)
- `<VariableTable bind:vars />` — add/remove/reorder rows; per-variable min/max/step/decimals/unit; live variant-count readout.
- `<FormulaInput bind:value scope />` — CodeMirror with identifier autocomplete from the scenario scope, inline error underlining, live evaluation against the current seed.
- `<TemplateEditor bind:value scope />` — same, for prompt/narrative text; highlights `{tokens}` and flags unknown identifiers.
- `<SeedScrubber bind:seed />` — prev/next/random + a numeric input; drives the live preview.
- `<CanonicalPanel scenario />` — shows the canonical check pass/fail per part, red when the formula disagrees with the source answer.

Ship a Storybook-less approach: a `/dev` route in Studio that renders every component against fixtures. Cheaper than Storybook and enough here.

---

## 7. CLI (`@pt/cli`, binary `pt`)

This is how 150 problems get authored in a reasonable time. Design it to be driven *by an agent* as much as by a human.

| Command | Behaviour |
|---|---|
| `pt import <file.html\|.docx\|.md> --set <id>` | Split on `^P\d+\.`, strip the trailing `(answer unit)` into `canonical`, detect numeric literals in the text and emit them as **draft** `vars` with `TODO` ranges, detect `<img>` references and emit a `figure` stub. Output: one draft YAML per problem. |
| `pt group <set>` | Cluster drafts that share a figure or have high narrative similarity into candidate multi-part scenarios, and print a proposed merge. Human/agent confirms. |
| `pt check [scenario…]` | Validate schema; run the canonical check; report per-part pass/fail with computed vs expected. **Exit non-zero on failure.** Wire into CI. |
| `pt fuzz <scenario> -n 500` | Instantiate across N seeds: assert no NaN/Infinity, constraints satisfiable within the attempt budget, answers within a sane magnitude band, all template identifiers resolve. Report constraint rejection rate — a high rate means the ranges are badly chosen. |
| `pt gen <scenario> --seed <n> [--json]` | Print the rendered instance and model answers. |
| `pt variants <scenario>` | Print the variant count and per-variable breakdown. |
| `pt lint <set>` | Missing `alt` text, missing tolerance, unreferenced figures, duplicate ids, parts with no `{_0}` slot, canonical block absent. |
| `pt agent-task <scenario>` | Emit a compact JSON packet — source text, detected literals, printed answer, current draft — designed to be handed to an LLM for "turn this into a parametric template", plus the exact schema it must return. |

`pt import` must be tolerant: the source HTML has superscripts as separate text nodes (`m/s` + `2`), Unicode Greek (`μ`, `θ`, `α`, `γ`, `β`, `ω`), sub/superscript digits (`M₁`, `10⁻¹⁶`), and both `°` and `˚`. Normalize these during import and record the raw source text alongside so nothing is lost.

---

## 8. Studio (`apps/studio`) — the editor

A minimal SvelteKit app. Server routes talk to a `ProblemRepository` chosen by env var (`PT_STORE=fs|memory`). No auth for now; note in the README that it is local-only.

Routes:

- `/` — set list
- `/sets/[setId]` — scenario list with filters (section, tag, difficulty, canonical-check status)
- `/sets/[setId]/[scenarioId]` — the editor, three panes:
  - **left:** narrative + per-part prompt templates (`<TemplateEditor>`)
  - **middle:** variables (`<VariableTable>`), constraints, derived values, per-part answer formulas (`<FormulaInput>`)
  - **right:** live preview (`<ProblemBody>`) driven by `<SeedScrubber>`, plus `<CanonicalPanel>`
- `/dev` — component gallery against fixtures

Behaviour requirements:
- Every keystroke re-instantiates at the current seed and re-renders the preview; show evaluation errors inline rather than blanking the pane.
- Scrubbing the seed must be instant — instantiation is pure and cheap, do it client-side.
- Save writes through the repository. Show canonical-check status in the save affordance; allow saving a failing scenario but mark it `draft`.

---

## 9. Reference corpus (`fixtures/corpus/`)

These are drawn from PHYS161 Exam 2 (150 problems, 12 sections: Work, Kinetic energy, Power, Potential energy, Energy conservation, Impulse and collisions, Conservation of linear momentum, Rocket propulsion, Moment of Inertia, Rotation, Torque, Angular momentum). They were chosen to span the feature space — **if the core handles all of these, it handles the set.** Author each one as a YAML scenario and make them the integration test suite.

Figures are not yet available; use a placeholder asset and correct `alt` text, and keep the `figure` block populated so the wiring is exercised.

---

**C1 — baseline (P1).** *Determine the work necessary to push (not pull) a mass of 66.5 kg horizontally at a distance of 2.6 m by a force of 73.8 N on a horizontal frictionless surface.* → **191.88 J**
Smoke test: one formula, one unit, mass is a red herring.

**C2 — trigonometry and sign conventions (P2).** *…push a mass of 25 kg a distance of 3.4 m along a horizontal frictionless surface by a force of 73 N directed at an angle of 20° below the horizontal.* → **233.232 J**
Degrees→radians; "below the horizontal" must not flip the sign of the work.

**C3 — multi-part scenario with a shared figure (P12/P13/P14).** One luggage-ramp situation, three asks: work by $F$ → **511.5 J**; work by friction → **−190.796 J**; magnitude of work by gravity → **372.49613729795 J**.
The canonical multi-part case. Note the three source problems have *different* numbers — pick one set as canonical and verify that part.

**C4 — scientific notation and prefixed units (P18).** *…meteor had a mass of 1.6×10⁸ kg and hit the ground at 12 km/s. How much kinetic energy did this meteor deliver?* → **1.152E+16 J**
Student must be able to type `1.152e16`. Tests display formatting of huge values too.

**C5 — very small magnitudes (P20).** *Electron has kinetic energy 4.3×10⁻¹⁶ J. If a proton has the same momentum as the electron, what is the proton's kinetic energy?* → **2.34205e-19 J**
Proves relative tolerance is mandatory; absolute tolerance is meaningless here.

**C6 — vectors in the prompt, scalar answer (P23).** *A 4 kg object has a velocity of (2î + 2ĵ) m/s. What is the net work done if its velocity changes to (8î + 5ĵ) m/s?* → **162 J**
Components must be independent random variables; the prompt needs vector notation rendering. See also P80 (3-D, sticking collision → **3.601 m/s**).

**C7 — symbolic function in the prompt (P30).** *U(x) = α·x⁴ where α = 2.7 J/m⁴. What is the force magnitude at x = −0.2 m?* → **0.0864 N**
Math markup in the narrative, a unit with a fractional-power denominator (`J/m^4`), and a negative coordinate. Companion P31 (work between two x values → **7.4217 J**).

**C8 — branch-dependent physics, needs constraints (P38/P39).** Bucket–box–gravel with μs = 0.68, μk = 0.43; friction force the roof exerts → **607.6 N**; after the gravel is removed, speed after descending 2 m → **2.721 m/s**.
Randomizing the masses can silently flip the static/kinetic branch and make the printed formula wrong. **This is the constraint system's reason to exist.** Same hazard in P56 (μs = 0.78 vs tan 41°).

**C9 — degenerate parameter (P54).** *Car in a loop of radius 14 m; minimum h so it doesn't fall off at the top.* → **35 m**
Answer is exactly 2.5R and independent of g. Guards against a template that "randomizes" g and breaks.

**C10 — dimensionless answer (P71).** *Ball rises to 84% of its original height. What fraction of its kinetic energy does it lose?* → **0.16**
`unit` omitted; the unit field must not render, and `unitPenalty` must not apply. Compare P50 (μk → **0.2195**) and P93 (payload fraction → **0.0497871**).

**C11 — integer / discrete answer (P88).** *Railroad cars couple one at a time until the final speed is 1/6 the initial speed of 4 cars. How many cars in the final collection?* → **24**
Answer is an exact integer. Tolerance must not accept 23.9. Suggests an optional `integer: true` flag on `Part` — add it.

**C12 — inverse problem requiring root-finding (P95).** *Two-density Earth model, ρ_inner = 6200, ρ_outer = 4300 kg/m³, R = 6.11×10⁶ m, I = 8.5×10³⁷ kg·m². Find the inner radius.* → **5945403.82 m**
No closed form. Exercises `solve(f, lo, hi)`. Companion: P132 (solve for wheel radius from a net torque of three forces → **0.597 m**) and P114 (launch window → **111.30 days**).

**C13 — one function, four different asks (P115–P118).** θ(t) = γt² − βt³. Angular velocity at t=4 (γ=3.2, β=0.43) → **4.96 rad/s**; average angular velocity 0→3 (γ=2.9, β=0.41) → **5.01 rad/s**; angular acceleration at t=8 (γ=2.8, β=0.54) → **−20.32 rad/s²**; time of maximum positive ω (γ=3.5, β=0.46) → **2.536 s**.
Four parts, one scenario, all derivable analytically — no symbolic differentiation needed, just correct hand-derived formulas. Tests negative answers and `rad/s^2` unit parsing.

**C14 — unit conversion inside the problem (P108).** *Blender blade, α = 1.3 rad/s², reaches 48 rad/s from rest. Through how many revolutions? Provide the answer in decimals.* → **141.04**
rad → rev conversion, and a "provide the answer in…" instruction that constrains the expected unit. Compare P98 (rpm → **7.399 m**) and P129 (**9.125** revolutions).

---

## 10. Milestones

Each milestone ends with green tests and a demonstrable artifact. Do not start the next until `pnpm -r test` passes.

| # | Milestone | Done when |
|---|---|---|
| M0 | Workspace scaffold, tsconfig, vitest, lint, CI | `pnpm -r build && pnpm -r test` green on an empty repo |
| M1 | Zod schemas + derived types + `InMemoryRepository` + conformance suite | C1 parses, validates, round-trips |
| M2 | Expression layer: restricted mathjs, budgets, typed errors, acceptance checks | Acceptance table in §3.2 fully covered by tests |
| M3 | Units engine | All §5 assertions pass, incl. the deliberate rejections |
| M4 | Instantiation: RNG, quantization, derived, constraints, variant counting | Same seed ⇒ identical instance, 10k-seed stability test; C8 constraint rejection works |
| M5 | Template renderer incl. slots and figure overlays | C3, C6, C7 render correctly |
| M6 | Grading | C5, C10, C11 grade correctly; unit penalty behaviour covered |
| M7 | `@pt/store-fs` + conformance suite passes against it; `@pt/store-sql` stub | Scenario survives write→read→write byte-stable |
| M8 | CLI: `check`, `gen`, `fuzz`, `variants`, `lint` | `pt check` green over all 14 corpus scenarios |
| M9 | CLI: `import`, `group`, `agent-task` | `pt import` on the source HTML produces 150 drafts and ≥40 figure stubs |
| M10 | `@pt/ui` components + `/dev` gallery | Every component renders against a fixture; `<AnswerField>` validation and preview work |
| M11 | Studio editor | A scenario can be authored end to end in the browser and saved, with the canonical check visibly passing |

---

## 11. Decisions deferred (record, do not resolve)

Leave these open and make sure nothing above forecloses them:

- **Persistence backend.** FS now, SQL adapter stubbed. Nothing above `ProblemRepository` may assume either.
- **Quiz/exam modes**, navigation, timing rules, marks, review policy. `@pt/ui` shell primitives are presentational only for exactly this reason.
- **KaTeX vs MathJax.** Behind `<MathInline>`. Revisit when the fidelity reference arrives.
- **Answer type `algebraic`** (symbolic answers compared by numerical sampling). Not in this corpus — every answer is a scalar. Leave a slot in the `AnswerType` union.
- **Figure sourcing.** Not yet available. Keep `alt` required so the corpus is usable meanwhile, and keep `overlays` in the schema so parametric labels are possible once real assets exist.
- **Multi-language.** The source is English only; do not build i18n, but do not hard-code strings into `@pt/core` either — it should return codes, not messages.
