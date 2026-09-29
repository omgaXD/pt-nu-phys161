<script lang="ts">
  import {
    checkCanonical,
    diagnoseScenario,
    instantiate,
    instantiateAt,
    type ProblemInstance,
    type RandomVar,
    type Scenario,
    type ScenarioInput,
    safeParseScenario,
  } from '@pt/core';
  import { CanonicalPanel, CorrectAnswer, FormulaInput, ProblemBody, SeedScrubber, TemplateEditor, VariableTable } from '@pt/ui';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  interface Props {
    initial: ScenarioInput;
    setId: string;
    sections: string[];
    isNew: boolean;
  }

  let { initial, setId, sections, isNew }: Props = $props();

  type Pinned = Record<string, number | string>;
  interface EditablePart {
    id: string;
    prompt: string;
    answerType?: 'number' | 'numeric' | 'numericalFormula';
    answer: string;
    unit?: string;
    unitPenalty?: number;
    tolerance: { rel?: number; abs?: number; absBelow?: number };
    integer?: boolean;
    mark?: number;
    difficulty?: number;
    tags?: string[];
    hint?: string;
    solution?: string;
  }
  interface Editable {
    id: string;
    title?: string;
    source?: { document: string; labels?: string[] };
    section?: string;
    tags?: string[];
    figure?: { id: string; src: string; alt: string; caption?: string; overlays?: { id: string; x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }[] };
    narrative: string;
    vars: RandomVar[];
    derived: { name: string; expr: string; unit?: string }[];
    constraints: string[];
    maxSampleAttempts?: number;
    parts: EditablePart[];
    canonical: { vars: Pinned; parts: { id: string; answer: number; unit?: string; source?: string; vars?: Pinned }[] };
    draft?: boolean;
  }

  function normalize(s: ScenarioInput): Editable {
    const e = structuredClone(s) as unknown as Editable;
    e.vars ??= [];
    e.derived ??= [];
    e.constraints ??= [];
    e.parts = (e.parts ?? []).map((p) => ({ ...p, tolerance: p.tolerance ?? {} }));
    e.canonical ??= { vars: {}, parts: [] };
    return e;
  }

  // svelte-ignore state_referenced_locally
  let doc = $state<Editable>(normalize(initial));
  // svelte-ignore state_referenced_locally
  let savedJson = $state(JSON.stringify(doc));
  const dirty = $derived(JSON.stringify(doc) !== savedJson);

  let seed = $state(0);
  let atSource = $state(false);

  const parsed = $derived(safeParseScenario($state.snapshot(doc)));
  const scenario = $derived<Scenario | null>(parsed.ok ? parsed.value : null);

  function sourceValues(s: Scenario): Pinned {
    return Object.fromEntries(Object.entries(s.canonical.vars).filter(([k]) => s.vars.some((v) => v.name === k)));
  }

  // The preview never blanks: on an error it keeps showing the last good
  // instance, with the error on top.
  let lastGood: ProblemInstance | null = null;
  const preview = $derived.by((): { instance: ProblemInstance | null; error: string | null } => {
    if (!scenario) return { instance: lastGood, error: 'The scenario does not match the schema yet — see Problems.' };
    try {
      const inst = atSource ? instantiateAt(scenario, sourceValues(scenario)) : instantiate(scenario, seed);
      lastGood = inst;
      return { instance: inst, error: null };
    } catch (e) {
      return { instance: lastGood, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const diagnostics = $derived(scenario ? diagnoseScenario(scenario) : []);
  const canonicalOk = $derived.by(() => {
    if (!scenario) return false;
    try {
      return checkCanonical(scenario).ok;
    } catch {
      return false;
    }
  });
  const hasErrors = $derived(!parsed.ok || diagnostics.some((d) => d.severity === 'error'));

  const randomNames = $derived(doc.vars.map((v) => v.name));
  const allNames = $derived([...randomNames, ...doc.derived.map((d) => d.name)]);
  const scope = $derived(preview.instance?.values ?? {});

  // ---- keeping canonical.vars in step with the variables --------------------
  function onVarsChange(next: RandomVar[], prev: RandomVar[]): void {
    const pinned = doc.canonical.vars;
    if (next.length === prev.length) {
      next.forEach((v, i) => {
        const old = prev[i]!.name;
        if (old !== v.name && old in pinned && !(v.name in pinned)) {
          pinned[v.name] = pinned[old]!;
          delete pinned[old];
        }
      });
    }
    const derivedNames = new Set(doc.derived.map((d) => d.name));
    for (const key of Object.keys(pinned)) {
      if (!next.some((v) => v.name === key) && !derivedNames.has(key)) delete pinned[key];
    }
    for (const v of next) {
      if (!(v.name in pinned)) pinned[v.name] = v.kind === 'range' ? v.min : v.options[0]!;
    }
  }

  // svelte-ignore state_referenced_locally
  let prevVars = $state.snapshot(doc.vars) as RandomVar[];
  function varsChanged(next: RandomVar[]): void {
    const plain = $state.snapshot(next) as RandomVar[];
    onVarsChange(plain, prevVars);
    prevVars = plain;
  }

  // ---- parts ---------------------------------------------------------------------
  function addPart(): void {
    let n = doc.parts.length + 1;
    while (doc.parts.some((p) => p.id === `part-${n}`)) n++;
    doc.parts.push({ id: `part-${n}`, prompt: '{_0}', answer: '0', tolerance: { rel: 0.01 } });
  }

  function removePart(i: number): void {
    const id = doc.parts[i]!.id;
    doc.parts.splice(i, 1);
    doc.canonical.parts = doc.canonical.parts.filter((c) => c.id !== id);
  }

  function renamePart(i: number, id: string): void {
    const old = doc.parts[i]!.id;
    doc.parts[i]!.id = id;
    for (const c of doc.canonical.parts) if (c.id === old) c.id = id;
  }

  function addCanonicalPart(): void {
    const free = doc.parts.find((p) => !doc.canonical.parts.some((c) => c.id === p.id)) ?? doc.parts[0];
    if (free) doc.canonical.parts.push({ id: free.id, answer: 0, ...(free.unit && { unit: free.unit }) });
  }

  const parseValue = (s: string): number | string => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : s.trim());
  const optNum = (s: string): number | undefined => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));
  const optStr = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim());

  function overridesText(v: Pinned | undefined): string {
    return Object.entries(v ?? {})
      .map(([k, x]) => `${k}=${x}`)
      .join(', ');
  }
  function parseOverrides(s: string): Pinned | undefined {
    const out: Pinned = {};
    for (const pair of s.split(',')) {
      const [k, v] = pair.split('=').map((x) => x.trim());
      if (k && v !== undefined && v !== '') out[k] = parseValue(v);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function toggleFigure(on: boolean): void {
    if (on) doc.figure = { id: 'fig', src: 'figures/', alt: '' };
    else delete doc.figure;
  }

  // ---- saving ---------------------------------------------------------------------
  let saving = $state(false);
  let saveResult = $state<{ kind: 'ok' | 'draft' | 'error'; text: string; issues?: string[] } | null>(null);

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    saveResult = null;
    try {
      const res = await fetch(`/api/scenarios/${encodeURIComponent(doc.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setId, isNew, scenario: $state.snapshot(doc) }),
      });
      const body = (await res.json()) as { message?: string; issues?: string[]; draft?: boolean; scenario?: ScenarioInput };
      if (!res.ok) {
        saveResult = { kind: 'error', text: body.message ?? `Save failed (${res.status})`, ...(body.issues && { issues: body.issues }) };
        return;
      }
      doc = normalize(body.scenario!);
      prevVars = $state.snapshot(doc.vars) as RandomVar[];
      savedJson = JSON.stringify(doc);
      saveResult = body.draft
        ? { kind: 'draft', text: 'Saved as draft — the canonical check is failing.' }
        : { kind: 'ok', text: 'Saved — canonical check passing.' };
      if (isNew) await goto(resolve('/sets/[setId]/[scenarioId]', { setId, scenarioId: doc.id }), { replaceState: true, invalidateAll: true });
    } catch (e) {
      saveResult = { kind: 'error', text: e instanceof Error ? e.message : String(e) };
    } finally {
      saving = false;
    }
  }

  function onkeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void save();
    }
  }

  const resolveSrc = (src: string): string => `/assets/${setId}/${src}`;
</script>

<svelte:window {onkeydown} />

<div class="editor-bar">
  <div class="title">
    {#if isNew}
      <label>Id <input class="id" bind:value={doc.id} placeholder="lowercase-kebab-id" aria-label="Scenario id" /></label>
    {:else}
      <code>{doc.id}</code>
    {/if}
    {#if doc.draft}<span class="pill draft">draft</span>{/if}
  </div>
  <div class="save">
    <span class="pill {canonicalOk && !hasErrors ? 'pass' : 'fail'}" data-testid="save-status">
      {canonicalOk && !hasErrors ? 'canonical ✓' : 'canonical ✗ — will save as draft'}
    </span>
    {#if dirty}<span class="muted">unsaved changes</span>{/if}
    <button type="button" class="primary" onclick={save} disabled={saving || !parsed.ok}>{saving ? 'Saving…' : 'Save'}</button>
  </div>
</div>
{#if saveResult}
  <div class="save-result {saveResult.kind}" role="status">
    {saveResult.text}
    {#if saveResult.issues}<ul>{#each saveResult.issues as i, k (k)}<li>{i}</li>{/each}</ul>{/if}
  </div>
{/if}

<div class="panes">
  <!-- LEFT: text -->
  <section class="pane" aria-label="Text">
    <h2>Text</h2>
    <label class="field">Title <input value={doc.title ?? ''} oninput={(e) => (doc.title = optStr(e.currentTarget.value))} /></label>
    <div class="row">
      <label class="field">Section
        <select value={doc.section ?? ''} onchange={(e) => (doc.section = optStr(e.currentTarget.value))}>
          <option value="">—</option>
          {#each sections as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>
      <label class="field">Tags
        <input value={(doc.tags ?? []).join(', ')} onchange={(e) => {
          const t = e.currentTarget.value.split(',').map((x) => x.trim()).filter(Boolean);
          doc.tags = t.length ? t : undefined;
        }} />
      </label>
    </div>
    <div class="field">
      <span class="label">Narrative</span>
      <TemplateEditor bind:value={doc.narrative} names={allNames} label="Narrative" />
    </div>
    {#each doc.parts as p, i (i)}
      <div class="field">
        <span class="label">Prompt — part {i + 1} <code>{p.id}</code></span>
        <TemplateEditor bind:value={p.prompt} names={allNames} label="Prompt of part {i + 1}" />
      </div>
    {/each}

    <details class="figure-editor" open={!!doc.figure}>
      <summary>Figure</summary>
      <label><input type="checkbox" checked={!!doc.figure} onchange={(e) => toggleFigure(e.currentTarget.checked)} /> Scenario has a figure</label>
      {#if doc.figure}
        <label class="field">File (relative to the set) <input bind:value={doc.figure.src} /></label>
        <label class="field">Alt text (required) <textarea rows="2" bind:value={doc.figure.alt}></textarea></label>
        <label class="field">Caption <input value={doc.figure.caption ?? ''} oninput={(e) => (doc.figure!.caption = optStr(e.currentTarget.value))} /></label>
        <span class="label">Overlays</span>
        {#each doc.figure.overlays ?? [] as o, k (k)}
          <div class="row small">
            <input aria-label="Overlay id" bind:value={o.id} />
            <input aria-label="Overlay x" type="number" step="0.01" min="0" max="1" bind:value={o.x} />
            <input aria-label="Overlay y" type="number" step="0.01" min="0" max="1" bind:value={o.y} />
            <input aria-label="Overlay text" class="grow" bind:value={o.text} />
            <button type="button" aria-label="Remove overlay" onclick={() => doc.figure!.overlays!.splice(k, 1)}>✕</button>
          </div>
        {/each}
        <button type="button" onclick={() => (doc.figure!.overlays ??= []).push({ id: `o${(doc.figure!.overlays?.length ?? 0) + 1}`, x: 0.5, y: 0.5, text: '' })}>+ Overlay</button>
      {/if}
    </details>
  </section>

  <!-- MIDDLE: model -->
  <section class="pane" aria-label="Model">
    <h2>Variables</h2>
    <VariableTable bind:vars={doc.vars} onchange={varsChanged} />

    <h3>Derived values</h3>
    {#each doc.derived as d, i (i)}
      <div class="row derived">
        <input aria-label="Derived name" class="name" bind:value={d.name} />
        <span>=</span>
        <div class="grow">
          <FormulaInput bind:value={d.expr} {scope} names={[...randomNames, ...doc.derived.slice(0, i).map((x) => x.name)]} label="Formula of {d.name}" />
        </div>
        <input aria-label="Unit of {d.name}" class="unit" value={d.unit ?? ''} oninput={(e) => (d.unit = optStr(e.currentTarget.value))} placeholder="unit" />
        <button type="button" aria-label="Remove {d.name}" onclick={() => doc.derived.splice(i, 1)}>✕</button>
      </div>
    {/each}
    <button type="button" onclick={() => doc.derived.push({ name: `k${doc.derived.length + 1}`, expr: '1' })}>+ Derived value</button>

    <h3>Constraints</h3>
    {#each doc.constraints as _c, i (i)}
      <div class="row">
        <div class="grow"><FormulaInput bind:value={doc.constraints[i]!} {scope} names={allNames} label="Constraint {i + 1}" /></div>
        <button type="button" aria-label="Remove constraint {i + 1}" onclick={() => doc.constraints.splice(i, 1)}>✕</button>
      </div>
    {/each}
    <button type="button" onclick={() => doc.constraints.push('true')}>+ Constraint</button>

    <h2>Parts</h2>
    {#each doc.parts as p, i (i)}
      <fieldset class="part">
        <legend>Part {i + 1}</legend>
        <div class="row">
          <label class="field">Id <input value={p.id} onchange={(e) => renamePart(i, e.currentTarget.value.trim())} /></label>
          <label class="field">Answer type
            <select value={p.answerType ?? 'numeric'} onchange={(e) => (p.answerType = e.currentTarget.value as EditablePart['answerType'])}>
              <option value="number">number</option>
              <option value="numeric">numeric</option>
              <option value="numericalFormula">numericalFormula</option>
            </select>
          </label>
          <label class="field">Unit <input class="unit" value={p.unit ?? ''} oninput={(e) => (p.unit = optStr(e.currentTarget.value))} placeholder="none" /></label>
        </div>
        <div class="field">
          <span class="label">Answer formula</span>
          <FormulaInput bind:value={p.answer} {scope} names={allNames} label="Answer formula of part {i + 1}" />
        </div>
        <div class="row">
          <label class="field">Rel. tolerance <input type="number" step="any" min="0" value={p.tolerance.rel ?? ''} oninput={(e) => (p.tolerance.rel = optNum(e.currentTarget.value))} placeholder="0.01" /></label>
          <label class="field">Unit penalty <input type="number" step="0.05" min="0" max="1" value={p.unitPenalty ?? ''} oninput={(e) => (p.unitPenalty = optNum(e.currentTarget.value))} placeholder="1" /></label>
          <label class="field">Mark <input type="number" step="any" min="0" value={p.mark ?? ''} oninput={(e) => (p.mark = optNum(e.currentTarget.value))} placeholder="1" /></label>
          <label class="field">Difficulty
            <select value={p.difficulty === undefined ? '' : String(p.difficulty)} onchange={(e) => (p.difficulty = optNum(e.currentTarget.value))}>
              <option value="">—</option>
              {#each [1, 2, 3, 4, 5] as d (d)}<option value={String(d)}>{d}</option>{/each}
            </select>
          </label>
          <label class="check"><input type="checkbox" checked={!!p.integer} onchange={(e) => (p.integer = e.currentTarget.checked || undefined)} /> integer</label>
        </div>
        {#if doc.parts.length > 1}
          <button type="button" class="danger" onclick={() => removePart(i)}>Remove part</button>
        {/if}
      </fieldset>
    {/each}
    <button type="button" onclick={addPart}>+ Part</button>

    <h2>Canonical source values</h2>
    <p class="muted small">The literal values and printed answers from the source document. The canonical check must reproduce them.</p>
    <div class="canonical-vars">
      {#each randomNames as n (n)}
        <label class="field">{n}
          <input value={doc.canonical.vars[n] ?? ''} onchange={(e) => (doc.canonical.vars[n] = parseValue(e.currentTarget.value))} aria-label="Source value of {n}" />
        </label>
      {/each}
    </div>
    {#each doc.canonical.parts as c, i (i)}
      <div class="row small canonical-part">
        <select aria-label="Canonical part {i + 1}" bind:value={c.id}>
          {#each doc.parts as p (p.id)}<option value={p.id}>{p.id}</option>{/each}
        </select>
        <input aria-label="Printed answer {i + 1}" type="number" step="any" value={c.answer} onchange={(e) => (c.answer = Number(e.currentTarget.value))} />
        <input aria-label="Printed unit {i + 1}" class="unit" value={c.unit ?? ''} oninput={(e) => (c.unit = optStr(e.currentTarget.value))} placeholder="unit" />
        <input aria-label="Source label {i + 1}" class="label-in" value={c.source ?? ''} oninput={(e) => (c.source = optStr(e.currentTarget.value))} placeholder="P1" />
        <input aria-label="Value overrides {i + 1}" class="grow" value={overridesText(c.vars)} onchange={(e) => (c.vars = parseOverrides(e.currentTarget.value))} placeholder="overrides: m=24, theta=29" />
        <button type="button" aria-label="Remove canonical row {i + 1}" onclick={() => doc.canonical.parts.splice(i, 1)}>✕</button>
      </div>
    {/each}
    <button type="button" onclick={addCanonicalPart}>+ Printed answer</button>
  </section>

  <!-- RIGHT: preview -->
  <section class="pane preview" aria-label="Preview">
    <h2>Preview</h2>
    <div class="row">
      <SeedScrubber bind:seed />
      <label class="check"><input type="checkbox" bind:checked={atSource} /> at source values</label>
    </div>
    {#if preview.error}
      <div class="preview-error" role="alert" data-testid="preview-error">{preview.error}</div>
    {/if}
    {#if preview.instance}
      <div class="preview-body" class:stale={!!preview.error}>
        <ProblemBody instance={preview.instance} {resolveSrc} />
        <dl class="answers">
          {#each preview.instance.parts as p, i (p.partId)}
            <dt>Answer ({String.fromCharCode(97 + i)})</dt>
            <dd><CorrectAnswer instance={preview.instance} part={p.partId} /></dd>
          {/each}
        </dl>
        <details>
          <summary>Values</summary>
          <code class="values">{Object.entries(preview.instance.values).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}</code>
        </details>
      </div>
    {/if}

    <h2>Canonical check</h2>
    {#if scenario}
      <CanonicalPanel {scenario} />
    {:else}
      <p class="muted">Fix the schema problems to run the canonical check.</p>
    {/if}

    <h2>Problems</h2>
    {#if !parsed.ok}
      <ul class="problems" data-testid="schema-issues">
        {#each parsed.issues as i, k (k)}<li class="error"><code>{i.path.join('.') || '(root)'}</code> {i.message}</li>{/each}
      </ul>
    {:else if diagnostics.length === 0}
      <p class="muted">None.</p>
    {:else}
      <ul class="problems">
        {#each diagnostics as d, k (k)}<li class={d.severity}><code>{d.path.join('.')}</code> {d.message}</li>{/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .editor-bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0;
    background: var(--pt-bg);
    border-bottom: 1px solid var(--pt-border);
  }
  .editor-bar .save {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .primary {
    padding: 0.35rem 1.1rem;
    border: none;
    border-radius: 4px;
    background: var(--pt-accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .save-result {
    margin: 0.5rem 0;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
  }
  .save-result.ok {
    background: var(--pt-good-bg);
    color: var(--pt-good);
  }
  .save-result.draft {
    background: var(--pt-warn-bg);
    color: var(--pt-warn);
  }
  .save-result.error {
    background: var(--pt-bad-bg);
    color: var(--pt-bad);
  }
  .panes {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(24rem, 1.25fr) minmax(20rem, 1fr);
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 1200px) {
    .panes {
      grid-template-columns: 1fr;
    }
  }
  .pane {
    min-width: 0;
  }
  .pane h2 {
    font-size: 1.05rem;
    margin: 1rem 0 0.5rem;
  }
  .pane h3 {
    font-size: 0.95rem;
    margin: 0.9rem 0 0.4rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-bottom: 0.6rem;
    font-size: 0.9em;
  }
  .label {
    font-size: 0.85em;
    color: var(--pt-muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .row .field {
    margin-bottom: 0;
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  input,
  select,
  textarea {
    font: inherit;
    padding: 0.2em 0.35em;
  }
  input.id {
    width: 18rem;
    font-family: var(--pt-mono);
  }
  input.name {
    width: 5rem;
    font-family: var(--pt-mono);
  }
  input.unit {
    width: 6rem;
  }
  input.label-in {
    width: 4rem;
  }
  .small input[type='number'] {
    width: 6rem;
  }
  .check {
    font-size: 0.9em;
  }
  fieldset.part {
    border: 1px solid var(--pt-border);
    border-radius: 6px;
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.75rem;
  }
  .danger {
    color: var(--pt-bad);
  }
  .canonical-vars {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .canonical-vars input {
    width: 6.5rem;
  }
  .preview-error {
    margin: 0.5rem 0;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    background: var(--pt-bad-bg);
    color: var(--pt-bad);
    font-size: 0.9em;
  }
  .preview-body {
    padding: 0.75rem;
    border-radius: 6px;
    background: var(--pt-formulation-bg);
  }
  .preview-body.stale {
    opacity: 0.6;
  }
  .answers {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.75rem;
    margin: 0.75rem 0 0.25rem;
    font-size: 0.9em;
  }
  .answers dt {
    color: var(--pt-muted);
  }
  .answers dd {
    margin: 0;
  }
  .values {
    display: block;
    white-space: pre;
    font-size: 0.8em;
    overflow-x: auto;
  }
  .problems {
    padding-left: 1.1rem;
    font-size: 0.9em;
  }
  .problems .error {
    color: var(--pt-bad);
  }
  .problems .warning {
    color: var(--pt-warn);
  }
  .small {
    font-size: 0.85em;
  }
</style>
