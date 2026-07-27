import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { RendererType, SimulationSpace, type ParticleSystemConfig } from '@newkrok/three-particles';
import {
    burstPoolStats,
    clearBurstPool,
    makePooledBurstRecipe,
    spawnPooledBurst,
} from '../src/engine/three/particles/BurstPool';
import {
    clearParticleMaterialCache,
    fxRenderer,
    fxSize,
} from '../src/engine/three/particles/ParticleEffect';
import { SceneHost } from '../src/engine/three/SceneHost';
import {
    elementFlashConfig,
    elementImpactConfig,
    elementNovaConfig,
    fireSmokePuffConfig,
} from '../src/survivors/fx/ElementParticles';

const LIFETIME = 0.4;

function burstConfig(overrides: Partial<ParticleSystemConfig> = {}): ParticleSystemConfig {
    return {
        looping: false,
        duration: LIFETIME + 0.1,
        maxParticles: 10,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 8 }] },
        startLifetime: { min: LIFETIME * 0.7, max: LIFETIME },
        startSpeed: { min: 1, max: 2 },
        startSize: { min: fxSize(0.1), max: fxSize(0.2) },
        startColor: { min: { r: 1, g: 1, b: 1 }, max: { r: 1, g: 1, b: 1 } },
        renderer: fxRenderer('additive'),
        ...overrides,
    };
}

/** Number of particles the library currently has alive in a system. */
function liveParticles(host: SceneHost, name: string): number {
    const object = host.scene.children.find((child) => child.name === name);
    if (!object) return 0;
    const attribute = (object as unknown as {
        geometry: { attributes: Record<string, { getX(i: number): number }> };
    }).geometry.attributes.isActive;
    let count = 0;
    for (let i = 0; i < 10; i++) if (attribute.getX(i)) count++;
    return count;
}

function tick(host: SceneHost, seconds: number, dt = 1 / 60): void {
    for (let t = 0; t < seconds; t += dt) host.tick(dt);
}

afterEach(() => {
    clearBurstPool();
    clearParticleMaterialCache();
});

describe('makePooledBurstRecipe', () => {
    it('rewrites a one-shot burst into a re-armable looping recipe', () => {
        const recipe = makePooledBurstRecipe(burstConfig());
        expect(recipe).not.toBeNull();
        expect(recipe!.config.looping).toBe(true);
        // A burst at time 0 can never satisfy `currentIterationTime < burstTime`,
        // so the library would never re-arm it.
        expect(recipe!.config.emission!.bursts![0].time).toBeGreaterThan(0);
        // The iteration has to be long enough that the library can never wrap on
        // its own - every re-arm is driven explicitly.
        expect(recipe!.config.duration!).toBeGreaterThan(60);
        expect(recipe!.periodMs).toBe(recipe!.config.duration! * 1000);
    });

    it('retires an effect only once every particle is provably gone', () => {
        const recipe = makePooledBurstRecipe(burstConfig())!;
        expect(recipe.lifeMs).toBeGreaterThanOrEqual(LIFETIME * 1000);
        // ...and still sooner than the authored duration, which pads by 0.1s.
        expect(recipe.lifeMs).toBeLessThan((LIFETIME + 0.1) * 1000);
    });

    it('carries multi-wave burst spacing through unchanged', () => {
        const recipe = makePooledBurstRecipe(burstConfig({
            emission: { rateOverTime: 0, bursts: [
                { time: 0, count: 8 }, { time: 0.12, count: 8 }, { time: 0.24, count: 8 },
            ] },
        }))!;
        const times = recipe.config.emission!.bursts!.map((b) => b.time);
        expect(times[1] - times[0]).toBeCloseTo(0.12, 10);
        expect(times[2] - times[1]).toBeCloseTo(0.12, 10);
        // The last wave still has to run its particles out before recycling.
        expect(recipe.lifeMs).toBeGreaterThan(240 + LIFETIME * 1000);
    });

    it('declines every recipe whose emission is not fully burst-driven', () => {
        // A rate keeps emitting for as long as the system runs, and `looping`
        // removes the duration cut-off that used to stop it.
        expect(makePooledBurstRecipe(burstConfig({
            emission: { rateOverTime: 10, bursts: [{ time: 0, count: 8 }] },
        }))).toBeNull();
        expect(makePooledBurstRecipe(burstConfig({ emission: { rateOverTime: 0, bursts: [] } }))).toBeNull();
        expect(makePooledBurstRecipe(burstConfig({ looping: true }))).toBeNull();
        expect(makePooledBurstRecipe(burstConfig({
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 8, cycles: 3, interval: 0.1 }] },
        }))).toBeNull();
    });

    it('declines a recipe whose start values are sampled from a lifetime curve', () => {
        // The rewrite stretches `duration`, which is what the system-lifetime
        // percentage a curve is sampled at is derived from.
        expect(makePooledBurstRecipe(burstConfig({
            startSize: { type: 'EASING', curveFunction: () => 1 },
        } as unknown as Partial<ParticleSystemConfig>))).toBeNull();
        expect(makePooledBurstRecipe(burstConfig({
            startLifetime: { type: 'EASING', curveFunction: () => 1 },
        } as unknown as Partial<ParticleSystemConfig>))).toBeNull();
    });

    it('declines local-space, delayed and sub-emitting recipes', () => {
        expect(makePooledBurstRecipe(burstConfig({ simulationSpace: SimulationSpace.LOCAL }))).toBeNull();
        expect(makePooledBurstRecipe(burstConfig({ startDelay: 0.25 }))).toBeNull();
        expect(makePooledBurstRecipe(burstConfig({
            renderer: { ...fxRenderer('additive'), rendererType: RendererType.TRAIL },
        }))).toBeNull();
    });
});

describe('BurstPool', () => {
    it('recycles one system across repeated spawns instead of building new ones', () => {
        const host = new SceneHost();
        const config = burstConfig();

        for (let i = 0; i < 12; i++) {
            expect(spawnPooledBurst('impact', host, config, new Vector3(i, 0, 0))).toBe(true);
            tick(host, 1);
        }

        expect(burstPoolStats()).toEqual({ recipes: 1, free: 1, live: 0 });
        expect(host.particleSystems.length).toBe(0);
    });

    it('emits the full burst at the requested position on every reuse', () => {
        const host = new SceneHost();
        const config = burstConfig();

        for (const x of [3, -17, 240]) {
            expect(spawnPooledBurst('impact', host, config, new Vector3(x, 0, 5))).toBe(true);
            expect(liveParticles(host, 'impact')).toBe(8);

            const object = host.scene.children.find((child) => child.name === 'impact')!;
            const positions = (object as unknown as {
                geometry: { attributes: Record<string, { getX(i: number): number; getZ(i: number): number }> };
            }).geometry.attributes.position;
            for (let i = 0; i < 8; i++) {
                expect(Math.abs(positions.getX(i) - x)).toBeLessThan(1);
                expect(Math.abs(positions.getZ(i) - 5)).toBeLessThan(1);
            }
            tick(host, 1);
        }
    });

    it('re-bounds a recycled burst so the frustum cannot cull it at its new home', () => {
        // A WORLD-space system's particles ARE its geometry and THREE caches a
        // geometry's bounding sphere forever, so a reused effect would otherwise
        // be tested against the sphere of the burst before it.
        const host = new SceneHost();
        const config = burstConfig();
        const geometryFor = () => {
            const object = host.scene.children.find((child) => child.name === 'impact')!;
            return (object as unknown as {
                geometry: { boundingSphere: { center: { x: number }; radius: number } | null; computeBoundingSphere(): void };
            }).geometry;
        };

        spawnPooledBurst('impact', host, config, new Vector3(0, 0, 0));
        const geometry = geometryFor();
        // Stand in for the renderer's one lazy compute on the first frame.
        geometry.computeBoundingSphere();
        expect(geometry.boundingSphere!.center.x).toBeLessThan(5);
        tick(host, 1);

        spawnPooledBurst('impact', host, config, new Vector3(400, 0, 0));
        expect(geometryFor()).toBe(geometry);
        // The renderer only recomputes when the cache is empty, so arm() has to
        // have emptied it - otherwise the burst is tested against the sphere of
        // the one before it and vanishes.
        expect(geometry.boundingSphere).toBeNull();
        geometry.computeBoundingSphere();
        expect(geometry.boundingSphere!.center.x).toBeGreaterThan(100);
    });

    it('takes a finished effect off the scene and off the tick registry', () => {
        const host = new SceneHost();
        spawnPooledBurst('impact', host, burstConfig(), new Vector3());

        expect(host.particleSystems.length).toBe(1);
        expect(host.scene.children.length).toBe(1);

        tick(host, 1);

        expect(host.particleSystems.length).toBe(0);
        expect(host.scene.children.length).toBe(0);
        expect(burstPoolStats().free).toBe(1);
    });

    it('keeps a burst on screen for its whole life and no longer', () => {
        const host = new SceneHost();
        spawnPooledBurst('impact', host, burstConfig(), new Vector3());

        // The library kills a particle on the first update whose age passes its
        // start lifetime, so mid-flight the effect must still be attached.
        tick(host, LIFETIME * 0.5);
        expect(host.scene.children.length).toBe(1);
        expect(liveParticles(host, 'impact')).toBeGreaterThan(0);

        tick(host, LIFETIME);
        expect(host.scene.children.length).toBe(0);
    });

    it('gives back a whole free list, so a reused burst is never short of particles', () => {
        const host = new SceneHost();
        const config = burstConfig();
        for (let i = 0; i < 20; i++) {
            spawnPooledBurst('impact', host, config, new Vector3(i, 0, 0));
            tick(host, 1);
            spawnPooledBurst('impact', host, config, new Vector3(i, 0, 1));
            expect(liveParticles(host, 'impact')).toBe(8);
            tick(host, 1);
        }
    });

    it('runs concurrent spawns on separate systems', () => {
        const host = new SceneHost();
        const config = burstConfig();

        for (let i = 0; i < 5; i++) spawnPooledBurst('impact', host, config, new Vector3(i * 4, 0, 0));

        expect(host.particleSystems.length).toBe(5);
        expect(burstPoolStats()).toEqual({ recipes: 1, free: 0, live: 5 });

        tick(host, 1);
        expect(burstPoolStats()).toEqual({ recipes: 1, free: 5, live: 0 });
    });

    it('survives a frame long enough to skip the whole burst', () => {
        const host = new SceneHost();
        const config = burstConfig();
        spawnPooledBurst('impact', host, config, new Vector3());
        host.tick(5);

        expect(host.scene.children.length).toBe(0);
        expect(burstPoolStats().free).toBe(1);

        // The recycled system still fires a whole burst.
        spawnPooledBurst('impact', host, config, new Vector3(9, 0, 0));
        expect(liveParticles(host, 'impact')).toBe(8);
    });

    it('declines a recipe it cannot recycle, leaving the caller its own path', () => {
        const host = new SceneHost();
        const streaming = burstConfig({ emission: { rateOverTime: 10, bursts: [{ time: 0, count: 8 }] } });

        expect(spawnPooledBurst('stream', host, streaming, new Vector3())).toBe(false);
        expect(host.particleSystems.length).toBe(0);
        expect(burstPoolStats()).toEqual({ recipes: 1, free: 0, live: 0 });
    });

    it('keys pools on the config object, so distinct recipes never share one', () => {
        const host = new SceneHost();
        const a = burstConfig();
        const b = burstConfig({ maxParticles: 10, gravity: 3 });

        spawnPooledBurst('a', host, a, new Vector3());
        spawnPooledBurst('b', host, b, new Vector3());
        tick(host, 1);

        expect(burstPoolStats()).toEqual({ recipes: 2, free: 2, live: 0 });
    });

    it('frees free and live effects alike on teardown', () => {
        const host = new SceneHost();
        const config = burstConfig();

        spawnPooledBurst('impact', host, config, new Vector3());
        tick(host, 1);
        spawnPooledBurst('impact', host, config, new Vector3());
        spawnPooledBurst('impact', host, config, new Vector3());
        expect(burstPoolStats()).toEqual({ recipes: 1, free: 0, live: 2 });

        clearBurstPool();

        expect(burstPoolStats()).toEqual({ recipes: 0, free: 0, live: 0 });
        expect(host.particleSystems.length).toBe(0);
        expect(host.scene.children.length).toBe(0);
    });

    it('pools every shipped one-shot power recipe', () => {
        // The whole win rides on these being poolable; a recipe edit that trips
        // one of makePooledBurstRecipe's guards should fail here, not silently
        // fall back to a system per hit.
        for (const element of ['fire', 'ice', 'arcane', 'storm', 'physical'] as const) {
            expect(makePooledBurstRecipe(elementImpactConfig(element, 0.6)), `${element} impact`).not.toBeNull();
            expect(makePooledBurstRecipe(elementFlashConfig(element, 1.1)), `${element} flash`).not.toBeNull();
            expect(makePooledBurstRecipe(elementNovaConfig(element, 2, 2)), `${element} nova`).not.toBeNull();
        }
        expect(makePooledBurstRecipe(fireSmokePuffConfig(1))).not.toBeNull();
    });

    it('hands out one config object per one-shot recipe, which is the pool key', () => {
        expect(elementImpactConfig('fire', 0.6)).toBe(elementImpactConfig('fire', 0.6));
        expect(elementImpactConfig('fire', 0.6)).not.toBe(elementImpactConfig('fire', 1.2));
        expect(elementFlashConfig('storm', 1.2)).toBe(elementFlashConfig('storm', 1.2));
        expect(elementNovaConfig('arcane', 3, 2)).toBe(elementNovaConfig('arcane', 3, 2));
        expect(elementNovaConfig('arcane', 3, 2)).not.toBe(elementNovaConfig('arcane', 3, 1));
        expect(fireSmokePuffConfig(1)).toBe(fireSmokePuffConfig(1));
    });

    it('rebuilds a pool bound to a scene that has been torn down', () => {
        const first = new SceneHost();
        const config = burstConfig();
        spawnPooledBurst('impact', first, config, new Vector3());
        tick(first, 1);

        const second = new SceneHost();
        spawnPooledBurst('impact', second, config, new Vector3());

        expect(first.particleSystems.length).toBe(0);
        expect(first.scene.children.length).toBe(0);
        expect(second.particleSystems.length).toBe(1);
        expect(burstPoolStats()).toEqual({ recipes: 1, free: 0, live: 1 });
    });
});
