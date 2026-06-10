import { describe, it, expect } from 'vitest';
import { computeCameraFocus } from '../src/survivors/coop/cameraFocus';

const OPTS = { baseHeight: 20, maxHeight: 30, zoomPerUnit: 0.5 };

describe('computeCameraFocus', () => {
    it('falls back to the single hero when there is no teammate', () => {
        const f = computeCameraFocus({ x: 3, z: 7 }, null, OPTS);
        expect(f.x).toBe(3);
        expect(f.z).toBe(7);
        expect(f.height).toBe(20);
    });

    it('centers on the midpoint of two heroes', () => {
        const f = computeCameraFocus({ x: 0, z: 0 }, { x: 10, z: -4 }, OPTS);
        expect(f.x).toBe(5);
        expect(f.z).toBe(-2);
    });

    it('zooms out (raises height) as the heroes separate, capped at maxHeight', () => {
        const near = computeCameraFocus({ x: 0, z: 0 }, { x: 2, z: 0 }, OPTS);
        const far = computeCameraFocus({ x: 0, z: 0 }, { x: 100, z: 0 }, OPTS);
        expect(near.height).toBeGreaterThan(20);
        expect(near.height).toBeCloseTo(21, 5);
        expect(far.height).toBe(30);
    });
});
