<script lang="ts">
  interface Props {
    flagged?: boolean;
    label?: string;
    /** Tooltip while unflagged (Moodle drops it once flagged). */
    title?: string;
    onchange?: (flagged: boolean) => void;
  }

  let { flagged = $bindable(false), label = 'Flag question', title = 'Flag this question for future reference', onchange }: Props = $props();
</script>

<!-- Moodle's .questionflag toggle: named "Flagged", pressed when flagged; Font Awesome 6 Free flag icons (CC BY 4.0). -->
<button
  type="button"
  class="pt-flag-toggle"
  class:flagged
  aria-pressed={flagged}
  aria-label="Flagged"
  title={flagged ? undefined : title}
  onclick={() => {
    flagged = !flagged;
    onchange?.(flagged);
  }}
  ><svg class="pt-flag-icon" viewBox="0 0 448 512" preserveAspectRatio="xMinYMid meet" aria-hidden="true"
    ><path
      d={flagged
        ? 'M64 32C64 14.3 49.7 0 32 0S0 14.3 0 32V64 368 480c0 17.7 14.3 32 32 32s32-14.3 32-32V352l64.3-16.1c41.1-10.3 84.6-5.5 122.5 13.4c44.2 22.1 95.5 24.8 141.7 7.4l34.7-13c12.5-4.7 20.8-16.6 20.8-30V66.1c0-23-24.2-38-44.8-27.7l-9.6 4.8c-46.3 23.2-100.8 23.2-147.1 0c-35.1-17.6-75.4-22-113.5-12.5L64 48V32z'
        : 'M48 24C48 10.7 37.3 0 24 0S0 10.7 0 24V64 350.5 400v88c0 13.3 10.7 24 24 24s24-10.7 24-24V388l80.3-20.1c41.1-10.3 84.6-5.5 122.5 13.4c44.2 22.1 95.5 24.8 141.7 7.4l34.7-13c12.5-4.7 20.8-16.6 20.8-30V66.1c0-23-24.2-38-44.8-27.7l-9.6 4.8c-46.3 23.2-100.8 23.2-147.1 0c-35.1-17.6-75.4-22-113.5-12.5L48 52V24zm0 77.5l96.6-24.2c27-6.7 55.5-3.6 80.4 8.8c54.9 27.4 118.7 29.7 175 6.8V334.7l-24.4 9.1c-33.7 12.6-71.2 10.7-103.4-5.4c-48.2-24.1-103.3-30.1-155.6-17.1L48 338.5v-237z'}
    /></svg
  >{label}</button
>

<style>
  .pt-flag-toggle {
    font: inherit;
    font-size: 0.85em;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0.2em 0;
  }
  .pt-flag-icon {
    box-sizing: content-box;
    width: 13px;
    height: 16px;
    padding-right: 3px;
    vertical-align: bottom;
    fill: currentColor;
  }
</style>
