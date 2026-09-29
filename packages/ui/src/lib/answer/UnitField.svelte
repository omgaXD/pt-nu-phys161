<script lang="ts">
  import MathInline from '../math/MathInline.svelte';
  import { type AnswerMessages, message } from './messages.js';
  import { type FieldValidation, validateUnitField } from './validate.js';

  interface Props {
    value?: string;
    debounce?: number;
    label?: string;
    id?: string;
    disabled?: boolean;
    messages?: Partial<AnswerMessages>;
    onchange?: (value: string) => void;
  }

  const uid = $props.id();

  let {
    value = $bindable(''),
    debounce = 300,
    label = 'Unit',
    id = `pt-unit-${uid}`,
    disabled = false,
    messages,
    onchange,
  }: Props = $props();

  let result = $state<FieldValidation | null>(null);

  $effect(() => {
    const input = value;
    if (input.trim() === '') {
      result = null;
      return;
    }
    const t = setTimeout(() => (result = validateUnitField(input)), debounce);
    return () => clearTimeout(t);
  });

  const invalid = $derived(result !== null && !result.ok);
</script>

<span class="pt-unit-field" class:invalid>
  <input
    {id}
    type="text"
    autocomplete="off"
    spellcheck="false"
    aria-label={label}
    aria-invalid={invalid}
    placeholder="unit"
    {value}
    {disabled}
    oninput={(e) => {
      value = e.currentTarget.value;
      onchange?.(value);
    }}
  />
  {#if result?.ok}
    <span class="pt-unit-preview"><MathInline tex={result.latex} /></span>
  {:else if result && !result.ok}
    <span class="pt-unit-error" role="alert">{message(result.error, messages)}</span>
  {/if}
</span>

<style>
  .pt-unit-field {
    display: inline-flex;
    flex-direction: column;
    vertical-align: top;
    margin: 0 0.25em;
  }
  input {
    font: inherit;
    width: 6em;
    padding: 0.2em 0.4em;
    border: 1px solid var(--pt-border, #8a8f98);
    border-radius: 4px;
    background: var(--pt-input-bg, #fff);
    color: inherit;
  }
  .invalid input {
    border-color: var(--pt-bad, #b3261e);
  }
  .pt-unit-preview {
    font-size: 0.9em;
    color: var(--pt-muted, #555);
  }
  .pt-unit-error {
    font-size: 0.8em;
    color: var(--pt-bad, #b3261e);
  }
</style>
