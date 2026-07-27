import { afterEach, describe, expect, it } from 'vitest';
import { AdditiveBlending, NormalBlending, Points, Vector3 } from 'three';
import { RendererType, SimulationSpace, type ParticleSystemConfig } from '@newkrok/three-particles';
import {
    burstFieldStats,
    clearBurstFields,
    makeBurstFieldRecipe,
    spawnFieldBurst,
} from '../src/engine/three/particles/BurstField';
import { clearParticleMaterialCache, fxRenderer, fxSize } from '../src/engine/three/particles/ParticleEffect';
import { SceneHost } from '../src/engine/three/SceneHost';
import { elementImpactConfig, elementNovaConfig, fireSmokePuffConfig } from '../src/survivors/fx/ElementParticles';

const LIFETIME = 0.4;
const BURST_COUNT = 8;

function burstConfig(overrides: Partial<ParticleSystemConfig> = {}): ParticleSystemConfig {
    return {
        looping: false,
        duration: LIFETIME + 0.1,
        maxParticles: 10,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: BURST_COUNT }] },
        startLifetime: { min: LIFETIME * 0.7, max: LIFETIME },
        startSpeed: { min: 1, max: 2 },
        startSize: { min: fxSize(0.1), max: fxSize(0.2) },
        startColor: { min: { r: 1, g: 1, b: 1 }, max: { r: 1, g: 1, b: 1 } },
        renderer: fxRenderer('additive'),
        ...overrides,
    };
}

interface FieldView {
    object: Points;
    capacity: number;
    /** World position of every live particle. */
    livePositions(): Vector3[];
    sizeOfDeadSlots(): number[];
}

function view(host: SceneHost, name: string): FieldView | null {
    const object = host.scene.children.find((child) => child.name === name) as Points | undefined;
    if (!object) return null;
    const attrs = (object as unknown as {
        geometry: {
            attributes: Record<string, {
                array: Float32Array;
                data?: { array: Float32Array; stride: number };
                offset: number;
                count: number;
            }>;
        };
    }).geometry.attributes;
    const active = attrs.instanceIsActive ?? attrs.isActive;
    const size = attrs.instanceSize ?? attrs.size;
    const offsets = attrs.instanceOffset ?? attrs.position;
    const scalars = active.data!.array;
    const stride = active.data!.stride;
    const capacity = scalars.length / stride;
    return {
        object,
        capacity,
        livePositions() {
            const out: Vector3[] = [];
            for (let i = 0; i < capacity; i++) {
                if (scalars[i * stride + active.offset] === 0) continue;
                out.push(new Vector3(offsets.array[i * 3], offsets.array[i * 3 + 1], offsets.array[i * 3 + 2]));
            }
            return out;
        },
        sizeOfDeadSlots() {
            const out: number[] = [];
            for (let i = 0; i < capacity; i++) {
                if (scalars[i * stride + active.offset] !== 0) continue;
                out.push(scalars[i * stride + size.offset]);
            }
            return out;
        },
    };
}

function tick(host: SceneHost, seconds: number, dt = 1 / 60): void {
    for (let t = 0; t < seconds - 1e-9; t += dt) host.tick(dt);
}

afterEach(() => {
    clearBurstFields();
    clearParticleMaterialCache();
});

describe('makeBurstFieldRecipe', () => {
    it('rewrites a one-shot burst into a permanently looping two-burst recipe', () => {
        const recipe = makeBurstFieldRecipe(burstConfig())!;
        expect(recipe).not.toBeNull();
        expect(recipe.config.looping).toBe(true);
        expect(recipe.config.duration).toBeGreaterThan(3600);
        expect(recipe.particlesPerSpawn).toBe(BURST_COUNT);
        expect(recipe.capacity % BURST_COUNT).toBe(0);
        expect(recipe.capacity).toBeGreaterThan(BURST_COUNT);
        // Both bursts start parked ahead of the clock and empty.
        expect(recipe.bursts).toHaveLength(2);
        for (const burst of recipe.bursts) expect(burst.count).toBe(0);
        // The rewritten array is the one the library will read.
        expect(recipe.config.emission!.bursts).toBe(recipe.bursts);
    });

    it('leaves the source config untouched', () => {
        const source = burstConfig();
        makeBurstFieldRecipe(source);
        expect(source.looping).toBe(false);
        expect(source.duration).toBe(LIFETIME + 0.1);
        expect(source.emission!.bursts![0]).toEqual({ time: 0, count: BURST_COUNT });
    });

    it.each([
        ['a second burst', { emission: { rateOverTime: 0, bursts: [{ time: 0, count: 4 }, { time: 0.1, count: 4 }] } }],
        ['a burst after time 0', { emission: { rateOverTime: 0, bursts: [{ time: 0.05, count: 4 }] } }],
        ['a variable burst count', { emission: { rateOverTime: 0, bursts: [{ time: 0, count: { min: 4, max: 8 } }] } }],
        ['multiple cycles', { emission: { rateOverTime: 0, bursts: [{ time: 0, count: 4, cycles: 3, interval: 0.1 }] } }],
        ['a probability', { emission: { rateOverTime: 0, bursts: [{ time: 0, count: 4, probability: 0.5 }] } }],
        ['a continuous rate', { emission: { rateOverTime: 5, bursts: [{ time: 0, count: 4 }] } }],
        ['a looping source', { looping: true }],
        ['LOCAL simulation space', { simulationSpace: SimulationSpace.LOCAL }],
        ['a start delay', { startDelay: 0.2 }],
        ['active noise', { noise: { isActive: true, strength: 1, frequency: 1, octaves: 1, positionAmount: 1, rotationAmount: 0, sizeAmount: 0 } }],
        ['a force field', { forceFields: [{ type: 'POINT', position: { x: 0, y: 0, z: 0 }, strength: 1, range: 2 }] }],
        ['normal blending', { renderer: fxRenderer('normal') }],
    ] as [string, Partial<ParticleSystemConfig>][])('refuses %s', (_label, overrides) => {
        expect(makeBurstFieldRecipe(burstConfig(overrides))).toBeNull();
    });

    it('refuses a start value read from a lifetime curve', () => {
        const curve = { type: 'EASING', curveFunction: (t: number) => t } as unknown as number;
        expect(makeBurstFieldRecipe(burstConfig({ startSize: curve }))).toBeNull();
        expect(makeBurstFieldRecipe(burstConfig({ startSpeed: curve }))).toBeNull();
        expect(makeBurstFieldRecipe(burstConfig({ startLifetime: curve }))).toBeNull();
    });

    it('accepts the additive impact recipes the on-hit passives spawn per enemy', () => {
        // fire and arcane are the two highest-rate FX in the game (flamingEdge /
        // arcaneBite fire one per enemy per hit).
        for (const element of ['fire', 'ice', 'arcane', 'storm'] as const) {
            const config = elementImpactConfig(element, 0.6);
            expect(config.renderer!.blending).toBe(AdditiveBlending);
            expect(makeBurstFieldRecipe(config), element).not.toBeNull();
        }
    });

    it('declines the normal-blended impact, smoke puff and multi-wave nova', () => {
        // The physical impact is the one impact recipe drawn with NORMAL
        // blending, where merge order would be visible.
        const physical = elementImpactConfig('physical', 0.6);
        expect(physical.renderer!.blending).toBe(NormalBlending);
        expect(makeBurstFieldRecipe(physical)).toBeNull();

        const smoke = fireSmokePuffConfig(1);
        expect(smoke.renderer!.blending).toBe(NormalBlending);
        expect(makeBurstFieldRecipe(smoke)).toBeNull();

        // A staggered multi-wave nova needs a per-spawn burst schedule.
        expect(makeBurstFieldRecipe(elementNovaConfig('fire', 1.1, 3))).toBeNull();
        // ...while a single-wave one is an ordinary time-0 burst and merges.
        expect(makeBurstFieldRecipe(elementNovaConfig('fire', 1.1, 1))).not.toBeNull();
    });
});

describe('BurstField', () => {
    it('draws every concurrent burst of a recipe as ONE scene object', () => {
        const host = new SceneHost();
        const config = burstConfig();
        for (let i = 0; i < 12; i++) {
            expect(spawnFieldBurst('impact', host, config, new Vector3(i * 4, 0, 0))).toBe(true);
        }
        host.tick(1 / 60);
        expect(host.scene.children.filter((c) => c.name === 'impact')).toHaveLength(1);
        expect(host.particleSystems).toHaveLength(1);
        expect(view(host, 'impact')!.livePositions()).toHaveLength(12 * BURST_COUNT);
    });

    it('places each burst at its own spawn position', () => {
        const host = new SceneHost();
        const config = burstConfig();
        const spawns = [new Vector3(30, 1, 0), new Vector3(-30, 1, 0), new Vector3(0, 1, 30)];
        for (const p of spawns) spawnFieldBurst('impact', host, config, p);
        host.tick(1 / 60);

        const positions = view(host, 'impact')!.livePositions();
        expect(positions).toHaveLength(spawns.length * BURST_COUNT);
        // Every particle sits within the shape radius of exactly one spawn, and
        // each spawn owns the same share of them.
        const perSpawn = spawns.map(() => 0);
        for (const p of positions) {
            const nearest = spawns.reduce((best, s, i) => (p.distanceTo(s) < p.distanceTo(spawns[best]) ? i : best), 0);
            expect(p.distanceTo(spawns[nearest])).toBeLessThan(1);
            perSpawn[nearest]++;
        }
        expect(perSpawn).toEqual(spawns.map(() => BURST_COUNT));
    });

    it('fires on consecutive frames, which one burst slot alone could not', () => {
        const host = new SceneHost();
        const config = burstConfig();
        for (let frame = 0; frame < 6; frame++) {
            spawnFieldBurst('impact', host, config, new Vector3(frame * 5, 0, 0));
            host.tick(1 / 60);
            expect(view(host, 'impact')!.livePositions()).toHaveLength((frame + 1) * BURST_COUNT);
        }
    });

    it('emits nothing on a frame with no spawns', () => {
        const host = new SceneHost();
        const config = burstConfig();
        spawnFieldBurst('impact', host, config, new Vector3(0, 0, 0));
        host.tick(1 / 60);
        const after = view(host, 'impact')!.livePositions().length;
        for (let i = 0; i < 5; i++) host.tick(1 / 60);
        expect(view(host, 'impact')!.livePositions().length).toBe(after);
    });

    it('retires the field from the scene and the tick registry once empty', () => {
        const host = new SceneHost();
        const config = burstConfig();
        spawnFieldBurst('impact', host, config, new Vector3(0, 0, 0));
        host.tick(1 / 60);
        expect(host.particleSystems).toHaveLength(1);

        tick(host, LIFETIME + 0.2);
        expect(host.particleSystems).toHaveLength(0);
        expect(host.scene.children.filter((c) => c.name === 'impact')).toHaveLength(0);
        expect(burstFieldStats().liveParticles).toBe(0);

        // ...and comes straight back for the next spawn, on the same object.
        spawnFieldBurst('impact', host, config, new Vector3(9, 0, 0));
        host.tick(1 / 60);
        expect(host.particleSystems).toHaveLength(1);
        expect(view(host, 'impact')!.livePositions()).toHaveLength(BURST_COUNT);
    });

    it('zeroes the size of dead slots so idle capacity rasterises nothing', () => {
        const host = new SceneHost();
        const config = burstConfig();
        spawnFieldBurst('impact', host, config, new Vector3(0, 0, 0));
        host.tick(1 / 60);
        const v = view(host, 'impact')!;
        expect(v.capacity).toBeGreaterThan(BURST_COUNT);
        expect(v.sizeOfDeadSlots()).toHaveLength(v.capacity - BURST_COUNT);
        expect(v.sizeOfDeadSlots().every((s) => s === 0)).toBe(true);

        // Slots freed by expiry are zeroed too, not just never-used ones.
        tick(host, LIFETIME + 0.2);
        spawnFieldBurst('impact', host, config, new Vector3(50, 0, 0));
        host.tick(1 / 60);
        const after = view(host, 'impact')!;
        expect(after.livePositions()).toHaveLength(BURST_COUNT);
        expect(after.sizeOfDeadSlots().every((s) => s === 0)).toBe(true);
    });

    it('recycles slots, so a long run of spawns never exceeds capacity', () => {
        const host = new SceneHost();
        const config = burstConfig();
        const capacity = makeBurstFieldRecipe(config)!.capacity;
        let declined = 0;
        for (let frame = 0; frame < 400; frame++) {
            for (let i = 0; i < 3; i++) {
                if (!spawnFieldBurst('impact', host, config, new Vector3(i, 0, frame))) declined++;
            }
            host.tick(1 / 60);
            expect(view(host, 'impact')!.livePositions().length).toBeLessThanOrEqual(capacity);
        }
        // 3 spawns/frame at a 0.4s lifetime is ~72 concurrent bursts, far inside
        // capacity - nothing should have fallen through to the pool.
        expect(declined).toBe(0);
        expect(host.scene.children.filter((c) => c.name === 'impact')).toHaveLength(1);
    });

    it('chains a second field rather than overflowing the first', () => {
        const host = new SceneHost();
        const config = burstConfig();
        const capacity = makeBurstFieldRecipe(config)!.capacity;
        const spawnsPerField = capacity / BURST_COUNT;
        for (let i = 0; i < spawnsPerField; i++) spawnFieldBurst('impact', host, config, new Vector3(i, 0, 0));
        expect(burstFieldStats().fields).toBe(1);

        expect(spawnFieldBurst('impact', host, config, new Vector3(-1, 0, 0))).toBe(true);
        expect(burstFieldStats().fields).toBe(2);
        host.tick(1 / 60);
        const objects = host.scene.children.filter((c) => c.name === 'impact');
        expect(objects).toHaveLength(2);
        expect(burstFieldStats().liveParticles).toBe(capacity + BURST_COUNT);
    });

    it('declines rather than dropping particles once the whole chain is committed', () => {
        const host = new SceneHost();
        const config = burstConfig();
        const capacity = makeBurstFieldRecipe(config)!.capacity;
        const maxSpawns = (capacity / BURST_COUNT) * 8;
        for (let i = 0; i < maxSpawns; i++) {
            expect(spawnFieldBurst('impact', host, config, new Vector3(i, 0, 0)), `spawn ${i}`).toBe(true);
        }
        expect(spawnFieldBurst('impact', host, config, new Vector3(0, 0, 0))).toBe(false);
        host.tick(1 / 60);
        expect(burstFieldStats().fields).toBe(8);
        expect(burstFieldStats().liveParticles).toBe(capacity * 8);
    });

    it('packs into the earliest field so the tail of the chain detaches', () => {
        const host = new SceneHost();
        const config = burstConfig();
        const spawnsPerField = makeBurstFieldRecipe(config)!.capacity / BURST_COUNT;
        for (let i = 0; i < spawnsPerField + 1; i++) spawnFieldBurst('impact', host, config, new Vector3(i, 0, 0));
        host.tick(1 / 60);
        expect(host.particleSystems).toHaveLength(2);

        tick(host, LIFETIME + 0.2);
        expect(host.particleSystems).toHaveLength(0);
        // The chain is retained for reuse; a light frame only wakes the first.
        expect(burstFieldStats().fields).toBe(2);
        spawnFieldBurst('impact', host, config, new Vector3(0, 0, 0));
        host.tick(1 / 60);
        expect(host.particleSystems).toHaveLength(1);
    });

    it('opts the merged object out of the frustum test', () => {
        const host = new SceneHost();
        spawnFieldBurst('impact', host, burstConfig(), new Vector3(0, 0, 0));
        host.tick(1 / 60);
        expect(view(host, 'impact')!.object.frustumCulled).toBe(false);
    });

    it('keeps one field per recipe and frees them all on teardown', () => {
        const host = new SceneHost();
        const fire = elementImpactConfig('fire', 0.6);
        const arcane = elementImpactConfig('arcane', 0.6);
        expect(fire.renderer!.rendererType).toBe(RendererType.MESH);
        for (let i = 0; i < 5; i++) {
            spawnFieldBurst('flamingEdgeImpact', host, fire, new Vector3(i, 0, 0));
            spawnFieldBurst('arcaneBiteImpact', host, arcane, new Vector3(0, 0, i));
        }
        host.tick(1 / 60);
        expect(host.particleSystems).toHaveLength(2);
        expect(burstFieldStats().fields).toBe(2);
        expect(burstFieldStats().liveParticles).toBeGreaterThan(0);

        clearBurstFields();
        expect(host.particleSystems).toHaveLength(0);
        expect(host.scene.children.filter((c) => /Impact$/.test(c.name))).toHaveLength(0);
        expect(burstFieldStats()).toEqual({ recipes: 0, fields: 0, liveParticles: 0 });
    });

    it('positions a MESH-renderer recipe through its instance offsets', () => {
        const host = new SceneHost();
        const fire = elementImpactConfig('fire', 0.6);
        spawnFieldBurst('flamingEdgeImpact', host, fire, new Vector3(40, 2, -15));
        host.tick(1 / 60);
        const positions = view(host, 'flamingEdgeImpact')!.livePositions();
        expect(positions.length).toBeGreaterThan(0);
        for (const p of positions) expect(p.distanceTo(new Vector3(40, 2, -15))).toBeLessThan(1);
    });

    it('keeps particles at their burst position as they age', () => {
        const host = new SceneHost();
        const config = burstConfig({ startSpeed: { min: 0, max: 0 }, gravity: 0 });
        spawnFieldBurst('impact', host, config, new Vector3(100, 0, 0));
        host.tick(1 / 60);
        tick(host, LIFETIME * 0.5);
        const positions = view(host, 'impact')!.livePositions();
        expect(positions.length).toBeGreaterThan(0);
        for (const p of positions) expect(p.distanceTo(new Vector3(100, 0, 0))).toBeLessThan(1);
    });

    it('rebuilds the field when the host changes', () => {
        const first = new SceneHost();
        const config = burstConfig();
        spawnFieldBurst('impact', first, config, new Vector3(0, 0, 0));
        first.tick(1 / 60);
        expect(first.particleSystems).toHaveLength(1);

        const second = new SceneHost();
        spawnFieldBurst('impact', second, config, new Vector3(0, 0, 0));
        second.tick(1 / 60);
        expect(first.particleSystems).toHaveLength(0);
        expect(first.scene.children.filter((c) => c.name === 'impact')).toHaveLength(0);
        expect(second.particleSystems).toHaveLength(1);
        expect(burstFieldStats().fields).toBe(1);
    });
});
