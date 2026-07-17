import { describe, expect, it } from 'vitest';
import { NormalBlending, AdditiveBlending } from 'three';
import { RendererType, SimulationSpace } from '@newkrok/three-particles';
import {
    elementAuraConfig,
    elementBurstConfig,
    elementFlashConfig,
    elementImpactConfig,
    elementNovaConfig,
    elementProjectileHeadConfig,
    elementProjectileTrailConfig,
    elementStatusConfig,
    fireSmokePuffConfig,
} from '../src/survivors/fx/ElementParticles';
import { PowerElement } from '../src/survivors/powers/PowerDefinitions';
import { StatusEffect } from '../src/survivors/GameTypes';

const ELEMENTS: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

const STATUS_WITH_FX = [
    StatusEffect.BURNING,
    StatusEffect.SLOWED,
    StatusEffect.FROZEN,
    StatusEffect.STUNNED,
    StatusEffect.CONFUSED,
];

const STATUS_WITHOUT_FX = [
    StatusEffect.NONE,
    StatusEffect.PUSHED,
    StatusEffect.CHILL,
    StatusEffect.CURSE,
    StatusEffect.FRAGILE,
];

describe('elementStatusConfig', () => {
    it('returns a config for every status with a defined FX recipe', () => {
        for (const effect of STATUS_WITH_FX) {
            expect(elementStatusConfig(effect)).not.toBeNull();
        }
    });

    it('returns null for statuses with no FX', () => {
        for (const effect of STATUS_WITHOUT_FX) {
            expect(elementStatusConfig(effect)).toBeNull();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementStatusConfig(StatusEffect.BURNING);
        const b = elementStatusConfig(StatusEffect.BURNING);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a).not.toBe(b);
    });

    it('caps maxParticles at 24 for every status recipe', () => {
        for (const effect of STATUS_WITH_FX) {
            const config = elementStatusConfig(effect);
            expect(config?.maxParticles).toBeLessThanOrEqual(24);
        }
    });

    it('FROZEN uses the MESH renderer with a shared geometry and no fxSize-scaled startSize', () => {
        const config = elementStatusConfig(StatusEffect.FROZEN);
        expect(config).not.toBeNull();
        expect(config?.renderer?.rendererType).toBe(RendererType.MESH);
        expect(config?.renderer?.mesh?.geometry).toBeDefined();
        const size = config?.startSize as { min: number; max: number };
        // fxSize multiplies by 19; a real-world mesh scale must stay well below that.
        expect(size.max).toBeLessThan(5);
    });

    it('FROZEN shares the same geometry instance across calls (module-level, never disposed)', () => {
        const a = elementStatusConfig(StatusEffect.FROZEN);
        const b = elementStatusConfig(StatusEffect.FROZEN);
        expect(a?.renderer?.mesh?.geometry).toBe(b?.renderer?.mesh?.geometry);
    });
});

describe('elementAuraConfig', () => {
    it('returns a config for every power element', () => {
        for (const element of ELEMENTS) {
            expect(elementAuraConfig(element)).toBeDefined();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementAuraConfig('fire');
        const b = elementAuraConfig('fire');
        expect(a).not.toBe(b);
    });

    it('respects the aura maxParticles budget of 40', () => {
        for (const element of ELEMENTS) {
            const config = elementAuraConfig(element);
            expect(config.maxParticles).toBeLessThanOrEqual(40);
        }
    });
});

describe('elementBurstConfig', () => {
    it('returns a config for every power element', () => {
        for (const element of ELEMENTS) {
            expect(elementBurstConfig(element)).toBeDefined();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementBurstConfig('storm');
        const b = elementBurstConfig('storm');
        expect(a).not.toBe(b);
    });

    it('respects the burst maxParticles budget of 48', () => {
        for (const element of ELEMENTS) {
            const config = elementBurstConfig(element);
            expect(config.maxParticles).toBeLessThanOrEqual(48);
        }
    });
});

describe('elementImpactConfig', () => {
    it('returns a config for every power element', () => {
        for (const element of ELEMENTS) {
            expect(elementImpactConfig(element)).toBeDefined();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementImpactConfig('fire');
        const b = elementImpactConfig('fire');
        expect(a).not.toBe(b);
        expect(a.emission).not.toBe(b.emission);
        expect(a.emission?.bursts).not.toBe(b.emission?.bursts);
    });

    it('is a one-shot burst (looping false, burst at t=0, duration = max lifetime + 0.1)', () => {
        for (const element of ELEMENTS) {
            const config = elementImpactConfig(element);
            expect(config.looping).toBe(false);
            const burst = config.emission?.bursts?.[0];
            expect(burst).toBeDefined();
            expect(burst?.time).toBe(0);
            const lifetime = config.startLifetime as { min: number; max: number };
            expect(config.duration).toBeCloseTo(lifetime.max + 0.1, 5);
        }
    });

    it('respects the impact maxParticles budget of 48', () => {
        for (const element of ELEMENTS) {
            const config = elementImpactConfig(element);
            expect(config.maxParticles).toBeLessThanOrEqual(48);
        }
    });

    it('fire and ice use the MESH renderer with a shared geometry and no fxSize-scaled startSize', () => {
        for (const element of ['fire', 'ice'] as PowerElement[]) {
            const config = elementImpactConfig(element);
            expect(config.renderer?.rendererType).toBe(RendererType.MESH);
            expect(config.renderer?.mesh?.geometry).toBeDefined();
            const size = config.startSize as { min: number; max: number };
            // fxSize multiplies by 19; a real-world mesh scale must stay well below that.
            expect(size.max).toBeLessThan(5);
        }
    });

    it('fire and ice share the same geometry instance across calls (module-level, never disposed)', () => {
        for (const element of ['fire', 'ice'] as PowerElement[]) {
            const a = elementImpactConfig(element);
            const b = elementImpactConfig(element);
            expect(a.renderer?.mesh?.geometry).toBe(b.renderer?.mesh?.geometry);
        }
    });

    it('ice reuses the same shared shard geometry as the FROZEN status recipe', () => {
        const frozen = elementStatusConfig(StatusEffect.FROZEN);
        const ice = elementImpactConfig('ice');
        expect(ice.renderer?.mesh?.geometry).toBe(frozen?.renderer?.mesh?.geometry);
    });

    it('sizeScale scales the burst up without changing particle count', () => {
        const base = elementImpactConfig('fire', 1);
        const scaled = elementImpactConfig('fire', 2);
        const baseSize = base.startSize as { min: number; max: number };
        const scaledSize = scaled.startSize as { min: number; max: number };
        expect(scaledSize.max).toBeGreaterThan(baseSize.max);
        expect(base.emission?.bursts?.[0].count).toBe(scaled.emission?.bursts?.[0].count);
    });
});

describe('elementProjectileTrailConfig', () => {
    it('returns a config for every power element', () => {
        for (const element of ELEMENTS) {
            expect(elementProjectileTrailConfig(element)).toBeDefined();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementProjectileTrailConfig('ice');
        const b = elementProjectileTrailConfig('ice');
        expect(a).not.toBe(b);
    });

    it('is a looping POINTS wake (never TRAIL renderer)', () => {
        for (const element of ELEMENTS) {
            const config = elementProjectileTrailConfig(element);
            expect(config.looping).toBe(true);
            expect(config.renderer?.rendererType).not.toBe(RendererType.TRAIL);
        }
    });

    it('respects the trail maxParticles budget of 32', () => {
        for (const element of ELEMENTS) {
            const config = elementProjectileTrailConfig(element);
            expect(config.maxParticles).toBeLessThanOrEqual(32);
        }
    });

    it('uses WORLD simulation space so the wake hangs behind a moving parent', () => {
        for (const element of ELEMENTS) {
            const config = elementProjectileTrailConfig(element);
            expect(config.simulationSpace).toBe('WORLD');
        }
    });
});

describe('elementProjectileHeadConfig', () => {
    it('returns a config for every power element', () => {
        for (const element of ELEMENTS) {
            expect(elementProjectileHeadConfig(element)).toBeDefined();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementProjectileHeadConfig('fire');
        const b = elementProjectileHeadConfig('fire');
        expect(a).not.toBe(b);
    });

    it('is a looping LOCAL-space cloud so the body rides its carrier rigidly', () => {
        for (const element of ELEMENTS) {
            const config = elementProjectileHeadConfig(element);
            expect(config.looping).toBe(true);
            expect(config.simulationSpace).toBe(SimulationSpace.LOCAL);
        }
    });

    it('respects the head maxParticles budget of 20', () => {
        for (const element of ELEMENTS) {
            const config = elementProjectileHeadConfig(element);
            expect(config.maxParticles).toBeLessThanOrEqual(20);
        }
    });

    it('maxParticles covers the steady-state rate x max lifetime (no emission starvation)', () => {
        for (const element of ELEMENTS) {
            const config = elementProjectileHeadConfig(element);
            const rate = config.emission?.rateOverTime as number;
            const lifetime = config.startLifetime as { min: number; max: number };
            expect(config.maxParticles).toBeGreaterThanOrEqual(Math.floor(rate * lifetime.max));
        }
    });

    it('ice head uses the MESH renderer with the shared shard geometry and mesh-scale sizes', () => {
        const config = elementProjectileHeadConfig('ice');
        expect(config.renderer?.rendererType).toBe(RendererType.MESH);
        const frozen = elementStatusConfig(StatusEffect.FROZEN);
        expect(config.renderer?.mesh?.geometry).toBe(frozen?.renderer?.mesh?.geometry);
        const size = config.startSize as { min: number; max: number };
        // fxSize multiplies by 19; a real-world mesh scale must stay well below that.
        expect(size.max).toBeLessThan(5);
    });
});

describe('elementFlashConfig', () => {
    it('returns a config for every power element', () => {
        for (const element of ELEMENTS) {
            expect(elementFlashConfig(element)).toBeDefined();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementFlashConfig('storm');
        const b = elementFlashConfig('storm');
        expect(a).not.toBe(b);
        expect(a.emission?.bursts).not.toBe(b.emission?.bursts);
    });

    it('is a tiny one-shot burst (looping false, burst at t=0, duration = max lifetime + 0.1)', () => {
        for (const element of ELEMENTS) {
            const config = elementFlashConfig(element);
            expect(config.looping).toBe(false);
            const burst = config.emission?.bursts?.[0];
            expect(burst?.time).toBe(0);
            expect(burst?.count).toBeLessThanOrEqual(4);
            const lifetime = config.startLifetime as { min: number; max: number };
            expect(config.duration).toBeCloseTo(lifetime.max + 0.1, 5);
        }
    });

    it('sizeScale scales the bloom up without changing particle count', () => {
        const base = elementFlashConfig('fire', 1);
        const scaled = elementFlashConfig('fire', 2);
        const baseSize = base.startSize as { min: number; max: number };
        const scaledSize = scaled.startSize as { min: number; max: number };
        expect(scaledSize.max).toBeGreaterThan(baseSize.max);
        expect(base.emission?.bursts?.[0].count).toBe(scaled.emission?.bursts?.[0].count);
    });

    it('grows over lifetime (a bloom, not a shrinking spark)', () => {
        const config = elementFlashConfig('arcane');
        const curve = config.sizeOverLifetime?.lifetimeCurve as { curveFunction: (t: number) => number };
        expect(curve.curveFunction(1)).toBeGreaterThan(curve.curveFunction(0));
    });
});

describe('fireSmokePuffConfig', () => {
    it('is a one-shot NORMAL-blended puff (occluding smoke, not additive glow)', () => {
        const config = fireSmokePuffConfig();
        expect(config.looping).toBe(false);
        expect(config.renderer?.blending).toBe(NormalBlending);
        expect(config.renderer?.blending).not.toBe(AdditiveBlending);
    });

    it('rises (negative gravity scalar = updraft) and grows over lifetime', () => {
        const config = fireSmokePuffConfig();
        expect(config.gravity).toBeLessThan(0);
        const curve = config.sizeOverLifetime?.lifetimeCurve as { curveFunction: (t: number) => number };
        expect(curve.curveFunction(1)).toBeGreaterThan(curve.curveFunction(0));
    });

    it('sizeScale scales speed and size together', () => {
        const base = fireSmokePuffConfig(1);
        const scaled = fireSmokePuffConfig(2);
        expect((scaled.startSize as { max: number }).max).toBeGreaterThan((base.startSize as { max: number }).max);
        expect((scaled.startSpeed as { max: number }).max).toBeGreaterThan((base.startSpeed as { max: number }).max);
    });
});

describe('elementNovaConfig', () => {
    const RADIUS = 4.5;

    it('returns a config for every power element', () => {
        for (const element of ELEMENTS) {
            expect(elementNovaConfig(element, RADIUS)).toBeDefined();
        }
    });

    it('returns a fresh object per call', () => {
        const a = elementNovaConfig('arcane', RADIUS);
        const b = elementNovaConfig('arcane', RADIUS);
        expect(a).not.toBe(b);
    });

    it('is a one-shot CIRCLE burst laid flat via transform.rotation', () => {
        for (const element of ELEMENTS) {
            const config = elementNovaConfig(element, RADIUS);
            expect(config.looping).toBe(false);
            expect(config.shape?.shape).toBe('CIRCLE');
            expect(config.shape?.circle?.radiusThickness).toBe(0);
            expect(config.transform?.rotation?.x).toBeCloseTo(-Math.PI / 2, 5);
        }
    });

    it('burst count is in the 24-36 range', () => {
        for (const element of ELEMENTS) {
            const config = elementNovaConfig(element, RADIUS);
            const count = config.emission?.bursts?.[0].count as number;
            expect(count).toBeGreaterThanOrEqual(24);
            expect(count).toBeLessThanOrEqual(36);
        }
    });

    it('startSpeed carries particles across the given radius within their average lifetime', () => {
        for (const element of ELEMENTS) {
            const config = elementNovaConfig(element, RADIUS);
            const lifetime = config.startLifetime as { min: number; max: number };
            const speed = config.startSpeed as { min: number; max: number };
            const avgLifetime = (lifetime.min + lifetime.max) / 2;
            const avgSpeed = (speed.min + speed.max) / 2;
            const traveled = avgSpeed * avgLifetime;
            expect(traveled).toBeGreaterThan(RADIUS * 0.7);
            expect(traveled).toBeLessThan(RADIUS * 1.3);
        }
    });

    it('waves=2 fires two staggered equal bursts and stretches duration to cover the last one', () => {
        const single = elementNovaConfig('arcane', RADIUS);
        const double = elementNovaConfig('arcane', RADIUS, 2);
        expect(double.emission?.bursts).toHaveLength(2);
        const [first, second] = double.emission!.bursts!;
        expect(first.time).toBe(0);
        expect(second.time).toBeGreaterThan(0);
        expect(second.count).toBe(first.count);
        const lifetime = double.startLifetime as { min: number; max: number };
        expect(double.duration).toBeCloseTo(lifetime.max + 0.1 + second.time, 5);
        expect(double.maxParticles).toBeGreaterThan(single.maxParticles as number);
        expect(double.maxParticles).toBeLessThanOrEqual(72);
    });
});
