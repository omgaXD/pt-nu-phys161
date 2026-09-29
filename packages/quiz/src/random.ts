import { uniformIndex } from '@pt/core';
import { mersenne } from 'pure-rand/generator/mersenne';

/**
 * 32-bit string hash: FNV-1a, then the murmur3 finaliser for avalanche.
 * Part of the share-link contract: the same link must reproduce the same
 * attempt, so never change it.
 */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The instance seed of one question. It depends on the question's key, not
 * its position, so reordering or redrawing never changes a question's values.
 */
export function questionSeed(attemptSeed: number, key: string): number {
  return hash32(`${attemptSeed}|${key}`);
}

export interface Rng {
  next(): number;
}

/** An independent random stream per purpose ("draw", "order"), all from one attempt seed. */
export function streamRng(attemptSeed: number, stream: string): Rng {
  return mersenne(hash32(`${attemptSeed}|${stream}`));
}

/** Seeded Fisher–Yates; returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = uniformIndex(rng, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A fresh random seed in [0, 2^32). */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** A short random id (attempt ids). */
export function randomId(): string {
  const b = crypto.getRandomValues(new Uint32Array(2));
  return `${b[0]!.toString(36)}${b[1]!.toString(36)}`.slice(0, 12);
}
