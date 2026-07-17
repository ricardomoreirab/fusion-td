import { Object3D, Vector3 } from 'three';
import { LifeTimeCurve, Shape, SimulationSpace, type ParticleSystemConfig } from '@newkrok/three-particles';
import { ParticleEffect, fxRenderer, fxSize } from '../../engine/three/particles/ParticleEffect';
import type { SceneHost } from '../../engine/three/SceneHost';

/** Sparse drifting motes — warm firefly/pollen specks hanging over the meadow.
 *  Pure atmosphere: one looping additive point system (1 draw call), emitted
 *  in a wide flat disc that follows the hero so the field always feels alive
 *  without ever reading as a gameplay signal. */
function motesConfig(): ParticleSystemConfig {
    return {
        looping: true,
        maxParticles: 44,
        simulationSpace: SimulationSpace.WORLD,
        emission: { rateOverTime: 7 },
        startLifetime: { min: 3.5, max: 6.5 },
        startSpeed: { min: 0.05, max: 0.22 },
        startSize: { min: fxSize(0.045), max: fxSize(0.1) },
        startColor: {
            min: { r: 1.0, g: 0.82, b: 0.45 },
            max: { r: 1.0, g: 0.95, b: 0.75 },
        },
        startOpacity: 1,
        // Slow flicker-in/out — sine envelope reads as fireflies, not sparks.
        opacityOverLifetime: {
            isActive: true,
            lifetimeCurve: {
                type: LifeTimeCurve.EASING,
                curveFunction: (t: number) => 0.75 * Math.sin(t * Math.PI) * (0.7 + 0.3 * Math.sin(t * 19)),
            },
        },
        noise: {
            isActive: true, strength: 0.35, frequency: 0.4, octaves: 1,
            positionAmount: 1, rotationAmount: 0, sizeAmount: 0, useRandomOffset: true,
        },
        gravity: -0.02, // faint updraft — motes hang and rise, never rain down
        // Box shapes emit along local +Z; the -π/2 X rotation maps that to
        // world up, so the post-rotation thin axis (z) is vertical.
        shape: {
            shape: Shape.BOX,
            box: { scale: { x: 30, y: 30, z: 2.2 } },
        },
        transform: {
            position: new Vector3(0, 1.4, 0),
            rotation: new Vector3(-Math.PI / 2, 0, 0),
        },
        renderer: fxRenderer('additive'),
    };
}

export class AmbientMotes {
    private effect: ParticleEffect | null;

    constructor(host: SceneHost, follow: Object3D) {
        this.effect = new ParticleEffect('ambientMotes', host, motesConfig(), { follow });
    }

    public dispose(): void {
        this.effect?.dispose();
        this.effect = null;
    }
}
