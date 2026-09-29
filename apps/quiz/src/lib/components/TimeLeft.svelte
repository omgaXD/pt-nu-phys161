<script lang="ts">
  import { CountdownTimer } from '@pt/ui';

  interface Props {
    endsAt: number;
    onExpire: () => void;
  }

  let { endsAt, onExpire }: Props = $props();
  let hidden = $state(false);
</script>

<!-- Moodle's sticky "Time left 0:39:59" box with a Hide button. -->
<div class="quiz-timer-wrapper">
  {#if !hidden}
    <div class="quiz-timer" id="quiz-timer">
      Time left <CountdownTimer {endsAt} {onExpire} format="hms" warnBelowMs={100_000} />
    </div>
  {/if}
  <button type="button" class="btn btn-secondary btn-sm" aria-controls="quiz-timer" onclick={() => (hidden = !hidden)}>
    {hidden ? 'Show' : 'Hide'}
  </button>
</div>
