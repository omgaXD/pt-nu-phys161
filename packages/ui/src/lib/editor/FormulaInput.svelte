<script lang="ts">
  import type { EditorView } from '@codemirror/view';
  import type { Scope } from '@pt/core';
  import { onMount } from 'svelte';
  import { createEditor, type EditorContext, forceLinting, syncDoc } from './codemirror.js';
  import { evaluatePreview, formulaDiagnostics } from './diagnostics.js';

  interface Props {
    value?: string;
    /** Current values (randoms + derived) for autocomplete and live evaluation. */
    scope?: Scope;
    /** Identifiers that are valid here; defaults to the scope's keys. */
    names?: string[];
    label?: string;
    /** Show the live "= value" readout. */
    showValue?: boolean;
    onchange?: (value: string) => void;
  }

  let { value = $bindable(''), scope = {}, names, label = 'Formula', showValue = true, onchange }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  const ctx: EditorContext = { names: [] };

  $effect(() => {
    ctx.names = names ?? Object.keys(scope);
    if (view) forceLinting(view);
  });

  onMount(() => {
    view = createEditor({
      parent: host,
      doc: value,
      mode: 'formula',
      ctx,
      ariaLabel: label,
      diagnostics: (doc) => formulaDiagnostics(doc, ctx.names),
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

  const preview = $derived(showValue ? evaluatePreview(value, scope) : null);
  const problems = $derived(formulaDiagnostics(value, names ?? Object.keys(scope)));
</script>

<div class="pt-formula-input" class:has-error={problems.length > 0 || preview?.ok === false}>
  <div class="pt-formula-editor" bind:this={host}></div>
  {#if preview}
    <div class="pt-formula-value" class:error={!preview.ok} aria-live="polite">
      {#if preview.ok}= {preview.text}{:else}{preview.message}{/if}
    </div>
  {/if}
</div>

<style>
  .pt-formula-value {
    font-size: 0.85em;
    color: var(--pt-muted, #555);
    margin-top: 0.15rem;
    font-variant-numeric: tabular-nums;
  }
  .pt-formula-value.error {
    color: var(--pt-bad, #b3261e);
  }
</style>
