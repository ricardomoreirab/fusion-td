import { describe, it, expect } from 'vitest';
import { pickNearestAlive, type TargetProvider } from '../src/survivors/enemies/nearestTarget';

const prov = (x: number, z: number, alive = true): TargetProvider => ({
  getPosition: () => ({ x, z }),
  isAlive: () => alive,
});

describe('pickNearestAlive', () => {
  it('returns null when there are no providers', () => {
    expect(pickNearestAlive(0, 0, [])).toBeNull();
  });
  it('returns null when no provider is alive', () => {
    expect(pickNearestAlive(0, 0, [prov(1, 1, false), prov(2, 2, false)])).toBeNull();
  });
  it('picks the nearest alive provider', () => {
    const near = prov(1, 0), far = prov(10, 0);
    expect(pickNearestAlive(0, 0, [far, near])).toBe(near);
  });
  it('excludes a closer dead provider in favor of a farther alive one', () => {
    const deadClose = prov(1, 0, false), aliveFar = prov(8, 0, true);
    expect(pickNearestAlive(0, 0, [deadClose, aliveFar])).toBe(aliveFar);
  });
  it('resolves ties to the first provider', () => {
    const a = prov(3, 0), b = prov(3, 0);
    expect(pickNearestAlive(0, 0, [a, b])).toBe(a);
  });
});
