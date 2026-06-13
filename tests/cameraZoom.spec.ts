import { describe, it, expect } from 'vitest';
import {
  clampZoom, stepZoom, lerpZoom, parsePersistedZoom,
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
