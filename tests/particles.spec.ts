import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { rgba } from '../src/engine/three/math';
import { ParticleSystem } from '../src/engine/three/particles/ParticleSystem';
import { SceneHost } from '../src/engine/three/SceneHost';

/**
 * Babylon sim-time parity: simDt = updateSpeed * dt * 60.
 * With updateSpeed = 1/60, simDt equals dt exactly - used below so the
 * assertions read in plain seconds.
 */
function makeSystem(host: SceneHost, capacity = 100): ParticleSystem {
    const ps = new ParticleSystem('test', capacity, host);
    ps.updateSpeed = 1 / 60;
    ps.emitter = new Vector3(0, 0, 0);
    ps.minLifeTime = 1;
    ps.maxLifeTime = 1;
    ps.emitRate = 10;
    return ps;
}

describe('ParticleSystem', () => {
    it('emits at emitRate scaled by Babylon sim time and respects capacity', () => {
        const host = new SceneHost();
        const ps = makeSystem(host, 5);
        ps.emitRate = 100;
        ps.start();
        host.tick(0.1); // 100/s * 0.1s = 10 wanted, capacity 5
        expect(ps.getLiveCount()).toBe(5);
    });

    it('updateSpeed scales simulation time (default 0.01 = 0.6x realtime)', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        ps.updateSpeed = 0.01;
        ps.emitRate = 100;
        ps.start();
        host.tick(0.1); // simDt = 0.06 -> 6 particles
        expect(ps.getLiveCount()).toBe(6);
    });

    it('particles die at end of lifetime', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        ps.start();
        host.tick(0.5);
        const alive = ps.getLiveCount();
        expect(alive).toBeGreaterThan(0);
        ps.stop();
        host.tick(0.6);
        host.tick(0.6); // 1.2s elapsed - past the 1s lifetime of everything emitted
        expect(ps.getLiveCount()).toBe(0);
    });

    it('stop() halts emission but lets live particles finish', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        ps.start();
        host.tick(0.2);
        const alive = ps.getLiveCount();
        ps.stop();
        host.tick(0.2);
        expect(ps.getLiveCount()).toBeLessThanOrEqual(alive);
        expect(ps.isStarted()).toBe(false);
    });

    it('manualEmitCount bursts once then resets to 0', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        ps.manualEmitCount = 7;
        ps.start();
        host.tick(0.016);
        expect(ps.getLiveCount()).toBe(7);
        expect(ps.manualEmitCount).toBe(0);
        host.tick(0.016);
        expect(ps.getLiveCount()).toBe(7); // no further emission
    });

    it('gravity accelerates particles', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        ps.direction1.set(0, 0, 0);
        ps.direction2.set(0, 0, 0);
        ps.gravity.set(0, -10, 0);
        ps.manualEmitCount = 1;
        ps.start();
        host.tick(0.1);
        host.tick(0.1);
        const y = ps.points.geometry.attributes.position.getY(0);
        expect(y).toBeLessThan(0);
    });

    it('color fades from start color toward colorDead over lifetime', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        ps.color1 = rgba(1, 0, 0, 1);
        ps.color2 = rgba(1, 0, 0, 1);
        ps.colorDead = rgba(0, 0, 0, 0);
        ps.manualEmitCount = 1;
        ps.start();
        host.tick(0.016);
        ps.stop();
        host.tick(0.5);
        const colors = ps.points.geometry.attributes.aColor;
        expect(colors.getX(0)).toBeLessThan(0.6);
        expect(colors.getX(0)).toBeGreaterThan(0.3);
        expect(colors.getW(0)).toBeLessThan(0.6);
    });

    it('follows an Object3D emitter world position', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        const parent = new Object3D();
        const emitterNode = new Object3D();
        parent.add(emitterNode);
        host.scene.add(parent);
        parent.position.set(10, 0, 0);
        emitterNode.position.set(0, 2, 0);
        ps.emitter = emitterNode;
        ps.manualEmitCount = 1;
        ps.start();
        host.tick(0.016);
        const pos = ps.points.geometry.attributes.position;
        expect(pos.getX(0)).toBeCloseTo(10);
        expect(pos.getY(0)).toBeCloseTo(2);
    });

    it('reset() kills all live particles', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        ps.start();
        host.tick(0.3);
        expect(ps.getLiveCount()).toBeGreaterThan(0);
        ps.reset();
        expect(ps.getLiveCount()).toBe(0);
    });

    it('dispose unregisters from the host, removes the points, and fires onDispose', () => {
        const host = new SceneHost();
        const ps = makeSystem(host);
        let onDisposeFired = false;
        ps.onDispose = () => (onDisposeFired = true);
        expect(host.particleSystems.length).toBe(1);
        expect(ps.points.parent).toBe(host.scene);
        ps.dispose();
        expect(host.particleSystems.length).toBe(0);
        expect(ps.points.parent).toBeNull();
        expect(onDisposeFired).toBe(true);
        expect(() => host.tick(0.016)).not.toThrow();
    });
});
