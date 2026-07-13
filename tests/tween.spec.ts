import { describe, expect, it } from 'vitest';
import { SceneHost } from '../src/engine/three/SceneHost';
import { tween } from '../src/engine/three/tween';

describe('tween', () => {
    it('progresses linearly and clamps to 1 with onEnd', () => {
        const host = new SceneHost();
        const values: number[] = [];
        let ended = 0;
        tween(host, 1, t => values.push(t), { onEnd: () => ended++ });
        host.tick(0.25);
        host.tick(0.25);
        host.tick(0.6);
        host.tick(0.25); // past end - must not fire again
        expect(values[0]).toBeCloseTo(0.25);
        expect(values[1]).toBeCloseTo(0.5);
        expect(values[2]).toBe(1);
        expect(values.length).toBe(3);
        expect(ended).toBe(1);
    });

    it('applies easing', () => {
        const host = new SceneHost();
        const values: number[] = [];
        tween(host, 1, t => values.push(t), { ease: t => t * t });
        host.tick(0.5);
        expect(values[0]).toBeCloseTo(0.25);
    });

    it('loop wraps progress and never ends', () => {
        const host = new SceneHost();
        const values: number[] = [];
        let ended = false;
        tween(host, 1, t => values.push(t), { loop: true, onEnd: () => (ended = true) });
        host.tick(0.75);
        host.tick(0.5); // 1.25 -> wraps to 0.25
        expect(values[1]).toBeCloseTo(0.25);
        expect(ended).toBe(false);
    });

    it('stop() cancels without firing onEnd', () => {
        const host = new SceneHost();
        let ended = false;
        let updates = 0;
        const handle = tween(host, 1, () => updates++, { onEnd: () => (ended = true) });
        host.tick(0.25);
        handle.stop();
        host.tick(1);
        expect(updates).toBe(1);
        expect(ended).toBe(false);
    });

    it('freezes while animationsEnabled is false (pause parity)', () => {
        const host = new SceneHost();
        const values: number[] = [];
        tween(host, 1, t => values.push(t));
        host.animationsEnabled = false;
        host.tick(0.5);
        expect(values.length).toBe(0);
        host.animationsEnabled = true;
        host.tick(0.5);
        expect(values[0]).toBeCloseTo(0.5);
    });

    it('zero duration completes immediately', () => {
        const host = new SceneHost();
        const values: number[] = [];
        let ended = false;
        tween(host, 0, t => values.push(t), { onEnd: () => (ended = true) });
        expect(values).toEqual([1]);
        expect(ended).toBe(true);
    });
});
