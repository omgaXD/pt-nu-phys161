import { mersenne } from 'pure-rand/generator/mersenne';
import { InstantiationError } from '../errors.js';
import { decimalPlaces, roundHalfAway, roundToSigfigs, shiftDecimal } from '../numbers/decimal.js';
import { effectiveStep } from '../schema/defaults.js';
import type { RandomVar, RangeVar, Scenario } from '../schema/scenario.js';

/** Minimal generator surface we rely on: 32-bit signed ints from MT19937. */
interface Generator {
  next(): number;
}

export const MAX_SEED = 0xffff_ffff;

export function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new InstantiationError('invalid-seed', `seed must be an integer in [0, ${MAX_SEED}]`, { seed });
  }
}

/**
 * Seed for draw number `k` (§3.3 step 5). Draw 0 uses the seed itself; each
 * constraint-rejected draw retries with `seed·0x9E3779B1 + k` (mod 2^32).
 * Part of the determinism contract — never change.
 */
export function drawSeed(seed: number, k: number): number {
  return k === 0 ? seed : (Math.imul(seed, 0x9e3779b1) + k) >>> 0;
}

/**
 * Uniform integer in [0, n) by rejection sampling on raw 32-bit MT outputs.
 * Implemented here rather than borrowed from a library so the mapping from
 * seed to values is fixed by this code alone (determinism contract).
 */
export function uniformIndex(rng: Generator, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 0x1_0000_0000) {
    throw new InstantiationError('grid-too-large', `cannot draw from ${n} values`, { n });
  }
  if (n === 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  let v = rng.next() >>> 0;
  while (v >= limit) v = rng.next() >>> 0;
  return v % n;
}

export interface Grid {
  count: number;
  valueAt(k: number): number;
}

/**
 * The value grid of a range variable, computed in scaled integers so that
 * `min + k·step` is exact in decimal: 0.25 + 7·0.01 is 0.32, not
 * 0.32000000000000006, and the grid count is not off by one.
 */
export function rangeGrid(v: RangeVar): Grid {
  const step = effectiveStep(v);
  const d = Math.max(decimalPlaces(v.min), decimalPlaces(v.max), decimalPlaces(step));
  const minI = Math.round(shiftDecimal(v.min, d));
  const maxI = Math.round(shiftDecimal(v.max, d));
  const stepI = Math.round(shiftDecimal(step, d));
  if (d <= 20 && stepI > 0 && Number.isSafeInteger(minI) && Number.isSafeInteger(maxI)) {
    const count = Math.floor((maxI - minI) / stepI) + 1;
    return { count, valueAt: (k) => shiftDecimal(minI + k * stepI, -d) };
  }
  // Fallback for extreme magnitudes: float grid, noise removed.
  const count = Math.floor((v.max - v.min) / step + 1e-9) + 1;
  return { count, valueAt: (k) => Number((v.min + k * step).toPrecision(15)) };
}

export function varCount(v: RandomVar): number {
  return v.kind === 'range' ? rangeGrid(v).count : v.options.length;
}

/** Apply the variable's decimals/sigfigs (§3.3 step 3). Strings pass through. */
export function quantize(v: RandomVar, x: number | string): number | string {
  if (typeof x !== 'number') return x;
  if (v.decimals !== undefined) return roundHalfAway(x, v.decimals);
  if (v.sigfigs !== undefined) return roundToSigfigs(x, v.sigfigs);
  return x;
}

/** Draw every random variable, in declaration order, from one generator. */
export function drawRandoms(vars: readonly RandomVar[], seed: number): Record<string, number | string> {
  const rng = mersenne(seed);
  const out: Record<string, number | string> = {};
  for (const v of vars) {
    if (v.kind === 'range') {
      const grid = rangeGrid(v);
      out[v.name] = quantize(v, grid.valueAt(uniformIndex(rng, grid.count)));
    } else {
      out[v.name] = quantize(v, v.options[uniformIndex(rng, v.options.length)]!);
    }
  }
  return out;
}

export interface VariantBreakdown {
  total: number;
  vars: { name: string; count: number }[];
}

/** Π over vars of grid size (§3.3), clamped to Number.MAX_SAFE_INTEGER. */
export function countVariants(scenario: Pick<Scenario, 'vars'>): number {
  return variantBreakdown(scenario).total;
}

export function variantBreakdown(scenario: Pick<Scenario, 'vars'>): VariantBreakdown {
  let total = 1;
  const vars = scenario.vars.map((v) => {
    const count = varCount(v);
    total = Math.min(Number.MAX_SAFE_INTEGER, total * count);
    return { name: v.name, count };
  });
  return { total, vars };
}
