import { Scene, Vector3, MeshBuilder, Mesh, Color3 } from '@babylonjs/core';
import { Champion } from './Champion';
import { PowerSlotManager } from '../powers/PowerSlotManager';
import { EnchantmentHitContext } from '../powers/PowerDefinitions';
import { Enemy } from '../enemies/Enemy';
import { PlayerStats } from '../PlayerStats';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';

// Module-level scratch vectors — safe because update() is not reentrant (frames serialize)
const _scratchA = new Vector3();
const _scratchB = new Vector3();

export interface BasicAttackTarget {
    position: Vector3;
    takeDamage: (amount: number) => void;
    isAlive: () => boolean;
}

export type BasicAttackMode = 'projectile' | 'melee';

export type ProjectileShape = 'sphere' | 'arrow' | 'mageBolt';

/** Delay between the main melee swing and each queued follow-up spin. */
const EXTRA_SPIN_DELAY = 0.15;

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
    /** When true, every 15% above 1.0× attack speed grants +1 projectile in the fan.
     *  Wired on for the ranger so AS investment scales target count, not just rate. */
    private multiTargetFromAttackSpeed: boolean = false;
    private targetProvider: () => BasicAttackTarget | null;
    private powerSlots: PowerSlotManager | null = null;
    private playerStats: PlayerStats | null = null;
    /** Wired by HeroController.setPlayerStats — routes lifesteal heals to the hero's REAL HP
     *  (PlayerStats.health is a separate phantom value that the HUD doesn't read). */
    private healCallback: ((amount: number) => void) | null = null;
    private projectileShape: ProjectileShape;
    private queuedSwings: number = 0;
    private queuedSpinTimer: number = 0;

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
            projectileShape?: ProjectileShape;
            multiTargetFromAttackSpeed?: boolean;
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
        this.projectileShape = opts.projectileShape ?? 'sphere';
        this.multiTargetFromAttackSpeed = opts.multiTargetFromAttackSpeed ?? false;
    }

    /** Wire up the power slot manager so enchantments apply on each hit. */
    public setPowerSlots(slots: PowerSlotManager): void {
        this.powerSlots = slots;
    }

    /** Global damage-multiplier provider (shop upgrades + run perks). Multiplies
     *  every basic-attack hit and is passed to enchantment onHit hooks so passive
     *  bonus-damage effects scale with global power too. */
    private damageMultiplierProvider: () => number = () => 1.0;
    public setDamageMultiplierProvider(fn: () => number): void {
        this.damageMultiplierProvider = fn;
    }

    private get effectiveDamage(): number {
        return this.damage * this.damageMultiplierProvider();
    }

    /** Wire up player stats so run-item effects (lifesteal, knockback, multishot, multi-spin) apply. */
    public setPlayerStats(stats: PlayerStats): void {
        this.playerStats = stats;
    }

    /** Wire the callback that applies lifesteal heals to the hero. */
    public setHealCallback(fn: (amount: number) => void): void {
        this.healCallback = fn;
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
        // While a GLB special or basic-attack animation is still playing, suspend
        // basic attacks — no swing, no projectile, no damage, no swing-arc visual.
        // For barbarian this lets the long whirlwind clip (skill3) finish before
        // the next attack restarts it. Cooldown still ticks so attacks resume
        // promptly when the previous animation ends.
        const hero = this.hero as { isSpecialActive?: () => boolean; isAttackActive?: () => boolean };
        const busy =
            (typeof hero.isSpecialActive === 'function' && hero.isSpecialActive()) ||
            (typeof hero.isAttackActive  === 'function' && hero.isAttackActive());
        if (busy) {
            this.cooldown -= deltaTime;
            return;
        }

        // Queued follow-up swings (barbarian extraAttacks) bypass the normal cooldown gate
        // so they fire at the chosen cadence regardless of the base attack interval. Skip
        // the swing if no enemy is in range (still drain the queue counter so we don't
        // pile up a backlog).
        if (this.queuedSwings > 0) {
            this.queuedSpinTimer -= deltaTime;
            if (this.queuedSpinTimer <= 0) {
                if (this.hasMeleeTarget()) this.performMeleeSwing();
                this.queuedSwings--;
                this.queuedSpinTimer = EXTRA_SPIN_DELAY;
            }
        }

        this.cooldown -= deltaTime;
        if (this.cooldown > 0) return;

        if (this.mode === 'melee') {
            // Only swing if at least one enemy is within range — otherwise the
            // cooldown holds and the next swing fires as soon as a mob walks in.
            if (!this.hasMeleeTarget()) return;
            this.performMeleeSwing();
            // After the main swing, queue any extra spins from RunItems.
            const extras = this.playerStats?.extraAttacks ?? 0;
            if (extras > 0) {
                this.queuedSwings = extras;
                this.queuedSpinTimer = EXTRA_SPIN_DELAY;
            }
            this.cooldown = this.effectiveInterval;
        } else {
            const target = this.targetProvider();
            if (!target || !target.isAlive()) return;

            const heroPos = this.getHeroPosition();
            const dist = Vector3.Distance(heroPos, target.position);
            if (dist > this.effectiveRange) return;

            const extras = this.playerStats?.extraAttacks ?? 0;
            // Ranger: every 15% above 1.0× AS grants an extra projectile. The
            // Multishot ult also rides on this — it boosts AS temporarily so the
            // multi-target effect chains naturally instead of duplicating logic.
            const asBonus = this.multiTargetFromAttackSpeed
                ? Math.max(0, Math.floor((this.attackSpeedMultiplier - 1) / 0.15))
                : 0;
            const total  = 1 + extras + asBonus;
            if (total === 1) {
                this.spawnProjectile(heroPos.clone(), target);
            } else if (this.multiTargetFromAttackSpeed) {
                // Ranger multishot: each extra arrow tracks a distinct nearest enemy.
                // Falls back to the angle-fan for any arrows beyond the available
                // target count so the volley still reads as "many arrows."
                const tgts = this.pickDistinctNearestTargets(heroPos, target, total);
                for (const t of tgts) this.spawnProjectile(heroPos.clone(), t);
                const fanned = total - tgts.length;
                if (fanned > 0) {
                    const totalSpreadRad = (20 * Math.PI) / 180;
                    const step = fanned > 1 ? totalSpreadRad / (fanned - 1) : 0;
                    const start = -totalSpreadRad / 2;
                    for (let i = 0; i < fanned; i++) {
                        this.spawnProjectileAtAngle(heroPos.clone(), target, start + step * i);
                    }
                }
            } else {
                const totalSpreadRad = (20 * Math.PI) / 180;
                const step = total > 1 ? totalSpreadRad / (total - 1) : 0;
                const start = -totalSpreadRad / 2;
                for (let i = 0; i < total; i++) {
                    const angle = start + step * i;
                    this.spawnProjectileAtAngle(heroPos.clone(), target, angle);
                }
            }
            // Trigger the ranger GLB's Shoot animation + face the target (no-op for
            // non-ranger champions).
            const hero = this.hero as { triggerAttack?: (targetPos?: Vector3) => void };
            if (typeof hero.triggerAttack === 'function') {
                hero.triggerAttack(target.position);
            }
            this.cooldown = this.effectiveInterval;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Melee — 360° AOE swing
    // ─────────────────────────────────────────────────────────────────────────

    /** True when at least one alive enemy is within the effective melee range. */
    private hasMeleeTarget(): boolean {
        if (!this.enemyProvider) return false;
        const heroPos = this.getHeroPosition();
        const range = this.effectiveRange;
        const rangeSq = range * range;
        for (const e of this.enemyProvider()) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            if (dx * dx + dz * dz <= rangeSq) return true;
        }
        return false;
    }

    private performMeleeSwing(): void {
        const heroPos = this.getHeroPosition();
        const range = this.effectiveRange;
        const enemies = this.enemyProvider ? this.enemyProvider() : [];
        const hitEnemies: Enemy[] = [];

        const rangeSq = range * range;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            if (dx * dx + dz * dz <= rangeSq) {
                this.applyHit(e, heroPos, enemies);
                hitEnemies.push(e);
            }
        }

        // Bright sword-arc visual (thick golden torus + sweeping blade trail)
        this.spawnSwingRing(heroPos, range);

        // Procedural barbarian spin FX (no-op for GLB champions — they lack barbAxeHead etc).
        const hero = this.hero as any;
        if (typeof hero.triggerSpinAttack === 'function') {
            hero.triggerSpinAttack();
        }
        // GLB attack animation — facing the nearest hit enemy if we landed any.
        if (typeof hero.triggerAttack === 'function') {
            const facing = hitEnemies.length > 0 ? hitEnemies[0].getPosition() : undefined;
            hero.triggerAttack(facing);
        }
    }

    /** Apply one full basic-attack hit to a single enemy: effective damage
     *  (crit is rolled inside Enemy.takeDamage), lifesteal, knockback radiating
     *  from `fromPos`, and element enchantments. Shared by the melee swing and
     *  Whirlwind ticks so both carry the exact same hit modifiers. */
    private applyHit(e: Enemy, fromPos: Vector3, enemies: Enemy[]): void {
        const dmg = this.effectiveDamage;
        e.takeDamage(dmg);

        const lifestealPct = this.playerStats?.lifestealPct ?? 0;
        if (lifestealPct > 0 && this.healCallback) {
            this.healCallback(dmg * lifestealPct);
        }

        const knockback = this.playerStats?.knockbackOnHit ?? 0;
        if (knockback > 0) {
            const dx = e.getPosition().x - fromPos.x;
            const dz = e.getPosition().z - fromPos.z;
            const horizDist = Math.hypot(dx, dz);
            if (horizDist > 0.001) {
                e.applyKnockback(dx / horizDist, dz / horizDist, knockback);
            }
        }

        this.applyEnchantments(e, fromPos, enemies);
    }

    /** Apply full basic-attack hits to every enemy within `radius` of `center`.
     *  Whirlwind uses this so each tick hits exactly like the basic attack
     *  (crit / lifesteal / knockback / enchantments) — just far more often. */
    public applyAttackHitsInRadius(center: Vector3, radius: number): void {
        const enemies = this.enemyProvider ? this.enemyProvider() : [];
        const rSq = radius * radius;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - center.x;
            const dz = e.getPosition().z - center.z;
            if (dx * dx + dz * dz <= rSq) {
                this.applyHit(e, center, enemies);
            }
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

            // Arc: sweep a full 360° (the half-disc rotates twice to look like a continuous sweep).
            // Negative sign = clockwise (viewed from above), matching the Aulus whirlwind spin.
            arc.rotation.y = -t * Math.PI * 2;
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

    /** Build the projectile mesh for this attack's configured shape. */
    private createProjectileMesh(): Mesh {
        const scene = this.scene;
        switch (this.projectileShape) {
            case 'arrow': {
                // Elongated shaft with a cone tip and fletching fins
                const shaft = MeshBuilder.CreateCylinder('arrowShaft',
                    { height: 0.6, diameterTop: 0.04, diameterBottom: 0.04, tessellation: 6 }, scene);
                const tip = MeshBuilder.CreateCylinder('arrowTip',
                    { height: 0.15, diameterTop: 0, diameterBottom: 0.10, tessellation: 6 }, scene);
                tip.position.y = 0.375; // tip at the front end of the shaft
                tip.parent = shaft;
                const fletching = MeshBuilder.CreateBox('arrowFletch',
                    { width: 0.10, height: 0.10, depth: 0.02 }, scene);
                fletching.position.y = -0.30;
                fletching.parent = shaft;
                // Rotate so the shaft points along the Z axis (flight direction set per-frame)
                shaft.rotation.x = Math.PI / 2;
                return shaft;
            }
            case 'mageBolt': {
                // Slightly larger glowing orb with a halo ring
                const orb = MeshBuilder.CreateSphere('mageBolt',
                    { diameter: 0.4, segments: 4 }, scene);
                const halo = MeshBuilder.CreateTorus('mageBoltHalo',
                    { diameter: 0.55, thickness: 0.05, tessellation: 12 }, scene);
                halo.parent = orb;
                halo.rotation.x = Math.PI / 2;
                return orb;
            }
            case 'sphere':
            default:
                return MeshBuilder.CreateSphere('basicProj', { diameter: 0.3, segments: 4 }, scene);
        }
    }

    /**
     * Fan-variant of spawnProjectile: rotates the launch direction by `angleRad`
     * around the vertical axis. Center projectile (angle = 0) is identical to
     * a normal spawnProjectile call. Off-center projectiles fly straight in the
     * rotated direction at the same speed; if they hit the original target
     * along the way (the target's tracking is preserved by spawnProjectile),
     * they still apply damage. Off-center projectiles miss the target most of
     * the time — they exist primarily to make the fan readable and to clear
     * out adjacent enemies.
     */
    private spawnProjectileAtAngle(from: Vector3, target: BasicAttackTarget, angleRad: number): void {
        if (angleRad === 0) {
            this.spawnProjectile(from, target);
            return;
        }
        // Build a virtual target offset by rotating the (target - from) vector by angleRad.
        const dx = target.position.x - from.x;
        const dz = target.position.z - from.z;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const rotX = dx * cos - dz * sin;
        const rotZ = dx * sin + dz * cos;
        // Extend the rotated direction out to the same length so the projectile travels.
        const virtualTargetPos = new Vector3(from.x + rotX, target.position.y, from.z + rotZ);
        const virtualTarget: BasicAttackTarget = {
            position: virtualTargetPos,
            takeDamage: (amount: number) => target.takeDamage(amount),
            isAlive: () => target.isAlive(),
        };
        this.spawnProjectile(from, virtualTarget);
    }

    /**
     * For the ranger multishot mechanic: return up to `total` distinct targets,
     * starting with the primary auto-target and filling the rest with the next
     * nearest alive enemies inside `effectiveRange`. Returned BasicAttackTargets
     * wrap the live Enemy.getPosition() reference so projectiles keep tracking.
     */
    private pickDistinctNearestTargets(
        heroPos: Vector3,
        primary: BasicAttackTarget,
        total: number,
    ): BasicAttackTarget[] {
        const out: BasicAttackTarget[] = [primary];
        if (!this.enemyProvider || total <= 1) return out;
        const range = this.effectiveRange;
        const rangeSq = range * range;

        const candidates: { e: Enemy; d2: number }[] = [];
        for (const e of this.enemyProvider()) {
            if (!e.isAlive()) continue;
            const ep = e.getPosition();
            // Skip the primary target — compare positions (BasicAttackTarget hides identity).
            const dxp = ep.x - primary.position.x;
            const dzp = ep.z - primary.position.z;
            if (dxp * dxp + dzp * dzp < 0.04) continue; // ~0.2u tolerance
            const dx = ep.x - heroPos.x;
            const dz = ep.z - heroPos.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > rangeSq) continue;
            candidates.push({ e, d2 });
        }
        candidates.sort((a, b) => a.d2 - b.d2);

        const need = total - 1;
        for (let i = 0; i < Math.min(need, candidates.length); i++) {
            const e = candidates[i].e;
            out.push({
                position: e.getPosition(),
                takeDamage: (amount: number) => e.takeDamage(amount),
                isAlive: () => e.isAlive(),
            });
        }
        return out;
    }

    private spawnProjectile(from: Vector3, target: BasicAttackTarget): void {
        const scene = this.scene;
        const poolKey = `basic_attack_proj_${this.projectileShape}`;
        const proj = acquireProjectile(scene, poolKey, () => this.createProjectileMesh());
        proj.position.copyFrom(from);
        proj.position.y = 1;

        const matKey = `basic_attack_proj_mat_${this.projectileShape}`;
        proj.material = getCachedMaterial(scene, matKey, m => {
            switch (this.projectileShape) {
                case 'arrow':
                    m.emissiveColor = new Color3(0.7, 0.5, 0.3);
                    m.diffuseColor  = new Color3(0.7, 0.5, 0.3);
                    break;
                case 'mageBolt':
                    m.emissiveColor = new Color3(0.6, 0.4, 1.0);
                    m.diffuseColor  = new Color3(0.2, 0.1, 0.4);
                    break;
                case 'sphere':
                default:
                    m.emissiveColor = new Color3(1, 0.9, 0.4);
                    break;
            }
        });

        const speed = 22;
        const startTime = performance.now() / 1000;
        // Snapshot damage at fire time — projectile carries that value; upgrades
        // mid-flight don't retroactively buff already-fired arrows.
        const capturedDamage = this.effectiveDamage;
        const heroPos = from;
        const allEnemies = this.enemyProvider ? this.enemyProvider() : [];
        const shape = this.projectileShape;

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            if (!observer) return;
            if (!target.isAlive()) {
                releaseProjectile(poolKey, proj);
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            _scratchA.copyFrom(target.position);
            _scratchA.y = 1;
            _scratchA.subtractToRef(proj.position, _scratchB);
            const dist = _scratchB.length();

            // Orient arrow to face travel direction
            if (shape === 'arrow' && dist > 0.01) {
                proj.rotation.y = Math.atan2(_scratchB.x, _scratchB.z);
            }

            if (dist < 0.4) {
                target.takeDamage(capturedDamage);
                if (this.healCallback && this.playerStats && this.playerStats.lifestealPct > 0) {
                    this.healCallback(capturedDamage * this.playerStats.lifestealPct);
                }
                // Apply enchantments AND knockback on projectile hit — look up the actual
                // Enemy instance behind the BasicAttackTarget so we have applyKnockback.
                const enemyHit = allEnemies.find(e => {
                    const ep = e.getPosition();
                    const dx = ep.x - target.position.x;
                    const dz = ep.z - target.position.z;
                    return Math.hypot(dx, dz) < 0.5 && e.isAlive();
                });
                if (enemyHit) {
                    const knockback = this.playerStats?.knockbackOnHit ?? 0;
                    if (knockback > 0) {
                        // Direction: hero → impact point (matches projectile travel direction).
                        const tx = target.position.x - heroPos.x;
                        const tz = target.position.z - heroPos.z;
                        const tlen = Math.hypot(tx, tz);
                        if (tlen > 0.001) {
                            enemyHit.applyKnockback(tx / tlen, tz / tlen, knockback);
                        }
                    }
                    if (this.powerSlots) {
                        this.applyEnchantments(enemyHit, heroPos, allEnemies);
                    }
                }
                releaseProjectile(poolKey, proj);
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            const step = Math.min(dist, speed * dt);
            _scratchB.normalize();
            _scratchB.scaleInPlace(step);
            proj.position.addInPlace(_scratchB);

            // Safety: release after 3s of flight
            if (performance.now() / 1000 - startTime > 3) {
                releaseProjectile(poolKey, proj);
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
            // Pass the multiplied damage so passive on-hit bonuses (Arcane Bite,
            // Flaming Edge DoT, Heavy Strike, Shock Chain) also scale with shop
            // upgrades and the per-card global power bump.
            baseDamage: this.effectiveDamage,
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
