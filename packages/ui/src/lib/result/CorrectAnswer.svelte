<script lang="ts">
  import { formatNumber, phpFloatString, type ProblemInstance, unitToTex } from '@pt/core';
  import MathInline from '../math/MathInline.svelte';

  interface Props {
    instance: ProblemInstance;
    /** Part id. */
    part: string;
    /** Significant figures to show in math (default 6). */
    sigfigs?: number;
    /** `math`: typeset, rounded to `sigfigs`. `moodle`: plain text as qtype_formulas prints it, the raw
        value at PHP's 14 digits and the unit as written ("0.068999999999999 cm^2"). */
    format?: 'math' | 'moodle';
  }

  let { instance, part, sigfigs = 6, format = 'math' }: Props = $props();

  const ip = $derived(instance.parts.find((p) => p.partId === part));
  const tex = $derived.by(() => {
    if (!ip) return '';
    const n = ip.integer ? String(Math.round(ip.modelAnswer)) : formatNumber(ip.modelAnswer, { sigfigs }).tex.replace(/\.?0+(?=\\times|$)/, '');
    return ip.unit ? `${n}\\ ${unitToTex(ip.unit)}` : n;
  });
</script>

{#if ip && format === 'moodle'}
  <span class="pt-correct-answer" data-part={part}>{phpFloatString(ip.modelAnswer)}{ip.unit ? ` ${ip.unit}` : ''}</span>
{:else if ip}
  <span class="pt-correct-answer" data-part={part}><MathInline {tex} /></span>
{/if}
