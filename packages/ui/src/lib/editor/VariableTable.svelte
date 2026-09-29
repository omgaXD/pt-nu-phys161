<script lang="ts">
  import { countVariants, type RandomVar, varCount } from '@pt/core';

  interface Props {
    vars?: RandomVar[];
    onchange?: (vars: RandomVar[]) => void;
  }

  let { vars = $bindable([]), onchange }: Props = $props();

  type AnyVar = Record<string, unknown> & { name: string; kind: 'range' | 'choice' };

  function clean(v: AnyVar): RandomVar {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== '')) as RandomVar;
  }

  function commit(next: RandomVar[]): void {
    vars = next;
    onchange?.(next);
  }

  function patch(i: number, p: Record<string, unknown>): void {
    commit(vars.map((v, j) => (j === i ? clean({ ...(v as AnyVar), ...p }) : v)));
  }

  const num = (s: string): number | undefined => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s));

  function setKind(i: number, kind: 'range' | 'choice'): void {
    const v = vars[i]!;
    const common = { name: v.name, unit: v.unit, label: v.label, decimals: v.decimals, sigfigs: v.sigfigs };
    const next: AnyVar =
      kind === 'range'
        ? { ...common, kind, min: 1, max: 10, step: 1 }
        : { ...common, kind, options: v.kind === 'range' ? [v.min, v.max] : [1, 2] };
    commit(vars.map((x, j) => (j === i ? clean(next) : x)));
  }

  function parseOptions(s: string): (number | string)[] {
    return s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(x) ? Number(x) : x));
  }

  function add(): void {
    const taken = new Set(vars.map((v) => v.name));
    let n = 1;
    while (taken.has(`v${n}`)) n++;
    commit([...vars, { name: `v${n}`, kind: 'range', min: 1, max: 10, step: 1 }]);
  }

  function move(i: number, d: -1 | 1): void {
    const j = i + d;
    if (j < 0 || j >= vars.length) return;
    const next = [...vars];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
  }

  function count(v: RandomVar): string {
    try {
      return varCount(v).toLocaleString('en-US');
    } catch {
      return '—';
    }
  }

  const total = $derived.by(() => {
    try {
      const n = countVariants({ vars });
      return n === Number.MAX_SAFE_INTEGER ? '≥ 9.0e15' : n.toLocaleString('en-US');
    } catch {
      return '—';
    }
  });
</script>

<div class="pt-variable-table">
  <table>
    <thead>
      <tr>
        <th scope="col">Name</th>
        <th scope="col">Kind</th>
        <th scope="col">Values</th>
        <th scope="col">Decimals</th>
        <th scope="col">Sig. figs</th>
        <th scope="col">Unit</th>
        <th scope="col">Label</th>
        <th scope="col">Variants</th>
        <th scope="col"><span class="pt-sr-only">Actions</span></th>
      </tr>
    </thead>
    <tbody>
      {#each vars as v, i (i)}
        <tr data-var={v.name}>
          <td><input aria-label="Name" class="name" value={v.name} onchange={(e) => patch(i, { name: e.currentTarget.value.trim() })} /></td>
          <td>
            <select aria-label="Kind of {v.name}" value={v.kind} onchange={(e) => setKind(i, e.currentTarget.value as 'range' | 'choice')}>
              <option value="range">range</option>
              <option value="choice">choice</option>
            </select>
          </td>
          <td class="values">
            {#if v.kind === 'range'}
              <input aria-label="Minimum of {v.name}" type="number" step="any" value={v.min} onchange={(e) => patch(i, { min: num(e.currentTarget.value) })} />
              <span aria-hidden="true">…</span>
              <input aria-label="Maximum of {v.name}" type="number" step="any" value={v.max} onchange={(e) => patch(i, { max: num(e.currentTarget.value) })} />
              <span>step</span>
              <input aria-label="Step of {v.name}" type="number" step="any" min="0" value={v.step ?? ''} onchange={(e) => patch(i, { step: num(e.currentTarget.value) })} />
            {:else}
              <input
                aria-label="Options of {v.name}"
                class="options"
                value={v.options.join(', ')}
                onchange={(e) => patch(i, { options: parseOptions(e.currentTarget.value) })}
              />
            {/if}
          </td>
          <td>
            <input aria-label="Decimals of {v.name}" type="number" min="0" max="15" value={v.decimals ?? ''} onchange={(e) => patch(i, { decimals: num(e.currentTarget.value), sigfigs: undefined })} />
          </td>
          <td>
            <input aria-label="Significant figures of {v.name}" type="number" min="1" max="15" value={v.sigfigs ?? ''} onchange={(e) => patch(i, { sigfigs: num(e.currentTarget.value), decimals: undefined })} />
          </td>
          <td><input aria-label="Unit of {v.name}" class="unit" value={v.unit ?? ''} onchange={(e) => patch(i, { unit: e.currentTarget.value.trim() || undefined })} /></td>
          <td><input aria-label="Label of {v.name}" value={v.label ?? ''} onchange={(e) => patch(i, { label: e.currentTarget.value || undefined })} /></td>
          <td class="count" data-testid="var-count">{count(v)}</td>
          <td class="actions">
            <button type="button" aria-label="Move {v.name} up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
            <button type="button" aria-label="Move {v.name} down" disabled={i === vars.length - 1} onclick={() => move(i, 1)}>↓</button>
            <button type="button" aria-label="Remove {v.name}" onclick={() => commit(vars.filter((_, j) => j !== i))}>✕</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="footer">
    <button type="button" onclick={add}>+ Add variable</button>
    <span class="total" aria-live="polite">Variants: <strong data-testid="variant-total">{total}</strong></span>
  </div>
</div>

<style>
  .pt-variable-table {
    overflow-x: auto;
    font-size: 0.9em;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    text-align: left;
    font-weight: 600;
    font-size: 0.85em;
    color: var(--pt-muted, #555);
    padding: 0.2rem;
  }
  td {
    padding: 0.15rem 0.2rem;
    vertical-align: middle;
  }
  input,
  select {
    font: inherit;
    width: 4.5em;
    padding: 0.1em 0.25em;
  }
  select {
    width: 6.5em;
  }
  input.name {
    width: 5em;
    font-family: var(--pt-mono, ui-monospace, monospace);
  }
  input.options {
    width: 14em;
  }
  input.unit {
    width: 5em;
  }
  .values {
    white-space: nowrap;
  }
  .count {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .actions {
    white-space: nowrap;
  }
  .actions button {
    font: inherit;
    padding: 0 0.3em;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.35rem;
  }
</style>
