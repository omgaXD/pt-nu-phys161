<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TransitionConfig } from 'svelte/transition';
  import { drawers } from '$lib/drawers.svelte';
  import FaIcon from './FaIcon.svelte';

  interface Props {
    /** Remembers the collapsed state. */
    id: string;
    title: string;
    children: Snippet;
  }

  let { id, title, children }: Props = $props();

  const expanded = $derived(drawers.isExpanded(id));
  const contentId = $derived(`courseindexcollapse-${id}`);

  /** CSS `ease`, i.e. cubic-bezier(.25, .1, .25, 1): solve x(s) = t for s, return y(s). */
  function ease(t: number): number {
    const curve = (a: number, b: number, s: number): number => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      if (curve(0.25, 0.25, mid) < t) lo = mid;
      else hi = mid;
    }
    return curve(0.1, 1, (lo + hi) / 2);
  }

  /** Bootstrap's .collapsing: the height runs between 0 and the content's, 0.35s ease (none with reduced motion). */
  function collapse(node: HTMLElement): TransitionConfig {
    const height = node.scrollHeight;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { duration: reduced ? 0 : 350, easing: ease, css: (t) => `height: ${t * height}px; overflow: hidden;` };
  }
</script>

<!-- Moodle's .courseindex-section. There the chevron is a collapse link and the title a link to the
     section; here the whole title row is the toggle. -->
<div class="courseindex-section">
  <button
    type="button"
    class="courseindex-item courseindex-section-title"
    aria-expanded={expanded}
    aria-controls={expanded ? contentId : undefined}
    onclick={() => drawers.setExpanded(id, !expanded)}
  >
    <span class="courseindex-chevron icons-collapse-expand" class:collapsed={!expanded}>
      <!-- As in Moodle, the collapsed chevron sits in an inline span (.dir-rtl-hide), on the text baseline. -->
      <span class="collapsed-icon" title="Expand"><span class="dir-rtl-hide"><FaIcon name="chevron-right" /></span></span>
      <span class="expanded-icon" title="Collapse"><FaIcon name="chevron-down" /></span>
    </span>
    <span class="courseindex-link text-truncate">{title}</span>
  </button>
  {#if expanded}
    <div id={contentId} class="courseindex-item-content" transition:collapse>{@render children()}</div>
  {/if}
</div>
