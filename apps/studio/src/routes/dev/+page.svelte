<script lang="ts">
  import { gradePart, instantiateAt, parseScenario, type Scenario } from '@pt/core';
  import {
    AnswerField,
    CanonicalPanel,
    CorrectAnswer,
    CountdownTimer,
    Figure,
    FlagToggle,
    FormulaInput,
    GradeBadge,
    MathBlock,
    MathInline,
    NavGrid,
    NumericKeypad,
    PartFeedback,
    ProblemBody,
    QuestionCard,
    SeedScrubber,
    TemplateEditor,
    UnitField,
    VariableTable,
  } from '@pt/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const byId = $derived(Object.fromEntries(data.scenarios.map((s) => [s.id, parseScenario(s)])) as Record<string, Scenario>);
  const atSource = (s: Scenario) =>
    instantiateAt(s, Object.fromEntries(Object.entries(s.canonical.vars).filter(([k]) => s.vars.some((v) => v.name === k))));

  const c1 = $derived(byId['c01-push-work']!);
  const c3 = $derived(byId['c03-luggage-ramp']!);
  const c1i = $derived(atSource(c1));
  const c3i = $derived(atSource(c3));
  const brokenC3 = $derived({ ...c3, parts: c3.parts.map((p) => (p.id === 'work-by-friction' ? { ...p, answer: '-mu * N' } : p)) });

  let keypadLog = $state('');
  let flagged = $state(false);
  let seed = $state(7);
  // svelte-ignore state_referenced_locally
  let vars = $state(structuredClone(data.scenarios.find((s) => s.id === 'c03-luggage-ramp')!.vars!));
  let formula = $state('m * g * sin(theta * pi / 180) * d');
  let template = $state('A {m}-kg suitcase on a {theta}° ramp, $\\mu_k = {mu}$, {ghost}. {_0}{_u}');
  let current = $state('q2');
  const endsAt = Date.now() + 5 * 60_000;
  const resolveSrc = (src: string) => `/assets/corpus/${src}`;
</script>

<svelte:head><title>Component gallery · PT Studio</title></svelte:head>

<h1>Component gallery</h1>
<p class="muted">Every @pt/ui component rendered against the reference corpus (fixtures/corpus).</p>

<nav class="toc">
  <a href="#math">Math</a> · <a href="#problem">Problem</a> · <a href="#answer">Answer entry</a> · <a href="#result">Results</a> ·
  <a href="#shell">Shell</a> · <a href="#editor">Editor</a>
</nav>

<section id="math">
  <h2>MathInline / MathBlock</h2>
  <p>Inline: <MathInline tex={'U(x) = \\alpha x^4,\\ \\alpha = 2.7\\ \\text{J}/\\text{m}^{4}'} /></p>
  <MathBlock tex={'r = \\left(\\frac{15 I / 8\\pi - \\rho_{out} R^5}{\\rho_{in} - \\rho_{out}}\\right)^{1/5}'} />
</section>

<section id="problem">
  <h2>ProblemBody — C3 (multi-part, shared figure)</h2>
  <div class="card"><ProblemBody instance={c3i} {resolveSrc} /></div>
  {#each ['c04-meteor', 'c06-vector-work', 'c07-quartic-potential', 'c10-bounce-energy-fraction', 'c11-railroad-cars'] as id (id)}
    <h3>ProblemBody — {id}</h3>
    <div class="card"><ProblemBody instance={atSource(byId[id]!)} {resolveSrc} /></div>
  {/each}
  <h2>Figure</h2>
  <div class="card narrow"><Figure figure={c3i.figure!} {resolveSrc} /></div>
</section>

<section id="answer">
  <h2>AnswerField</h2>
  <div class="grid">
    <label>number <AnswerField answerType="number" label="number" /></label>
    <label>numeric <AnswerField answerType="numeric" label="numeric" value="0.01*1.70 + 0.01*5.60" /></label>
    <label>numericalFormula <AnswerField answerType="numericalFormula" label="numericalFormula" value="sqrt(0.017^2+0.056^2)" /></label>
    <label>numeric (rejects functions) <AnswerField answerType="numeric" label="numeric rejecting" value="sqrt(2)" /></label>
    <label>combined number + unit <AnswerField withUnit label="combined" value="191.88 J" /></label>
  </div>
  <h2>UnitField</h2>
  <UnitField value="m/s^2" />
  <h2>NumericKeypad</h2>
  <NumericKeypad onkey={(k) => (keypadLog = k === 'backspace' ? keypadLog.slice(0, -1) : keypadLog + k)} />
  <p>Typed: <code>{keypadLog}</code></p>
</section>

<section id="result">
  <h2>PartFeedback / GradeBadge / CorrectAnswer</h2>
  <div class="grid">
    <PartFeedback result={gradePart(c1.parts[0]!, c1i.parts[0]!, { combined: '191.88 J' })} />
    <PartFeedback result={gradePart(c1.parts[0]!, c1i.parts[0]!, { value: '191.88' })} />
    <PartFeedback result={gradePart(c1.parts[0]!, c1i.parts[0]!, { value: 'abc', unit: 'J' })} />
  </div>
  <p><GradeBadge fraction={1} /> <GradeBadge fraction={0.5} /> <GradeBadge fraction={0} /></p>
  <p>Correct answer: <CorrectAnswer instance={c1i} part="work" /></p>
</section>

<section id="shell">
  <h2>QuestionCard</h2>
  <QuestionCard state="answersaved">
    {#snippet header()}
      <strong>Question 1</strong>
      <div>Not yet answered</div>
      <div>Marked out of 1.00</div>
      <FlagToggle bind:flagged />
    {/snippet}
    <ProblemBody instance={c1i} />
    {#snippet footer()}
      <PartFeedback result={gradePart(c1.parts[0]!, c1i.parts[0]!, { combined: '191.88 J' })} />
    {/snippet}
  </QuestionCard>
  <h2>CountdownTimer</h2>
  <p>Time left: <CountdownTimer {endsAt} /></p>
  <h2>NavGrid</h2>
  <NavGrid
    items={[
      { id: 'q1', label: '1', answered: true },
      { id: 'q2', label: '2', current: current === 'q2' },
      { id: 'q3', label: '3', flagged: true },
      { id: 'q4', label: '4', answered: true, flagged: true },
    ]}
    onSelect={(id) => (current = id)}
  />
</section>

<section id="editor">
  <h2>VariableTable</h2>
  <VariableTable bind:vars />
  <h2>FormulaInput</h2>
  <FormulaInput bind:value={formula} scope={c3i.values} />
  <h2>TemplateEditor</h2>
  <TemplateEditor bind:value={template} scope={c3i.values} />
  <h2>SeedScrubber</h2>
  <SeedScrubber bind:seed /> <span class="muted">seed = {seed}</span>
  <h2>CanonicalPanel</h2>
  <div class="grid two">
    <CanonicalPanel scenario={c3} />
    <CanonicalPanel scenario={brokenC3} />
  </div>
</section>

<style>
  section {
    margin: 2rem 0;
    max-width: 70rem;
  }
  h2 {
    font-size: 1.1rem;
    border-bottom: 1px solid var(--pt-border);
    padding-bottom: 0.2rem;
  }
  h3 {
    font-size: 0.95rem;
  }
  .card {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    background: var(--pt-formulation-bg);
    max-width: 48rem;
  }
  .narrow {
    max-width: 24rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: 1rem;
  }
  .grid.two {
    grid-template-columns: repeat(auto-fill, minmax(26rem, 1fr));
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85em;
  }
  .toc {
    font-size: 0.9em;
  }
</style>
