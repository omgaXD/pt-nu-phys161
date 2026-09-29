<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<h1>Problem sets</h1>
<p class="muted">Store: {data.store}</p>
{#if data.sets.length === 0}
  <p>No sets yet. Import one with <code>pt import &lt;file&gt; --set &lt;id&gt;</code>.</p>
{/if}
<ul class="sets">
  {#each data.sets as set (set.id)}
    <li>
      <a href={resolve('/sets/[setId]', { setId: set.id })}><strong>{set.title}</strong></a>
      <span class="muted">({set.id}) — {set.scenarioCount} scenario(s), {set.sections.length} section(s)</span>
    </li>
  {/each}
</ul>

<style>
  .sets {
    line-height: 2;
  }
</style>
