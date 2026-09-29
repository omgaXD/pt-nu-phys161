<script lang="ts">
  import { renderTex } from './render.js';

  let { tex }: { tex: string } = $props();
  const html = $derived(renderTex(tex, false));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- KaTeX output, rendered with trust: false -->
<span class="pt-math-inline">{@html html}</span>
