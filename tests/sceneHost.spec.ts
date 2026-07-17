import { describe, expect, it } from 'vitest';
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
