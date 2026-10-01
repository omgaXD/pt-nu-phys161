<script lang="ts">
  import { toasts } from '$lib/toasts.svelte';
</script>

<!-- Moodle's .toast-wrapper (fixed at the top, centred) and its core/toast messages. -->
<div class="toast-wrapper mx-auto py-0 fixed-top" role="status" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast mx-auto toast-{t.kind} show" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="toast-body d-flex">
        <div>{t.text}</div>
        {#if t.closeButton}
          <button type="button" class="btn-close ms-auto" aria-label="Dismiss this notification" onclick={() => toasts.remove(t.id)}></button>
        {/if}
      </div>
    </div>
  {/each}
</div>
