<script lang="ts">
  import '@pt/ui/styles.css';
  import '@pt/ui/themes/moodle.css';
  import '../app.css';
  import { onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { app } from '$lib/app.svelte';
  import Toasts from '$lib/components/Toasts.svelte';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    const flush = (): void => app.save();
    window.addEventListener('pagehide', flush);
    void app.init().then(() => {
      // Marks the page as interactive with content loaded (end-to-end tests wait for this).
      document.body.dataset.hydrated = 'true';
    });
    return () => window.removeEventListener('pagehide', flush);
  });

  // Auto-submit at the deadline wherever the user is in the app.
  $effect(() => app.watchDeadline());
</script>

<svelte:head>
  <title>Physics Quiz</title>
</svelte:head>

<Toasts />

<nav class="navbar" aria-label="Site">
  <a class="brand" href={resolve('/')}>Physics Quiz</a>
  <span class="navbar-note">Practice runner · progress is kept in this browser</span>
</nav>

{#if app.error}
  <div class="alert alert-danger" role="alert">{app.error}</div>
{/if}

{#if app.ready}
  {@render children()}
{:else}
  <p class="loading" aria-live="polite">Loading…</p>
{/if}
