import { OctahedronGeometry, TetrahedronGeometry, Vector3 } from 'three';
import { LifeTimeCurve, RendererType, Shape, SimulationSpace, type ParticleSystemConfig } from '@newkrok/three-particles';
import { fxRenderer, fxSize } from '../../engine/three/particles/ParticleEffect';
import { PowerElement } from '../powers/PowerDefinitions';
import { StatusEffect } from '../GameTypes';

const UP = new Vector3(-Math.PI / 2, 0, 0);
const DOWN = new Vector3(Math.PI / 2, 0, 0);

// Shared shard geometry for the FROZEN mesh-particle recipe. Module-level,
// never disposed (same invariant as MaterialCache: bounded, shared resource).
const sharedShardGeometry = new OctahedronGeometry(0.07, 0);

// Shared ember geometry for the fire impact burst's tumbling MESH particles.
// Module-level, never disposed - same bounded-resource pattern as above.
const sharedEmberGeometry = new TetrahedronGeometry(0.05, 0);

function fireConfig(
    maxParticles: number, rate: number, radius: number, maxLifetime: number,
    minSpeed: number, maxSpeed: number
): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: rate },
        startLifetime: { min: 0.45, max: maxLifetime },
        startSpeed: { min: minSpeed, max: maxSpeed },
        startSize: { min: fxSize(0.16), max: fxSize(0.3) },
        startColor: { min: { r: 1, g: 0.85, b: 0.5 }, max: { r: 1, g: 0.95, b: 0.7 } },
        startOpacity: 1,
        colorOverLifetime: {
            isActive: true,
            r: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - 0.45 * t },
            g: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - 0.85 * t },
            b: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.max(0, 1 - 2.2 * t) },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.7 + 0.55 * Math.sin(t * Math.PI) },
        },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t },
        },
        noise: {
            isActive: true, strength: 0.5, frequency: 1.4, octaves: 1,
            positionAmount: 1, rotationAmount: 0, sizeAmount: 0.2, useRandomOffset: true,
        },
        gravity: -0.5,
        shape: { shape: Shape.CONE, cone: { angle: 10, radius, radiusThickness: 1, arc: 360 } },
        transform: { rotation: UP },
        renderer: fxRenderer('additive'),
    };
}

function iceMistConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 24,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 10 },
        startLifetime: { min: 0.8, max: 1.4 },
        startSpeed: { min: 0.15, max: 0.4 },
        startSize: { min: fxSize(0.22), max: fxSize(0.4) },
        startColor: { min: { r: 0.55, g: 0.8, b: 1 }, max: { r: 0.75, g: 0.92, b: 1 } },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.55 * Math.sin(t * Math.PI) },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.6 + 0.9 * t },
        },
        noise: {
            isActive: true, strength: 0.15, frequency: 0.5, octaves: 1,
            positionAmount: 0.6, rotationAmount: 0, sizeAmount: 0, useRandomOffset: true,
        },
        gravity: 0.35,
        shape: { shape: Shape.CONE, cone: { angle: 25, radius: 0.3, radiusThickness: 1, arc: 360 } },
        transform: { rotation: DOWN },
        renderer: fxRenderer('additive'),
    };
}

function iceShardsConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 16,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 8 },
        startLifetime: { min: 0.6, max: 1.1 },
        startSpeed: { min: 0.15, max: 0.45 },
        // MESH particle startSize is a real-world scale multiplier, not the
        // point-sprite pixel scale - do NOT run this through fxSize().
        startSize: { min: 0.7, max: 1.6 },
        startColor: { min: { r: 0.5, g: 0.85, b: 1 }, max: { r: 0.8, g: 0.97, b: 1 } },
        startOpacity: 1,
        rotationOverLifetime: { isActive: true, min: 60, max: 240 },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t * t },
        },
        gravity: 0.8,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.35, radiusThickness: 0.4, arc: 360 } },
        renderer: { ...fxRenderer('additive'), rendererType: RendererType.MESH, mesh: { geometry: sharedShardGeometry } },
    };
}

function stormSparksConfig(duration: number, count: number, radius: number): ParticleSystemConfig {
    return {
        looping: true,
        duration,
        maxParticles: 24,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count }] },
        startLifetime: { min: 0.08, max: 0.22 },
        startSpeed: { min: 2.2, max: 4.5 },
        startSize: { min: fxSize(0.08), max: fxSize(0.16) },
        startColor: { min: { r: 1, g: 0.95, b: 0.65 }, max: { r: 1, g: 1, b: 0.9 } },
        startOpacity: 1,
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - 0.6 * t },
        },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t },
        },
        noise: {
            isActive: true, strength: 0.9, frequency: 3, octaves: 1,
            positionAmount: 1.6, rotationAmount: 0, sizeAmount: 0, useRandomOffset: true,
        },
        shape: { shape: Shape.SPHERE, sphere: { radius, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function arcaneMotesConfig(rate: number, radius: number): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 24,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: rate },
        startLifetime: { min: 1.0, max: 1.8 },
        startSpeed: { min: 0.05, max: 0.15 },
        startSize: { min: fxSize(0.09), max: fxSize(0.16) },
        startColor: { min: { r: 0.62, g: 0.28, b: 1 }, max: { r: 0.8, g: 0.5, b: 1 } },
        startOpacity: 1,
        velocityOverLifetime: {
            isActive: true,
            linear: { x: 0, y: 0.25, z: 0 },
            orbital: { x: 0, y: 3.2, z: 0 },
        },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.sin(t * Math.PI) },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.8 + 0.4 * Math.sin(t * Math.PI * 3) },
        },
        gravity: 0,
        shape: { shape: Shape.CIRCLE, circle: { radius, radiusThickness: 0, arc: 360 } },
        transform: { rotation: UP },
        renderer: fxRenderer('additive'),
    };
}

function physicalGritConfig(maxParticles: number, rate: number): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: rate },
        startLifetime: { min: 0.4, max: 0.8 },
        startSpeed: { min: 0.6, max: 1.4 },
        startSize: { min: fxSize(0.1), max: fxSize(0.2) },
        startColor: { min: { r: 0.75, g: 0.72, b: 0.65 }, max: { r: 0.9, g: 0.88, b: 0.82 } },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.8 * (1 - t) },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.7 + 0.5 * t },
        },
        gravity: 1.2,
        shape: { shape: Shape.CONE, cone: { angle: 35, radius: 0.3, radiusThickness: 1, arc: 360 } },
        transform: { rotation: UP },
        renderer: fxRenderer('normal'),
    };
}

/**
 * Status -> recipe mapping for per-enemy looping FX. Returns null when the
 * status has no dedicated particle look.
 */
export function elementStatusConfig(effect: StatusEffect): ParticleSystemConfig | null {
    switch (effect) {
        case StatusEffect.BURNING:
            return fireConfig(24, 22, 0.22, 0.8, 0.9, 1.7);
        case StatusEffect.SLOWED:
            return iceMistConfig();
        case StatusEffect.FROZEN:
            return iceShardsConfig();
        case StatusEffect.STUNNED:
            return stormSparksConfig(0.45, 6, 0.25);
        case StatusEffect.CONFUSED:
            return arcaneMotesConfig(12, 0.4);
        default:
            return null;
    }
}

/** Hero-attached looping aura, one per equipped power element. Richer than
 *  the status recipes (hero-only cost, no horde multiplier). */
export function elementAuraConfig(element: PowerElement): ParticleSystemConfig {
    switch (element) {
        case 'fire':
            return fireConfig(40, 14, 0.45, 1.0, 0.6, 1.1);
        case 'ice':
            return iceMistConfig();
        case 'arcane':
            return arcaneMotesConfig(12, 0.4);
        case 'storm':
            return stormSparksConfig(0.6, 10, 0.5);
        case 'physical':
        default:
            return physicalGritConfig(40, 10);
    }
}

/** Looping trail-ish emitter used by the barbarian spin FX (created per
 *  spin, stopped after). */
export function elementBurstConfig(element: PowerElement): ParticleSystemConfig {
    switch (element) {
        case 'fire':
            return fireConfig(48, 22, 0.22, 0.8, 0.9, 1.7);
        case 'ice':
            return iceMistConfig();
        case 'arcane':
            return arcaneMotesConfig(12, 0.4);
        case 'storm':
            return stormSparksConfig(0.45, 6, 0.25);
        case 'physical':
        default:
            return physicalGritConfig(48, 10);
    }
}

function fireImpactConfig(sizeScale: number): ParticleSystemConfig {
    const lifetime = 0.4;
    return {
        looping: false,
        duration: lifetime + 0.1,
        maxParticles: 10,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 8 }] },
        startLifetime: { min: lifetime * 0.7, max: lifetime },
        startSpeed: { min: 1.2 * sizeScale, max: 2.6 * sizeScale },
        // MESH particle startSize is a real-world scale multiplier, not the
        // point-sprite pixel scale - do NOT run this through fxSize().
        startSize: { min: 0.5 * sizeScale, max: 1.1 * sizeScale },
        startColor: { min: { r: 1, g: 1, b: 0.9 }, max: { r: 1, g: 0.6, b: 0.2 } },
        startOpacity: 1,
        colorOverLifetime: {
            isActive: true,
            r: { type: LifeTimeCurve.EASING, curveFunction: () => 1 },
            g: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - 0.75 * t },
            b: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.max(0, 1 - 3 * t) },
        },
        rotationOverLifetime: { isActive: true, min: 90, max: 300 },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t },
        },
        gravity: 2.2,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.15 * sizeScale, radiusThickness: 1, arc: 360 } },
        renderer: { ...fxRenderer('additive'), rendererType: RendererType.MESH, mesh: { geometry: sharedEmberGeometry } },
    };
}

function iceImpactConfig(sizeScale: number): ParticleSystemConfig {
    const lifetime = 0.5;
    return {
        looping: false,
        duration: lifetime + 0.1,
        maxParticles: 12,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 10 }] },
        startLifetime: { min: lifetime * 0.7, max: lifetime },
        startSpeed: { min: 1.0 * sizeScale, max: 2.4 * sizeScale },
        // MESH particle startSize is a real-world scale multiplier, not the
        // point-sprite pixel scale - do NOT run this through fxSize().
        startSize: { min: 0.5 * sizeScale, max: 1.3 * sizeScale },
        startColor: { min: { r: 0.5, g: 0.85, b: 1 }, max: { r: 0.8, g: 0.97, b: 1 } },
        startOpacity: 1,
        rotationOverLifetime: { isActive: true, min: 120, max: 360 },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t * t },
        },
        gravity: 1.5,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.15 * sizeScale, radiusThickness: 1, arc: 360 } },
        renderer: { ...fxRenderer('additive'), rendererType: RendererType.MESH, mesh: { geometry: sharedShardGeometry } },
    };
}

function arcaneImpactConfig(sizeScale: number): ParticleSystemConfig {
    const lifetime = 0.55;
    return {
        looping: false,
        duration: lifetime + 0.1,
        maxParticles: 12,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 12 }] },
        startLifetime: { min: lifetime * 0.75, max: lifetime },
        startSpeed: { min: 0.4 * sizeScale, max: 1.0 * sizeScale },
        startSize: { min: fxSize(0.08 * sizeScale), max: fxSize(0.15 * sizeScale) },
        startColor: { min: { r: 0.62, g: 0.28, b: 1 }, max: { r: 0.85, g: 0.55, b: 1 } },
        startOpacity: 1,
        velocityOverLifetime: {
            isActive: true,
            linear: { x: 0, y: 0.1, z: 0 },
            orbital: { x: 0, y: 5.5, z: 0 },
        },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.sin(t * Math.PI) },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.12 * sizeScale, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function stormImpactConfig(sizeScale: number): ParticleSystemConfig {
    // Very short lifetimes read as a crackle rather than a puff; wide startSpeed
    // variance stands in for per-particle jitter/noise (the config schema has no
    // dedicated jitter field for one-shot bursts short enough that noise curves
    // never get a chance to visibly evolve).
    return {
        looping: false,
        duration: 0.28,
        maxParticles: 8,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 8 }] },
        startLifetime: { min: 0.06, max: 0.18 },
        startSpeed: { min: 1.5 * sizeScale, max: 5.5 * sizeScale },
        startSize: { min: fxSize(0.06 * sizeScale), max: fxSize(0.14 * sizeScale) },
        startColor: { min: { r: 1, g: 0.95, b: 0.65 }, max: { r: 1, g: 1, b: 0.9 } },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.08 * sizeScale, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function physicalImpactConfig(sizeScale: number): ParticleSystemConfig {
    const lifetime = 0.6;
    return {
        looping: false,
        duration: lifetime + 0.1,
        maxParticles: 10,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 10 }] },
        startLifetime: { min: lifetime * 0.6, max: lifetime },
        startSpeed: { min: 1.0 * sizeScale, max: 2.2 * sizeScale },
        startSize: { min: fxSize(0.1 * sizeScale), max: fxSize(0.2 * sizeScale) },
        startColor: { min: { r: 0.75, g: 0.72, b: 0.65 }, max: { r: 0.9, g: 0.88, b: 0.82 } },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.8 * (1 - t) },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.7 + 0.5 * t },
        },
        gravity: 1.8,
        shape: { shape: Shape.CONE, cone: { angle: 35, radius: 0.25 * sizeScale, radiusThickness: 1, arc: 360 } },
        transform: { rotation: UP },
        renderer: fxRenderer('normal'),
    };
}

/** One-shot burst for hits/explosions. sizeScale lets callers match an
 *  explosion's own AOE radius/impact strength without a second recipe. */
export function elementImpactConfig(element: PowerElement, sizeScale: number = 1): ParticleSystemConfig {
    switch (element) {
        case 'fire':
            return fireImpactConfig(sizeScale);
        case 'ice':
            return iceImpactConfig(sizeScale);
        case 'arcane':
            return arcaneImpactConfig(sizeScale);
        case 'storm':
            return stormImpactConfig(sizeScale);
        case 'physical':
        default:
            return physicalImpactConfig(sizeScale);
    }
}

function fireTrailConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 20,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 20 },
        startLifetime: { min: 0.2, max: 0.4 },
        startSpeed: { min: 0.1, max: 0.35 },
        startSize: { min: fxSize(0.08), max: fxSize(0.16) },
        startColor: { min: { r: 1, g: 0.6, b: 0.15 }, max: { r: 1, g: 0.85, b: 0.4 } },
        startOpacity: 0.85,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - 0.5 * t },
        },
        gravity: -0.3,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.06, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function iceTrailConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 18,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 14 },
        startLifetime: { min: 0.3, max: 0.55 },
        startSpeed: { min: 0.05, max: 0.2 },
        startSize: { min: fxSize(0.07), max: fxSize(0.14) },
        startColor: { min: { r: 0.6, g: 0.88, b: 1 }, max: { r: 0.8, g: 0.96, b: 1 } },
        startOpacity: 0.75,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
        },
        gravity: 0.15,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.05, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function arcaneTrailConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 16,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 12 },
        startLifetime: { min: 0.35, max: 0.6 },
        startSpeed: { min: 0.05, max: 0.15 },
        startSize: { min: fxSize(0.06), max: fxSize(0.12) },
        startColor: { min: { r: 0.65, g: 0.3, b: 1 }, max: { r: 0.85, g: 0.55, b: 1 } },
        startOpacity: 0.8,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.sin(t * Math.PI) },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.05, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function stormTrailConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 16,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [
            { time: 0, count: 3, cycles: 1000, interval: 0.3 },
        ] },
        startLifetime: { min: 0.08, max: 0.18 },
        startSpeed: { min: 0.8, max: 2.0 },
        startSize: { min: fxSize(0.05), max: fxSize(0.1) },
        startColor: { min: { r: 1, g: 0.95, b: 0.6 }, max: { r: 1, g: 1, b: 0.9 } },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.05, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function physicalTrailConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 14,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 10 },
        startLifetime: { min: 0.2, max: 0.4 },
        startSpeed: { min: 0.1, max: 0.3 },
        startSize: { min: fxSize(0.05), max: fxSize(0.1) },
        startColor: { min: { r: 0.78, g: 0.76, b: 0.7 }, max: { r: 0.92, g: 0.9, b: 0.85 } },
        startOpacity: 0.6,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
        },
        gravity: 0.6,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.05, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('normal'),
    };
}

/** Looping low-rate wake meant to be created with `follow: <flying mesh>` so
 *  the trail hangs in the air behind the projectile instead of riding along
 *  with it. Always POINTS renderer (never TRAIL) - multiple concurrent
 *  projectiles (piercing/multishot powers) rule out the single-ribbon
 *  TRAIL renderer entirely, so every element uses the same POINTS wake
 *  approach for consistency. physical returns a light dust wake rather than
 *  null so Piercing Shot's fast silver arrow keeps a visible trail too. */
export function elementProjectileTrailConfig(element: PowerElement): ParticleSystemConfig {
    switch (element) {
        case 'fire':
            return fireTrailConfig();
        case 'ice':
            return iceTrailConfig();
        case 'arcane':
            return arcaneTrailConfig();
        case 'storm':
            return stormTrailConfig();
        case 'physical':
        default:
            return physicalTrailConfig();
    }
}

const NOVA_WAVE_GAP = 0.12;

function novaRingConfig(
    radius: number, lifetime: number, count: number,
    colorMin: { r: number; g: number; b: number }, colorMax: { r: number; g: number; b: number },
    size: { min: number; max: number },
    waves: number = 1,
): ParticleSystemConfig {
    const speed = radius / lifetime;
    return {
        looping: false,
        duration: lifetime + 0.1 + (waves - 1) * NOVA_WAVE_GAP,
        maxParticles: Math.min(72, count * waves + 4),
        simulationSpace: SimulationSpace.WORLD,
        emission: {
            rateOverTime: 0,
            bursts: Array.from({ length: waves }, (_, i) => ({ time: i * NOVA_WAVE_GAP, count })),
        },
        startLifetime: { min: lifetime * 0.85, max: lifetime },
        startSpeed: { min: speed * 0.85, max: speed * 1.15 },
        startSize: size,
        startColor: { min: colorMin, max: colorMax },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t },
        },
        gravity: 0,
        shape: { shape: Shape.CIRCLE, circle: { radius: 0.05, radiusThickness: 0, arc: 360 } },
        transform: { rotation: UP },
        renderer: fxRenderer('additive'),
    };
}

/** Expanding-ring burst for nova/radial casts. Particles cross `radius`
 *  within their average lifetime (startSpeed derived from radius/lifetime).
 *  `waves` > 1 fires extra staggered rings from the same system (one burst
 *  each, NOVA_WAVE_GAP apart) - cheaper than stacking systems. */
export function elementNovaConfig(element: PowerElement, radius: number, waves: number = 1): ParticleSystemConfig {
    switch (element) {
        case 'fire':
            return novaRingConfig(radius, 0.5, 28,
                { r: 1, g: 0.55, b: 0.1 }, { r: 1, g: 0.85, b: 0.4 },
                { min: fxSize(0.1), max: fxSize(0.2) }, waves);
        case 'ice':
            return novaRingConfig(radius, 0.55, 28,
                { r: 0.5, g: 0.85, b: 1 }, { r: 0.8, g: 0.97, b: 1 },
                { min: fxSize(0.1), max: fxSize(0.2) }, waves);
        case 'arcane':
            return novaRingConfig(radius, 0.5, 32,
                { r: 0.65, g: 0.3, b: 1 }, { r: 0.88, g: 0.55, b: 1 },
                { min: fxSize(0.1), max: fxSize(0.2) }, waves);
        case 'storm':
            return novaRingConfig(radius, 0.4, 32,
                { r: 1, g: 0.95, b: 0.6 }, { r: 1, g: 1, b: 0.9 },
                { min: fxSize(0.08), max: fxSize(0.16) }, waves);
        case 'physical':
        default:
            return novaRingConfig(radius, 0.45, 24,
                { r: 0.8, g: 0.77, b: 0.7 }, { r: 0.95, g: 0.92, b: 0.85 },
                { min: fxSize(0.1), max: fxSize(0.18) }, waves);
    }
}

// =============================================================================
// PROJECTILE HEADS - the projectile BODY itself as a particle system. LOCAL
// simulation space keeps the cloud rigidly attached to the moving carrier
// (the trail configs above deliberately use WORLD space for the opposite
// reason - their particles must hang in the air behind it).
// =============================================================================

function fireHeadConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 18,
        simulationSpace: SimulationSpace.LOCAL,
        emission: { rateOverTime: 46 },
        startLifetime: { min: 0.14, max: 0.3 },
        startSpeed: { min: 0.2, max: 0.6 },
        startSize: { min: fxSize(0.22), max: fxSize(0.42) },
        startColor: { min: { r: 1, g: 0.88, b: 0.5 }, max: { r: 1, g: 0.97, b: 0.75 } },
        startOpacity: 1,
        colorOverLifetime: {
            isActive: true,
            r: { type: LifeTimeCurve.EASING, curveFunction: () => 1 },
            g: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - 0.6 * t },
            b: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.max(0, 1 - 2.5 * t) },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - 0.55 * t },
        },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t },
        },
        noise: {
            isActive: true, strength: 0.4, frequency: 1.8, octaves: 1,
            positionAmount: 0.8, rotationAmount: 0, sizeAmount: 0.2, useRandomOffset: true,
        },
        gravity: -0.4,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.1, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function iceHeadConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 10,
        simulationSpace: SimulationSpace.LOCAL,
        emission: { rateOverTime: 13 },
        startLifetime: { min: 0.35, max: 0.6 },
        startSpeed: { min: 0.1, max: 0.3 },
        // MESH particle startSize is a real-world scale multiplier, not the
        // point-sprite pixel scale - do NOT run this through fxSize().
        startSize: { min: 0.7, max: 1.4 },
        startColor: { min: { r: 0.5, g: 0.85, b: 1 }, max: { r: 0.82, g: 0.97, b: 1 } },
        startOpacity: 1,
        rotationOverLifetime: { isActive: true, min: 90, max: 320 },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t * t },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.16, radiusThickness: 0.6, arc: 360 } },
        renderer: { ...fxRenderer('additive'), rendererType: RendererType.MESH, mesh: { geometry: sharedShardGeometry } },
    };
}

function arcaneHeadConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 20,
        simulationSpace: SimulationSpace.LOCAL,
        emission: { rateOverTime: 28 },
        startLifetime: { min: 0.3, max: 0.55 },
        startSpeed: { min: 0.05, max: 0.15 },
        startSize: { min: fxSize(0.09), max: fxSize(0.17) },
        startColor: { min: { r: 0.62, g: 0.28, b: 1 }, max: { r: 0.85, g: 0.55, b: 1 } },
        startOpacity: 1,
        velocityOverLifetime: {
            isActive: true,
            linear: { x: 0, y: 0, z: 0 },
            orbital: { x: 0, y: 10, z: 0 },
        },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.sin(t * Math.PI) },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.2, radiusThickness: 0, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function stormHeadConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 16,
        simulationSpace: SimulationSpace.LOCAL,
        emission: { rateOverTime: 55 },
        startLifetime: { min: 0.05, max: 0.16 },
        startSpeed: { min: 1.2, max: 3 },
        startSize: { min: fxSize(0.07), max: fxSize(0.14) },
        startColor: { min: { r: 1, g: 0.95, b: 0.65 }, max: { r: 1, g: 1, b: 0.9 } },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.08, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

function physicalHeadConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 12,
        simulationSpace: SimulationSpace.LOCAL,
        emission: { rateOverTime: 26 },
        startLifetime: { min: 0.08, max: 0.18 },
        startSpeed: { min: 0.3, max: 0.8 },
        startSize: { min: fxSize(0.08), max: fxSize(0.15) },
        startColor: { min: { r: 0.85, g: 0.83, b: 0.78 }, max: { r: 0.98, g: 0.97, b: 0.95 } },
        startOpacity: 1,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.06, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

/** Looping projectile-body cloud meant to be created with `follow: <carrier>`
 *  alongside elementProjectileTrailConfig's hanging wake. */
export function elementProjectileHeadConfig(element: PowerElement): ParticleSystemConfig {
    switch (element) {
        case 'fire':
            return fireHeadConfig();
        case 'ice':
            return iceHeadConfig();
        case 'arcane':
            return arcaneHeadConfig();
        case 'storm':
            return stormHeadConfig();
        case 'physical':
        default:
            return physicalHeadConfig();
    }
}

// =============================================================================
// FLASH + SMOKE - impact garnish shared by the power casts.
// =============================================================================

function flashConfig(
    colorMin: { r: number; g: number; b: number }, colorMax: { r: number; g: number; b: number },
    sizeScale: number,
): ParticleSystemConfig {
    const lifetime = 0.2;
    return {
        looping: false,
        duration: lifetime + 0.1,
        maxParticles: 4,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 3 }] },
        startLifetime: { min: lifetime * 0.7, max: lifetime },
        startSpeed: { min: 0, max: 0.1 },
        startSize: { min: fxSize(0.5 * sizeScale), max: fxSize(0.75 * sizeScale) },
        startColor: { min: colorMin, max: colorMax },
        startOpacity: 0.9,
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.55 + 1.8 * t },
        },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t },
        },
        gravity: 0,
        shape: { shape: Shape.SPHERE, sphere: { radius: 0.02 * sizeScale, radiusThickness: 1, arc: 360 } },
        renderer: fxRenderer('additive'),
    };
}

/** One-shot bright bloom at an impact/cast point (the particle replacement
 *  for the old expanding-flash-sphere mesh hack). */
export function elementFlashConfig(element: PowerElement, sizeScale: number = 1): ParticleSystemConfig {
    switch (element) {
        case 'fire':
            return flashConfig({ r: 1, g: 0.85, b: 0.45 }, { r: 1, g: 0.95, b: 0.7 }, sizeScale);
        case 'ice':
            return flashConfig({ r: 0.6, g: 0.9, b: 1 }, { r: 0.85, g: 0.97, b: 1 }, sizeScale);
        case 'arcane':
            return flashConfig({ r: 0.8, g: 0.5, b: 1 }, { r: 0.9, g: 0.7, b: 1 }, sizeScale);
        case 'storm':
            return flashConfig({ r: 1, g: 0.97, b: 0.7 }, { r: 1, g: 1, b: 0.95 }, sizeScale);
        case 'physical':
        default:
            return flashConfig({ r: 0.85, g: 0.83, b: 0.78 }, { r: 0.95, g: 0.93, b: 0.88 }, sizeScale);
    }
}

/** One-shot rising smoke puff for fire explosions (normal blending - reads
 *  as occluding smoke over the bright field, not additive glow). */
export function fireSmokePuffConfig(sizeScale: number = 1): ParticleSystemConfig {
    const lifetime = 1.1;
    return {
        looping: false,
        duration: lifetime + 0.1,
        maxParticles: 8,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 6 }] },
        startLifetime: { min: 0.6, max: lifetime },
        startSpeed: { min: 0.3 * sizeScale, max: 0.9 * sizeScale },
        startSize: { min: fxSize(0.3 * sizeScale), max: fxSize(0.55 * sizeScale) },
        startColor: { min: { r: 0.22, g: 0.2, b: 0.18 }, max: { r: 0.38, g: 0.35, b: 0.32 } },
        startOpacity: 0.45,
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => Math.sin(t * Math.PI) },
        },
        sizeOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 0.6 + 1.1 * t },
        },
        noise: {
            isActive: true, strength: 0.3, frequency: 0.8, octaves: 1,
            positionAmount: 0.7, rotationAmount: 0, sizeAmount: 0.2, useRandomOffset: true,
        },
        gravity: -0.6,
        shape: { shape: Shape.CONE, cone: { angle: 20, radius: 0.2 * sizeScale, radiusThickness: 1, arc: 360 } },
        transform: { rotation: UP },
        renderer: fxRenderer('normal'),
    };
}
