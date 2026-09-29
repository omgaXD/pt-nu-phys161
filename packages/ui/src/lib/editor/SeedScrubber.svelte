<script lang="ts">
  import { MAX_SEED } from '@pt/core';

  interface Props {
    seed?: number;
    onchange?: (seed: number) => void;
    /** Random source; injectable for tests. */
    random?: () => number;
  }

  let { seed = $bindable(0), onchange, random = Math.random }: Props = $props();

  function set(next: number): void {
    const s = Math.min(MAX_SEED, Math.max(0, Math.trunc(Number.isFinite(next) ? next : 0)));
    seed = s;
    onchange?.(s);
  }
</script>

<div class="pt-seed-scrubber" role="group" aria-label="Seed">
  <button type="button" aria-label="Previous seed" disabled={seed <= 0} onclick={() => set(seed - 1)}>‹</button>
  <input
    type="number"
    min="0"
    max={MAX_SEED}
    aria-label="Seed"
    value={seed}
    onchange={(e) => set(Number(e.currentTarget.value))}
  />
  <button type="button" aria-label="Next seed" onclick={() => set(seed + 1)}>›</button>
  <button type="button" aria-label="Random seed" onclick={() => set(Math.floor(random() * (MAX_SEED + 1)))}>⟳ random</button>
</div>

<style>
  .pt-seed-scrubber {
    display: inline-flex;
    gap: 0.25rem;
    align-items: center;
  }
  input {
    font: inherit;
    width: 8.5em;
    padding: 0.15em 0.3em;
    font-variant-numeric: tabular-nums;
  }
  button {
    font: inherit;
    padding: 0.15em 0.5em;
    cursor: pointer;
  }
</style>
