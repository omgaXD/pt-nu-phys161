<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ImportChoices } from '$lib/app.svelte';
  import { drawers } from '$lib/drawers.svelte';
  import CourseIndexSection from './CourseIndexSection.svelte';
  import FaIcon from './FaIcon.svelte';
  import StateActions from './StateActions.svelte';

  interface Props {
    children: Snippet;
    /** Content of the right-hand block drawer (quiz navigation); none on pages without blocks. */
    blocks?: Snippet;
    /** Keep the main column at reading width (start page, forms). */
    narrow?: boolean;
    /** After importing a saved state without resuming an attempt. */
    onimported?: (choices: ImportChoices) => void;
  }

  let { children, blocks, narrow = false, onimported }: Props = $props();

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


<!-- Moodle Boost's #page.drawers: the course-index drawer on the left (app-wide actions here),
     the block drawer on the right, each closable and reopened from a toggle at the edge. -->
<div id="page" class="drawers" class:show-drawer-left={drawers.left} class:show-drawer-right={blocks && drawers.right} class:narrow>
  <div class="drawer drawer-left" class:show={drawers.left} aria-label="Course index" role="region">
    <div class="drawerheader">
      <button type="button" class="drawertoggle" aria-label="Close course index" data-tooltip="Close course index" onclick={() => drawers.set('left', false)}>
        <FaIcon name="xmark" />
      </button>
      <div class="dropdown" bind:this={menuEl}>
        <button type="button" class="drawer-menu" aria-label="Course index options" aria-haspopup="true" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
          <FaIcon name="ellipsis-vertical" />
        </button>
        {#if menuOpen}
          <div class="dropdown-menu dropdown-menu-end show">
            <div class="dropdown-item-text">:3</div>
          </div>
        {/if}
      </div>
    </div>
    <div class="drawercontent">
      <nav class="courseindex" aria-label="Course index">
        <CourseIndexSection id="general" title="General"><StateActions {onimported} /></CourseIndexSection>
      </nav>
    </div>
  </div>

  {#if blocks}
    <aside class="drawer drawer-right" class:show={drawers.right} aria-label="Blocks">
      <div class="drawerheader">
        <button type="button" class="drawertoggle" aria-label="Close block drawer" data-tooltip="Close block drawer" onclick={() => drawers.set('right', false)}>
          <FaIcon name="xmark" />
        </button>
      </div>
      <div class="drawercontent">{@render blocks()}</div>
    </aside>
  {/if}

  <div class="drawer-toggles">
    {#if !drawers.left}
      <div class="drawer-toggler drawer-left-toggle">
        <button type="button" class="btn" aria-label="Open course index" data-tooltip="Open course index" onclick={() => drawers.set('left', true)}>
          <FaIcon name="list" fixedWidth={false} />
        </button>
      </div>
    {/if}
    {#if blocks && !drawers.right}
      <div class="drawer-toggler drawer-right-toggle">
        <button type="button" class="btn" aria-label="Open block drawer" data-tooltip="Open block drawer" onclick={() => drawers.set('right', true)}>
          <FaIcon name="chevron-left" fixedWidth={false} />
        </button>
      </div>
    {/if}
  </div>

  <main class="main-inner">{@render children()}</main>
</div>
