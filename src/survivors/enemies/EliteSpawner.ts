import { Color, type Mesh } from 'three';
import { Enemy } from './Enemy';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { createDisc, createPolyhedron, createSphere, isMeshDisposed } from '../../engine/three/primitives';
import type { SceneHost } from '../../engine/three/SceneHost';
import { DifficultyTuning } from '../DifficultyTuning';

const ELEMENT_COLORS: Record<string, Color> = {
    fire:     new Color(1.0, 0.4, 0.0),
    ice:      new Color(0.3, 0.7, 1.0),
    arcane:   new Color(0.8, 0.3, 1.0),
    physical: new Color(0.9, 0.9, 0.9),
    storm:    new Color(0.8, 0.8, 1.0),
};

/**
 * Transform a regular enemy into an elite:
 * - 1.4× scale
 * - eliteHpMult× HP (DifficultyTuning)
 * - 1.5× reward
 * - Emissive aura sphere (pulsing alpha) tinted to the drop element
 * - Element-colored spikes protruding from the top
 * - Ground glow disc at the enemy's feet
 */
export function makeElite(enemy: Enemy, element: string, host: SceneHost): void {
    enemy.isElite = true;
    enemy.eliteDropElement = element;

    // Promote HP bar to elite tier (wider + orange frame). Keeps existing
    // head-height offset since the enemy class already configured it.
    enemy.applyHealthBarTier('elite');

    const color = ELEMENT_COLORS[element] ?? new Color(1, 1, 1);

    // Scale up mesh
    const mesh = (enemy as any).mesh as Mesh | null;
    if (mesh) {
        mesh.scale.multiplyScalar(1.4);
    }

    // Elite HP multiplier (DifficultyTuning.eliteHpMult).
    enemy.applyHealthMultiplier(DifficultyTuning.eliteHpMult);

    // 1.5× reward
    if ((enemy as any).reward !== undefined) {
        (enemy as any).reward = Math.floor((enemy as any).reward * 1.5);
    }

    if (!mesh) return;

    // ── Pulsing aura sphere ──────────────────────────────────────────────────
    const aura = createSphere('eliteAura_' + element, { diameter: 2.6 }, host);
    // Shared material per element — all elites of the same element pulse in sync
    // (intentional: the per-frame opacity write below deliberately hits the
    // SHARED cached material so one pulse drives every elite of that element).
    const auraMat = getCachedMaterial(`elite_aura_${element}`, m => {
        m.emissive = color.clone();
        m.transparent = true;
        m.opacity = 0.18;
        m.depthWrite = false;
    });
    aura.material = auraMat;
    mesh.add(aura);
    aura.position.y = 0.8;

    // Pulse the aura — throttled to every 3 frames to reduce per-frame JS cost.
    let _auraFrameCounter = 0;
    const auraObserver = host.onBeforeRender.add(() => {
        if (isMeshDisposed(aura)) {
            // Enemy died (via die() OR dispose()) — the parented aura is gone.
            // Self-remove so the callback doesn't pile up on the per-frame list
            // for the rest of the run. The dispose() monkey-patch below never
            // fires on the in-combat die() path (EnemyManager removes dead
            // enemies without calling dispose()).
            host.onBeforeRender.remove(auraObserver);
            return;
        }
        _auraFrameCounter++;
        if (_auraFrameCounter < 3) return;
        _auraFrameCounter = 0;
        const t = performance.now() / 1000;
        auraMat.opacity = 0.10 + 0.10 * (1 + Math.sin((t / 0.75) * Math.PI));
    });

    // ── Ground glow disc at enemy feet ───────────────────────────────────────
    const disc = createDisc('eliteGlow_' + element, { radius: 0.9, tessellation: 16 }, host);
    disc.material = getCachedMaterial(`elite_glow_${element}`, m => {
        m.emissive = color.clone();
        m.transparent = true;
        m.opacity = 0.40;
        m.depthWrite = false;
    });
    mesh.add(disc);
    disc.rotation.x = -Math.PI / 2; // lie flat, facing up (+Y normal in Three)
    disc.position.y = -0.55; // at feet level relative to mesh centre

    // ── Spikes / horns ───────────────────────────────────────────────────────
    // 2 small polyhedra (reduced from 4) — minimal visual impact, halves spike draw calls.
    const spikeConfigs = [
        { x:  0.18, z:  0.18 },
        { x: -0.18, z: -0.18 },
    ];

    const spikeMat = getCachedMaterial(`elite_spike_${element}`, m => {
        m.emissive = color.clone();
        m.color = color.clone();
        m.specular = new Color(0, 0, 0);
    });

    for (let i = 0; i < spikeConfigs.length; i++) {
        const cfg = spikeConfigs[i];
        const spike = createPolyhedron(`eliteSpike_${element}_${i}`, {
            type: 2, // same Babylon polyhedron-type code (see primitives.createPolyhedron)
            size: 0.09
        }, host);
        spike.material = spikeMat;
        mesh.add(spike);
        spike.position.set(cfg.x, 0.55, cfg.z);
        // Tilt outward from centre
        spike.rotation.z = cfg.x > 0 ? 0.4 : -0.4;
        spike.rotation.x = cfg.z > 0 ? 0.4 : -0.4;
    }

    // ── Cleanup on enemy death / dispose ────────────────────────────────────
    // Since all visuals are parented to mesh they are disposed with it (their
    // materials are cache-owned — disposeMesh skips them by design).
    // But we must remove the per-frame pulse callback manually.
    const origDispose = enemy.dispose.bind(enemy);
    (enemy as any).dispose = () => {
        host.onBeforeRender.remove(auraObserver);
        origDispose();
    };
}
