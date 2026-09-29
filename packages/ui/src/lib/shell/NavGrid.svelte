<script lang="ts">
  import type { NavItem } from './types.js';

  interface Props {
    items: NavItem[];
    onSelect?: (id: string) => void;
    label?: string;
  }

  let { items, onSelect, label = 'Question navigation' }: Props = $props();

  const stateOf = (i: NavItem): string => i.outcome ?? (i.answered ? 'answered' : 'unanswered');
  const spoken = (i: NavItem): string => (i.outcome ? `, ${i.outcome}` : i.answered ? ', answered' : ', not answered');
</script>

<nav class="pt-nav-grid" aria-label={label}>
  {#each items as item (item.id)}
    <button
      type="button"
      class="pt-nav-item {stateOf(item)}"
      class:flagged={item.flagged}
      class:current={item.current}
      data-state={stateOf(item)}
      aria-current={item.current ? 'step' : undefined}
      aria-label="{item.label}{spoken(item)}{item.flagged ? ', flagged' : ''}"
      title={item.title}
      onclick={() => onSelect?.(item.id)}
    >
      {item.label}
    </button>
  {/each}
</nav>

<style>
  .pt-nav-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(2.25rem, 1fr));
    gap: 0.3rem;
  }
  .pt-nav-item {
    position: relative;
    font: inherit;
    min-height: 2.25rem;
    border: 1px solid var(--pt-border, #8a8f98);
    border-radius: 4px;
    background: var(--pt-bg, #fff);
    color: inherit;
    cursor: pointer;
  }
  .answered {
    background: var(--pt-nav-answered, #c8d6e5);
  }
  .correct {
    background: var(--pt-good-bg, #e3f4e5);
    border-color: var(--pt-good, #1b6e2a);
  }
  .partial {
    background: var(--pt-warn-bg, #fff4d6);
    border-color: var(--pt-warn, #7a5300);
  }
  .incorrect {
    background: var(--pt-bad-bg, #fbe4e2);
    border-color: var(--pt-bad, #b3261e);
  }
  .current {
    outline: 2px solid var(--pt-accent, #0f6cbf);
    outline-offset: 1px;
    font-weight: 700;
  }
  .flagged::after {
    content: '';
    position: absolute;
    top: 2px;
    right: 2px;
    border-width: 0 8px 8px 0;
    border-style: solid;
    border-color: transparent var(--pt-bad, #b3261e) transparent transparent;
  }
</style>
