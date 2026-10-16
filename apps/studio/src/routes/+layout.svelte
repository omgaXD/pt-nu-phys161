<script lang="ts">
  import '@pt/ui/styles.css';
  import '../app.css';
  import { copyMathAsTex } from '@pt/ui';
  import { onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    // Marks the page as interactive (end-to-end tests wait for this).
    document.body.dataset.hydrated = 'true';
    return copyMathAsTex();
  });
</script>

<svelte:head>
  <title>PT Studio</title>
</svelte:head>

<header class="studio-header">
  <a class="brand" href={resolve('/')}>PT Studio</a>
  <nav><a href={resolve('/')}>Sets</a> · <a href={resolve('/dev')}>Component gallery</a></nav>
  <span class="note">Local-only editor — no authentication.</span>
</header>
<main>{@render children()}</main>
