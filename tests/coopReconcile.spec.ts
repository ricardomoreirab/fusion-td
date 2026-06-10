import { describe, it, expect } from 'vitest';
import { reconcilePosition, replayInputs, type Vec2, type InputFrame } from '../src/survivors/coop/reconcile';
import { integrateMove } from '../src/survivors/integrateMove';

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

describe('replayInputs (M6 E2)', () => {
  const SPEED = 6;
  const R = 50;
  const DT = 1 / 60;

  it('no unacked inputs → returns the authoritative start unchanged', () => {
    const r = replayInputs({ x: 3, z: -2 }, [], SPEED, R);
    expect(r).toEqual({ x: 3, z: -2 });
  });

  it('single input matches one integrateMove step exactly', () => {
    const inputs: InputFrame[] = [{ dx: 1, dz: 0, dt: DT }];
    const r = replayInputs({ x: 0, z: 0 }, inputs, SPEED, R);
    expect(r).toEqual(integrateMove(0, 0, 1, 0, SPEED, DT, R));
  });

  it('multiple inputs accumulate in order', () => {
    const inputs: InputFrame[] = [
      { dx: 1, dz: 0, dt: DT },
      { dx: 1, dz: 0, dt: DT },
      { dx: 0, dz: 1, dt: DT },
    ];
    const r = replayInputs({ x: 0, z: 0 }, inputs, SPEED, R);
    expect(r.x).toBeCloseTo(2 * SPEED * DT, 12);
    expect(r.z).toBeCloseTo(SPEED * DT, 12);
  });

  it('KEY PROPERTY: replaying the unacked tail from the authoritative pose reproduces the local prediction', () => {
    // Local sim applied inputs i1..i5 from P0. Host acked through i2, so its
    // authoritative pose is P0 after i1,i2. Replaying i3..i5 from there must
    // land EXACTLY on the local predicted position → zero residual, no jitter.
    const all: InputFrame[] = [
      { dx: 1,  dz: 0,  dt: DT },
      { dx: 1,  dz: 1,  dt: DT },        // diagonal (normalized inside)
      { dx: 0,  dz: -1, dt: DT },
      { dx: -0.4, dz: 0.2, dt: DT },     // analog joystick
      { dx: 1,  dz: 0,  dt: 0.02 },      // varying frame dt
    ];
    let local: Vec2 = { x: 5, z: 5 };
    for (const i of all) local = integrateMove(local.x, local.z, i.dx, i.dz, SPEED, i.dt, R);

    const authoritative = replayInputs({ x: 5, z: 5 }, all.slice(0, 2), SPEED, R);
    const predicted = replayInputs(authoritative, all.slice(2), SPEED, R);
    expect(predicted.x).toBe(local.x); // exact float equality — same math, same order
    expect(predicted.z).toBe(local.z);
  });

  it('replay respects the arena clamp', () => {
    const inputs: InputFrame[] = Array.from({ length: 10 }, () => ({ dx: 1, dz: 0, dt: 1 }));
    const r = replayInputs({ x: 45, z: 0 }, inputs, SPEED, R);
    expect(Math.hypot(r.x, r.z)).toBeLessThanOrEqual(49.5 + 1e-9);
  });
});
