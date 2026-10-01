<script lang="ts">
  import Page from '$lib/components/Page.svelte';
  import quizIcon from '$lib/assets/quiz-monologo.svg';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import {
    applyPreset,
    buildPool,
    decodeConfig,
    defaultConfig,
    encodeConfig,
    matchPreset,
    PRESET_IDS,
    type PresetId,
    type QuizConfig,
    QuizConfigSchema,
    randomSeed,
    sectionSlug,
    solvedCount,
  } from '@pt/quiz';
  import { app } from '$lib/app.svelte';
  import { describeConfig, formatDate, formatMark, PRESET_INFO, presetName } from '$lib/labels';

  const index = app.index;
  const allSets = (index?.sets ?? []).map((s) => s.id);

  /** URL (share link) first, then the last configuration used, then Ordered over the first set. */
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
    const saved = QuizConfigSchema.safeParse(app.prefs().config);
    const base = saved.success ? { ...saved.data, sets: saved.data.sets.filter((s) => allSets.includes(s)) } : defaultConfig(allSets.slice(0, 1));
    const config = base.sets.length ? base : { ...base, sets: allSets.slice(0, 1) };
    return { config, linkIssue: decoded && !decoded.ok ? `This link could not be read (${decoded.issues.join('; ')}).` : null };
  }

  const init = initialConfig();
  let config = $state<QuizConfig>(init.config);
  let linkIssue = $state(init.linkIssue);
  let message = $state<string | null>(null);
  let copied = $state(false);

  const preset = $derived(matchPreset(config));
  const pool = $derived(config.sets.length ? buildPool(app.catalog(), config, app.mastery).length : 0);
  const questions = $derived(config.count === 'all' ? pool : Math.min(pool, config.count));
  const inProgress = $derived(app.attempt);

  function choose(p: PresetId): void {
    config = applyPreset(config, p);
  }

  function toggleSet(id: string, on: boolean): void {
    const sets = on ? allSets.filter((s) => s === id || config.sets.includes(s)) : config.sets.filter((s) => s !== id);
    config = { ...config, sets };
  }

  function sectionsOf(setId: string): string[] {
    return index?.sets.find((s) => s.id === setId)?.sections.map((s) => s.id) ?? [];
  }

  function isSectionOn(setId: string, sectionId: string): boolean {
    const chosen = config.sections[setId];
    return !chosen || chosen.length === 0 || chosen.includes(sectionId);
  }

  function toggleSection(setId: string, sectionId: string, on: boolean): void {
    const all = sectionsOf(setId);
    const current = all.filter((s) => isSectionOn(setId, s));
    const next = on ? all.filter((s) => s === sectionId || current.includes(s)) : current.filter((s) => s !== sectionId);
    const sections = { ...config.sections };
    if (next.length === all.length) delete sections[setId];
    else sections[setId] = next;
    config = { ...config, sections };
  }

  function setAllSections(setId: string, on: boolean): void {
    const sections = { ...config.sections };
    if (on) delete sections[setId];
    else sections[setId] = [];
    config = { ...config, sections };
  }

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

<Page narrow>
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

  <h2>Mode</h2>
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
        <details class="sections">
          <summary>Sections ({s.sections.filter((x) => isSectionOn(s.id, x.id)).length} of {s.sections.length})</summary>
          <div class="actions">
            <button type="button" class="link-button" onclick={() => setAllSections(s.id, true)}>All</button>
            <button type="button" class="link-button" onclick={() => setAllSections(s.id, false)}>None</button>
          </div>
          <ul>
            {#each s.sections as sec (sec.id)}
              <li>
                <label>
                  <input type="checkbox" checked={isSectionOn(s.id, sec.id)} onchange={(e) => toggleSection(s.id, sec.id, e.currentTarget.checked)} />
                  {sec.name}
                </label>
                <span class="counts">{sec.questions} · {sec.authored} randomized · {solvedIn(s.id, sec.id)} solved</span>
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
      </div>

      <span class="label" id="opt-values">Numbers</span>
      <div class="choices" role="radiogroup" aria-labelledby="opt-values">
        <label><input type="radio" name="values" checked={config.values === 'random'} onchange={() => (config = { ...config, values: 'random' })} /> Randomized</label>
        <label><input type="radio" name="values" checked={config.values === 'source'} onchange={() => (config = { ...config, values: 'source' })} /> The source's own numbers</label>
      </div>

      <span class="label">Content</span>
      <div class="choices">
        <label><input type="checkbox" checked={config.includeFixed} onchange={(e) => (config = { ...config, includeFixed: e.currentTarget.checked })} /> Include problems not randomized yet</label>
        <label><input type="checkbox" checked={config.skipSolved} onchange={(e) => (config = { ...config, skipSolved: e.currentTarget.checked })} /> Skip problems I have solved</label>
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
      <thead><tr><th>Finished</th><th>Mode</th><th>Sets</th><th>Marks</th><th></th></tr></thead>
      <tbody>
        {#each app.history as h (h.id)}
          <tr>
            <td>{formatDate(h.finishedAt)}{h.finishReason === 'timeout' ? ' (time up)' : ''}</td>
            <td>{presetName(h.preset)}</td>
            <td>{setTitles(h.sets)}</td>
            <td>{formatMark(h.marks)} / {formatMark(h.total)}</td>
            <td>{#if h.full}<a href={resolve(`/review/?id=${encodeURIComponent(h.id)}`)}>Review</a>{/if}</td>
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
