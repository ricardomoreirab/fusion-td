import { describe, it, expect } from 'vitest';
import { cooldownFraction, waveLabel, levelLabel } from '../src/ui/format';

describe('cooldownFraction', () => {
  it('clamps to 0..1', () => {
    expect(cooldownFraction(5, 10)).toBe(0.5);
    expect(cooldownFraction(20, 10)).toBe(1);
    expect(cooldownFraction(-1, 10)).toBe(0);
  });
  it('returns 0 when total is non-positive', () => {
    expect(cooldownFraction(5, 0)).toBe(0);
  });
});

describe('waveLabel', () => {
  it('formats an in-progress wave', () => {
    expect(waveLabel({ wave: 3, enemiesAlive: 12, inProgress: true })).toBe('WAVE 3 · 12 LEFT');
  });
  it('formats the starting state', () => {
    expect(waveLabel({ wave: 0, enemiesAlive: 0, inProgress: false })).toBe('WAVE 1 STARTING');
  });
  it('formats a cleared wave', () => {
    expect(waveLabel({ wave: 4, enemiesAlive: 0, inProgress: false })).toBe('WAVE 4 CLEARED');
  });
  it('returns empty string when no info', () => {
    expect(waveLabel(undefined)).toBe('');
  });
});

describe('levelLabel', () => {
  it('prefixes the LV tag', () => {
    expect(levelLabel(23)).toBe('LV 23');
  });
});
