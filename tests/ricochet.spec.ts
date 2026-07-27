import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';
import { HeroBasicAttack, BasicAttackTarget } from '../src/survivors/champions/HeroBasicAttack';
import { PlayerStats } from '../src/survivors/PlayerStats';
import type { Champion } from '../src/survivors/champions/Champion';
import type { Enemy } from '../src/survivors/enemies/Enemy';

/** Minimal stand-in enemy: live position + hit counter, never dies.
 *  Carries the `position` / `alive` FIELDS as well as the accessors — the
 *  horde-scan loops read the fields directly (see Enemy.position), so a double
 *  that only implements getPosition()/isAlive() is invisible to them. */
function makeEnemy(x: number, z: number) {
    const pos = new Vector3(x, 0, z);
    const hits: number[] = [];
    const enemy = {
        position: pos,
        alive: true,
        getPosition: () => pos,
        isAlive: () => true,
        takeDamage: (amount: number) => { hits.push(amount); },
        applyKnockback: () => {},
    } as unknown as Enemy;
    return { enemy, hits };
}

function makeAttack(host: SceneHost, enemies: Enemy[], primary: Enemy, ricochetBounces: number) {
    const hero = { position: new Vector3(0, 0, 0) } as unknown as Champion;
    const attack = new HeroBasicAttack(host, hero, {
        mode: 'projectile',
        fireRate: 1.8,
        damage: 8,
        range: 9,
        projectileShape: 'arrow',
        targetProvider: (): BasicAttackTarget => ({
            position: primary.getPosition(),
            takeDamage: (amount, element) => primary.takeDamage(amount, element),
            isAlive: () => primary.isAlive(),
            enemy: primary,
        }),
        enemyProvider: () => enemies,
    });
    const stats = new PlayerStats();
    stats.ricochetBounces = ricochetBounces;
    attack.setPlayerStats(stats);
    return attack;
}

/** Fire once, then advance the host until all flights resolve. */
function fireAndSettle(host: SceneHost, attack: HeroBasicAttack): void {
    attack.update(1 / 60);
    for (let i = 0; i < 120; i++) host.tick(1 / 60);
}

describe('basic-attack ricochet', () => {
    it('bounces the arrow to 2 extra enemies, hitting each exactly once', () => {
        const host = new SceneHost();
        const a = makeEnemy(3, 0);   // primary target
        const b = makeEnemy(5, 0);   // 2u from a — first bounce
        const c = makeEnemy(5, 3);   // 3u from b — second bounce
        const far = makeEnemy(30, 0); // outside every bounce radius
        const enemies = [a.enemy, b.enemy, c.enemy, far.enemy];

        const attack = makeAttack(host, enemies, a.enemy, 2);
        fireAndSettle(host, attack);

        expect(a.hits).toEqual([8]);
        expect(b.hits).toEqual([8]);
        expect(c.hits).toEqual([8]);
        expect(far.hits).toEqual([]);
        attack.dispose();
    });

    it('stops early when no fresh enemy is within bounce reach', () => {
        const host = new SceneHost();
        const a = makeEnemy(3, 0);
        const far = makeEnemy(30, 0);
        const enemies = [a.enemy, far.enemy];

        const attack = makeAttack(host, enemies, a.enemy, 2);
        fireAndSettle(host, attack);

        expect(a.hits).toEqual([8]); // never re-hit by its own arrow
        expect(far.hits).toEqual([]);
        attack.dispose();
    });

    it('without the item the arrow expires on its first hit', () => {
        const host = new SceneHost();
        const a = makeEnemy(3, 0);
        const b = makeEnemy(5, 0);
        const enemies = [a.enemy, b.enemy];

        const attack = makeAttack(host, enemies, a.enemy, 0);
        fireAndSettle(host, attack);

        expect(a.hits).toEqual([8]);
        expect(b.hits).toEqual([]);
        attack.dispose();
    });
});
