<script lang="ts">
  import type { FieldContents } from '@pt/core';
  import { type Attempt, isLocked, type QuestionSnapshot, questionState, type SectionReference, triesLeft } from '@pt/quiz';
  import { DifficultyDots, FlagToggle, PartFeedback, ProblemBody, QuestionCard } from '@pt/ui';
  import { formatMark, STATE_TEXT } from '$lib/labels';

  interface Props {
    attempt: Attempt;
    index: number;
    /** What was shown (or, in review of an unseen question, rebuilt from content). */
    snapshot: QuestionSnapshot | null;
    review?: boolean;
    setTitle: string;
    resolveSrc: (src: string) => string;
    references?: SectionReference[];
    onanswer?: (answer: FieldContents) => void;
    oncheck?: () => void;
    onreveal?: () => void;
    onflag?: (flagged: boolean) => void;
  }

  let { attempt, index, snapshot, review = false, setTitle, resolveSrc, references = [], onanswer, oncheck, onreveal, onflag }: Props = $props();

  const q = $derived(attempt.questions[index]!);
  const state = $derived(questionState(attempt, index));
  const answer = $derived(attempt.answers[index] ?? { value: '', unit: '' });
  const partId = $derived(snapshot?.instance.parts[0]?.partId ?? q.partId);
  const locked = $derived(review || isLocked(attempt, index));
  const immediate = $derived(attempt.config.feedback === 'immediate');
  const last = $derived(attempt.checks[index]?.at(-1));
  const checkedNow = $derived(last !== undefined && last.answer.value.trim() === answer.value.trim() && last.answer.unit.trim() === answer.unit.trim());
  const tries = $derived(triesLeft(attempt, index));
  const blank = $derived(answer.value.trim() === '' && answer.unit.trim() === '');
  const flagged = $derived(attempt.flagged[index] ?? false);
  /** Difficulty stays internal until the question is settled: in review, or locked with immediate feedback (solved, shown, out of tries). */
  const difficulty = $derived(
    q.difficulty !== undefined && snapshot && !attempt.unavailable[index] && (review || (immediate && isLocked(attempt, index))) ? q.difficulty : undefined,
  );

  /** What the outcome box shows. */
  const outcome = $derived.by(() => {
    if (review) return { result: attempt.final[index] ?? null, showAnswer: true };
    if (!immediate) return null;
    if (attempt.revealed[index]) return { result: null, showAnswer: true };
    if (!checkedNow || !last) return null;
    return { result: last.result, showAnswer: locked, tryAgain: !locked && last.result.fraction < 1 };
  });

  /** The mark beside the field and "One possible correct answer is", inside the question box (qtype_formulas). */
  const partOutcomes = $derived(
    outcome ? { [partId]: { fraction: outcome.result?.fraction ?? (state === 'notanswered' ? 0 : undefined), showAnswer: outcome.showAnswer } } : {},
  );
  /** The yellow box below holds the verdict; a shown answer alone leaves it out. */
  const hasFeedback = $derived(!!outcome && (!!outcome.result || state === 'notanswered' || state === 'unavailable'));

  const gradeText = $derived(review ? `Mark ${formatMark(attempt.marks[index] ?? 0)} out of 1.00` : 'Marked out of 1.00');
</script>

{#snippet controls()}
  <span class="im-controls">
    <button type="button" class="btn btn-secondary" onclick={() => oncheck?.()} disabled={blank || checkedNow}>Check</button>
    {#if attempt.config.allowReveal}
      <button type="button" class="btn btn-outline-secondary" onclick={() => onreveal?.()}>Show correct answer</button>
    {/if}
    {#if tries !== null}
      <span class="tries">{tries} {tries === 1 ? 'try' : 'tries'} left</span>
    {/if}
  </span>
{/snippet}

{#snippet outcomeBox()}
  {#if outcome?.result}
    <PartFeedback result={outcome.result} />
  {:else if state === 'notanswered'}
    <!-- Moodle grades a blank answer like a wrong one. -->
    <div class="feedback"><div class="specificfeedback"><p>Your answer is incorrect.</p></div></div>
  {:else if state === 'unavailable'}
    <p class="muted">No answer was given.</p>
  {/if}
  {#if outcome && 'tryAgain' in outcome && outcome.tryAgain}
    <p>Please try again.</p>
  {/if}
{/snippet}

<div id="question-{index + 1}">
  <QuestionCard state="{state}{immediate ? ' interactive' : ' deferredfeedback'}" footer={hasFeedback ? outcomeBox : undefined}>
    {#snippet header()}
      <h3 class="no">Question <span class="qno">{index + 1}</span></h3>
      <div class="state">{STATE_TEXT[state]}</div>
      <div class="grade">{gradeText}</div>
      {#if !review}
        <FlagToggle {flagged} label={flagged ? 'Remove flag' : 'Flag question'} onchange={(f) => onflag?.(f)} />
      {/if}
      {#if immediate || review}
        <div class="source">{setTitle} · {q.label}{snapshot?.sourceValues ? ' · source values' : ''}</div>
      {/if}
      {#if difficulty !== undefined}
        <div class="difficulty">Difficulty <DifficultyDots level={difficulty} /></div>
      {/if}
    {/snippet}

    {#if snapshot}
      <ProblemBody
        instance={snapshot.instance}
        answers={{ [partId]: answer }}
        onanswer={(_, a) => onanswer?.(a)}
        disabled={locked}
        {resolveSrc}
        controls={immediate && !review && !locked ? controls : undefined}
        outcomes={partOutcomes}
      />
      {#each references as r (r.src)}
        <details class="reference-link">
          <summary>Reference sheet: {r.section}</summary>
          <div class="reference-figure"><img src={resolveSrc(r.src)} alt={r.alt} /></div>
        </details>
      {/each}
    {:else}
      <p>This question is no longer available: its problem was removed from the content.</p>
    {/if}
  </QuestionCard>
</div>
