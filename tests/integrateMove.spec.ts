import { describe, it, expect } from 'vitest';
import { capInputLen, arenaClampScale, integrateMove, ARENA_EDGE_BUFFER } from '../src/survivors/integrateMove';

describe('capInputLen', () => {
  it('leaves sub-unit analog input untouched (joystick)', () => {
    const out = { dx: 0, dz: 0 };
    capInputLen(0.5, 0.3, out);
    expect(out).toEqual({ dx: 0.5, dz: 0.3 });
  });

  it('leaves exactly-unit input untouched (boundary is exclusive, matches the controller)', () => {
    const out = { dx: 0, dz: 0 };
    capInputLen(1, 0, out);
    expect(out).toEqual({ dx: 1, dz: 0 });
  });

  it('normalizes diagonal keyboard input via the SAME division the controller used (dx /= len)', () => {
    const out = { dx: 0, dz: 0 };
    capInputLen(1, 1, out);
    const len = Math.hypot(1, 1);
    expect(out.dx).toBe(1 / len); // exact op-for-op match, not just toBeCloseTo
    expect(out.dz).toBe(1 / len);
    expect(Math.hypot(out.dx, out.dz)).toBeCloseTo(1, 12);
  });

  it('zero input stays zero', () => {
    const out = { dx: 9, dz: 9 };
    capInputLen(0, 0, out);
    expect(out).toEqual({ dx: 0, dz: 0 });
  });
});

describe('arenaClampScale', () => {
  it('returns 1 when inside the limit', () => {
    expect(arenaClampScale(3, 4, 50)).toBe(1); // dist 5 << 49.5
  });

  it('returns 1 exactly AT the limit (controller clamps only when strictly beyond)', () => {
    expect(arenaClampScale(49.5, 0, 50)).toBe(1);
  });

  it('returns the controller\'s exact scale factor beyond the limit', () => {
    // Controller inline math was: k = (arenaRadius - 0.5) / distFromCenter
    const k = arenaClampScale(40, 30, 50); // dist = 50 > 49.5
    expect(k).toBe((50 - 0.5) / 50);
    expect(Math.hypot(40 * k, 30 * k)).toBeCloseTo(50 - ARENA_EDGE_BUFFER, 12);
  });

  it('uses the 0.5 edge buffer', () => {
    expect(ARENA_EDGE_BUFFER).toBe(0.5);
  });
});

describe('integrateMove', () => {
  const R = 50;

  it('straight move: x advances by dx*speed*dt', () => {
    const r = integrateMove(0, 0, 1, 0, 6, 0.1, R);
    expect(r.x).toBeCloseTo(0.6, 12);
    expect(r.z).toBe(0);
  });

  it('analog input below magnitude 1 is NOT normalized up', () => {
    const r = integrateMove(0, 0, 0.5, 0, 6, 0.1, R);
    expect(r.x).toBeCloseTo(0.3, 12);
  });

  it('diagonal keyboard input is normalized (no speed advantage)', () => {
    const r = integrateMove(0, 0, 1, 1, 6, 0.1, R);
    const step = Math.hypot(r.x, r.z);
    expect(step).toBeCloseTo(0.6, 12);
    expect(r.x).toBeCloseTo(r.z, 12);
  });

  it('matches velocity-then-integrate order of operations ((dx*speed)*dt)', () => {
    // Champion.update does position += (dx*speed) * dt — verify exact float equality.
    const dx = 0.7, speed = 9, dt = 0.016666;
    const r = integrateMove(1.25, 0, dx, 0, speed, dt, R);
    expect(r.x).toBe(1.25 + (dx * speed) * dt);
  });

  it('clamps radially at the arena edge, preserving direction', () => {
    const r = integrateMove(49.4, 0, 1, 0, 6, 0.1, R); // would land at 50.0 > 49.5
    expect(r.x).toBeCloseTo(49.5, 12);
    expect(r.z).toBe(0);
  });

  it('clamp is radial (not per-axis): off-axis position scales both coords', () => {
    const r = integrateMove(35, 35, 1, 1, 10, 1, R); // far outside after the move
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(49.5, 12);
    expect(r.x).toBeCloseTo(r.z, 12); // direction preserved
  });

  it('zero dt / zero input are no-ops', () => {
    expect(integrateMove(3, -2, 1, 0, 6, 0, R)).toEqual({ x: 3, z: -2 });
    expect(integrateMove(3, -2, 0, 0, 6, 0.1, R)).toEqual({ x: 3, z: -2 });
  });

  it('sliding along the edge stays on the edge circle', () => {
    let x = 49.5, z = 0;
    for (let i = 0; i < 30; i++) {
      const r = integrateMove(x, z, 0, 1, 7, 0.05, R); // push "up" while at the east edge
      x = r.x; z = r.z;
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(49.5 + 1e-9);
    }
    expect(z).toBeGreaterThan(1); // still made progress along the rim
  });
});
