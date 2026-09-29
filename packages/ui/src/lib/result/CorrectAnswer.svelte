<script lang="ts">
  import { formatNumber, type ProblemInstance, unitToTex } from '@pt/core';
  import MathInline from '../math/MathInline.svelte';

  interface Props {
    instance: ProblemInstance;
    /** Part id. */
    part: string;
    /** Significant figures to show (default 6). */
    sigfigs?: number;
  }

  let { instance, part, sigfigs = 6 }: Props = $props();

  const ip = $derived(instance.parts.find((p) => p.partId === part));
  const tex = $derived.by(() => {
    if (!ip) return '';
    const n = ip.integer ? String(Math.round(ip.modelAnswer)) : formatNumber(ip.modelAnswer, { sigfigs }).tex.replace(/\.?0+(?=\\times|$)/, '');
    return ip.unit ? `${n}\\ ${unitToTex(ip.unit)}` : n;
  });
</script>

{#if ip}
  <span class="pt-correct-answer" data-part={part}><MathInline {tex} /></span>
{/if}
