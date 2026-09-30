<script lang="ts">
  import type { Snippet } from 'svelte';
  import { drawers } from '$lib/drawers.svelte';

  interface Props {
    children: Snippet;
    /** Content of the right-hand block drawer (quiz navigation); none on pages without blocks. */
    blocks?: Snippet;
    /** Keep the main column at reading width (start page, forms). */
    narrow?: boolean;
  }

  let { children, blocks, narrow = false }: Props = $props();

  // The course index's "⋮" menu. In Moodle it holds expand/collapse actions; here it hides an easter egg.
  let menuOpen = $state(false);
  let menuEl: HTMLElement | undefined = $state();
</script>

<svelte:window
  onclick={(e) => {
    if (menuOpen && menuEl && !menuEl.contains(e.target as Node)) menuOpen = false;
  }}
  onkeydown={(e) => {
    if (menuOpen && e.key === 'Escape') menuOpen = false;
  }}
/>


<!-- Moodle Boost's #page.drawers: a course-index drawer on the left (empty here, for the look),
     the block drawer on the right, each closable and reopened from a toggle at the edge. -->
<div id="page" class="drawers" class:show-drawer-left={drawers.left} class:show-drawer-right={blocks && drawers.right} class:narrow>
  <div class="drawer drawer-left" class:show={drawers.left} aria-label="Course index" role="region">
    <div class="drawerheader">
      <button type="button" class="drawertoggle" aria-label="Close course index" data-tooltip="Close course index" onclick={() => drawers.set('left', false)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
      </button>
      <div class="dropdown" bind:this={menuEl}>
        <button type="button" class="drawer-menu" aria-label="Course index options" aria-haspopup="true" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" /></svg>
        </button>
        {#if menuOpen}
          <div class="dropdown-menu dropdown-menu-end show">
            <div class="dropdown-item-text">:3</div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if blocks}
    <aside class="drawer drawer-right" class:show={drawers.right} aria-label="Blocks">
      <div class="drawerheader">
        <button type="button" class="drawertoggle" aria-label="Close block drawer" data-tooltip="Close block drawer" onclick={() => drawers.set('right', false)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
        </button>
      </div>
      <div class="drawercontent">{@render blocks()}</div>
    </aside>
  {/if}

  <div class="drawer-toggles">
    {#if !drawers.left}
      <div class="drawer-toggler drawer-left-toggle">
        <button type="button" class="btn" aria-label="Open course index" data-tooltip="Open course index" onclick={() => drawers.set('left', true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5.5 4h8M5.5 8h8M5.5 12h8" /><circle cx="2.5" cy="4" r="0.9" /><circle cx="2.5" cy="8" r="0.9" /><circle cx="2.5" cy="12" r="0.9" />
          </svg>
        </button>
      </div>
    {/if}
    {#if blocks && !drawers.right}
      <div class="drawer-toggler drawer-right-toggle">
        <button type="button" class="btn" aria-label="Open block drawer" data-tooltip="Open block drawer" onclick={() => drawers.set('right', true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
        </button>
      </div>
    {/if}
  </div>

  <main class="main-inner">{@render children()}</main>
</div>
