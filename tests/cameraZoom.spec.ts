import { describe, it, expect } from 'vitest';
import {
  clampZoom, stepZoom, lerpZoom, parsePersistedZoom, setCameraSlantPosition,
  CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_ZOOM_DEFAULT, CAMERA_ZOOM_STEP, CAMERA_ZOOM_LERP,
} from '../src/survivors/cameraZoom';

describe('range constants', () => {
  it('are the 0.6x-1.6x band with a 1.0x default', () => {
    expect(CAMERA_ZOOM_MIN).toBe(0.6);
    expect(CAMERA_ZOOM_MAX).toBe(1.6);
    expect(CAMERA_ZOOM_DEFAULT).toBe(1.0);
    expect(CAMERA_ZOOM_STEP).toBeGreaterThan(1); // multiplicative step
    expect(CAMERA_ZOOM_LERP).toBe(8);            // ease factor — guard against a silent retune to 0 (freezes zoom)
  });
});

describe('clampZoom', () => {
  it('passes through an in-range value', () => {
    expect(clampZoom(1.0)).toBe(1.0);
    expect(clampZoom(1.25)).toBe(1.25);
  });
  it('clamps at both bounds', () => {
    expect(clampZoom(5)).toBe(CAMERA_ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(CAMERA_ZOOM_MIN);
  });
  it('non-finite input falls back to the default (NaN can never reach the camera transform)', () => {
    expect(clampZoom(NaN)).toBe(CAMERA_ZOOM_DEFAULT);
    expect(clampZoom(Infinity)).toBe(CAMERA_ZOOM_DEFAULT);
    expect(clampZoom(-Infinity)).toBe(CAMERA_ZOOM_DEFAULT);
  });
});

describe('stepZoom', () => {
  it('scroll up (deltaY < 0) zooms IN — smaller multiplier', () => {
    expect(stepZoom(1.0, -100)).toBeCloseTo(1.0 / CAMERA_ZOOM_STEP, 12);
  });
  it('scroll down (deltaY > 0) zooms OUT — larger multiplier', () => {
    expect(stepZoom(1.0, 100)).toBeCloseTo(1.0 * CAMERA_ZOOM_STEP, 12);
  });
  it('deltaY === 0 is a clamped no-op', () => {
    expect(stepZoom(1.2, 0)).toBe(1.2);
  });
  it('repeated out-steps converge exactly on the max', () => {
    let z = 1.0;
    for (let i = 0; i < 25; i++) z = stepZoom(z, 1);
    expect(z).toBe(CAMERA_ZOOM_MAX);
  });
  it('repeated in-steps converge exactly on the min', () => {
    let z = 1.0;
    for (let i = 0; i < 25; i++) z = stepZoom(z, -1);
    expect(z).toBe(CAMERA_ZOOM_MIN);
  });
});

describe('lerpZoom', () => {
  it('dt <= 0 does not move', () => {
    expect(lerpZoom(1.0, 1.5, 0)).toBe(1.0);
    expect(lerpZoom(1.0, 1.5, -0.5)).toBe(1.0);
  });
  it('eases toward the target, staying strictly between for a small dt', () => {
    const r = lerpZoom(1.0, 1.5, 0.05);
    expect(r).toBeGreaterThan(1.0);
    expect(r).toBeLessThan(1.5);
  });
  it('a large dt reaches (does not overshoot) the target', () => {
    expect(lerpZoom(1.0, 1.5, 10)).toBe(1.5);
    expect(lerpZoom(1.5, 0.6, 10)).toBe(0.6);
  });
});

describe('setCameraSlantPosition', () => {
  // Base isometric geometry: 42° pitch at slant distance 26 (the desktop solo camera).
  const PITCH = 42 * Math.PI / 180;
  const DIST = 26;
  const baseHeight = DIST * Math.sin(PITCH);
  const baseOffsetZ = -DIST * Math.cos(PITCH);

  // A zero-alloc Vector3 stand-in: matches the Vec3Sink contract setCameraSlantPosition writes to.
  function makeSink() {
    const out: { x: number; y: number; z: number; set(x: number, y: number, z: number): void } = {
      x: 0, y: 0, z: 0,
      set(x, y, z) { out.x = x; out.y = y; out.z = z; },
    };
    return out;
  }
  // Look-down pitch (deg) of a camera at `pos` aimed at the ground focus point.
  const pitchDeg = (pos: { x: number; y: number; z: number }, fx: number, fz: number) =>
    Math.atan2(pos.y, Math.hypot(pos.x - fx, pos.z - fz)) * 180 / Math.PI;

  it('scale 1 reproduces the base slant position (solo framing)', () => {
    const v = makeSink();
    setCameraSlantPosition(v, 3, -5, baseHeight, baseOffsetZ, 1);
    expect(v.x).toBe(3);
    expect(v.y).toBeCloseTo(baseHeight, 12);
    expect(v.z).toBeCloseTo(-5 + baseOffsetZ, 12);
  });

  it('keeps the look-down pitch invariant across every scale — the co-op regression guard', () => {
    const fx = 4, fz = -2;
    const base = makeSink();
    setCameraSlantPosition(base, fx, fz, baseHeight, baseOffsetZ, 1);
    expect(pitchDeg(base, fx, fz)).toBeCloseTo(42, 4); // base geometry really is 42°
    // user zoom range (0.6–1.6) AND co-op pull-back (up to ~2.4 combined) must all keep 42°.
    for (const scale of [0.6, 0.8, 1.2, 1.5, 1.6, 2.4]) {
      const v = makeSink();
      setCameraSlantPosition(v, fx, fz, baseHeight, baseOffsetZ, scale);
      expect(pitchDeg(v, fx, fz)).toBeCloseTo(42, 4);
    }
  });
});

describe('parsePersistedZoom', () => {
  it('null (nothing saved) -> default', () => {
    expect(parsePersistedZoom(null)).toBe(CAMERA_ZOOM_DEFAULT);
  });
  it('a valid in-range string round-trips', () => {
    expect(parsePersistedZoom('1.3')).toBe(1.3);
  });
  it('out-of-range strings clamp', () => {
    expect(parsePersistedZoom('99')).toBe(CAMERA_ZOOM_MAX);
    expect(parsePersistedZoom('0.01')).toBe(CAMERA_ZOOM_MIN);
  });
  it('garbage / empty / NaN -> default', () => {
    expect(parsePersistedZoom('abc')).toBe(CAMERA_ZOOM_DEFAULT);
    expect(parsePersistedZoom('')).toBe(CAMERA_ZOOM_DEFAULT);
    expect(parsePersistedZoom('NaN')).toBe(CAMERA_ZOOM_DEFAULT);
  });
});
