import { describe, expect, it } from 'vitest';
import { Object3D, Points } from 'three';
import { LifeTimeCurve, type ParticleSystemConfig } from '@newkrok/three-particles';
import { fxRenderer, fxSize, ParticleEffect } from '../src/engine/three/particles/ParticleEffect';
import { SceneHost } from '../src/engine/three/SceneHost';

function loopingConfig(overrides: Partial<ParticleSystemConfig> = {}): ParticleSystemConfig {
    return {
        looping: true,
        duration: 5,
        maxParticles: 50,
        emission: { rateOverTime: 50 },
        startLifetime: 1,
        startSpeed: 1,
        startSize: fxSize(0.1),
        renderer: fxRenderer('additive'),
        ...overrides,
    };
}

function burstConfig(overrides: Partial<ParticleSystemConfig> = {}): ParticleSystemConfig {
    return {
        looping: false,
        duration: 0.2,
        maxParticles: 50,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 20 }] },
        startLifetime: 1,
        startSpeed: 1,
        startSize: fxSize(0.1),
        renderer: fxRenderer('additive'),
        ...overrides,
    };
}

describe('ParticleEffect', () => {
    it('registers with the host and parents the instance under the scene root by default', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('test', host, loopingConfig());
        expect(host.particleSystems.length).toBe(1);
        expect(effect.object.parent).toBe(host.scene);
        expect(effect.object.name).toBe('test');
    });

    it('parents the instance under a given Object3D via opts.parent', () => {
        const host = new SceneHost();
        const parent = new Object3D();
        host.scene.add(parent);
        const effect = new ParticleEffect('child', host, loopingConfig(), { parent });
        expect(effect.object.parent).toBe(parent);
    });

    it('ticking via host.tick(dt) advances the system and emits particles without throwing', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('emit', host, loopingConfig());
        expect(() => host.tick(0.1)).not.toThrow();
        expect(() => host.tick(0.1)).not.toThrow();
        const positions = (effect.object as Points).geometry.attributes.position;
        expect(positions).toBeDefined();
    });

    it('stop() halts emission (pauseEmitter) without throwing on subsequent ticks', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('stoppable', host, loopingConfig());
        host.tick(0.1);
        effect.stop();
        expect(() => host.tick(0.1)).not.toThrow();
    });

    it('start() resumes emission after stop() (startPaused then start())', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('paused', host, loopingConfig(), { startPaused: true });
        expect(() => host.tick(0.1)).not.toThrow();
        effect.start();
        expect(() => host.tick(0.1)).not.toThrow();
    });

    it('dispose() is idempotent, unregisters from the host, and removes the instance from its parent', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('disposable', host, loopingConfig());
        let onDisposeFired = false;
        effect.onDispose = () => (onDisposeFired = true);

        expect(host.particleSystems.length).toBe(1);
        effect.dispose();
        expect(host.particleSystems.length).toBe(0);
        expect(effect.object.parent).toBeNull();
        expect(onDisposeFired).toBe(true);

        expect(() => effect.dispose()).not.toThrow();
        expect(() => effect.stop()).not.toThrow();
        expect(() => host.tick(0.1)).not.toThrow();
    });

    it('autoDispose fires after a non-looping system completes its duration', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('burst', host, burstConfig(), { autoDispose: true });
        expect(host.particleSystems.length).toBe(1);

        // Duration is 0.2s; tick well past it so onComplete fires and the
        // wrapper self-disposes on the following tick.
        host.tick(0.1);
        host.tick(0.2);
        host.tick(0.1);

        expect(host.particleSystems.length).toBe(0);
        expect(effect.object.parent).toBeNull();
    });

    it('does not auto-dispose when autoDispose is false, even past duration', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('burst-no-autodispose', host, burstConfig());
        host.tick(0.1);
        host.tick(0.2);
        host.tick(0.1);
        expect(host.particleSystems.length).toBe(1);
        effect.dispose();
    });

    it('follows a moving parent Object3D across ticks without throwing', () => {
        const host = new SceneHost();
        const parent = new Object3D();
        host.scene.add(parent);
        const effect = new ParticleEffect(
            'follow',
            host,
            loopingConfig({ simulationSpace: 'WORLD' as any }),
            { parent }
        );
        parent.position.set(10, 0, 0);
        host.tick(0.1);
        parent.position.set(20, 0, 0);
        expect(() => host.tick(0.1)).not.toThrow();
        effect.dispose();
    });

    it('fxSize scales world units by 19', () => {
        expect(fxSize(1)).toBe(19);
        expect(fxSize(0.5)).toBe(9.5);
    });

    it('fxRenderer returns a complete Renderer config for both blend modes', () => {
        const additive = fxRenderer('additive');
        const normal = fxRenderer('normal');
        expect(additive.transparent).toBe(true);
        expect(additive.depthWrite).toBe(false);
        expect(normal.transparent).toBe(true);
        expect(additive.blending).not.toBe(normal.blending);
    });

    it('supports opacityOverLifetime easing curves without throwing', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect(
            'fade',
            host,
            loopingConfig({
                opacityOverLifetime: {
                    isActive: true,
                    lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
                },
            })
        );
        expect(() => host.tick(0.1)).not.toThrow();
        effect.dispose();
    });
});
