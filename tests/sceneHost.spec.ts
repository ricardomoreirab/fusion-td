import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';

describe('SceneHost update bus', () => {
    it('stamps deltaSeconds and runs callbacks each tick', () => {
        const host = new SceneHost();
        const seen: number[] = [];
        host.onBeforeRender.add(h => seen.push(h.deltaSeconds));
        host.tick(0.016);
        host.tick(0.033);
        expect(seen).toEqual([0.016, 0.033]);
    });

    it('remove is synchronous - safe from inside a callback', () => {
        const host = new SceneHost();
        let calls = 0;
        const token = host.onBeforeRender.add(() => {
            calls++;
            host.onBeforeRender.remove(token);
        });
        host.tick(0.016);
        host.tick(0.016);
        expect(calls).toBe(1);
        expect(host.onBeforeRender.size).toBe(0);
    });

    it('a callback that removes a LATER callback prevents its stale run this frame', () => {
        const host = new SceneHost();
        let staleRan = false;
        let victim: ReturnType<typeof host.onBeforeRender.add> | null = null;
        host.onBeforeRender.add(() => host.onBeforeRender.remove(victim));
        victim = host.onBeforeRender.add(() => {
            staleRan = true;
        });
        host.tick(0.016);
        expect(staleRan).toBe(false);
    });

    it('callbacks added during a tick run from the next tick', () => {
        const host = new SceneHost();
        let innerRuns = 0;
        let added = false;
        host.onBeforeRender.add(() => {
            if (!added) {
                added = true;
                host.onBeforeRender.add(() => innerRuns++);
            }
        });
        host.tick(0.016);
        expect(innerRuns).toBe(0);
        host.tick(0.016);
        expect(innerRuns).toBe(1);
    });

    it('animationsEnabled gates onAnimUpdate but not onBeforeRender', () => {
        const host = new SceneHost();
        let renderCalls = 0;
        let animCalls = 0;
        host.onBeforeRender.add(() => renderCalls++);
        host.onAnimUpdate.add(() => animCalls++);
        host.animationsEnabled = false;
        host.tick(0.016);
        expect(renderCalls).toBe(1);
        expect(animCalls).toBe(0);
        host.animationsEnabled = true;
        host.tick(0.016);
        expect(animCalls).toBe(1);
    });

    it('particle registry: register once, unregister removes', () => {
        const host = new SceneHost();
        const ticks: number[] = [];
        const ps = { tick: (dt: number) => ticks.push(dt) };
        host.registerParticleSystem(ps);
        host.registerParticleSystem(ps);
        host.tick(0.02);
        expect(ticks).toEqual([0.02]);
        host.unregisterParticleSystem(ps);
        host.tick(0.02);
        expect(ticks).toEqual([0.02]);
    });

    it('onBeforeRender.add does not allocate a fresh array on every run (mutation-safe live iteration)', () => {
        const host = new SceneHost();
        let calls = 0;
        host.onBeforeRender.add(() => calls++);
        for (let i = 0; i < 5; i++) host.tick(0.016);
        expect(calls).toBe(5);
    });

    it('a callback that adds a callback which itself removes another mid-run leaves the bus consistent', () => {
        const host = new SceneHost();
        let victimRan = false;
        let victim: ReturnType<typeof host.onBeforeRender.add> | null = null;
        victim = host.onBeforeRender.add(() => {
            victimRan = true;
        });
        host.onBeforeRender.add(() => host.onBeforeRender.remove(victim));
        host.tick(0.016);
        expect(victimRan).toBe(true);
        expect(host.onBeforeRender.size).toBe(1);
        victimRan = false;
        host.tick(0.016);
        expect(victimRan).toBe(false);
    });

    it('particle registry: a system disposed mid-tick (unregistering a later system) is not ticked this frame', () => {
        const host = new SceneHost();
        let victimTicked = false;
        let victim: { tick: (dt: number) => void } | null = null;
        victim = { tick: () => { victimTicked = true; } };
        const disposer = {
            tick: () => host.unregisterParticleSystem(victim!),
        };
        host.registerParticleSystem(disposer);
        host.registerParticleSystem(victim);
        host.tick(0.02);
        expect(victimTicked).toBe(false);
        expect(host.particleSystems.length).toBe(1);
        expect(host.particleSystems).toEqual([disposer]);
    });

    it('particle registry: a system registered during tick does not tick until the next tick', () => {
        const host = new SceneHost();
        let lateTicks = 0;
        let registrar: { tick: (dt: number) => void } | null = null;
        const late = { tick: () => lateTicks++ };
        registrar = { tick: () => host.registerParticleSystem(late) };
        host.registerParticleSystem(registrar);
        host.tick(0.02);
        expect(lateTicks).toBe(0);
        host.tick(0.02);
        expect(lateTicks).toBe(1);
    });

    it('particle registry: a system that unregisters itself mid-tick does not throw and is removed', () => {
        const host = new SceneHost();
        let ticks = 0;
        const selfDisposing = {
            tick: () => {
                ticks++;
                host.unregisterParticleSystem(selfDisposing);
            },
        };
        host.registerParticleSystem(selfDisposing);
        expect(() => host.tick(0.02)).not.toThrow();
        expect(ticks).toBe(1);
        expect(host.particleSystems.length).toBe(0);
        host.tick(0.02);
        expect(ticks).toBe(1);
    });
});

/** Stands in for @newkrok/three-particles, which calls
 *  `particleSystem.parent.updateMatrixWorld()` on every update - a full-graph
 *  walk whenever the emitter sits at the scene root. */
function nagger(host: SceneHost, times: number, onTick?: () => void) {
    return {
        tick: () => {
            onTick?.();
            for (let i = 0; i < times; i++) host.scene.updateMatrixWorld();
        },
    };
}

describe('SceneHost world-matrix pass', () => {
    it('runs exactly one pass per tick', () => {
        const host = new SceneHost();
        expect(host.matrixWorldPasses).toBe(0);
        host.tick(0.016);
        expect(host.matrixWorldPasses).toBe(1);
        host.tick(0.016);
        expect(host.matrixWorldPasses).toBe(2);
    });

    it('stays at one pass per tick however many times the particle loop asks', () => {
        const host = new SceneHost();
        for (let i = 0; i < 8; i++) host.registerParticleSystem(nagger(host, 20));
        host.tick(0.016);
        // 8 systems x 20 requests = 160 suppressed; only tick()'s own pass runs.
        expect(host.matrixWorldPasses).toBe(1);
        host.tick(0.016);
        expect(host.matrixWorldPasses).toBe(2);
    });

    it('the pass runs BEFORE the particle loop, so emitters read fresh matrices', () => {
        const host = new SceneHost();
        const child = new Object3D();
        host.scene.add(child);
        // A gameplay object moved on the update bus, exactly like a projectile
        // hosting a trail emitter.
        host.onBeforeRender.add(() => { child.position.x = 5; });
        let seenX = Number.NaN;
        host.registerParticleSystem(nagger(host, 3, () => {
            seenX = child.matrixWorld.elements[12];
        }));
        host.tick(0.016);
        expect(seenX).toBe(5);
    });

    it('suppression is released when a particle system throws', () => {
        const host = new SceneHost();
        const exploder = { tick: () => { throw new Error('boom'); } };
        host.registerParticleSystem(exploder);
        expect(() => host.tick(0.016)).toThrow('boom');
        // The pass tick() ran before the loop still counted...
        expect(host.matrixWorldPasses).toBe(1);
        // ...and the guard is NOT stuck on: a direct call recomputes for real.
        host.scene.updateMatrixWorld();
        expect(host.matrixWorldPasses).toBe(2);

        // The next tick must keep updating world matrices - a stuck guard here
        // would silently freeze every transform in the game.
        host.unregisterParticleSystem(exploder);
        const child = new Object3D();
        host.scene.add(child);
        child.position.z = 7;
        host.tick(0.016);
        expect(host.matrixWorldPasses).toBe(3);
        expect(child.matrixWorld.elements[14]).toBe(7);
    });

    it('only the scene instance is guarded - a non-scene parent still walks', () => {
        const host = new SceneHost();
        const rig = new Object3D();      // e.g. a projectile hosting a trail
        const emitter = new Object3D();
        rig.add(emitter);
        host.scene.add(rig);
        host.registerParticleSystem({
            tick: () => {
                rig.position.x = 3;
                // What the library does for a mesh-parented WORLD-space system.
                rig.updateMatrixWorld();
                expect(emitter.matrixWorld.elements[12]).toBe(3);
            },
        });
        host.tick(0.016);
        expect(host.matrixWorldPasses).toBe(1);
    });
});
