<script lang="ts">
  import Page from '$lib/components/Page.svelte';
  import ProblemGrid, { type PickerProblem } from '$lib/components/ProblemGrid.svelte';
  import quizIcon from '$lib/assets/quiz-monologo.svg';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import {
    applyPreset,
    buildPool,
    type CatalogQuestion,
    decodeConfig,
    defaultConfig,
    difficultyFilter,
    encodeConfig,
    isProblemOn,
    leaveOutSolved,
    matchPreset,
    PRESET_IDS,
    type PresetId,
    type QuizConfig,
    QuizConfigSchema,
    randomSeed,
    sectionSelection,
    sectionSlug,
    setAllSections,
    solvedCount,
    solvedSelected,
    toggleProblem,
    toggleSection,
  } from '@pt/quiz';
  import type { DifficultyLevel } from '@pt/core';
  import { DEFAULT_DIFFICULTY_NAMES } from '@pt/ui';
  import { app } from '$lib/app.svelte';
  import { describeConfig, formatDate, formatMark, PRESET_INFO, presetName } from '$lib/labels';

  const index = app.index;
  const allSets = (index?.sets ?? []).map((s) => s.id);
  const sectionsOf = (setId: string): string[] => index?.sets.find((s) => s.id === setId)?.sections.map((s) => s.id) ?? [];
  const questionsOf = (setId: string): CatalogQuestion[] => [...(app.sets[setId]?.questions ?? [])];

  /** Leave out the solved problems of these sets. */
  function withoutSolved(c: QuizConfig, setIds: readonly string[]): QuizConfig {
    return setIds.reduce((acc, id) => leaveOutSolved(acc, sectionsOf(id), questionsOf(id), app.mastery), c);
  }

  /** The last configuration used, else Practice over the first set. */
  function savedConfig(): QuizConfig {
    const raw = app.prefs().config;
    const saved = QuizConfigSchema.safeParse(raw);
    // Older versions also remembered the seed, which kept repeating the same questions and numbers.
    const { seed: _seed, ...data } = saved.success ? saved.data : defaultConfig(allSets.slice(0, 1));
    const base = { ...data, sets: data.sets.filter((s) => allSets.includes(s)) };
    const c = base.sets.length ? base : { ...base, sets: allSets.slice(0, 1) };
    // Older versions had a "Skip problems I have solved" option: those problems are left out instead.
    return saved.success && (raw as { skipSolved?: unknown }).skipSolved === true ? withoutSolved(c, c.sets) : c;
  }

  /** URL (share link) first, then the last configuration used. */
  function initialConfig(): { config: QuizConfig; linkIssue: string | null } {
    const decoded = decodeConfig(page.url.searchParams);
    if (decoded?.ok) {
      const sets = decoded.config.sets.filter((s) => allSets.includes(s));
      const stale = decoded.contentVersion !== undefined && decoded.contentVersion !== index?.version;
      return {
        config: { ...decoded.config, sets: sets.length ? sets : allSets.slice(0, 1) },
        linkIssue: stale ? 'The content changed since this link was made, so the questions may differ.' : null,
      };
    }
    return { config: savedConfig(), linkIssue: decoded && !decoded.ok ? `This link could not be read (${decoded.issues.join('; ')}).` : null };
  }

  const init = initialConfig();
  let config = $state<QuizConfig>(init.config);
  let linkIssue = $state(init.linkIssue);
  let message = $state<string | null>(null);
  let copied = $state(false);

  const preset = $derived(matchPreset(config));
  const pool = $derived(config.sets.length ? buildPool(app.catalog(), config).length : 0);
  const questions = $derived(config.count === 'all' ? pool : Math.min(pool, config.count));
  const inProgress = $derived(app.attempt);

  function choose(p: PresetId): void {
    config = applyPreset(config, p);
  }

  function toggleSet(id: string, on: boolean): void {
    const sets = on ? allSets.filter((s) => s === id || config.sets.includes(s)) : config.sets.filter((s) => s !== id);
    config = { ...config, sets };
  }

  const LEVELS: DifficultyLevel[] = [1, 2, 3, 4, 5];
  const BY_DIFFICULTY_HINT = 'Shuffled within each difficulty level. Problems without a difficulty come last.';
  const range = $derived(config.difficulty ?? { min: 1 as DifficultyLevel, max: 5 as DifficultyLevel, unrated: false });

  /** Set the difficulty range; the full range is stored as no filter. A bound crossing the other moves it along. */
  function setDifficulty(change: { min?: DifficultyLevel; max?: DifficultyLevel; unrated?: boolean }): void {
    let { min, max, unrated } = { ...range, ...change };
    if (change.min !== undefined && min > max) max = min;
    if (change.max !== undefined && max < min) min = max;
    const { difficulty: _drop, ...rest } = config;
    config = min === 1 && max === 5 ? rest : { ...rest, difficulty: { min, max, unrated } };
  }

  /** Expanded sections (`setId/sectionId`), showing their problems. */
  let expanded = $state<Record<string, boolean>>({});

  function pickSection(setId: string, sectionId: string, on: boolean): void {
    config = toggleSection(config, setId, sectionId, on, sectionsOf(setId), questionsOf(setId));
  }

  function pickProblem(q: CatalogQuestion, on: boolean): void {
    config = toggleProblem(config, q, on, sectionsOf(q.setId), questionsOf(q.setId));
  }

  function problemsIn(setId: string, sectionId: string): PickerProblem[] {
    return questionsOf(setId)
      .filter((q) => sectionSlug(q.section) === sectionId)
      .map((q) => {
        const solved = app.mastery[q.key]?.solved ?? false;
        const blocked = !config.includeFixed && q.kind === 'fixed';
        return { q, on: isProblemOn(config, q), solved, ...(blocked && { blockedBy: 'fixed' as const }) };
      });
  }

  /** Sets a checkbox's mixed state (a property, not an attribute). */
  const indeterminate = (mixed: boolean) => (el: HTMLInputElement) => {
    el.indeterminate = mixed;
  };

  function solvedIn(setId: string, sectionId?: string): number {
    const qs = app.sets[setId]?.questions ?? [];
    return solvedCount(
      app.mastery,
      qs.filter((q) => sectionId === undefined || sectionSlug(q.section) === sectionId).map((q) => q.key),
    );
  }

  function start(): void {
    message = null;
    if (inProgress && !confirm('You have an attempt in progress. Starting a new one abandons it. Continue?')) return;
    const r = app.start(config);
    if (!r.ok) {
      message = r.message;
      return;
    }
    void goto(resolve('/attempt/'));
  }

  async function copyLink(): Promise<void> {
    const withSeed = { ...config, seed: config.seed ?? randomSeed() };
    config = withSeed;
    const url = new URL(`${resolve('/')}?${encodeConfig(withSeed, index?.version).toString()}`, window.location.origin);
    try {
      await navigator.clipboard.writeText(url.href);
    } catch {
      window.prompt('Copy this link:', url.href);
    }
    history.replaceState(history.state, '', url.href);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  const setTitles = (ids: string[]): string => ids.map((id) => app.setTitle(id).replace(/^PHYS161 /, '')).join(', ');
  const setsCount = $derived(config.sets.length);
</script>

<svelte:head><title>Start a quiz · Physics Quiz</title></svelte:head>

<Page narrow onimported={(c) => c.prefs && (config = savedConfig())}>
  <ol class="breadcrumb"><li>Home</li></ol>
  <div class="page-header">
    <img class="activity-icon" src={quizIcon} alt="" />
    <h1>Start a quiz</h1>
  </div>

  {#if app.notice}
    <div class="alert alert-warning" role="status">{app.notice}</div>
  {/if}
  {#if linkIssue}
    <div class="alert alert-warning" role="status">{linkIssue}</div>
  {/if}

  {#if inProgress}
    <div class="alert alert-info" data-testid="resume">
      <strong>Attempt in progress:</strong>
      {presetName(inProgress.preset)} — {setTitles(inProgress.config.sets)}, started {formatDate(inProgress.startedAt)},
      {inProgress.answers.filter((a) => a.value.trim() !== '').length} of {inProgress.questions.length} answered.
      <div class="actions" style="margin-top: 0.5rem">
        <a class="btn btn-primary" href={resolve('/attempt/')}>Continue the last attempt</a>
        <button type="button" class="btn btn-secondary" onclick={() => app.abandon()}>Abandon it</button>
      </div>
    </div>
  {/if}

  <h2>Preset</h2>
  <div class="presets" role="group" aria-label="Presets">
    {#each PRESET_IDS as id (id)}
      <button type="button" class="preset" aria-pressed={preset === id} onclick={() => choose(id)} data-preset={id}>
        <strong>{PRESET_INFO[id].name}</strong>
        <span>{PRESET_INFO[id].blurb}</span>
      </button>
    {/each}
  </div>
  <p class="muted" data-testid="preset-state">
    {#if preset === 'custom'}<span class="custom-chip">Custom</span> The options below differ from every preset.{:else}Preset: {PRESET_INFO[preset].name}. Change any option below to customise it.{/if}
  </p>

  <h2>Problems</h2>
  <fieldset>
    <legend>Sets</legend>
    {#each index?.sets ?? [] as s (s.id)}
      {@const on = config.sets.includes(s.id)}
      <div class="set-row">
        <label><input type="checkbox" checked={on} onchange={(e) => toggleSet(s.id, e.currentTarget.checked)} /> {s.title}</label>
        <span class="counts">
          {s.questions} problems · {s.authored} randomized · {s.fixed} with source values{s.missing ? ` · ${s.missing} not playable` : ''} · {solvedIn(s.id)} solved
        </span>
      </div>
      {#if on}
        {@const qs = questionsOf(s.id)}
        {@const picked = s.sections.map((sec) => sectionSelection(config, s.id, sec.id, qs))}
        {@const solved = solvedSelected(config, qs, app.mastery).length}
        <details class="sections">
          <summary>
            Sections ({picked.filter((p) => p.state !== 'none').length} of {s.sections.length} · {picked.reduce((n, p) => n + p.selected, 0)} of {qs.length} problems)
          </summary>
          <div class="actions">
            <button type="button" class="link-button" onclick={() => (config = setAllSections(config, s.id, true))}>All</button>
            <button type="button" class="link-button" onclick={() => (config = setAllSections(config, s.id, false))}>None</button>
            <button type="button" class="link-button" disabled={solved === 0} onclick={() => (config = withoutSolved(config, [s.id]))}>Leave out solved ({solved})</button>
          </div>
          <ul class="section-tree">
            {#each s.sections as sec, i (sec.id)}
              {@const sel = picked[i]!}
              {@const key = `${s.id}/${sec.id}`}
              {@const open = expanded[key] ?? false}
              <li>
                <div class="section-row">
                  <button
                    type="button"
                    class="chevron"
                    aria-expanded={open}
                    aria-controls="problems-{s.id}-{sec.id}"
                    title={open ? 'Collapse' : 'Expand'}
                    onclick={() => (expanded[key] = !open)}
                  >
                    <span class="pt-sr-only">{open ? 'Collapse' : 'Expand'} {sec.name}</span>
                  </button>
                  <div>
                    <label>
                      <input
                        type="checkbox"
                        checked={sel.state === 'all'}
                        {@attach indeterminate(sel.state === 'some')}
                        onchange={(e) => pickSection(s.id, sec.id, e.currentTarget.checked)}
                      />
                      {sec.name}
                    </label>
                    <span class="counts">
                      {sel.state === 'some' ? `${sel.selected} of ${sel.total}` : sel.total} · {sec.authored} randomized · {solvedIn(s.id, sec.id)} solved
                    </span>
                  </div>
                </div>
                {#if open}
                  <ProblemGrid id="problems-{s.id}-{sec.id}" label="Problems in {sec.name}" problems={problemsIn(s.id, sec.id)} ontoggle={pickProblem} />
                {/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    {/each}
  </fieldset>

  <h2>Options</h2>
  <fieldset>
    <legend>How the quiz runs</legend>
    <div class="options">
      <span class="label" id="opt-count">Questions</span>
      <div class="choices" role="radiogroup" aria-labelledby="opt-count">
        <label><input type="radio" name="count" checked={config.count === 'all'} onchange={() => (config = { ...config, count: 'all' })} /> All selected problems</label>
        <label>
          <input type="radio" name="count" checked={config.count !== 'all'} onchange={() => (config = { ...config, count: 7 })} /> A sample of
        </label>
        <input
          class="form-control"
          type="number"
          min="1"
          max="1000"
          aria-label="Number of questions"
          disabled={config.count === 'all'}
          value={config.count === 'all' ? 7 : config.count}
          onchange={(e) => (config = { ...config, count: Math.max(1, Math.min(1000, Math.round(Number(e.currentTarget.value) || 1))) })}
        />
      </div>

      {#if config.count !== 'all'}
        <label class="label" for="opt-draw">Spread</label>
        <div class="choices">
          <select id="opt-draw" class="form-select" value={config.draw} onchange={(e) => (config = { ...config, draw: e.currentTarget.value as QuizConfig['draw'] })}>
            <option value="sections">Across sections (one per section, then repeat)</option>
            <option value="sets">Across sets</option>
            <option value="uniform">Uniformly over all problems</option>
          </select>
          <span class="hint">Variants of the same situation are never drawn together.</span>
        </div>
      {/if}

      <span class="label" id="opt-order">Order</span>
      <div class="choices" role="radiogroup" aria-labelledby="opt-order">
        <label><input type="radio" name="order" checked={config.order === 'source'} onchange={() => (config = { ...config, order: 'source' })} /> As in the source</label>
        <label><input type="radio" name="order" checked={config.order === 'shuffled'} onchange={() => (config = { ...config, order: 'shuffled' })} /> Shuffled</label>
        <label class="pt-tooltip" data-tooltip={BY_DIFFICULTY_HINT}>
          <input type="radio" name="order" aria-describedby="order-difficulty-hint" checked={config.order === 'easy-first'} onchange={() => (config = { ...config, order: 'easy-first' })} /> Easy to hard
        </label>
        <label class="pt-tooltip" data-tooltip={BY_DIFFICULTY_HINT}>
          <input type="radio" name="order" aria-describedby="order-difficulty-hint" checked={config.order === 'hard-first'} onchange={() => (config = { ...config, order: 'hard-first' })} /> Hard to easy
        </label>
        <span id="order-difficulty-hint" class="pt-sr-only">{BY_DIFFICULTY_HINT}</span>
      </div>

      <span class="label" id="opt-values">Numbers</span>
      <div class="choices" role="radiogroup" aria-labelledby="opt-values">
        <label><input type="radio" name="values" checked={config.values === 'random'} onchange={() => (config = { ...config, values: 'random' })} /> Randomized</label>
        <label><input type="radio" name="values" checked={config.values === 'source'} onchange={() => (config = { ...config, values: 'source' })} /> The source's own numbers</label>
      </div>

      <span class="label">Content</span>
      <div class="choices">
        <label><input type="checkbox" checked={config.includeFixed} onchange={(e) => (config = { ...config, includeFixed: e.currentTarget.checked })} /> Include problems not randomized yet</label>
      </div>

      <span class="label" id="opt-difficulty">Difficulty</span>
      <div class="choices" role="group" aria-labelledby="opt-difficulty">
        <label>
          from
          <select class="form-select" aria-label="Lowest difficulty" value={String(range.min)} onchange={(e) => setDifficulty({ min: Number(e.currentTarget.value) as DifficultyLevel })}>
            {#each LEVELS as d (d)}<option value={String(d)}>{d} · {DEFAULT_DIFFICULTY_NAMES[d]}</option>{/each}
          </select>
        </label>
        <label>
          to
          <select class="form-select" aria-label="Highest difficulty" value={String(range.max)} onchange={(e) => setDifficulty({ max: Number(e.currentTarget.value) as DifficultyLevel })}>
            {#each LEVELS as d (d)}<option value={String(d)}>{d} · {DEFAULT_DIFFICULTY_NAMES[d]}</option>{/each}
          </select>
        </label>
        {#if difficultyFilter(config.difficulty)}
          <label>
            <input type="checkbox" checked={range.unrated} onchange={(e) => setDifficulty({ unrated: e.currentTarget.checked })} /> Include problems without a difficulty (not randomized yet)
          </label>
        {/if}
      </div>

      <span class="label" id="opt-feedback">Feedback</span>
      <div class="choices" role="radiogroup" aria-labelledby="opt-feedback">
        <label><input type="radio" name="feedback" checked={config.feedback === 'immediate'} onchange={() => (config = { ...config, feedback: 'immediate' })} /> Check each answer</label>
        <label><input type="radio" name="feedback" checked={config.feedback === 'deferred'} onchange={() => (config = { ...config, feedback: 'deferred' })} /> Only after finishing</label>
      </div>

      {#if config.feedback === 'immediate'}
        <span class="label">Tries</span>
        <div class="choices">
          <label>
            <input type="checkbox" checked={config.maxTries === null} onchange={(e) => (config = { ...config, maxTries: e.currentTarget.checked ? null : 3 })} /> Unlimited
          </label>
          {#if config.maxTries !== null}
            <input
              class="form-control"
              type="number"
              min="1"
              max="99"
              aria-label="Tries per question"
              value={config.maxTries}
              onchange={(e) => (config = { ...config, maxTries: Math.max(1, Math.min(99, Math.round(Number(e.currentTarget.value) || 1))) })}
            />
          {/if}
          <label><input type="checkbox" checked={config.allowReveal} onchange={(e) => (config = { ...config, allowReveal: e.currentTarget.checked })} /> "Show correct answer" button</label>
        </div>
      {/if}

      <span class="label">Time limit</span>
      <div class="choices">
        <label>
          <input
            type="checkbox"
            checked={config.timeLimitMinutes !== null}
            onchange={(e) => (config = { ...config, timeLimitMinutes: e.currentTarget.checked ? 40 : null })}
          /> Enable
        </label>
        {#if config.timeLimitMinutes !== null}
          <input
            class="form-control"
            type="number"
            min="1"
            max="600"
            aria-label="Time limit in minutes"
            value={config.timeLimitMinutes}
            onchange={(e) => (config = { ...config, timeLimitMinutes: Math.max(1, Math.min(600, Math.round(Number(e.currentTarget.value) || 1))) })}
          /> minutes
        {/if}
      </div>

      <label class="label" for="opt-seed">Seed</label>
      <div class="choices">
        <input
          id="opt-seed"
          class="form-control"
          type="number"
          min="0"
          placeholder="random"
          value={config.seed ?? ''}
          onchange={(e) => {
            const v = e.currentTarget.value.trim();
            const { seed: _drop, ...rest } = config;
            config = v === '' ? rest : { ...rest, seed: Math.max(0, Math.min(0xffff_ffff, Math.round(Number(v)) || 0)) };
          }}
        />
        <span class="hint">Same seed and options, same questions and numbers (share links carry it).</span>
      </div>
    </div>
  </fieldset>

  <div class="start-summary" data-testid="summary">
    {#if setsCount === 0}
      Select at least one set.
    {:else}
      <strong>{presetName(preset)}:</strong> {describeConfig(config, questions)} — from {pool} matching problem{pool === 1 ? '' : 's'}.
      {#if config.count !== 'all' && pool < config.count}<br /><span class="muted">Only {pool} problems match, so the quiz will be shorter.</span>{/if}
    {/if}
  </div>
  {#if message}<div class="alert alert-danger" role="alert">{message}</div>{/if}
  <div class="actions">
    <button type="button" class="btn btn-primary" onclick={start} disabled={setsCount === 0 || pool === 0}>Start attempt</button>
    <button type="button" class="btn btn-secondary" onclick={copyLink} disabled={setsCount === 0}>{copied ? 'Link copied' : 'Copy link'}</button>
  </div>

  <h2>Previous attempts</h2>
  {#if app.history.length === 0}
    <p class="muted">No finished attempts yet.</p>
  {:else}
    <table class="generaltable" data-testid="history">
      <thead><tr><th>Finished</th><th>Preset</th><th>Sets</th><th>Marks</th><th></th></tr></thead>
      <tbody>
        {#each app.history as h (h.id)}
          <tr>
            <td>{formatDate(h.finishedAt)}{h.finishReason === 'timeout' ? ' (time up)' : ''}</td>
            <td>{presetName(h.preset)}</td>
            <td>{setTitles(h.sets)}</td>
            <td>{formatMark(h.marks)} / {formatMark(h.total)}</td>
            <td>{#if h.full && app.reviewable(h.id)}<a href={resolve(`/review/?id=${encodeURIComponent(h.id)}`)}>Review</a>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <div class="actions">
    {#if app.history.length > 0}
      <button type="button" class="btn btn-secondary btn-sm" onclick={() => confirm('Delete every finished attempt?') && app.clearHistory()}>Clear history</button>
    {/if}
    {#if Object.keys(app.mastery).length > 0}
      <button type="button" class="btn btn-secondary btn-sm" onclick={() => confirm('Forget which problems you have solved?') && app.resetMastery()}>Reset solved problems</button>
    {/if}
  </div>
</Page>
