<script lang="ts">
  import { type Attempt, questionState } from '@pt/quiz';
  import { NavGrid, type NavItem } from '@pt/ui';
  import type { Snippet } from 'svelte';
  import { navState, STATE_TEXT } from '$lib/labels';

  interface Props {
    attempt: Attempt;
    /** Index of the question on screen. */
    current?: number;
    onSelect: (index: number) => void;
    /** Heading of the block. */
    title?: string;
    setTitle: (setId: string) => string;
    /** Links under the grid ("Finish attempt ..."). */
    children?: Snippet;
  }

  let { attempt, current, onSelect, title = 'Quiz navigation', setTitle, children }: Props = $props();

  const items = $derived(
    attempt.questions.map((_, i): NavItem => {
      const state = questionState(attempt, i);
      return {
        id: String(i),
        label: String(i + 1),
        ...navState(state),
        flagged: attempt.flagged[i] ?? false,
        current: i === current,
        title: `Question ${i + 1} - ${STATE_TEXT[state]}`,
      };
    }),
  );

  /**
   * Long practice runs in source order are grouped by set and section, so a
   * 150-question grid stays navigable. Shuffled or short attempts: one grid.
   */
  const groups = $derived.by(() => {
    if (attempt.questions.length <= 30 || attempt.config.order !== 'source') return [{ name: '', items }];
    const out: { name: string; items: NavItem[] }[] = [];
    attempt.questions.forEach((q, i) => {
      const name = `${attempt.config.sets.length > 1 ? `${setTitle(q.setId)} · ` : ''}${q.section ?? 'Other'}`;
      const last = out.at(-1);
      if (last?.name === name) last.items.push(items[i]!);
      else out.push({ name, items: [items[i]!] });
    });
    return out;
  });
</script>

<!-- Moodle's #mod_quiz_navblock: .card-body > h3.h5.card-title.d-inline + .card-text.content.mt-3. -->
<section class="block" aria-labelledby="quiz-nav-title">
  <h2 id="quiz-nav-title" class="card-title">{title}</h2>
  <div class="content">
    {#each groups as g, gi (gi)}
      {#if g.name}<div class="section-name">{g.name}</div>{/if}
      <NavGrid items={g.items} label={g.name ? `${title}: ${g.name}` : title} onSelect={(id) => onSelect(Number(id))} />
    {/each}
    {#if children}<div class="othernav">{@render children()}</div>{/if}
  </div>
</section>
