<script lang="ts">
  interface Props {
    /** When time is up (epoch ms or Date). */
    endsAt: number | Date;
    onExpire?: () => void;
    /** Clock source; injectable for tests. */
    now?: () => number;
    /** Tick interval in ms. */
    interval?: number;
  }

  let { endsAt, onExpire, now = () => Date.now(), interval = 250 }: Props = $props();

  const end = $derived(typeof endsAt === 'number' ? endsAt : endsAt.getTime());
  let current = $state(Date.now());
  let fired = false;

  $effect.pre(() => {
    current = now();
    const t = setInterval(() => (current = now()), interval);
    return () => clearInterval(t);
  });

  const remaining = $derived(Math.max(0, end - current));

  $effect(() => {
    if (remaining === 0 && !fired) {
      fired = true;
      onExpire?.();
    }
  });

  function fmt(ms: number): string {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
  }
</script>

<span class="pt-countdown" class:low={remaining < 60_000} class:expired={remaining === 0} role="timer" aria-live="off" aria-label="Time left {fmt(remaining)}">
  {fmt(remaining)}
</span>

<style>
  .pt-countdown {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .low {
    color: var(--pt-bad, #b3261e);
  }
</style>
