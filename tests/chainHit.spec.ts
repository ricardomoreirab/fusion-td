import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SceneHost } from '../src/engine/three/SceneHost';
import { chainHit, resetPowerEffects } from '../src/survivors/powers/PowerEffects';
import type { Enemy } from '../src/survivors/enemies/Enemy';
import { StatusEffect } from '../src/survivors/GameTypes';

/**
 * chainHit walks the whole live enemy list once per hop, which at a maxed
 * fusion loadout is the single hottest gameplay loop in the game. It was
 * rewritten around an index loop, direct `alive`/`position` field reads and a
 * reusable slot marker instead of a per-call `Set` — these specs pin the
 * behaviour that rewrite had to preserve, including the two shapes the marker
 * makes non-obvious: reuse across calls and a list that GROWS mid-chain.
 */

interface EnemyDouble {
    position: Vector3;
    alive: boolean;
    statuses: number;
    getPosition(): Vector3;
    isAlive(): boolean;
    takeDamage(amount: number): boolean;
    applyStatusEffect(): void;
    applyKnockback(): void;
}
interface Spy { enemy: Enemy; double: EnemyDouble; hits: number[]; }

function makeEnemy(x: number, z: number, opts: { onHit?: () => void } = {}): Spy {
    const hits: number[] = [];
    const double: EnemyDouble = {
        position: new Vector3(x, 0, z),
        alive: true,
        statuses: 0,
        getPosition() { return this.position; },
        isAlive() { return this.alive; },
        takeDamage(amount: number) {
            hits.push(amount);
            opts.onHit?.();
            return false;
        },
        applyStatusEffect() { this.statuses++; },
        applyKnockback() { /* no-op */ },
    };
    return { enemy: double as unknown as Enemy, double, hits };
}

function hitsOf(list: Spy[]): number[][] {
    return list.map(s => s.hits);
}

describe('chainHit', () => {
    it('chains hop by hop to the nearest unhit enemy, applying falloff', () => {
        const host = new SceneHost();
        const a = makeEnemy(1, 0);
        const b = makeEnemy(3, 0);
        const c = makeEnemy(5, 0);
        const far = makeEnemy(40, 0);
        chainHit(host, [a, b, c, far].map(s => s.enemy), new Vector3(0, 1, 0), {
            hops: 3, radius: 4, damage: 100, element: 'storm', falloff: 0.5,
        });
        expect(hitsOf([a, b, c, far])).toEqual([[100], [50], [25], []]);
        resetPowerEffects();
    });

    it('never hits the same enemy twice across split branches', () => {
        const host = new SceneHost();
        const spies = [
            makeEnemy(1, 0), makeEnemy(2, 0), makeEnemy(3, 0),
            makeEnemy(1, 1), makeEnemy(2, 1), makeEnemy(3, 1),
            makeEnemy(1, -1),
        ];
        chainHit(host, spies.map(s => s.enemy), new Vector3(0, 1, 0), {
            hops: 3, radius: 5, damage: 8, element: 'storm', split: true,
        });
        // A 3-hop split chain visits 1 + 2 + 4 = 7 distinct enemies, each once.
        expect(spies.every(s => s.hits.length <= 1)).toBe(true);
        expect(spies.reduce((n, s) => n + s.hits.length, 0)).toBe(7);
        resetPowerEffects();
    });

    it('skips dead enemies and stops when nothing is in reach', () => {
        const host = new SceneHost();
        const near = makeEnemy(1, 0);
        const far = makeEnemy(30, 0);
        near.double.alive = false;
        chainHit(host, [near, far].map(s => s.enemy), new Vector3(0, 1, 0), {
            hops: 4, radius: 3, damage: 5, element: 'storm',
        });
        expect(hitsOf([near, far])).toEqual([[], []]);
        resetPowerEffects();
    });

    it('applies the status to every enemy the chain touches', () => {
        const host = new SceneHost();
        const a = makeEnemy(1, 0);
        const b = makeEnemy(2, 0);
        chainHit(host, [a, b].map(s => s.enemy), new Vector3(0, 1, 0), {
            hops: 2, radius: 4, damage: 3, element: 'storm',
            status: { effect: StatusEffect.FRAGILE, durationS: 3, strength: 0 },
        });
        expect([a.double.statuses, b.double.statuses]).toEqual([1, 1]);
        resetPowerEffects();
    });

    it('does not carry hit marks from one chain into the next', () => {
        const host = new SceneHost();
        const spies = [makeEnemy(1, 0), makeEnemy(2, 0), makeEnemy(3, 0)];
        const list = spies.map(s => s.enemy);
        const opts = { hops: 3, radius: 4, damage: 7, element: 'storm' as const, falloff: 1 };
        chainHit(host, list, new Vector3(0, 1, 0), opts);
        chainHit(host, list, new Vector3(0, 1, 0), opts);
        expect(hitsOf(spies)).toEqual([[7, 7], [7, 7], [7, 7]]);
        resetPowerEffects();
    });

    it('chains into enemies APPENDED to the list mid-chain (a splitting death)', () => {
        const host = new SceneHost();
        const spawned: Spy[] = [];
        let list: Enemy[] = [];
        // Hitting the splitter appends two minis, exactly as SplittingEnemy's
        // synchronous `enemySplit` event does through EnemyManager._pushEnemy.
        const splitter = makeEnemy(1, 0, {
            onHit: () => {
                if (spawned.length) return;
                const m1 = makeEnemy(1.5, 0);
                const m2 = makeEnemy(2, 0);
                spawned.push(m1, m2);
                list.push(m1.enemy, m2.enemy);
            },
        });
        list = [splitter.enemy];
        chainHit(host, list, new Vector3(0, 1, 0), {
            hops: 3, radius: 4, damage: 6, element: 'storm', falloff: 1,
        });
        expect(splitter.hits).toEqual([6]);
        expect(hitsOf(spawned)).toEqual([[6], [6]]);
        resetPowerEffects();
    });

    it('survives a chain re-entered from inside a hit without corrupting the outer one', () => {
        const host = new SceneHost();
        const inner = [makeEnemy(20, 0), makeEnemy(21, 0), makeEnemy(22, 0)];
        const outer = [makeEnemy(1, 0), makeEnemy(2, 0), makeEnemy(3, 0)];
        let reentered = false;
        // The first outer hit fires a whole second chain (a shatter/kill hook
        // reaching another chain power) before the outer chain's next hop runs.
        const trigger = makeEnemy(0.5, 0, {
            onHit: () => {
                if (reentered) return;
                reentered = true;
                chainHit(host, inner.map(s => s.enemy), new Vector3(20, 1, 0), {
                    hops: 3, radius: 4, damage: 1, element: 'storm', falloff: 1,
                });
            },
        });
        chainHit(host, [trigger, ...outer].map(s => s.enemy), new Vector3(0, 1, 0), {
            hops: 4, radius: 4, damage: 9, element: 'storm', falloff: 1,
        });
        expect(reentered).toBe(true);
        expect(hitsOf(inner)).toEqual([[1], [1], [1]]);
        // The outer chain still walked all four of its own enemies, once each.
        expect(hitsOf([trigger, ...outer])).toEqual([[9], [9], [9], [9]]);
        resetPowerEffects();
    });
});
