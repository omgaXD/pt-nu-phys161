<script lang="ts">
  import type { PartResult } from '@pt/core';
  import { type AnswerMessages, message } from '../answer/messages.js';
  import MathInline from '../math/MathInline.svelte';
  import GradeBadge from './GradeBadge.svelte';

  interface Props {
    result: PartResult;
    messages?: Partial<AnswerMessages> & Partial<Record<'no-response', string>>;
  }

  let { result, messages }: Props = $props();

  const verdict = $derived(result.fraction >= 1 ? 'Correct' : result.fraction > 0 ? 'Partially correct' : 'Incorrect');
</script>

<div class="pt-part-feedback" data-verdict={verdict.toLowerCase().replace(' ', '-')} role="status">
  <GradeBadge fraction={result.fraction} />
  <strong>{verdict}</strong>
  {#if result.parsedLatex}
    <span class="pt-feedback-answer">
      Your answer: <MathInline tex={result.parsedLatex + (result.studentUnit ? `\\ \\text{${result.studentUnit}}` : '')} />
    </span>
  {/if}
  <ul class="pt-feedback-details">
    {#if result.error}
      <li class="bad">{result.error.code === 'no-response' ? (messages?.['no-response'] ?? 'No answer given.') : message(result.error.code, messages)}</li>
    {:else}
      <li class={result.valueOk ? 'good' : 'bad'}>{result.valueOk ? 'Value is correct.' : 'Value is not correct.'}</li>
    {/if}
    <li class={result.unitOk ? 'good' : 'bad'}>{result.unitOk ? 'Unit is acceptable.' : 'Unit is missing or wrong.'}</li>
  </ul>
</div>

<style>
  .pt-part-feedback {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }
  .pt-feedback-details {
    flex-basis: 100%;
    margin: 0;
    padding-left: 1.2rem;
    font-size: 0.9em;
  }
  .good {
    color: var(--pt-good, #1b6e2a);
  }
  .bad {
    color: var(--pt-bad, #b3261e);
  }
</style>
