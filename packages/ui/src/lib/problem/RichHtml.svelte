<script lang="ts">
  import { type HtmlSegment, splitRenderedHtml } from '@pt/core';
  import type { Snippet } from 'svelte';
  import MathBlock from '../math/MathBlock.svelte';
  import MathInline from '../math/MathInline.svelte';

  interface Props {
    /** Placeholder HTML produced by @pt/core's template renderer. */
    html: string;
    /** Renders an answer slot in place. Slots are dropped when absent. */
    slot?: Snippet<[Extract<HtmlSegment, { type: 'slot' }>]>;
    /** Renders the scenario figure where {@fig} was written. */
    figure?: Snippet<[string]>;
  }

  let { html, slot, figure }: Props = $props();
  const segments = $derived(splitRenderedHtml(html));
</script>

{#each segments as seg, i (i)}
  {#if seg.type === 'html'}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- @pt/core renderer output: authored text is HTML-escaped -->
    {@html seg.html}
  {:else if seg.type === 'math'}
    {#if seg.display}<MathBlock tex={seg.tex} />{:else}<MathInline tex={seg.tex} />{/if}
  {:else if seg.type === 'slot'}
    {@render slot?.(seg)}
  {:else if seg.type === 'figure'}
    {@render figure?.(seg.id)}
  {/if}
{/each}
