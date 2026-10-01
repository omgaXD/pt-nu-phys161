<script lang="ts">
  import type { DifficultyLevel } from '@pt/core';
  import { DEFAULT_DIFFICULTY_NAMES, type DifficultyNames } from './difficulty.js';

  let { level, names = DEFAULT_DIFFICULTY_NAMES }: { level: DifficultyLevel; names?: DifficultyNames } = $props();

  const name = $derived(names[level]);
</script>

<!-- Five dots, `level` of them filled; the name is the accessible label and the tooltip. -->
<span class="pt-difficulty" role="img" aria-label="{name}, {level} of 5" data-tooltip={name} data-level={level}>
  {#each [1, 2, 3, 4, 5] as d (d)}
    <span class="dot" class:on={d <= level} aria-hidden="true"></span>
  {/each}
</span>

<style>
  .pt-difficulty {
    display: inline-flex;
    gap: 0.2em;
    align-items: center;
    vertical-align: middle;
  }
  .dot {
    box-sizing: border-box;
    width: 0.6em;
    height: 0.6em;
    border: 1px solid currentColor;
    border-radius: 50%;
  }
  .dot.on {
    background: currentColor;
  }
</style>
