<script lang="ts">
  import type { EditorView } from '@codemirror/view';
  import type { Scope } from '@pt/core';
  import { onMount } from 'svelte';
  import { createEditor, type EditorContext, forceLinting, syncDoc } from './codemirror.js';
  import { templateDiagnostics } from './diagnostics.js';

  interface Props {
    value?: string;
    /** Current values; their names are what {tokens} may reference. */
    scope?: Scope;
    names?: string[];
    label?: string;
    onchange?: (value: string) => void;
  }

  let { value = $bindable(''), scope = {}, names, label = 'Template', onchange }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  const ctx: EditorContext = { names: [] };

  $effect(() => {
    ctx.names = names ?? Object.keys(scope);
    if (view) {
      forceLinting(view);
      view.dispatch({}); // refresh token highlighting for the new names
    }
  });

  onMount(() => {
    view = createEditor({
      parent: host,
      doc: value,
      mode: 'template',
      ctx,
      ariaLabel: label,
      diagnostics: (doc) => templateDiagnostics(doc, ctx.names),
      onChange: (doc) => {
        value = doc;
        onchange?.(doc);
      },
    });
    return () => view?.destroy();
  });

  $effect(() => {
    if (view) syncDoc(view, value);
  });

  const problems = $derived(templateDiagnostics(value, names ?? Object.keys(scope)));
</script>

<div class="pt-template-editor" class:has-error={problems.length > 0}>
  <div bind:this={host}></div>
  {#if problems.length > 0}
    <ul class="pt-template-problems">
      {#each problems as p, i (i)}<li>{p.message}</li>{/each}
    </ul>
  {/if}
</div>

<style>
  .pt-template-problems {
    margin: 0.2rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.8em;
    color: var(--pt-bad, #b3261e);
  }
</style>
