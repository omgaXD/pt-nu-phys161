<script lang="ts">
  import type { AnswerType } from '@pt/core';
  import MathInline from '../math/MathInline.svelte';
  import { type AnswerMessages, message } from './messages.js';
  import { type FieldValidation, validateField } from './validate.js';

  interface Props {
    value?: string;
    answerType?: AnswerType;
    /** Combined mode: one field holds number and unit ("191.88 J"). */
    withUnit?: boolean;
    /** Custom validator; defaults to @pt/core's acceptance checks. */
    validate?: (input: string) => FieldValidation;
    /** Milliseconds to wait after typing before validating. */
    debounce?: number;
    label?: string;
    id?: string;
    disabled?: boolean;
    placeholder?: string;
    /** Hover hint; defaults to qtype_formulas' wording ("Numeric and unit"). */
    title?: string;
    messages?: Partial<AnswerMessages>;
    onchange?: (value: string) => void;
  }

  const uid = $props.id();

  let {
    value = $bindable(''),
    answerType = 'numeric',
    withUnit = false,
    validate,
    debounce = 300,
    label = 'Answer',
    id = `pt-answer-${uid}`,
    disabled = false,
    placeholder,
    title,
    messages,
    onchange,
  }: Props = $props();

  let result = $state<FieldValidation | null>(null);

  $effect(() => {
    const input = value;
    const check = validate ?? ((s: string) => validateField(s, answerType, withUnit));
    if (input.trim() === '') {
      result = null;
      return;
    }
    const t = setTimeout(() => (result = check(input)), debounce);
    return () => clearTimeout(t);
  });

  const TYPE_TITLE: Record<AnswerType, string> = { number: 'Number', numeric: 'Numeric', numericalFormula: 'Numerical formula' };
  const hint = $derived(title ?? `${TYPE_TITLE[answerType]}${withUnit ? ' and unit' : ''}`);

  const invalid = $derived(result !== null && !result.ok);
  const errorId = $derived(`${id}-error`);
  const previewId = $derived(`${id}-preview`);

  function oninput(e: Event & { currentTarget: HTMLInputElement }): void {
    value = e.currentTarget.value;
    onchange?.(value);
  }
</script>

<span class="pt-answer-field" class:invalid class:combined={withUnit} data-tooltip={hint}>
  <input
    {id}
    type="text"
    inputmode="text"
    autocomplete="off"
    spellcheck="false"
    aria-label={label}
    aria-invalid={invalid}
    aria-describedby={invalid ? errorId : result?.ok ? previewId : undefined}
    title={hint}
    {placeholder}
    {value}
    {disabled}
    {oninput}
  />
  {#if result?.ok}
    <span class="pt-answer-preview" id={previewId} data-testid="answer-preview"><MathInline tex={result.latex} /></span>
  {:else if result && !result.ok}
    <span class="pt-answer-error" id={errorId} role="alert">{message(result.error, messages)}</span>
  {/if}
</span>

<style>
  .pt-answer-field {
    display: inline-flex;
    flex-direction: column;
    vertical-align: top;
    margin: 0 0.25em;
  }
  input {
    font: inherit;
    min-width: 8em;
    padding: 0.2em 0.4em;
    border: 1px solid var(--pt-border, #8a8f98);
    border-radius: 4px;
    background: var(--pt-input-bg, #fff);
    color: inherit;
  }
  .combined input {
    min-width: 11em;
  }
  .invalid input {
    border-color: var(--pt-bad, #b3261e);
    box-shadow: 0 0 0 1px var(--pt-bad, #b3261e);
  }
  .pt-answer-preview {
    font-size: 0.9em;
    color: var(--pt-muted, #555);
    min-height: 1.4em;
  }
  .pt-answer-error {
    font-size: 0.8em;
    color: var(--pt-bad, #b3261e);
  }
</style>
