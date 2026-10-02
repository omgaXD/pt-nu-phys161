<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { isFinished, questionMark, questionState } from '@pt/quiz';
  import { app } from '$lib/app.svelte';
  import quizIcon from '$lib/assets/quiz-monologo.svg';
  import Page from '$lib/components/Page.svelte';
  import QuizNav from '$lib/components/QuizNav.svelte';
  import TimeLeft from '$lib/components/TimeLeft.svelte';
  import { formatMark, presetName, STATE_TEXT } from '$lib/labels';

  const a = $derived(app.attempt);
  let dialog = $state<HTMLDialogElement>();

  const unanswered = $derived(a ? a.questions.filter((_, i) => questionState(a, i) === 'notyetanswered').length : 0);

  $effect(() => {
    if (!a || isFinished(a)) {
      const id = app.lastFinished?.id;
      void goto(id ? resolve(`/review/?id=${encodeURIComponent(id)}`) : resolve('/'), { replaceState: true });
    }
  });

  function open(i: number): void {
    app.dispatch({ type: 'goto', page: i });
    void goto(resolve('/attempt/'));
  }

  function submit(): void {
    dialog?.close();
    app.dispatch({ type: 'finish', now: Date.now(), reason: 'submitted' });
    // The effect above navigates to the review once the attempt is finished.
  }
</script>

<svelte:head><title>Summary of attempt · Physics Quiz</title></svelte:head>

{#if a}
  <Page>
    <ol class="breadcrumb">
      <li><a href={resolve('/')}>Home</a></li>
      <li>{presetName(a.preset)}</li>
    </ol>
    <div class="page-header">
      <img class="activity-icon" src={quizIcon} alt="" />
      <h1>{presetName(a.preset)}</h1>
    </div>
    {#if a.endsAt !== null}
      <TimeLeft endsAt={a.endsAt} onExpire={() => app.dispatch({ type: 'tick', now: Date.now() })} />
    {/if}
    <h2>Summary of attempt</h2>
    <table class="generaltable quizsummaryofattempt" data-testid="attempt-summary">
      <thead>
        <tr>
          <th scope="col">Question</th>
          <th scope="col">Status</th>
          {#if a.config.feedback === 'immediate'}<th scope="col">Marks</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each a.questions as q, i (q.key)}
          {@const state = questionState(a, i)}
          <tr>
            <td>
              <button type="button" class="link-button" onclick={() => open(i)}>{i + 1}</button>
              {#if a.flagged[i]}<span class="muted" title="Flagged"> ⚑</span>{/if}
            </td>
            <td>{STATE_TEXT[state]}</td>
            {#if a.config.feedback === 'immediate'}
              {@const mark = questionMark(a, i)}
              <td>{mark === null ? '' : formatMark(mark)}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="actions">
      <a class="btn btn-secondary" href={resolve('/attempt/')}>Return to attempt</a>
    </div>
    {#if a.endsAt !== null}
      <p class="muted">This attempt must be submitted by {new Date(a.endsAt).toLocaleTimeString()}.</p>
    {/if}
    <div class="actions" style="margin-top: 1rem">
      <button type="button" class="btn btn-primary" onclick={() => dialog?.showModal()}>Submit all and finish</button>
    </div>

    <dialog bind:this={dialog} aria-labelledby="confirm-title">
      <h2 id="confirm-title">Submit all your answers and finish?</h2>
      <p>Once you submit your answers, you won't be able to change them.</p>
      {#if unanswered > 0}<p><strong>Questions without a response: {unanswered}</strong></p>{/if}
      <div class="actions">
        <button type="button" class="btn btn-secondary" onclick={() => dialog?.close()}>Cancel</button>
        <button type="button" class="btn btn-primary" onclick={submit}>Submit all and finish</button>
      </div>
    </dialog>
    {#snippet blocks()}
      <QuizNav attempt={a} onSelect={open} setTitle={(id) => app.setTitle(id)} />
    {/snippet}
  </Page>
{/if}
