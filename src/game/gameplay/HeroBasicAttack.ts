import { Scene, Vector3, MeshBuilder, Color3 } from '@babylonjs/core';
import { Champion } from './Champion';
import { PowerSlotManager } from './PowerSlotManager';
import { EnchantmentHitContext } from './powers/PowerDefinitions';
import { Enemy } from './enemies/Enemy';
import { getCachedMaterial } from '../rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../rendering/ProjectilePool';

export interface BasicAttackTarget {
    position: Vector3;
    takeDamage: (amount: number) => void;
    isAlive: () => boolean;
}

export type BasicAttackMode = 'projectile' | 'melee';

export class HeroBasicAttack {
    private scene: Scene;
    private hero: Champion;
    private cooldown: number = 0;
    private baseFireInterval: number;
    private attackSpeedMultiplier: number = 1.0;
    private rangeMultiplier: number = 1.0;
    private damage: number;
    private baseRange: number;
    private mode: BasicAttackMode;
    private targetProvider: () => BasicAttackTarget | null;
    private powerSlots: PowerSlotManager | null = null;

    // For melee: reference to full enemy list for AOE
    private enemyProvider: (() => Enemy[]) | null = null;

    constructor(
        scene: Scene,
        hero: Champion,
        opts: {
            mode: BasicAttackMode;
            fireRate: number;
            damage: number;
            range: number;
            targetProvider: () => BasicAttackTarget | null;
            enemyProvider?: () => Enemy[];
        },
    ) {
        this.scene = scene;
        this.hero = hero;
        this.baseFireInterval = 1 / opts.fireRate;
        this.damage = opts.damage;
        this.baseRange = opts.range;
        this.mode = opts.mode;
        this.targetProvider = opts.targetProvider;
        this.enemyProvider = opts.enemyProvider ?? null;
    }

    /** Wire up the power slot manager so enchantments apply on each hit. */
    public setPowerSlots(slots: PowerSlotManager): void {
        this.powerSlots = slots;
    }

    /** Update the effective attack speed. multiplier > 1 = faster. */
    public updateAttackSpeed(multiplier: number): void {
        this.attackSpeedMultiplier = multiplier;
    }

    /** Update the effective attack range. multiplier > 1 = farther reach. */
    public updateRange(multiplier: number): void {
        this.rangeMultiplier = multiplier;
    }

    private get effectiveInterval(): number {
        return this.baseFireInterval / this.attackSpeedMultiplier;
    }

    private get effectiveRange(): number {
        const enchantBonus = this.mode === 'melee' && this.powerSlots
            ? this.powerSlots.getMeleeRangeBonus()
            : 0;
        return (this.baseRange + enchantBonus) * this.rangeMultiplier;
    }

    public update(deltaTime: number): void {
        this.cooldown -= deltaTime;
        if (this.cooldown > 0) return;

        if (this.mode === 'melee') {
            this.performMeleeSwing();
            this.cooldown = this.effectiveInterval;
        } else {
            const target = this.targetProvider();
            if (!target || !target.isAlive()) return;

            const heroPos = this.getHeroPosition();
            const dist = Vector3.Distance(heroPos, target.position);
            if (dist > this.effectiveRange) return;

            this.spawnProjectile(heroPos.clone(), target);
            this.cooldown = this.effectiveInterval;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Melee — 360° AOE swing
    // ─────────────────────────────────────────────────────────────────────────
    private performMeleeSwing(): void {
        const heroPos = this.getHeroPosition();
        const range = this.effectiveRange;
        const enemies = this.enemyProvider ? this.enemyProvider() : [];
        const hitEnemies: Enemy[] = [];

        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            if (Math.hypot(dx, dz) <= range) {
                e.takeDamage(this.damage);
                hitEnemies.push(e);
                this.applyEnchantments(e, heroPos, enemies);
            }
        }

        // Bright sword-arc visual (thick golden torus + sweeping blade trail)
        this.spawnSwingRing(heroPos, range);

        // Trigger the full-body spin attack on the Champion
        const hero = this.hero as any;
        if (typeof hero.triggerSpinAttack === 'function') {
            hero.triggerSpinAttack();
        }
    }

    private spawnSwingRing(center: Vector3, range: number): void {
        // Thick golden torus on the ground — the main slash arc readout
        const ring = MeshBuilder.CreateTorus(
            'swingRing',
            { diameter: range * 2, thickness: 0.45, tessellation: 32 },
            this.scene,
        );
        ring.position.copyFrom(center);
        ring.position.y = 0.25;
        const ringMat = getCachedMaterial(this.scene, 'swingRingMat', m => {
            m.emissiveColor = new Color3(1, 0.85, 0.4);
            m.diffuseColor = new Color3(0, 0, 0);
            m.alpha = 0.9;
        });
        ring.material = ringMat;
        ring.scaling.set(0.7, 0.7, 0.7); // starts a bit smaller

        // Sweeping blade trail — a flat half-disc that rotates around the hero matching the spin
        const arc = MeshBuilder.CreateDisc(
            'swingArc',
            { radius: range, tessellation: 32, arc: 0.5 },
            this.scene,
        );
        arc.position.copyFrom(center);
        arc.position.y = 0.35;
        arc.rotation.x = Math.PI / 2;
        const arcMat = getCachedMaterial(this.scene, 'swingArcMat', m => {
            m.emissiveColor = new Color3(1, 0.95, 0.7);
            m.diffuseColor = new Color3(0, 0, 0);
            m.alpha = 0.5;
        });
        arc.material = arcMat;

        const duration = 0.35; // seconds — matches Champion spin duration roughly
        let elapsed = 0;

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            const t = Math.min(elapsed / duration, 1);

            // Ring: expand from 0.7 to 1.0× and fade out
            const ringScale = 0.7 + 0.3 * t;
            ring.scaling.set(ringScale, ringScale, ringScale);
            ringMat.alpha = 0.9 * (1 - t);

            // Arc: sweep a full 360° (the half-disc rotates twice to look like a continuous sweep)
            arc.rotation.y = t * Math.PI * 2;
            arcMat.alpha = 0.5 * (1 - t);

            if (t >= 1) {
                ring.dispose();
                arc.dispose();
                this.scene.onBeforeRenderObservable.remove(observer);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Projectile
    // ─────────────────────────────────────────────────────────────────────────
    private spawnProjectile(from: Vector3, target: BasicAttackTarget): void {
        const scene = this.scene;
        const proj = acquireProjectile(scene, 'basic_attack_proj', () =>
            MeshBuilder.CreateSphere('basicProj', { diameter: 0.3 }, scene));
        proj.position.copyFrom(from);
        proj.position.y = 1;
        proj.material = getCachedMaterial(scene, 'basic_attack_proj_mat', m => {
            m.emissiveColor = new Color3(1, 0.9, 0.4);
        });

        const speed = 22;
        const startTime = performance.now() / 1000;
        const capturedDamage = this.damage;
        const heroPos = from;
        const allEnemies = this.enemyProvider ? this.enemyProvider() : [];

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            if (!observer) return;
            if (!target.isAlive()) {
                releaseProjectile('basic_attack_proj', proj);
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const targetPos = target.position.clone();
            targetPos.y = 1;
            const dir = targetPos.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.4) {
                target.takeDamage(capturedDamage);
                // Apply enchantments on projectile hit
                if (this.powerSlots) {
                    // Find the corresponding Enemy object for enchantments
                    const enemyHit = allEnemies.find(e => {
                        const ep = e.getPosition();
                        const dx = ep.x - target.position.x;
                        const dz = ep.z - target.position.z;
                        return Math.hypot(dx, dz) < 0.5 && e.isAlive();
                    });
                    if (enemyHit) {
                        this.applyEnchantments(enemyHit, heroPos, allEnemies);
                    }
                }
                releaseProjectile('basic_attack_proj', proj);
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            const step = Math.min(dist, speed * dt);
            proj.position.addInPlace(dir.normalize().scale(step));

            // Safety: release after 3s of flight
            if (performance.now() / 1000 - startTime > 3) {
                releaseProjectile('basic_attack_proj', proj);
                this.scene.onBeforeRenderObservable.remove(observer);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Enchantment application
    // ─────────────────────────────────────────────────────────────────────────
    private applyEnchantments(enemy: Enemy, heroPos: Vector3, allEnemies: Enemy[]): void {
        if (!this.powerSlots) return;
        const enchantments = this.powerSlots.getActiveEnchantments();
        if (enchantments.length === 0) return;

        const ctx: EnchantmentHitContext = {
            scene: this.scene,
            heroPosition: heroPos,
            enemies: allEnemies,
            baseDamage: this.damage,
        };

        for (const enc of enchantments) {
            if (enc.slot.def.onHit) {
                enc.slot.def.onHit(enemy, enc.level, ctx);
            }
        }
    }

    private getHeroPosition(): Vector3 {
        return (this.hero as any).position as Vector3;
    }
}
