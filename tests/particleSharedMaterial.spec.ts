import { afterEach, describe, expect, it } from 'vitest';
import { AdditiveBlending, NormalBlending, type Material, type ShaderMaterial } from 'three';
import { type ParticleSystemConfig } from '@newkrok/three-particles';
import {
    clearParticleMaterialCache,
    fxRenderer,
    fxSize,
    ParticleEffect,
    particleMaterialCacheSize,
    particleMaterialsInterchangeable,
} from '../src/engine/three/particles/ParticleEffect';
import { SceneHost } from '../src/engine/three/SceneHost';

function burstConfig(overrides: Partial<ParticleSystemConfig> = {}): ParticleSystemConfig {
    return {
        looping: false,
        duration: 0.2,
        maxParticles: 12,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 12 }] },
        startLifetime: 0.15,
        startSpeed: 1,
        startSize: fxSize(0.1),
        renderer: fxRenderer('additive'),
        ...overrides,
    };
}

function materialOf(effect: ParticleEffect): Material {
    return (effect.object as unknown as { material: Material }).material;
}

afterEach(() => {
    clearParticleMaterialCache();
});

describe('ParticleEffect shared materials', () => {
    it('draws every effect of one recipe through a single material', () => {
        const host = new SceneHost();
        const a = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        const b = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        const c = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });

        expect(materialOf(a)).toBe(materialOf(b));
        expect(materialOf(b)).toBe(materialOf(c));
        expect(particleMaterialCacheSize()).toBe(1);
    });

    it('caches a CLONE, so the first effect never hands its own material to the cache', () => {
        const host = new SceneHost();
        const first = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        const shared = materialOf(first);
        let sharedDisposed = false;
        shared.dispose = () => { sharedDisposed = true; };

        // The first effect's own material was replaced, not adopted: disposing it
        // must leave the shared one usable by everything spawned afterwards.
        first.dispose();
        expect(sharedDisposed).toBe(false);
        expect(materialOf(first)).not.toBe(shared);

        const second = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        expect(materialOf(second)).toBe(shared);
    });

    it('marks the cached material cache-owned so disposeMesh leaves it alone', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        expect(materialOf(effect).userData.cached).toBe(true);
    });

    it('gives the instance its own material back before the library frees it', () => {
        const host = new SceneHost();
        const first = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        const shared = materialOf(first);
        let sharedDisposed = false;
        shared.dispose = () => { sharedDisposed = true; };

        const second = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        expect(materialOf(second)).toBe(shared);

        second.dispose();
        // The library's teardown disposes whatever `instance.material` points at,
        // so the instance must be holding its OWN material again by then.
        expect(materialOf(second)).not.toBe(shared);
        expect(sharedDisposed).toBe(false);

        // …and the shared one is still what the next effect draws through.
        const third = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        expect(materialOf(third)).toBe(shared);
    });

    it('holds one material per recipe across a run of spawns', () => {
        const host = new SceneHost();
        for (let i = 0; i < 50; i++) {
            const fire = new ParticleEffect('fireImpact', host, burstConfig(), { sharedMaterial: 'fireImpact' });
            const ice = new ParticleEffect('iceImpact', host, burstConfig(), { sharedMaterial: 'iceImpact' });
            fire.dispose();
            ice.dispose();
        }
        expect(particleMaterialCacheSize()).toBe(2);
    });

    it('leaves the material private when no key is given', () => {
        const host = new SceneHost();
        const a = new ParticleEffect('impact', host, burstConfig());
        const b = new ParticleEffect('impact', host, burstConfig());
        expect(materialOf(a)).not.toBe(materialOf(b));
        expect(particleMaterialCacheSize()).toBe(0);
    });

    it('falls back to the private material when a key is reused for a different recipe', () => {
        const host = new SceneHost();
        const additive = new ParticleEffect('oops', host, burstConfig(), { sharedMaterial: 'oops' });
        const normal = new ParticleEffect('oops', host, burstConfig({ renderer: fxRenderer('normal') }), {
            sharedMaterial: 'oops',
        });

        expect(materialOf(additive).blending).toBe(AdditiveBlending);
        expect(materialOf(normal).blending).toBe(NormalBlending);
        expect(materialOf(normal)).not.toBe(materialOf(additive));
    });

    it('clearParticleMaterialCache disposes and empties the cache', () => {
        const host = new SceneHost();
        const effect = new ParticleEffect('impact', host, burstConfig(), { sharedMaterial: 'impact' });
        const shared = materialOf(effect);
        let disposed = false;
        shared.dispose = () => { disposed = true; };

        clearParticleMaterialCache();
        expect(disposed).toBe(true);
        expect(particleMaterialCacheSize()).toBe(0);
    });
});

describe('particleMaterialsInterchangeable', () => {
    it('accepts two materials built from the same recipe', () => {
        const host = new SceneHost();
        const a = new ParticleEffect('a', host, burstConfig());
        const b = new ParticleEffect('b', host, burstConfig());
        expect(particleMaterialsInterchangeable(materialOf(a), materialOf(b))).toBe(true);
    });

    it('rejects a differing blend mode, depth flag or uniform value', () => {
        const host = new SceneHost();
        const base = materialOf(new ParticleEffect('a', host, burstConfig()));

        const blend = materialOf(new ParticleEffect('b', host, burstConfig({ renderer: fxRenderer('normal') })));
        expect(particleMaterialsInterchangeable(base, blend)).toBe(false);

        const depth = materialOf(new ParticleEffect('c', host, burstConfig()));
        depth.depthWrite = !base.depthWrite;
        expect(particleMaterialsInterchangeable(base, depth)).toBe(false);

        const uniforms = materialOf(new ParticleEffect('d', host, burstConfig())) as ShaderMaterial;
        uniforms.uniforms.backgroundColorTolerance.value = 0.123;
        expect(particleMaterialsInterchangeable(base, uniforms)).toBe(false);
    });

    it('rejects a differing shader program', () => {
        const host = new SceneHost();
        const base = materialOf(new ParticleEffect('a', host, burstConfig())) as ShaderMaterial;
        const other = materialOf(new ParticleEffect('b', host, burstConfig())) as ShaderMaterial;
        other.fragmentShader = `${other.fragmentShader}\n// changed`;
        expect(particleMaterialsInterchangeable(base, other)).toBe(false);
    });
});

describe('three-particles shader contract', () => {
    // Sharing one material across systems is only sound while every uniform is a
    // recipe constant. `elapsed` is the one that is NOT (each ParticleEffect owns
    // its own clock), and it is declared in the shipped shaders but never read.
    // If a library upgrade starts reading it, every shared effect would animate
    // off one system's clock — so fail here rather than on screen.
    it('declares `elapsed` but never reads it', () => {
        const host = new SceneHost();
        const material = materialOf(new ParticleEffect('a', host, burstConfig())) as ShaderMaterial;
        expect(material.uniforms.elapsed).toBeDefined();

        for (const source of [material.vertexShader, material.fragmentShader]) {
            const uses = source
                .split('\n')
                .filter(line => /\belapsed\b/.test(line))
                .map(line => line.trim());
            expect(uses).toEqual(uses.filter(line => /^uniform\s+float\s+elapsed\s*;$/.test(line)));
        }
    });
});
