import { OctahedronGeometry, Vector3 } from 'three';
import { LifeTimeCurve, RendererType, Shape, SimulationSpace, type ParticleSystemConfig } from '@newkrok/three-particles';
import { ParticleEffect, fxRenderer } from '../../engine/three/particles/ParticleEffect';
import type { SceneHost } from '../../engine/three/SceneHost';

// Shared gem geometry for the kill-loot burst mesh particles. Module-level,
// never disposed — same bounded-resource invariant as ElementParticles.
const sharedGemGeometry = new OctahedronGeometry(0.09, 0);

const UP = new Vector3(-Math.PI / 2, 0, 0);

/** Cap on concurrently-live gem bursts: kills come in clumps during hordes,
 *  and every burst is its own small particle system (1 draw call). Beyond the
 *  cap the kill still shows its gold float — the burst is pure garnish. */
const MAX_ACTIVE_BURSTS = 6;
let activeBursts = 0;

function gemBurstConfig(): ParticleSystemConfig {
    return {
        looping: false,
        duration: 1.1,
        maxParticles: 5,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 4 }] },
        startLifetime: { min: 0.55, max: 0.95 },
        startSpeed: { min: 1.4, max: 2.6 },
        // MESH particle startSize is a real-world scale multiplier (not fxSize).
        startSize: { min: 1.3, max: 2.1 },
        startColor: { min: { r: 1, g: 0.78, b: 0.2 }, max: { r: 1, g: 0.92, b: 0.5 } },
        startOpacity: 1,
        rotationOverLifetime: { isActive: true, min: 120, max: 420 },
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t * t * t },
        },
        gravity: 1.6, // gems arc up and rain back into the grass
        shape: { shape: Shape.CONE, cone: { angle: 32, radius: 0.15, radiusThickness: 1, arc: 360 } },
        transform: { rotation: UP },
        renderer: { ...fxRenderer('additive'), rendererType: RendererType.MESH, mesh: { geometry: sharedGemGeometry } },
    };
}

/** Cosmetic gold-gem spray at a kill position — loot made visible without
 *  touching the reward math (gold/XP are credited exactly as before). */
export function spawnKillGems(scene: SceneHost, x: number, z: number): void {
    if (activeBursts >= MAX_ACTIVE_BURSTS) return;
    activeBursts++;
    const fx = new ParticleEffect('killGems', scene, gemBurstConfig(), { autoDispose: true });
    fx.object.position.set(x, 0.5, z);
    fx.onDispose = () => { activeBursts = Math.max(0, activeBursts - 1); };
}
