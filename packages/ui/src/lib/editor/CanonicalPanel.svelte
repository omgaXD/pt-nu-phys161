<script lang="ts">
  import { type CanonicalReport, checkCanonical, CoreError, type Scenario } from '@pt/core';

  interface Props {
    scenario: Scenario;
  }

  let { scenario }: Props = $props();

  const report = $derived.by((): CanonicalReport | { error: string } => {
    try {
      return checkCanonical(scenario);
    } catch (e) {
      return { error: e instanceof CoreError || e instanceof Error ? e.message : String(e) };
    }
  });

  const fmt = (x: number | null): string =>
    x === null ? '—' : Math.abs(x) >= 1e6 || (x !== 0 && Math.abs(x) < 1e-3) ? x.toExponential(5) : String(Number(x.toPrecision(8)));
</script>

<section class="pt-canonical-panel" aria-label="Canonical check">
  {#if 'error' in report}
    <p class="bad">Canonical check could not run: {report.error}</p>
  {:else}
    <header class:ok={report.ok} class:bad={!report.ok} data-status={report.ok ? 'pass' : 'fail'}>
      {report.ok ? '✓ Reproduces the source answers' : '✗ Does not reproduce the source answers'}
    </header>
    <table>
      <thead>
        <tr><th scope="col">Part</th><th scope="col">Source</th><th scope="col">Computed</th><th scope="col">Printed</th><th scope="col">Rel. error</th></tr>
      </thead>
      <tbody>
        {#each report.parts as p (p.partId)}
          <tr class:fail={!p.ok} data-part={p.partId}>
            <td>{p.ok ? '✓' : '✗'} {p.partId}</td>
            <td>{p.source ?? ''}</td>
            {#if p.error}
              <td colspan="3" class="bad">{p.error.message}</td>
            {:else}
              <td>{fmt(p.computed)}</td>
              <td>{fmt(p.expectedInPartUnit)} {p.expectedUnit ?? ''}</td>
              <td>{p.relError === null ? '—' : p.relError.toExponential(1)}</td>
            {/if}
          </tr>
          {#each p.derivedMismatches as m (m.name)}
            <tr class="fail"><td colspan="5">{m.name} = {String(m.actual)}, the source says {String(m.expected)}</td></tr>
          {/each}
        {/each}
      </tbody>
    </table>
    {#if report.warnings.length > 0}
      <ul class="warnings">
        {#each report.warnings as w, i (i)}
          <li>
            {#if w.code === 'canonical-violates-constraint'}
              Source values of {w.partId} violate constraint <code>{w.constraint}</code>
            {:else}
              Source value {w.name} = {w.value} is not reachable by the randomization
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .pt-canonical-panel {
    font-size: 0.9em;
  }
  header {
    font-weight: 600;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    margin-bottom: 0.35rem;
  }
  header.ok {
    background: var(--pt-good-bg, #e3f4e5);
    color: var(--pt-good, #1b6e2a);
  }
  header.bad,
  .bad {
    background: var(--pt-bad-bg, #fbe4e2);
    color: var(--pt-bad, #b3261e);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 0.2rem 0.35rem;
    border-bottom: 1px solid var(--pt-border, #e1e4e8);
  }
  tr.fail td {
    color: var(--pt-bad, #b3261e);
  }
  .warnings {
    margin: 0.35rem 0 0;
    padding-left: 1.1rem;
    color: var(--pt-warn, #7a5300);
  }
</style>
