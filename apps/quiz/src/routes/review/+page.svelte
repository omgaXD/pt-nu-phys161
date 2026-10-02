<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { encodeConfig, summarizeAttempt } from '@pt/quiz';
  import { app } from '$lib/app.svelte';
  import Page from '$lib/components/Page.svelte';
  import quizIcon from '$lib/assets/quiz-monologo.svg';
  import QuestionView from '$lib/components/QuestionView.svelte';
  import QuizNav from '$lib/components/QuizNav.svelte';
  import { formatDate, formatDuration, formatMark, presetName } from '$lib/labels';

  const PER_PAGE = 20;
  const id = $derived(page.url.searchParams.get('id') ?? '');
  const a = $derived(id ? app.finished(id) : null);
  const s = $derived(a ? summarizeAttempt(a) : null);
  let reviewPage = $state(0);
  const pages = $derived(a ? Math.ceil(a.questions.length / PER_PAGE) : 0);
  const shown = $derived(a ? a.questions.map((_, i) => i).slice(reviewPage * PER_PAGE, (reviewPage + 1) * PER_PAGE) : []);

  /** Start again: same options, a fresh seed (a new set of numbers). */
  const againQuery = $derived.by(() => {
    if (!a) return '';
    const { seed: _seed, ...config } = a.config;
    return encodeConfig(config).toString();
  });

  function show(i: number): void {
    reviewPage = Math.floor(i / PER_PAGE);
    requestAnimationFrame(() => document.getElementById(`question-${i + 1}`)?.scrollIntoView());
  }
</script>

<svelte:head><title>Review · Physics Quiz</title></svelte:head>

{#if !a || !s}
  <Page narrow>
    <h1>Review</h1>
    <p>This attempt is no longer stored in this browser.</p>
    <a class="btn btn-secondary" href={resolve('/')}>Back to the start page</a>
  </Page>
{:else}
  <Page>
    <ol class="breadcrumb">
      <li><a href={resolve('/')}>Home</a></li>
      <li>{presetName(a.preset)}</li>
      <li>Review</li>
    </ol>
    <div class="page-header">
      <img class="activity-icon" src={quizIcon} alt="" />
      <h1>{presetName(a.preset)}</h1>
    </div>
    {#if app.notice}
      <div class="alert alert-warning" role="status">{app.notice}</div>
    {/if}

    <table class="generaltable quizreviewsummary" data-testid="review-summary">
      <tbody>
        <tr><th scope="row">Started on</th><td>{formatDate(a.startedAt)}</td></tr>
        <tr><th scope="row">State</th><td>Finished{a.finishReason === 'timeout' ? ' (time limit reached)' : ''}</td></tr>
        <tr><th scope="row">Completed on</th><td>{formatDate(a.finishedAt ?? a.startedAt)}</td></tr>
        <tr><th scope="row">Time taken</th><td>{formatDuration(s.durationMs)}</td></tr>
        <tr><th scope="row">Marks</th><td data-testid="marks">{formatMark(s.marks)}/{formatMark(s.total)}</td></tr>
        <tr>
          <th scope="row">Grade</th>
          <td><strong>{formatMark(s.total ? (10 * s.marks) / s.total : 0)}</strong> out of 10.00 ({Math.round(s.percent)}%)</td>
        </tr>
        {#if a.config.feedback === 'immediate'}
          <tr>
            <th scope="row">Details</th>
            <td>
              {s.correct} correct ({s.firstTry} at the first check, {s.afterRetries} after retries), {s.incorrect} incorrect, {s.revealed} answer{s.revealed === 1 ? '' : 's'} shown, {s.unanswered} not answered
            </td>
          </tr>
        {/if}
      </tbody>
    </table>

    {#each shown as i (i)}
      {@const q = a.questions[i]!}
      <QuestionView
        attempt={a}
        index={i}
        snapshot={a.snapshots[i] ?? app.snapshotFor(a, i)}
        review
        setTitle={app.setTitle(q.setId)}
        resolveSrc={app.resolveSrc(q.setId)}
        onflag={(flagged) => app.flagFinished(a.id, i, flagged)}
      />
    {/each}

    {#if pages > 1}
      <nav class="actions" aria-label="Review pages">
        {#each Array.from({ length: pages }, (_, p) => p) as p (p)}
          <button type="button" class="btn btn-sm {p === reviewPage ? 'btn-primary' : 'btn-secondary'}" aria-current={p === reviewPage ? 'page' : undefined} onclick={() => (reviewPage = p)}>
            {p + 1}
          </button>
        {/each}
      </nav>
    {/if}

    <div class="actions" style="margin-top: 1.5rem">
      <a class="btn btn-primary" href={resolve('/')}>Finish review</a>
      <a class="btn btn-secondary" href={resolve(`/?${againQuery}`)}>Start again with the same options</a>
    </div>
    {#snippet blocks()}
      <QuizNav attempt={a} onSelect={show} setTitle={(sid) => app.setTitle(sid)} />
    {/snippet}
  </Page>
{/if}
