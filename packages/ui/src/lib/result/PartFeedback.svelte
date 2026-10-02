<script lang="ts">
  import type { PartResult } from '@pt/core';
  import { type AnswerMessages, message } from '../answer/messages.js';

  interface Props {
    result: PartResult;
    messages?: Partial<AnswerMessages> & Partial<Record<'no-response', string>>;
  }

  let { result, messages }: Props = $props();

  const verdict = $derived(result.fraction >= 1 ? 'correct' : result.fraction > 0 ? 'partially correct' : 'incorrect');
</script>

<!-- qtype_formulas' wording ("Your answer is correct."); what went wrong only when something did. -->
<div class="pt-part-feedback feedback" data-verdict={verdict.replace(' ', '-')} role="status">
  <div class="specificfeedback"><p>Your answer is {verdict}.</p></div>
  {#if result.fraction < 1}
    <ul class="pt-feedback-details">
      {#if result.error}
        <li class="bad">{result.error.code === 'no-response' ? (messages?.['no-response'] ?? 'No answer given.') : message(result.error.code, messages)}</li>
      {:else}
        <li class={result.valueOk ? 'good' : 'bad'}>{result.valueOk ? 'Value is correct.' : 'Value is not correct.'}</li>
      {/if}
      <li class={result.unitOk ? 'good' : 'bad'}>{result.unitOk ? 'Unit is acceptable.' : 'Unit is missing or wrong.'}</li>
    </ul>
  {/if}
</div>

<style>
  .specificfeedback p {
    margin: 0 0 0.5em;
  }
  .pt-feedback-details {
    margin: 0 0 0.5em;
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
