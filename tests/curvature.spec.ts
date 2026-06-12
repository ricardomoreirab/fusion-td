import { describe, it, expect, afterEach } from 'vitest';
import { curveDrop, curveDropAt, setCurveOrigin, clearCurveOrigin } from '../src/survivors/globe/curvature';
import { GLOBE_RADIUS } from '../src/survivors/globe/constants';

afterEach(() => clearCurveOrigin());

describe('curveDrop', () => {
    it('is zero at the origin', () => {
        expect(curveDrop(0, 0)).toBe(0);
    });

    it('matches d²/2R', () => {
        expect(curveDrop(3, 4)).toBeCloseTo(25 / (2 * GLOBE_RADIUS), 10);
        expect(curveDrop(40, 0, 80)).toBeCloseTo(10, 10);
    });

    it('is monotonic in distance', () => {
        expect(curveDrop(10, 0)).toBeLessThan(curveDrop(20, 0));
        expect(curveDrop(20, 0)).toBeLessThan(curveDrop(0, 30));
    });

    it('is radially symmetric', () => {
        expect(curveDrop(5, 12)).toBeCloseTo(curveDrop(13, 0), 10);
    });
});

describe('curveDropAt (module origin)', () => {
    it('returns 0 when no origin is set', () => {
        expect(curveDropAt(100, 100)).toBe(0);
    });

    it('measures from the set origin', () => {
        setCurveOrigin(10, 20);
        expect(curveDropAt(10, 20)).toBe(0);
        expect(curveDropAt(13, 24)).toBeCloseTo(curveDrop(3, 4), 10);
    });

    it('returns 0 again after clearCurveOrigin', () => {
        setCurveOrigin(10, 20);
        clearCurveOrigin();
        expect(curveDropAt(13, 24)).toBe(0);
    });
});
