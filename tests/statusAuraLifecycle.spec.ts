// tests/statusAuraLifecycle.spec.ts
//
// Persistent status auras (burn / chill-slow / freeze / stun / confuse) are
// scene-root THREE.Points: one extra draw call, one entry in the per-frame
// particle walk, and one slot of a hard 24-wide concurrency budget EACH. Every
// path that frees an enemy must therefore free its auras exactly once, and no
// path may create one for an enemy that is already dead.
//
// The bug these specs pin down: powers damage first and apply their status
// second, so a killing blow that also burns called applyStatusEffect() AFTER
// die() had freed the map and handed the enemy to the corpse list. The aura it
// created was owned by nothing from that instant on: disposeCorpse() releases
// the corpse and never looked at the map, and dispose() (which does clear it) is
// not on that path. Measured in play: 123 live `burningParticles` after ~2
// minutes of stress, drawing and simulating forever at the spots enemies died,
// and 123 permanently-held budget slots, which silently stopped every ordinary
// enemy from ever showing a status aura again.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';
import { Enemy, activeStatusVisualCount } from '../src/survivors/enemies/Enemy';
import { StatusEffect } from '../src/survivors/GameTypes';
import type { Game } from '../src/engine/Game';

/** Enough of Game for Enemy's constructor + status-particle path. */
function stubGame(host: SceneHost): Game {
    return { getScene: () => host } as unknown as Game;
}

/**
 * A live enemy with a mesh (createStatusEffectParticles needs one to follow) but
 * without the GLB/health-bar machinery a concrete subclass would build. The
 * base constructor deliberately builds nothing (see its comment) and the leaf
 * subclasses are what call _initEnemyVisuals().
 */
function makeEnemy(host: SceneHost): Enemy {
    const enemy = new Enemy(stubGame(host), new Vector3(1, 0, 2), [], 1, 100, 1, 1);
    const mesh = new Object3D();
    mesh.name = 'stubEnemyRoot';
    host.scene.add(mesh);
    (enemy as unknown as { mesh: Object3D }).mesh = mesh;
    return enemy;
}

/** The enemy's own view of what it believes it still owns. */
function ownedAuras(enemy: Enemy): number {
    return (enemy as unknown as { statusEffectParticles: Map<unknown, unknown> }).statusEffectParticles.size;
}

/** Live auras on the particle bus, by aura name (`<effect>Particles`). */
function busAuras(host: SceneHost): number {
    return host.particleSystems.filter(ps => /Particles$/.test((ps as { name?: string }).name ?? '')).length;
}

/** Scene-root Points actually being drawn. */
function sceneAuras(host: SceneHost): number {
    return host.scene.children.filter(o => /Particles$/.test(o.name)).length;
}

/** Re-baselined per spec: the budget is module-global, so measuring against a
 *  file-level snapshot would blame every later spec for the first leak. Each
 *  spec asserts only that IT gave back everything it took. */
let budgetAtStart = 0;
beforeEach(() => { budgetAtStart = activeStatusVisualCount(); });
afterEach(() => { expect(activeStatusVisualCount()).toBe(budgetAtStart); });

describe('status aura lifecycle', () => {
    it('creates one aura for a live enemy and releases it on expiry', () => {
        const host = new SceneHost();
        const enemy = makeEnemy(host);

        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
        expect(ownedAuras(enemy)).toBe(1);
        expect(busAuras(host)).toBe(1);
        expect(sceneAuras(host)).toBe(1);
        expect(activeStatusVisualCount()).toBe(budgetAtStart + 1);

        (enemy as unknown as { stopStatusEffectParticles(e: StatusEffect): void })
            .stopStatusEffectParticles(StatusEffect.BURNING);
        expect(busAuras(host)).toBe(0);
        expect(sceneAuras(host)).toBe(0);
    });

    it('re-applying a running status reuses the same aura', () => {
        const host = new SceneHost();
        const enemy = makeEnemy(host);

        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
        const first = host.particleSystems[0];
        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);

        expect(busAuras(host)).toBe(1);
        expect(host.particleSystems[0]).toBe(first);

        (enemy as unknown as { stopStatusEffectParticles(e: StatusEffect): void })
            .stopStatusEffectParticles(StatusEffect.BURNING);
    });

    it('a status applied by the SAME hit that kills leaves nothing behind', () => {
        const host = new SceneHost();
        const enemy = makeEnemy(host);

        // The real ordering: damage, then status. The damage is lethal.
        enemy.takeDamage(999, 'fire');
        expect(enemy.isAlive()).toBe(false);
        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);

        expect(ownedAuras(enemy)).toBe(0);
        expect(busAuras(host)).toBe(0);
        expect(sceneAuras(host)).toBe(0);
    });

    it('a lethal hit frees the aura the enemy was already carrying', () => {
        const host = new SceneHost();
        const enemy = makeEnemy(host);

        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
        expect(busAuras(host)).toBe(1);

        enemy.takeDamage(999, 'fire');
        expect(ownedAuras(enemy)).toBe(0);
        expect(busAuras(host)).toBe(0);
        expect(sceneAuras(host)).toBe(0);
    });

    it('no aura survives a full death → corpse → release cycle under repeated re-application', () => {
        const host = new SceneHost();
        for (let i = 0; i < 30; i++) {
            const enemy = makeEnemy(host);
            enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
            enemy.applyStatusEffect(StatusEffect.SLOWED, 2, 0.4);
            enemy.takeDamage(999, 'fire');
            // Post-mortem re-application, exactly as a multi-hit AoE frame does.
            enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
            enemy.applyStatusEffect(StatusEffect.SLOWED, 2, 0.4);
            enemy.disposeCorpse();
        }
        expect(busAuras(host)).toBe(0);
        expect(sceneAuras(host)).toBe(0);
    });

    it('disposeCorpse frees any aura still in the map', () => {
        const host = new SceneHost();
        const enemy = makeEnemy(host);

        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
        expect(busAuras(host)).toBe(1);

        // Reach past die() and drop the enemy straight into the terminal release
        // path, so the belt-and-braces in disposeCorpse is what has to free it.
        enemy.disposeCorpse();
        expect(ownedAuras(enemy)).toBe(0);
        expect(busAuras(host)).toBe(0);
        expect(sceneAuras(host)).toBe(0);
    });

    it('disposeCorpse is idempotent', () => {
        const host = new SceneHost();
        const enemy = makeEnemy(host);

        enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
        enemy.disposeCorpse();
        enemy.disposeCorpse();
        enemy.disposeCorpse();

        expect(busAuras(host)).toBe(0);
    });

    it('the aura budget is fully recovered after a burst of deaths', () => {
        const host = new SceneHost();
        const before = activeStatusVisualCount();
        const enemies: Enemy[] = [];
        for (let i = 0; i < 20; i++) {
            const enemy = makeEnemy(host);
            enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
            enemies.push(enemy);
        }
        expect(activeStatusVisualCount()).toBe(before + 20);

        for (const enemy of enemies) {
            enemy.takeDamage(999, 'fire');
            enemy.applyStatusEffect(StatusEffect.BURNING, 2, 5);
            enemy.disposeCorpse();
        }
        expect(activeStatusVisualCount()).toBe(before);
        expect(busAuras(host)).toBe(0);
    });
});
