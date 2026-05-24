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

    private get effectiveInterval(): number {
        return this.baseFireInterval / this.attackSpeedMultiplier;
    }

    private get effectiveRange(): number {
        const bonus = this.mode === 'melee' && this.powerSlots
            ? this.powerSlots.getMeleeRangeBonus()
            : 0;
        return this.baseRange + bonus;
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

        // Expanding ring visual
        this.spawnSwingRing(heroPos, range);

        // Animate sword arm if accessible
        const arm = (this.hero as any)['swordArm'];
        if (arm && arm.rotation) {
            arm.rotation.x = -Math.PI / 2.2;
            setTimeout(() => {
                if (arm && !arm.isDisposed()) {
                    arm.rotation.x = 0;
                }
            }, 200);
        }
    }

    private spawnSwingRing(center: Vector3, range: number): void {
        const ring = MeshBuilder.CreateDisc('swingRing', { radius: 0.05, tessellation: 24 }, this.scene);
        ring.position.copyFrom(center);
        ring.position.y = 0.3;
        ring.rotation.x = Math.PI / 2;
        const mat = getCachedMaterial(this.scene, 'swingRingMat', m => {
            m.emissiveColor = new Color3(1, 1, 1);
            m.alpha = 0.6;
        });
        ring.material = mat;

        const duration = 0.15; // seconds
        const startScale = 0.1;
        const endScale = range;
        let elapsed = 0;

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            const t = Math.min(elapsed / duration, 1);
            const s = startScale + (endScale - startScale) * t;
            ring.scaling.set(s, s, s);
            mat.alpha = 0.6 * (1 - t);
            if (t >= 1) {
                ring.dispose();
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
