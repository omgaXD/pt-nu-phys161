import { defaultConfig } from '@pt/quiz';
import { describe, expect, it } from 'vitest';
import { describeConfig, formatDuration, navState, presetName } from '../src/lib/labels.ts';

describe('labels', () => {
  it('describes a configuration in one line', () => {
    expect(describeConfig(defaultConfig(['a'], 'exam'), 7)).toBe('7 questions · in order · randomized values · 40 min · feedback at the end');
    expect(describeConfig({ ...defaultConfig(['a'], 'chaotic'), maxTries: 1, values: 'source' }, 1)).toBe(
      '1 question · shuffled · source values · no time limit · Check after each (1 try)',
    );
  });

  it('maps question states to navigation colours', () => {
    expect(navState('correct')).toEqual({ answered: true, outcome: 'correct' });
    expect(navState('revealed')).toEqual({ answered: true, outcome: 'incorrect' });
    expect(navState('answersaved')).toEqual({ answered: true });
    expect(navState('notyetanswered')).toEqual({ answered: false });
  });

  it('formats durations and preset names', () => {
    expect(formatDuration(65_000)).toBe('1 min 5 secs');
    expect(formatDuration(3_725_000)).toBe('1 hour 2 min');
    expect(formatDuration(1_000)).toBe('1 sec');
    expect(presetName('custom')).toBe('Custom quiz');
    expect(presetName('exam')).toBe('Exam');
  });
});
