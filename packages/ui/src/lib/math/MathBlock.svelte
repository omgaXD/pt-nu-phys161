<script lang="ts">
  import { renderTex } from './render.js';

  let { tex }: { tex: string } = $props();
  const html = $derived(renderTex(tex, true));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- KaTeX output, rendered with trust: false -->
<div class="pt-math-block">{@html html}</div>
