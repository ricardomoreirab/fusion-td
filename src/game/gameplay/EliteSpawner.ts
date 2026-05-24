import { Color3, MeshBuilder, StandardMaterial, Scene, Observer } from '@babylonjs/core';
import { Enemy } from './enemies/Enemy';

const ELEMENT_COLORS: Record<string, Color3> = {
    fire:     new Color3(1.0, 0.4, 0.0),
    ice:      new Color3(0.3, 0.7, 1.0),
    arcane:   new Color3(0.8, 0.3, 1.0),
    physical: new Color3(0.9, 0.9, 0.9),
    storm:    new Color3(0.8, 0.8, 1.0),
};

/**
 * Transform a regular enemy into an elite:
 * - 1.4× scale
 * - 3× HP
 * - 1.5× reward
 * - Emissive aura sphere (pulsing alpha) tinted to the drop element
 * - Element-colored spikes protruding from the top
 * - Ground glow disc at the enemy's feet
 */
export function makeElite(enemy: Enemy, element: string, scene: Scene): void {
    enemy.isElite = true;
    enemy.eliteDropElement = element;

    const color = ELEMENT_COLORS[element] ?? new Color3(1, 1, 1);

    // Scale up mesh
    const mesh = (enemy as any).mesh;
    if (mesh) {
        mesh.scaling.scaleInPlace(1.4);
    }

    // Triple HP
    const newMax = ((enemy as any).maxHealth ?? 30) * 3;
    (enemy as any).maxHealth = newMax;
    (enemy as any).health = newMax;

    // 1.5× reward
    if ((enemy as any).reward !== undefined) {
        (enemy as any).reward = Math.floor((enemy as any).reward * 1.5);
    }

    if (!mesh) return;

    // ── Pulsing aura sphere ──────────────────────────────────────────────────
    const aura = MeshBuilder.CreateSphere('eliteAura_' + element, { diameter: 2.6 }, scene);
    const auraMat = new StandardMaterial('eliteAuraMat_' + element + '_' + Math.random(), scene);
    auraMat.emissiveColor = color;
    auraMat.alpha = 0.18;
    aura.material = auraMat;
    aura.parent = mesh;
    aura.position.y = 0.8;

    // Pulse the aura between alpha 0.10 and 0.30 over ~1.5 s
    const auraObserver: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
        if (aura.isDisposed()) return;
        const t = performance.now() / 1000;
        auraMat.alpha = 0.10 + 0.10 * (1 + Math.sin((t / 0.75) * Math.PI));
    })!;

    // ── Ground glow disc at enemy feet ───────────────────────────────────────
    const disc = MeshBuilder.CreateDisc('eliteGlow_' + element, { radius: 0.9, tessellation: 16 }, scene);
    const discMat = new StandardMaterial('eliteGlowMat_' + element + '_' + Math.random(), scene);
    discMat.emissiveColor = color;
    discMat.alpha = 0.40;
    disc.material = discMat;
    disc.parent = mesh;
    disc.rotation.x = Math.PI / 2; // lie flat
    disc.position.y = -0.55; // at feet level relative to mesh centre

    // ── Spikes / horns ───────────────────────────────────────────────────────
    // 4 small icosahedra arranged around the top of the enemy, slightly pointing outward
    const spikeConfigs = [
        { x:  0.18, z:  0.18 },
        { x: -0.18, z:  0.18 },
        { x:  0.18, z: -0.18 },
        { x: -0.18, z: -0.18 },
    ];

    for (let i = 0; i < spikeConfigs.length; i++) {
        const cfg = spikeConfigs[i];
        const spike = MeshBuilder.CreatePolyhedron(`eliteSpike_${element}_${i}`, {
            type: 2, // icosahedron
            size: 0.09
        }, scene);
        const spikeMat = new StandardMaterial(`eliteSpikeMat_${element}_${i}_` + Math.random(), scene);
        spikeMat.emissiveColor = color;
        spikeMat.diffuseColor = color;
        spikeMat.specularColor = Color3.Black();
        spike.material = spikeMat;
        spike.parent = mesh;
        spike.position.set(cfg.x, 0.55, cfg.z);
        // Tilt outward from centre
        spike.rotation.z = cfg.x > 0 ? 0.4 : -0.4;
        spike.rotation.x = cfg.z > 0 ? 0.4 : -0.4;
    }

    // ── Cleanup on enemy death / dispose ────────────────────────────────────
    // Since all visuals are parented to mesh they are disposed with it.
    // But we must remove the scene observer manually.
    const origDispose = enemy.dispose.bind(enemy);
    (enemy as any).dispose = () => {
        scene.onBeforeRenderObservable.remove(auraObserver);
        origDispose();
    };
}
