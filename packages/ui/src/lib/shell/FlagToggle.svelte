<script lang="ts">
  interface Props {
    flagged?: boolean;
    label?: string;
    onchange?: (flagged: boolean) => void;
  }

  let { flagged = $bindable(false), label = 'Flag question', onchange }: Props = $props();
</script>

<button
  type="button"
  class="pt-flag-toggle"
  class:flagged
  aria-pressed={flagged}
  onclick={() => {
    flagged = !flagged;
    onchange?.(flagged);
  }}
>
  <span aria-hidden="true">{flagged ? '⚑' : '⚐'}</span>
  {label}
</button>

<style>
  .pt-flag-toggle {
    font: inherit;
    font-size: 0.85em;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0.2em 0;
  }
  .flagged span {
    color: var(--pt-bad, #b3261e);
  }
</style>
