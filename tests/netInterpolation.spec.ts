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
});
