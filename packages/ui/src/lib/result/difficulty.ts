import type { DifficultyLevel } from '@pt/core';

/** English names for the difficulty levels; pass `names` to `DifficultyDots` to translate. */
export type DifficultyNames = Record<DifficultyLevel, string>;

export const DEFAULT_DIFFICULTY_NAMES: DifficultyNames = {
  1: 'Very easy',
  2: 'Easy',
  3: 'Medium',
  4: 'Hard',
  5: 'Very hard',
};
