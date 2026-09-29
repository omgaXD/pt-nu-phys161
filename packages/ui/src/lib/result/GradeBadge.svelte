<script lang="ts">
  let { fraction }: { fraction: number } = $props();

  const pct = $derived(Math.round(fraction * 100));
  const kind = $derived(fraction >= 1 ? 'full' : fraction > 0 ? 'partial' : 'zero');
</script>

<span class="pt-grade-badge {kind}" data-kind={kind}>{pct}%</span>

<style>
  .pt-grade-badge {
    display: inline-block;
    padding: 0.1em 0.5em;
    border-radius: 999px;
    font-size: 0.85em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .full {
    background: var(--pt-good-bg, #e3f4e5);
    color: var(--pt-good, #1b6e2a);
  }
  .partial {
    background: var(--pt-warn-bg, #fff4d6);
    color: var(--pt-warn, #7a5300);
  }
  .zero {
    background: var(--pt-bad-bg, #fbe4e2);
    color: var(--pt-bad, #b3261e);
  }
</style>
