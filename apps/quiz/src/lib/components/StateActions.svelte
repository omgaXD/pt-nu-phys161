<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { matchPreset, parseStateFile, QuizConfigSchema, type QuizStateFile } from '@pt/quiz';
  import { tick } from 'svelte';
  import { app, type ImportChoices } from '$lib/app.svelte';
  import { formatDuration, presetName } from '$lib/labels';
  import { toasts } from '$lib/toasts.svelte';

  interface Props {
    /** After an import that did not resume an attempt (the start page reloads its options). */
    onimported?: (choices: ImportChoices) => void;
  }

  let { onimported }: Props = $props();

  let input = $state<HTMLInputElement>();
  let dialog = $state<HTMLDialogElement>();
  let file = $state.raw<QuizStateFile | null>(null);
  let choices = $state<ImportChoices>({ progress: false, attempt: false, history: false, prefs: false, merge: true });

  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const setTitles = (ids: string[]): string => ids.map((id) => app.setTitle(id).replace(/^PHYS161 /, '')).join(', ');
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

  function exportState(): void {
    const state = app.exportState();
    const url = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pt-quiz-state-${stamp(new Date(state.exportedAt))}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function pick(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // choosing the same file again still fires `change`
    if (!f) return;
    const parsed = parseStateFile(await f.text());
    if (!parsed.ok) {
      toasts.add(parsed.message, 'danger', { closeButton: true });
      return;
    }
    file = parsed.file;
    choices = { progress: !!file.mastery, attempt: attemptImportable, history: !!file.history, prefs: file.prefs !== undefined, merge: true };
    await tick(); // render the choices first, so the dialog focuses the first one
    dialog?.showModal();
  }

  function apply(): void {
    if (!file) return;
    const taken = { ...choices };
    const { resumed } = app.importState(file, taken);
    dialog?.close();
    file = null;
    toasts.add('The saved state was imported.');
    if (resumed) void goto(resolve('/attempt/'));
    else onimported?.(taken);
  }

  /** The file's quiz was finished in this browser since (an older export of it): it stays finished. */
  const finishedHere = $derived(!!file?.attempt && app.history.some((h) => h.id === file?.attempt?.id));
  const attemptImportable = $derived(!!file?.attempt && !finishedHere);

  const progress = $derived.by(() => {
    const m = Object.values(file?.mastery ?? {});
    return `${plural(m.filter((e) => e.solved).length, 'problem')} solved, ${m.length} tried`;
  });

  const attempt = $derived.by(() => {
    const a = file?.attempt;
    if (!a) return '';
    const answered = a.answers.filter((x) => x.value.trim() !== '').length;
    const left = a.endsAt !== null && file ? `, ${formatDuration(Math.max(0, a.endsAt - file.exportedAt))} left` : '';
    return `${presetName(a.preset)} — ${setTitles(a.config.sets)}: on question ${a.page + 1} of ${a.questions.length}, ${answered} answered${left}`;
  });

  const history = $derived.by(() => {
    const h = file?.history;
    if (!h) return '';
    return `${plural(h.entries.length, 'attempt')} (${h.attempts.length} with review)`;
  });

  const prefs = $derived.by(() => {
    const config = QuizConfigSchema.safeParse((file?.prefs as { config?: unknown } | undefined)?.config);
    return config.success ? `${presetName(matchPreset(config.data))} — ${setTitles(config.data.sets)}` : 'The last options used';
  });

  const nothing = $derived(!choices.progress && !choices.attempt && !choices.history && !choices.prefs);
  const contentChanged = $derived(!!file?.contentVersion && !!app.index && file.contentVersion !== app.index.version);
</script>

<!-- Leaves of Moodle's course index (li.courseindex-item > .completioninfo + a.courseindex-link),
     holding app-wide actions instead of course links. -->
<nav class="courseindex" aria-label="Saved state">
  <ul class="courseindex-sectioncontent unlist">
    <li class="courseindex-item d-flex">
      <span class="completioninfo"></span>
      <button type="button" class="courseindex-link text-truncate" onclick={exportState}>Export state</button>
    </li>
    <li class="courseindex-item d-flex">
      <span class="completioninfo"></span>
      <button type="button" class="courseindex-link text-truncate" onclick={() => input?.click()}>Import state</button>
    </li>
  </ul>
</nav>
<input bind:this={input} type="file" accept=".json,application/json" hidden aria-label="Saved state file" onchange={pick} />

<dialog bind:this={dialog} aria-labelledby="import-title" onclose={() => (file = null)}>
  {#if file}
    <h2 id="import-title">Import saved state</h2>
    <p>Saved {new Date(file.exportedAt).toLocaleString()}. Choose what to take from the file:</p>
    <ul class="import-choices">
      <li>
        <label><input type="checkbox" bind:checked={choices.progress} disabled={!file.mastery} /> Problem progress</label>
        <span class="counts">{file.mastery ? progress : 'Not in this file.'}</span>
      </li>
      <li>
        <label><input type="checkbox" bind:checked={choices.attempt} disabled={!attemptImportable} /> Current quiz</label>
        <span class="counts">
          {#if !file.attempt}
            Not in this file.
          {:else}
            {attempt}.
            {#if finishedHere}<br />Already finished in this browser, so it stays finished.
            {:else if app.attempt}<br /><strong>Replaces the attempt in progress in this browser.</strong>{/if}
          {/if}
        </span>
      </li>
      <li>
        <label><input type="checkbox" bind:checked={choices.history} disabled={!file.history} /> Finished attempts</label>
        <span class="counts">{file.history ? history : 'Not in this file.'}</span>
      </li>
      <li>
        <label><input type="checkbox" bind:checked={choices.prefs} disabled={file.prefs === undefined} /> Start-page settings</label>
        <span class="counts">{file.prefs !== undefined ? prefs : 'Not in this file.'}</span>
      </li>
    </ul>
    <label class="merge">
      <input type="checkbox" bind:checked={choices.merge} disabled={!choices.progress && !choices.history} /> Keep progress already in this browser
    </label>
    <p class="counts">
      {choices.merge
        ? 'Problems solved and attempts finished here are kept alongside the ones in the file.'
        : "The file's problem progress and finished attempts replace this browser's."}
    </p>
    {#if contentChanged}
      <p class="muted">The problems have changed since this file was saved. Questions already shown keep their numbers.</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn btn-secondary" onclick={() => dialog?.close()}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={apply} disabled={nothing}>Import</button>
    </div>
  {/if}
</dialog>
