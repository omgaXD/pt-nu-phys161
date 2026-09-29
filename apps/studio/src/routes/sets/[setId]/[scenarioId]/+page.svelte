<script lang="ts">
  import { resolve } from '$app/paths';
  import ScenarioEditor from '$lib/ScenarioEditor.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.scenario.id} · PT Studio</title></svelte:head>

<p><a href={resolve('/sets/[setId]', { setId: data.setId })}>← {data.setTitle}</a></p>
{#key data.scenario.id}
  <ScenarioEditor initial={data.scenario} setId={data.setId} sections={data.sections} isNew={false} />
{/key}
