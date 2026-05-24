import { Color3, MeshBuilder, StandardMaterial, Scene } from '@babylonjs/core';
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
 * - Emissive aura sphere tinted to the drop element
 */
export function makeElite(enemy: Enemy, element: string, scene: Scene): void {
    enemy.isElite = true;
    enemy.eliteDropElement = element;

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

    // Emissive aura — a slightly transparent sphere parented to the mesh
    const aura = MeshBuilder.CreateSphere('eliteAura_' + element, { diameter: 2.4 }, scene);
    const mat = new StandardMaterial('eliteAuraMat_' + element + '_' + Math.random(), scene);
    mat.emissiveColor = ELEMENT_COLORS[element] ?? new Color3(1, 1, 1);
    mat.alpha = 0.18;
    aura.material = mat;
    if (mesh) {
        aura.parent = mesh;
        aura.position.y = 0.8;
    }
}
