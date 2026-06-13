import { describe, it, expect } from 'vitest';
import { computeCameraFocus } from '../src/survivors/coop/cameraFocus';

// Co-op framing is now expressed as a multiplier on the camera's BASE slant distance
// (1 = solo framing, >1 = pulled straight back), NOT an absolute height. This keeps
// the look-down pitch identical to solo — see setCameraSlantPosition.
const OPTS = { maxScale: 1.5, scalePerUnit: 0.02 };

describe('computeCameraFocus', () => {
    it('falls back to the single hero at solo framing when there is no teammate', () => {
        const f = computeCameraFocus({ x: 3, z: 7 }, null, OPTS);
        expect(f.x).toBe(3);
        expect(f.z).toBe(7);
        expect(f.distanceScale).toBe(1); // solo perspective, no pull-back
    });

    it('centers on the midpoint of two heroes', () => {
        const f = computeCameraFocus({ x: 0, z: 0 }, { x: 10, z: -4 }, OPTS);
        expect(f.x).toBe(5);
        expect(f.z).toBe(-2);
    });

    it('matches solo framing (scale 1) when the heroes are on the same spot', () => {
        // Regression guard: at zero separation the co-op camera MUST equal solo.
        const f = computeCameraFocus({ x: 4, z: -2 }, { x: 4, z: -2 }, OPTS);
        expect(f.distanceScale).toBe(1);
    });

    it('pulls the camera back (scale > 1) as the heroes separate, capped at maxScale', () => {
        const near = computeCameraFocus({ x: 0, z: 0 }, { x: 2, z: 0 }, OPTS);
        const far = computeCameraFocus({ x: 0, z: 0 }, { x: 1000, z: 0 }, OPTS);
        expect(near.distanceScale).toBeGreaterThan(1);
        expect(near.distanceScale).toBeCloseTo(1.04, 5); // 1 + 2 * 0.02
        expect(far.distanceScale).toBe(1.5);             // capped at maxScale
    });
});
