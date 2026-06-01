import { describe, it, expect } from 'vitest';
import { entranceTierForWave } from '../src/survivors/bossEntranceTier';

describe('entranceTierForWave', () => {
  it('maps the first three milestone waves to tiers 1-3', () => {
    expect(entranceTierForWave(5)).toBe(1);
    expect(entranceTierForWave(10)).toBe(2);
    expect(entranceTierForWave(15)).toBe(3);
  });

  it('returns null for non-milestone waves', () => {
    expect(entranceTierForWave(1)).toBeNull();
    expect(entranceTierForWave(7)).toBeNull();
    expect(entranceTierForWave(0)).toBeNull();
    expect(entranceTierForWave(-5)).toBeNull();
  });

  it('returns null for milestone waves beyond the third boss (no entrance asset)', () => {
    expect(entranceTierForWave(20)).toBeNull();
    expect(entranceTierForWave(25)).toBeNull();
  });
});
