import { describe, it, expect } from 'vitest';
import { PoseBuffer, type Pose } from '../src/net/Interpolation';

const pose = (x: number, z: number, ry = 0): Pose => ({ x, y: 0, z, ry });

describe('PoseBuffer', () => {
    it('returns null before any sample', () => {
        expect(new PoseBuffer().sample(0)).toBeNull();
    });

    it('returns the only sample when just one exists', () => {
        const b = new PoseBuffer();
        b.push(100, pose(2, 4));
        expect(b.sample(100)).toEqual(pose(2, 4));
    });

    it('linearly interpolates between two samples at the render time', () => {
        const b = new PoseBuffer();
        b.push(100, pose(0, 0));
        b.push(200, pose(10, -20));
        expect(b.sample(150)).toEqual(pose(5, -10));
    });

    it('clamps to the latest sample when render time is past it', () => {
        const b = new PoseBuffer();
        b.push(100, pose(0, 0));
        b.push(200, pose(10, 0));
        expect(b.sample(999)).toEqual(pose(10, 0));
    });

    it('interpolates rotation along the shortest arc across the PI wrap', () => {
        const b = new PoseBuffer();
        b.push(0, pose(0, 0, 3.0));
        b.push(100, pose(0, 0, -3.0));
        const out = b.sample(50)!;
        expect(Math.abs(Math.abs(out.ry) - Math.PI)).toBeLessThan(0.15);
    });

    it('caps stored samples at 32 and drops the oldest', () => {
        const b = new PoseBuffer();
        for (let i = 0; i < 40; i++) b.push(i, pose(i, 0));
        // 32 retained (t=8..39); sampling at/under the oldest retained clamps to it.
        expect(b.sample(0)).toEqual(pose(8, 0));
        expect(b.sample(8)).toEqual(pose(8, 0));
    });

    describe('speedAt', () => {
        it('returns 0 with fewer than two samples', () => {
            const b = new PoseBuffer();
            expect(b.speedAt(100)).toBe(0);
            b.push(100, pose(0, 0));
            expect(b.speedAt(100)).toBe(0);
        });

        it('returns the XZ displacement rate of the bracketing segment', () => {
            const b = new PoseBuffer();
            b.push(0, pose(0, 0));
            b.push(100, pose(3, 4)); // 5 units over 0.1s → 50 u/s
            expect(b.speedAt(50)).toBeCloseTo(50);
        });

        it('returns 0 outside the buffered range (clamped pose is not moving)', () => {
            const b = new PoseBuffer();
            b.push(100, pose(0, 0));
            b.push(200, pose(10, 0));
            expect(b.speedAt(50)).toBe(0);
            expect(b.speedAt(999)).toBe(0);
        });

        it('ignores vertical (y) motion', () => {
            const b = new PoseBuffer();
            b.push(0, { x: 0, y: 0, z: 0, ry: 0 });
            b.push(1000, { x: 0, y: 5, z: 0, ry: 0 });
            expect(b.speedAt(500)).toBe(0);
        });
    });
});
