<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let showDrafts = $state(false);
</script>

<p><a href={resolve('/')}>← Sets</a></p>
<h1>{data.set.title}</h1>

<form class="filters" method="get" data-sveltekit-keepfocus>
  <label>Section
    <select name="section" value={data.filters.section}>
      <option value="">All</option>
      {#each data.set.sections as s (s)}<option value={s}>{s}</option>{/each}
    </select>
  </label>
  <label>Tag
    <select name="tag" value={data.filters.tag}>
      <option value="">All</option>
      {#each data.tags as t (t)}<option value={t}>{t}</option>{/each}
    </select>
  </label>
  <label>Difficulty
    <select name="difficulty" value={data.filters.difficulty}>
      <option value="">Any</option>
      {#each [1, 2, 3, 4, 5] as d (d)}<option value={String(d)}>{d}</option>{/each}
    </select>
  </label>
  <label>Canonical check
    <select name="status" value={data.filters.status}>
      <option value="">Any</option>
      <option value="pass">Passing</option>
      <option value="fail">Failing</option>
      <option value="draft">Draft</option>
    </select>
  </label>
  <label>Search <input name="q" type="search" value={data.filters.text} /></label>
  <button type="submit">Filter</button>
  <a href={resolve('/sets/[setId]', { setId: data.set.id })}>Reset</a>
</form>

<p class="muted">{data.rows.length} of {data.total} scenario(s) · <a href={resolve('/sets/[setId]/new', { setId: data.set.id })}>+ New scenario</a></p>

<table class="scenarios">
  <thead><tr><th scope="col">Scenario</th><th scope="col">Section</th><th scope="col">Parts</th><th scope="col">Source</th><th scope="col">Status</th></tr></thead>
  <tbody>
    {#each data.rows as r (r.id)}
      <tr data-scenario={r.id}>
        <td><a href={resolve('/sets/[setId]/[scenarioId]', { setId: data.set.id, scenarioId: r.id })}>{r.title}</a><div class="muted id">{r.id}{r.hasFigure ? ' · figure' : ''}</div></td>
        <td>{r.section ?? ''}</td>
        <td>{r.partCount}</td>
        <td>{r.sourceLabels.join(', ')}</td>
        <td><span class="pill {r.status}">{r.status === 'pass' ? 'canonical ✓' : r.status === 'fail' ? 'canonical ✗' : 'draft'}</span></td>
      </tr>
    {/each}
  </tbody>
</table>

{#if data.drafts.length > 0}
  <section class="drafts">
    <h2>Imported drafts <span class="muted">({data.drafts.length} not yet authored)</span></h2>
    <button type="button" onclick={() => (showDrafts = !showDrafts)} aria-expanded={showDrafts}>{showDrafts ? 'Hide' : 'Show'} drafts</button>
    {#if showDrafts}
      <ul>
        {#each data.drafts as d (d.label)}
          <li><a href={resolve('/sets/[setId]/drafts/[label]', { setId: data.set.id, label: d.label })}>{d.label}</a> <span class="muted">{d.text.slice(0, 140)}{d.text.length > 140 ? '…' : ''}</span></li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
    margin-bottom: 0.75rem;
  }
  .filters label {
    display: flex;
    flex-direction: column;
    font-size: 0.85em;
    gap: 0.15rem;
  }
  .scenarios {
    border-collapse: collapse;
    width: 100%;
  }
  .scenarios th,
  .scenarios td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--pt-border);
    vertical-align: top;
  }
  .id {
    font-size: 0.8em;
  }
  .drafts {
    margin-top: 2rem;
  }
  .drafts li {
    margin: 0.3rem 0;
  }
</style>
