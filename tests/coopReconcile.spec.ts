import { describe, it, expect } from 'vitest';
import { reconcilePosition, type Vec2 } from '../src/survivors/coop/reconcile';

describe('reconcilePosition', () => {
  const THRESHOLD = 2.0;
  const LERP = 0.2;

  it('hard-snaps when distance exceeds the threshold', () => {
    const local: Vec2 = { x: 0, z: 0 };
    const snap: Vec2  = { x: 5, z: 0 }; // dist = 5 > 2
    const result = reconcilePosition(local, snap, THRESHOLD, LERP);
    expect(result.snapped).toBe(true);
    expect(result.pos).toEqual({ x: 5, z: 0 });
  });

  it('hard-snaps when distance exactly equals the threshold (boundary is exclusive)', () => {
    // dist = threshold → NOT snapped (lerp)
    const local: Vec2 = { x: 0, z: 0 };
    const snap: Vec2  = { x: 2, z: 0 }; // dist == threshold
    const result = reconcilePosition(local, snap, THRESHOLD, LERP);
    expect(result.snapped).toBe(false);
  });

  it('lerps below threshold, snapped:false, moves fraction toward snap', () => {
    const local: Vec2 = { x: 0, z: 0 };
    const snap: Vec2  = { x: 1, z: 0 }; // dist = 1 < 2
    const result = reconcilePosition(local, snap, THRESHOLD, LERP);
    expect(result.snapped).toBe(false);
    expect(result.pos.x).toBeCloseTo(0 + 1 * LERP, 6); // 0.2
    expect(result.pos.z).toBeCloseTo(0, 6);
  });

  it('lerps in both axes proportionally', () => {
    const local: Vec2 = { x: 0, z: 0 };
    const snap: Vec2  = { x: 0.8, z: 0.6 }; // dist = 1.0 < 2
    const result = reconcilePosition(local, snap, THRESHOLD, LERP);
    expect(result.snapped).toBe(false);
    expect(result.pos.x).toBeCloseTo(0.8 * LERP, 6);
    expect(result.pos.z).toBeCloseTo(0.6 * LERP, 6);
  });

  it('repeated lerp monotonically converges toward snap', () => {
    let pos: Vec2 = { x: 0, z: 0 };
    const snap: Vec2 = { x: 1.5, z: 0 }; // dist < threshold throughout
    let prevDist = Math.hypot(snap.x - pos.x, snap.z - pos.z);
    for (let i = 0; i < 10; i++) {
      const r = reconcilePosition(pos, snap, THRESHOLD, LERP);
      expect(r.snapped).toBe(false);
      pos = r.pos;
      const d = Math.hypot(snap.x - pos.x, snap.z - pos.z);
      expect(d).toBeLessThan(prevDist);
      prevDist = d;
    }
    // After 10 iterations distance should be very small
    expect(prevDist).toBeLessThan(0.2);
  });

  it('zero distance is a no-op (pos unchanged, snapped:false)', () => {
    const at: Vec2 = { x: 3, z: -1 };
    const result = reconcilePosition(at, at, THRESHOLD, LERP);
    expect(result.snapped).toBe(false);
    expect(result.pos).toEqual({ x: 3, z: -1 });
  });

  it('snap across diagonal distance', () => {
    // sqrt(3^2 + 4^2) = 5 > threshold
    const local: Vec2 = { x: 0, z: 0 };
    const snap: Vec2  = { x: 3, z: 4 };
    const result = reconcilePosition(local, snap, THRESHOLD, LERP);
    expect(result.snapped).toBe(true);
    expect(result.pos).toEqual({ x: 3, z: 4 });
  });
});
