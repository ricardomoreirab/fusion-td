/**
 * Tower ability execution engine.
 * Processes ability effects each frame, handles cooldowns, targeting, and execution.
 */

import { Vector3, Scene, ParticleSystem, Color4, MeshBuilder, Mesh } from '@babylonjs/core';
import { AbilityDefinition, AbilityEffect } from './TowerAbility';
import { Enemy } from '../../enemies/Enemy';
import { StatusEffect } from '../Tower';
import { Game } from '../../../Game';
import { createEmissiveMaterial } from '../../../rendering/LowPolyMaterial';

export interface AbilityState {
    definition: AbilityDefinition;
    lastUsedTime: number;
    isReady: boolean;
    // For spin-up tracking
    spinUpStacks: number;
    lastHitTime: number;
    // For armor shatter tracking per enemy
    armorStacks: Map<Enemy, { stacks: number; expireTime: number }>;
    // For shadow curse tracking per enemy
    curseStacks: Map<Enemy, { stacks: number; expireTime: number }>;
}

export class TowerAbilitySystem {
    private game: Game;
    private scene: Scene;

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();
    }

    public createState(definition: AbilityDefinition): AbilityState {
        return {
            definition,
            lastUsedTime: 0,
            isReady: true,
            spinUpStacks: 0,
            lastHitTime: 0,
            armorStacks: new Map(),
            curseStacks: new Map(),
        };
    }

    /**
     * Process ability on fire (called each time the tower fires).
     * Returns modified damage if ability affects it, or 0 for no modification.
     */
    public onFire(
        state: AbilityState,
        baseDamage: number,
        target: Enemy,
        towerPosition: Vector3,
        allEnemies: Enemy[],
        deltaTime: number
    ): { damage: number; extraTargets?: Enemy[] } {
        const effect = state.definition.effect;
        const now = performance.now();
        let damage = baseDamage;
        let extraTargets: Enemy[] | undefined;

        switch (effect.kind) {
            case 'criticalHit': {
                if (Math.random() < effect.chance) {
                    damage = baseDamage * effect.multiplier;
                }
                break;
            }
            case 'piercingShot': {
                if (now - state.lastUsedTime > effect.cooldown * 1000) {
                    state.lastUsedTime = now;
                    // Find enemies in a line from tower to target and beyond
                    const dir = target.getPosition().subtract(towerPosition).normalize();
                    extraTargets = allEnemies
                        .filter(e => e !== target && e.isAlive())
                        .filter(e => {
                            const toEnemy = e.getPosition().subtract(towerPosition);
                            const proj = Vector3.Dot(toEnemy, dir);
                            if (proj < 0) return false;
                            const perpDist = toEnemy.subtract(dir.scale(proj)).length();
                            return perpDist < 1.0;
                        })
                        .slice(0, effect.maxTargets - 1);
                }
                break;
            }
            case 'multishot': {
                extraTargets = allEnemies
                    .filter(e => e !== target && e.isAlive())
                    .sort((a, b) =>
                        Vector3.Distance(a.getPosition(), towerPosition) -
                        Vector3.Distance(b.getPosition(), towerPosition)
                    )
                    .slice(0, effect.extraProjectiles);
                break;
            }
            case 'spinUp': {
                const timeSinceLastHit = (now - state.lastHitTime) / 1000;
                if (timeSinceLastHit > 2) {
                    state.spinUpStacks = 0;
                } else {
                    state.spinUpStacks = Math.min(state.spinUpStacks + effect.perSecond * deltaTime, effect.maxBonus);
                }
                state.lastHitTime = now;
                damage = baseDamage * (1 + state.spinUpStacks);
                break;
            }
            case 'armorShatter': {
                let entry = state.armorStacks.get(target);
                if (!entry || now > entry.expireTime) {
                    entry = { stacks: 0, expireTime: now + effect.duration * 1000 };
                }
                entry.stacks = Math.min(entry.stacks + 1, effect.maxStacks);
                entry.expireTime = now + effect.duration * 1000;
                state.armorStacks.set(target, entry);
                damage = baseDamage * (1 + entry.stacks * effect.reductionPerStack);
                break;
            }
            case 'shadowCurse': {
                let curseEntry = state.curseStacks.get(target);
                if (!curseEntry || now > curseEntry.expireTime) {
                    curseEntry = { stacks: 0, expireTime: now + effect.duration * 1000 };
                }
                curseEntry.stacks = Math.min(curseEntry.stacks + 1, effect.maxStacks);
                curseEntry.expireTime = now + effect.duration * 1000;
                state.curseStacks.set(target, curseEntry);
                damage = baseDamage * (1 + curseEntry.stacks * effect.damageAmpPerStack);
                break;
            }
            case 'executeThreshold': {
                const healthPercent = target.getHealth() / target.getMaxHealth();
                if (healthPercent <= effect.healthPercent) {
                    damage = baseDamage * (1 + effect.bonusDamage);
                }
                break;
            }
            case 'siegeShot': {
                damage = baseDamage + effect.bonusDamage;
                // Splash damage to nearby enemies
                extraTargets = allEnemies
                    .filter(e => e !== target && e.isAlive())
                    .filter(e => Vector3.Distance(e.getPosition(), target.getPosition()) <= effect.splashRadius);
                break;
            }
            case 'chainLightning': {
                const chainTargets: Enemy[] = [];
                let lastPos = target.getPosition();
                let currentDamageScale = 1.0;
                const hit = new Set<Enemy>([target]);
                for (let i = 0; i < effect.chains; i++) {
                    currentDamageScale *= effect.damageDecay;
                    const next = allEnemies
                        .filter(e => e.isAlive() && !hit.has(e))
                        .filter(e => Vector3.Distance(e.getPosition(), lastPos) <= effect.chainRange)
                        .sort((a, b) => Vector3.Distance(a.getPosition(), lastPos) - Vector3.Distance(b.getPosition(), lastPos))[0];
                    if (next) {
                        chainTargets.push(next);
                        hit.add(next);
                        lastPos = next.getPosition();
                    } else break;
                }
                extraTargets = chainTargets;
                break;
            }
            case 'burnDoT': {
                target.applyStatusEffect(StatusEffect.BURNING, effect.duration, effect.dps);
                break;
            }
            case 'snare': {
                target.applyStatusEffect(StatusEffect.SLOWED, effect.duration, effect.slow);
                break;
            }
            case 'overcharge': {
                if (now - state.lastUsedTime > effect.cooldown * 1000) {
                    state.lastUsedTime = now;
                    damage = baseDamage * effect.damageMultiplier;
                }
                break;
            }
            case 'none':
            default:
                break;
        }

        // Clean up expired stacks
        this.cleanupExpiredStacks(state, now);

        return { damage, extraTargets };
    }

    /**
     * Process area-of-effect abilities that trigger periodically.
     */
    public processAutoAbility(
        state: AbilityState,
        towerPosition: Vector3,
        towerRange: number,
        allEnemies: Enemy[]
    ): void {
        const effect = state.definition.effect;
        const now = performance.now();

        if (state.definition.type !== 'active_auto') return;
        if (now - state.lastUsedTime < state.definition.cooldown * 1000) return;

        switch (effect.kind) {
            case 'freezeNova': {
                state.lastUsedTime = now;
                const nearby = allEnemies.filter(
                    e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= effect.radius
                );
                for (const e of nearby) {
                    e.applyStatusEffect(StatusEffect.FROZEN, effect.duration, 1.0);
                }
                this.createFreezeNovaEffect(towerPosition, effect.radius);
                break;
            }
            case 'aoeVolley': {
                state.lastUsedTime = now;
                const inRange = allEnemies
                    .filter(e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= towerRange)
                    .slice(0, effect.projectiles);
                // Targets returned will be damaged by caller
                break;
            }
            case 'eruption': {
                state.lastUsedTime = now;
                const nearby = allEnemies.filter(
                    e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= effect.radius
                );
                for (const e of nearby) {
                    e.takeDamage(effect.damage);
                    e.applyStatusEffect(StatusEffect.BURNING, effect.burnDuration, effect.burnDps);
                }
                break;
            }
            case 'poisonCloud': {
                state.lastUsedTime = now;
                const nearby = allEnemies.filter(
                    e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= effect.radius
                );
                for (const e of nearby) {
                    e.applyStatusEffect(StatusEffect.BURNING, effect.duration, effect.dps); // re-use burning for DoT
                }
                break;
            }
            case 'pullVortex': {
                state.lastUsedTime = now;
                const nearby = allEnemies.filter(
                    e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= effect.radius
                );
                for (const e of nearby) {
                    e.applyStatusEffect(StatusEffect.SLOWED, 1.0, 0.5);
                    e.takeDamage(effect.dps);
                }
                break;
            }
            case 'trapField': {
                state.lastUsedTime = now;
                const nearby = allEnemies.filter(
                    e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= effect.radius
                );
                for (const e of nearby) {
                    e.applyStatusEffect(StatusEffect.SLOWED, effect.duration, effect.slow);
                    e.takeDamage(effect.dps);
                }
                break;
            }
            case 'whirlpool': {
                state.lastUsedTime = now;
                const nearby = allEnemies.filter(
                    e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= effect.radius
                );
                for (const e of nearby) {
                    e.applyStatusEffect(StatusEffect.SLOWED, effect.duration, effect.slow);
                    e.takeDamage(effect.dps);
                }
                break;
            }
            case 'thornAura': {
                // Continuous; always tick
                state.lastUsedTime = now;
                const nearby = allEnemies.filter(
                    e => e.isAlive() && Vector3.Distance(e.getPosition(), towerPosition) <= effect.radius
                );
                for (const e of nearby) {
                    e.applyStatusEffect(StatusEffect.SLOWED, 1.0, effect.slow);
                }
                break;
            }
        }
    }

    /**
     * Get aura buff values if this tower has an auraBuff ability.
     */
    public getAuraBuffValues(state: AbilityState): { bonusDamage: number; bonusFireRate: number; bonusRange: number; radius: number } | null {
        if (state.definition.effect.kind !== 'auraBuff') return null;
        const e = state.definition.effect;
        return { bonusDamage: e.bonusDamage, bonusFireRate: e.bonusFireRate, bonusRange: e.bonusRange, radius: e.radius };
    }

    private cleanupExpiredStacks(state: AbilityState, now: number): void {
        for (const [enemy, entry] of state.armorStacks) {
            if (!enemy.isAlive() || now > entry.expireTime) {
                state.armorStacks.delete(enemy);
            }
        }
        for (const [enemy, entry] of state.curseStacks) {
            if (!enemy.isAlive() || now > entry.expireTime) {
                state.curseStacks.delete(enemy);
            }
        }
    }

    private createFreezeNovaEffect(position: Vector3, radius: number): void {
        const ps = new ParticleSystem('freezeNova', 40, this.scene);
        ps.emitter = position;
        ps.minEmitBox = new Vector3(-radius * 0.3, 0, -radius * 0.3);
        ps.maxEmitBox = new Vector3(radius * 0.3, 0.5, radius * 0.3);
        ps.color1 = new Color4(0.5, 0.8, 1.0, 0.8);
        ps.color2 = new Color4(0.3, 0.6, 1.0, 0.6);
        ps.colorDead = new Color4(0.1, 0.3, 0.5, 0.0);
        ps.minSize = 0.3;
        ps.maxSize = 0.8;
        ps.minLifeTime = 0.3;
        ps.maxLifeTime = 0.6;
        ps.emitRate = 100;
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.direction1 = new Vector3(-1, 1, -1);
        ps.direction2 = new Vector3(1, 2, 1);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 3;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 300);
    }
}
