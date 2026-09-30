<script lang="ts">
  import type { InstancePart, ProblemInstance } from '@pt/core';
  import type { Snippet } from 'svelte';
  import AnswerField from '../answer/AnswerField.svelte';
  import type { AnswerMessages } from '../answer/messages.js';
  import { emptyAnswer, type PartAnswer } from '../answer/types.js';
  import UnitField from '../answer/UnitField.svelte';
  import Figure from './Figure.svelte';
  import RichHtml from './RichHtml.svelte';

  interface Props {
    instance: ProblemInstance;
    /** Render only this part's prompt (default: every part). */
    part?: string;
    /** Field contents per part id. */
    answers?: Record<string, PartAnswer>;
    /** Called whenever a field changes. */
    onanswer?: (partId: string, answer: PartAnswer) => void;
    resolveSrc?: (src: string) => string;
    disabled?: boolean;
    /** Hide answer inputs entirely (e.g. authoring preview). */
    readonly?: boolean;
    messages?: Partial<AnswerMessages>;
    debounce?: number;
    /** Buttons for the answer (Check, ...): beside the last part's fields when they end its prompt, else after the parts. */
    controls?: Snippet;
  }

  let {
    instance,
    part,
    answers = $bindable({}),
    onanswer,
    resolveSrc,
    disabled = false,
    readonly = false,
    messages,
    debounce = 300,
    controls,
  }: Props = $props();

  const parts = $derived(part === undefined ? instance.parts : instance.parts.filter((p) => p.partId === part));
  /** The figure goes where {@fig} was written, else right after the narrative. */
  const figurePlaced = $derived(
    instance.narrativeHtml.includes('class="pt-figure"') || parts.some((p) => p.promptHtml.includes('class="pt-figure"')),
  );

  /** Answer slots that end a prompt; they get their own row, like Moodle's .formulaspart. */
  const TRAILING_SLOTS = /(?:\s*<span class="pt-slot"[^>]*><\/span>)+\s*$/;
  function splitPrompt(html: string): { text: string; answer: string } {
    const m = TRAILING_SLOTS.exec(html);
    return m ? { text: html.slice(0, m.index), answer: m[0] } : { text: html, answer: '' };
  }

  const lastTrailing = $derived.by(() => {
    const last = parts.at(-1);
    return last && splitPrompt(last.promptHtml).answer ? last.partId : null;
  });

  function answerOf(partId: string): PartAnswer {
    return answers[partId] ?? emptyAnswer();
  }

  function update(p: InstancePart, patch: Partial<PartAnswer>): void {
    const next = { ...answerOf(p.partId), ...patch };
    answers = { ...answers, [p.partId]: next };
    onanswer?.(p.partId, next);
  }

  const label = (p: InstancePart, what: string): string =>
    instance.parts.length > 1 ? `${what}, part ${instance.parts.indexOf(p) + 1}` : what;
</script>

{#snippet figureSnippet(_id: string)}
  {#if instance.figure}<Figure figure={instance.figure} {resolveSrc} />{/if}
{/snippet}

<div class="pt-problem" data-scenario={instance.scenarioId} data-seed={instance.seed}>
  <div class="pt-narrative">
    <RichHtml html={instance.narrativeHtml} figure={figureSnippet} />
  </div>
  {#if instance.figure && !figurePlaced}
    <Figure figure={instance.figure} {resolveSrc} />
  {/if}
  {#each parts as p (p.partId)}
    {@const prompt = splitPrompt(p.promptHtml)}
    <div class="pt-part" data-part={p.partId}>
      {#snippet slotSnippet(seg: { index: number; kind: 'value' | 'unit' | 'combined' })}
        {#if readonly}
          <span class="pt-slot-placeholder" data-kind={seg.kind}>{seg.kind === 'unit' ? 'unit' : 'answer'}</span>
        {:else if seg.kind === 'unit'}
          <UnitField
            value={answerOf(p.partId).unit}
            onchange={(v) => update(p, { unit: v })}
            label={label(p, 'Unit')}
            {disabled}
            {messages}
            {debounce}
          />
        {:else}
          <AnswerField
            value={answerOf(p.partId).value}
            onchange={(v) => update(p, { value: v })}
            answerType={p.answerType}
            withUnit={seg.kind === 'combined'}
            label={label(p, seg.kind === 'combined' ? 'Answer with unit' : 'Answer')}
            {disabled}
            {messages}
            {debounce}
          />
        {/if}
      {/snippet}
      <RichHtml html={prompt.text} slot={slotSnippet} figure={figureSnippet} />
      {#if prompt.answer}
        <span class="pt-part-answer"
          ><RichHtml html={prompt.answer} slot={slotSnippet} />{#if controls && p.partId === lastTrailing}<span class="pt-answer-controls"
              >{@render controls()}</span
            >{/if}</span
        >
      {/if}
    </div>
  {/each}
  {#if controls && lastTrailing === null}
    <div class="pt-answer-controls">{@render controls()}</div>
  {/if}
</div>

<style>
  .pt-problem {
    line-height: 1.6;
  }
  .pt-part {
    margin-top: 0.75rem;
  }
  .pt-slot-placeholder {
    display: inline-block;
    min-width: 6em;
    padding: 0 0.4em;
    border: 1px dashed var(--pt-border, #999);
    border-radius: 4px;
    color: var(--pt-muted, #666);
    font-size: 0.85em;
    text-align: center;
  }
</style>
