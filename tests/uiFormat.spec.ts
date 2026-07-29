import { describe, it, expect } from 'vitest';
import {
  cooldownFraction, waveTitle, enemiesLeftLabel, waveBannerLabel,
  clockLabel, levelLabel,
} from '../src/ui/format';

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

describe('waveTitle', () => {
  it('shows the wave number alone — count and clock are separate fields', () => {
    expect(waveTitle({ wave: 3, enemiesAlive: 12, inProgress: true })).toBe('WAVE 3');
    expect(waveTitle({ wave: 4, enemiesAlive: 0, inProgress: false })).toBe('WAVE 4');
  });
  it('floors the pre-first-wave state at 1 rather than showing "WAVE 0"', () => {
    expect(waveTitle({ wave: 0, enemiesAlive: 0, inProgress: false })).toBe('WAVE 1');
  });
  it('falls back before any wave info exists', () => {
    expect(waveTitle(undefined)).toBe('WAVE 1');
  });
  it('drops the number entirely once the last stand begins', () => {
    // The phase never advances, so a wave number would sit frozen on screen and
    // read as a stuck counter rather than as the endgame.
    expect(waveTitle({ wave: 30, enemiesAlive: 80, inProgress: true, lastStand: true }))
      .toBe('LAST STAND');
    // The flag wins over whatever the wave number happens to be.
    expect(waveTitle({ wave: 1, enemiesAlive: 5, inProgress: true, lastStand: true }))
      .toBe('LAST STAND');
  });
});

describe('enemiesLeftLabel', () => {
  it('counts the living enemies mid-wave', () => {
    expect(enemiesLeftLabel({ wave: 2, enemiesAlive: 26, inProgress: true })).toBe('26');
  });
  it('shows a dash between waves, where there is nothing to count', () => {
    expect(enemiesLeftLabel({ wave: 2, enemiesAlive: 0, inProgress: false })).toBe('—');
    expect(enemiesLeftLabel(undefined)).toBe('—');
  });
  it('never renders a negative count', () => {
    expect(enemiesLeftLabel({ wave: 2, enemiesAlive: -3, inProgress: true })).toBe('0');
  });
});

describe('waveBannerLabel', () => {
  it('announces a wave starting', () => {
    expect(waveBannerLabel({ wave: 5, enemiesAlive: 20, inProgress: true })).toBe('Wave 5');
  });
  it('announces a wave cleared', () => {
    expect(waveBannerLabel({ wave: 5, enemiesAlive: 0, inProgress: false })).toBe('Wave 5 Cleared');
  });
  it('stays silent before the first wave and with no info', () => {
    expect(waveBannerLabel({ wave: 0, enemiesAlive: 0, inProgress: false })).toBeNull();
    expect(waveBannerLabel(undefined)).toBeNull();
  });
  it('announces the last stand over any wave state', () => {
    // The phase opens MID-wave (the frame the final boss dies), so it is neither
    // a wave start nor a wave clear and has to win over both.
    expect(waveBannerLabel({ wave: 30, enemiesAlive: 40, inProgress: true, lastStand: true }))
      .toBe('Last Stand');
    expect(waveBannerLabel({ wave: 30, enemiesAlive: 0, inProgress: false, lastStand: true }))
      .toBe('Last Stand');
  });
});

describe('clockLabel', () => {
  it('formats minutes:seconds with zero-padding', () => {
    expect(clockLabel(754)).toBe('12:34');
  });
  it('rolls into hours past 60 minutes', () => {
    expect(clockLabel(3723)).toBe('1:02:03');
  });
  it('clamps negatives and truncates fractions', () => {
    expect(clockLabel(-5)).toBe('00:00');
    expect(clockLabel(59.9)).toBe('00:59');
  });
});

describe('levelLabel', () => {
  it('renders the bare number for the medallion', () => {
    expect(levelLabel(23)).toBe('23');
  });
  it('floors to at least 1 so the medallion is never blank or fractional', () => {
    expect(levelLabel(0)).toBe('1');
    expect(levelLabel(4.7)).toBe('4');
  });
});
