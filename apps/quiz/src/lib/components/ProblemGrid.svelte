<script lang="ts" module>
  import type { CatalogQuestion } from '@pt/quiz';

  export interface PickerProblem {
    q: CatalogQuestion;
    /** Included in the selection. */
    on: boolean;
    solved: boolean;
    /** Why an option below leaves it out anyway (it cannot be toggled then). */
    blockedBy?: string;
  }
</script>

<script lang="ts">
  interface Props {
    id: string;
    /** Group name for screen readers, e.g. "Problems in Vectors". */
    label: string;
    problems: PickerProblem[];
    ontoggle: (q: CatalogQuestion, on: boolean) => void;
  }

  let { id, label, problems, ontoggle }: Props = $props();

  /** The tile under the pointer or focus, else the last one tapped (touch screens have no tooltips). */
  let shown = $state<string | null>(null);
  const shownProblem = $derived(problems.find((p) => p.q.key === shown));

  const name = (q: CatalogQuestion): string => (q.title ? `${q.label} · ${q.title}` : q.label);
  const stateText = (p: PickerProblem): string =>
    `${p.blockedBy ? `left out: ${p.blockedBy}` : p.on ? 'included' : 'left out'}${p.solved ? ', solved' : ''}`;
</script>

<div class="problem-picker" {id}>
  <div class="pt-nav-grid" role="group" aria-label={label}>
    {#each problems as p (p.q.key)}
      <button
        type="button"
        class="pt-nav-item"
        class:correct={p.solved}
        class:left-out={!p.on || p.blockedBy}
        aria-pressed={p.on}
        aria-disabled={p.blockedBy ? 'true' : undefined}
        aria-label="{name(p.q)}, {stateText(p)}"
        title={name(p.q)}
        onpointerenter={() => (shown = p.q.key)}
        onfocus={() => (shown = p.q.key)}
        onclick={() => {
          shown = p.q.key;
          if (!p.blockedBy) ontoggle(p.q, !p.on);
        }}
      >
        {p.q.number}
      </button>
    {/each}
  </div>
  <p class="hint" aria-hidden="true">
    {#if shownProblem}{name(shownProblem.q)} — {stateText(shownProblem)}{:else}Select a number to leave that problem out or bring it back.{/if}
  </p>
</div>

<style>
  .pt-nav-item {
    font: inherit;
    cursor: pointer;
  }
  /* Two lines kept free, so the rows below do not jump as the text changes. */
  .hint {
    display: -webkit-box;
    min-height: 2lh;
    margin: 0.35rem 0 0;
    overflow: hidden;
    font-size: 0.8rem;
    color: rgba(33, 37, 41, 0.75);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
