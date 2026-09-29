<script lang="ts">
  interface Props {
    /** Called with the text to insert, or 'backspace'. */
    onkey: (key: string) => void;
    disabled?: boolean;
  }

  let { onkey, disabled = false }: Props = $props();

  const keys: { label: string; key: string; aria?: string }[] = [
    { label: '7', key: '7' },
    { label: '8', key: '8' },
    { label: '9', key: '9' },
    { label: '⌫', key: 'backspace', aria: 'Backspace' },
    { label: '4', key: '4' },
    { label: '5', key: '5' },
    { label: '6', key: '6' },
    { label: '×10ⁿ', key: 'e', aria: 'Times ten to the power' },
    { label: '1', key: '1' },
    { label: '2', key: '2' },
    { label: '3', key: '3' },
    { label: '\u2212', key: '-', aria: 'Minus' },
    { label: '0', key: '0' },
    { label: '.', key: '.', aria: 'Decimal point' },
    { label: '(', key: '(' },
    { label: ')', key: ')' },
  ];
</script>

<div class="pt-keypad" role="group" aria-label="Numeric keypad">
  {#each keys as k (k.key)}
    <button type="button" {disabled} aria-label={k.aria ?? k.label} onclick={() => onkey(k.key)}>{k.label}</button>
  {/each}
</div>

<style>
  .pt-keypad {
    display: grid;
    grid-template-columns: repeat(4, minmax(2.75rem, 1fr));
    gap: 0.35rem;
    max-width: 16rem;
  }
  button {
    font: inherit;
    min-height: 2.75rem;
    border: 1px solid var(--pt-border, #8a8f98);
    border-radius: 6px;
    background: var(--pt-surface, #f3f4f6);
    color: inherit;
    cursor: pointer;
  }
  button:active {
    background: var(--pt-border, #ddd);
  }
</style>
