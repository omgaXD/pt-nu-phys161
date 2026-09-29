<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Info column: question number, state, mark, flag. */
    header?: Snippet;
    /** The question text and inputs. */
    children?: Snippet;
    /** Outcome / feedback area. */
    footer?: Snippet;
    /** Extra state classes, mirroring the target system (e.g. "answersaved"). */
    state?: string;
  }

  let { header, children, footer, state = '' }: Props = $props();
</script>

<!--
  Mirrors the target DOM (Moodle's .que > .info + .content > .formulation /
  .outcome) so styling later is a find-and-replace, not a rewrite.
-->
<div class="que pt-question-card {state}">
  <div class="info">{@render header?.()}</div>
  <div class="content">
    <div class="formulation clearfix">{@render children?.()}</div>
    {#if footer}
      <div class="outcome clearfix">{@render footer()}</div>
    {/if}
  </div>
</div>

<style>
  .que {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }
  .info {
    flex: 0 0 7rem;
    padding: 0.5rem;
    border: 1px solid var(--pt-border, #d0d4da);
    border-radius: 4px;
    background: var(--pt-surface, #f7f7f9);
    font-size: 0.85em;
  }
  .content {
    flex: 1 1 auto;
    min-width: 0;
  }
  .formulation {
    padding: 0.75rem 1rem;
    border-radius: 4px;
    background: var(--pt-formulation-bg, #e7f3f5);
    color: var(--pt-fg, #001a1e);
  }
  .outcome {
    margin-top: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    background: var(--pt-outcome-bg, #fcefdc);
  }
  @media (max-width: 40rem) {
    .que {
      flex-direction: column;
    }
    .info {
      flex-basis: auto;
    }
  }
</style>
