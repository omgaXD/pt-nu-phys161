<script lang="ts">
  import type { RenderedFigure } from '@pt/core';
  import RichHtml from './RichHtml.svelte';

  interface Props {
    figure: RenderedFigure;
    /** Map the authored `src` to a URL (the app knows where assets are served). */
    resolveSrc?: (src: string) => string;
  }

  let { figure, resolveSrc = (src: string) => src }: Props = $props();

  const anchorShift = { start: '0%', middle: '-50%', end: '-100%' } as const;
</script>

<!--
  Overlay labels sit in a layer over the image, positioned in percentages of
  the image box and sized in container units, so they stay on their spot and
  scale with the image at any width. Labels can contain math.
-->
<figure class="pt-figure" data-figure={figure.id}>
  <div class="pt-figure-frame">
    <img src={resolveSrc(figure.src)} alt={figure.alt} />
    {#if figure.overlays.length > 0}
      <div class="pt-figure-overlays" aria-hidden="true">
        {#each figure.overlays as o (o.id)}
          <span
            class="pt-overlay"
            data-overlay={o.id}
            style:left="{o.x * 100}%"
            style:top="{o.y * 100}%"
            style:transform="translate({anchorShift[o.anchor]}, -50%)"
          >
            <RichHtml html={o.html} />
          </span>
        {/each}
      </div>
      <ul class="pt-sr-only">
        {#each figure.overlays as o (o.id)}
          <li><RichHtml html={o.html} /></li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if figure.captionHtml}
    <figcaption><RichHtml html={figure.captionHtml} /></figcaption>
  {/if}
</figure>

<style>
  .pt-figure {
    margin: 0.75rem 0;
    max-width: 32rem;
  }
  .pt-figure-frame {
    position: relative;
    container-type: inline-size;
  }
  .pt-figure-frame img {
    display: block;
    width: 100%;
    height: auto;
  }
  .pt-figure-overlays {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .pt-overlay {
    position: absolute;
    white-space: nowrap;
    font-size: clamp(10px, 3.4cqw, 20px);
    line-height: 1;
    padding: 0.1em 0.25em;
    border-radius: 3px;
    background: color-mix(in srgb, var(--pt-bg, #fff) 80%, transparent);
    color: var(--pt-fg, #111);
  }
  figcaption {
    font-size: 0.9em;
    color: var(--pt-muted, #555);
    margin-top: 0.25rem;
  }
</style>
