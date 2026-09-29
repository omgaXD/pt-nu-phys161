<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { isFinished } from '@pt/quiz';
  import { app } from '$lib/app.svelte';
  import QuestionView from '$lib/components/QuestionView.svelte';
  import QuizNav from '$lib/components/QuizNav.svelte';
  import TimeLeft from '$lib/components/TimeLeft.svelte';
  import { presetName } from '$lib/labels';

  const a = $derived(app.attempt);
  const i = $derived(a?.page ?? 0);
  const q = $derived(a?.questions[i]);
  const last = $derived(a ? i === a.questions.length - 1 : true);
  const references = $derived(q ? (app.sets[q.setId]?.references ?? []).filter((r) => r.section === q.section) : []);

  // Nothing in progress (never started, finished elsewhere, or timed out): go back.
  $effect(() => {
    if (!a || isFinished(a)) {
      const id = app.lastFinished?.id;
      void goto(id ? resolve(`/review/?id=${encodeURIComponent(id)}`) : resolve('/'), { replaceState: true });
    }
  });

  // The question on screen always has its snapshot.
  $effect(() => {
    if (a && !a.snapshots[i] && !a.unavailable[i]) app.ensureSnapshot(i);
  });

  function go(page: number): void {
    app.dispatch({ type: 'goto', page });
    window.scrollTo({ top: 0 });
  }
</script>

<svelte:head><title>{a ? presetName(a.preset) : 'Quiz'} (question {i + 1}) · Physics Quiz</title></svelte:head>

{#if a && q}
  <div class="page">
    <main class="page-main">
      <ol class="breadcrumb">
        <li><a href={resolve('/')}>Home</a></li>
        <li>{presetName(a.preset)}</li>
      </ol>
      <div class="page-header">
        <span class="activity-icon" aria-hidden="true">?</span>
        <h1>{presetName(a.preset)}</h1>
      </div>
      <div class="tertiary-navigation">
        <a class="btn btn-secondary" href={resolve('/')}>Back</a>
      </div>
      {#if a.endsAt !== null}
        <TimeLeft endsAt={a.endsAt} onExpire={() => app.dispatch({ type: 'tick', now: Date.now() })} />
      {/if}

      <!-- Enter in the answer field checks it (immediate feedback). -->
      <form
        id="responseform"
        onsubmit={(e) => {
          e.preventDefault();
          if (a.config.feedback === 'immediate') app.dispatch({ type: 'check', index: i, now: Date.now() });
        }}
      >
        <QuestionView
          attempt={a}
          index={i}
          snapshot={a.snapshots[i] ?? null}
          setTitle={app.setTitle(q.setId)}
          resolveSrc={app.resolveSrc(q.setId)}
          {references}
          onanswer={(answer) => app.dispatch({ type: 'answer', index: i, answer })}
          oncheck={() => app.dispatch({ type: 'check', index: i, now: Date.now() })}
          onreveal={() => app.dispatch({ type: 'reveal', index: i, now: Date.now() })}
          onflag={(flagged) => app.dispatch({ type: 'flag', index: i, flagged })}
        />
        <div class="submitbtns">
          {#if i > 0}
            <button type="button" class="btn btn-secondary" onclick={() => go(i - 1)}>Previous page</button>
          {/if}
          {#if last}
            <a class="btn btn-primary next" href={resolve('/attempt/summary/')}>Finish attempt ...</a>
          {:else}
            <button type="button" class="btn btn-primary next" onclick={() => go(i + 1)}>Next page</button>
          {/if}
        </div>
      </form>
    </main>
    <aside class="drawer-right">
      <QuizNav attempt={a} current={i} onSelect={go} setTitle={(id) => app.setTitle(id)}>
        <a href={resolve('/attempt/summary/')}>Finish attempt ...</a>
      </QuizNav>
    </aside>
  </div>
{/if}
