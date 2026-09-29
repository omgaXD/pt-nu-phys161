<script lang="ts">
  interface Props {
    /** When time is up (epoch ms or Date). */
    endsAt: number | Date;
    onExpire?: () => void;
    /** Clock source; injectable for tests. */
    now?: () => number;
    /** Tick interval in ms. */
    interval?: number;
    /** `auto`: 1:05 / 1:02:03; `hms`: always H:MM:SS (0:39:59), as Moodle shows it. */
    format?: 'auto' | 'hms';
    /** Below this many ms left the timer is marked `low` and exposes `--pt-urgency` (0 → 1). */
    warnBelowMs?: number;
  }

  let { endsAt, onExpire, now = () => Date.now(), interval = 250, format = 'auto', warnBelowMs = 60_000 }: Props = $props();

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
    if (format === 'hms') return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
  }

  const low = $derived(remaining < warnBelowMs);
  /** 0 at the warning threshold, 1 at zero; used by themes to fade the timer in. */
  const urgency = $derived(low && warnBelowMs > 0 ? Math.min(1, 1 - remaining / warnBelowMs) : 0);
</script>

<span
  class="pt-countdown"
  class:low
  class:expired={remaining === 0}
  style:--pt-urgency={urgency.toFixed(3)}
  role="timer"
  aria-live="off"
  aria-label="Time left {fmt(remaining)}"
>
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
