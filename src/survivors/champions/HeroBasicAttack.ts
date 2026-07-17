import { Vector3, Mesh, Color, CircleGeometry, DoubleSide, MeshBasicMaterial, MeshPhongMaterial } from 'three';
import { Champion } from './Champion';
import { PowerSlotManager } from '../powers/PowerSlotManager';
import { EnchantmentHitContext, PowerElement } from '../powers/PowerDefinitions';
import { Enemy } from '../enemies/Enemy';
import { rollCrit } from '../enemies/critRoll';
import { PlayerStats } from '../PlayerStats';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { acquireProjectile, releaseProjectile } from '../../engine/rendering/ProjectilePool';
import { setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { blendElements } from '../ElementColors';
import { emitCoopFx } from '../coop/CoopFx';
import { buildArrowMesh } from '../powers/ArrowMesh';
import { createSphere, createTorus, disposeMesh } from '../../engine/three/primitives';
import { headingToYaw } from '../../engine/three/math';
import type { SceneHost, UpdateToken } from '../../engine/three/SceneHost';

// Module-level scratch vectors — safe because update() is not reentrant (frames serialize)
const _scratchA = new Vector3();
const _scratchB = new Vector3();

export interface BasicAttackTarget {
    position: Vector3;
    takeDamage: (amount: number, element?: PowerElement) => void;
    isAlive: () => boolean;
    /** The underlying Enemy instance, if available. Used by the co-op guest to
     *  route damage to the host even when the proximity re-resolve fails. */
    enemy?: Enemy;
}

export type BasicAttackMode = 'projectile' | 'melee';

export type ProjectileShape = 'sphere' | 'arrow' | 'mageBolt';

/** Delay between the main melee swing and each queued follow-up spin. */
const EXTRA_SPIN_DELAY = 0.15;

/** Half-angle of the forward melee cone (full chop arc = 110°). */
export const MELEE_CONE_HALF_ANGLE_RAD = (55 * Math.PI) / 180;

/** Baseline shove every cone hit applies (world units). Small on purpose —
 *  it staggers the front rank without scattering the horde; the knockback
 *  item's per-stack push (1.0) stacks on top inside applyHit. */
export const MELEE_BASE_KNOCKBACK = 0.5;

/** Pure cone test: is the (dx, dz) offset within the cone around the unit
 *  facing (fx, fz)? Exported for Vitest. */
export function isInMeleeCone(
    dx: number, dz: number,
    fx: number, fz: number,
    cosHalfAngle: number,
): boolean {
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return true; // standing inside the hero — always hit
    return (dx / d) * fx + (dz / d) * fz >= cosHalfAngle;
}

/** In-flight projectile state, advanced by the ONE shared per-frame observer
 *  (was: one observer registered per projectile — dozens of live observers
 *  with attack-speed builds). */
interface ProjectileFlight {
    proj: Mesh;
    poolKey: string;
    target: BasicAttackTarget;
    shape: ProjectileShape;
    trailColor: Color;
    trailTimer: number;
    capturedDamage: number;
    heroPos: Vector3;
    allEnemies: Enemy[];
    /** Seconds in flight — released at 3s as a safety net. */
    age: number;
}

/** Fading trail puff driven by the shared observer (meshes pooled). */
interface StreakPuff { mesh: Mesh; elapsed: number; }
const STREAK_LIFETIME_S = 0.22;
const STREAK_POOL_MAX = 48;
/** Base alpha of a streak puff (the fade multiplies this, matching the old
 *  material.alpha(0.7) × mesh.visibility(1 - t) product). */
const STREAK_BASE_ALPHA = 0.7;

export class HeroBasicAttack {
    private scene: SceneHost;
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
    /** Item-effect hook: fired once per enemy actually hit by a basic attack
     *  (melee swing AND projectile), with the pre-crit damage dealt. */
    private onHitCallback: ((target: Enemy, damage: number) => void) | null = null;
    private projectileShape: ProjectileShape;
    private queuedSwings: number = 0;
    private queuedSpinTimer: number = 0;

    // For melee: reference to full enemy list for AOE
    private enemyProvider: (() => Enemy[]) | null = null;

    // Shared flight machinery: ONE observer advances every projectile + streak.
    private liveProjectiles: ProjectileFlight[] = [];
    private liveStreaks: StreakPuff[] = [];
    private streakPool: Mesh[] = [];
    private flightToken: UpdateToken | null = null;

    /**
     * When set (co-op guest), a hit reports to the host instead of mutating enemy HP.
     * Return value ignored; the caller still plays local hit VFX (swing ring / arc).
     */
    public damageRouter: ((enemy: Enemy, amount: number, element: PowerElement, isCrit: boolean) => void) | null = null;

    constructor(
        scene: SceneHost,
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

    /** Item-effect hook: fired once per enemy actually hit by a basic attack
     *  (melee swing AND projectile), with the pre-crit damage dealt. */
    public setOnHit(fn: ((target: Enemy, damage: number) => void) | null): void {
        this.onHitCallback = fn;
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

    /** Debug snapshot of every gate the fire path checks — so the co-op overlay can
     *  show exactly why the attack isn't firing (busy / no-target / out-of-range /
     *  on-cooldown) without the dev console. */
    public debugState(): { busy: boolean; hasTarget: boolean; dist: number; range: number; cooldown: number } {
        const hero = this.hero as { isSpecialActive?: () => boolean; isAttackActive?: () => boolean };
        const busy =
            (typeof hero.isSpecialActive === 'function' && hero.isSpecialActive()) ||
            (typeof hero.isAttackActive  === 'function' && hero.isAttackActive());
        const t = this.targetProvider();
        const dist = t ? this.getHeroPosition().distanceTo(t.position) : -1;
        return {
            busy,
            hasTarget: !!t && (t.isAlive?.() ?? true),
            dist,
            range: this.effectiveRange,
            cooldown: this.cooldown,
        };
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
            const range = this.effectiveRange;
            if (heroPos.distanceToSquared(target.position) > range * range) return;

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
    // Melee — forward cone chop (aimed at the nearest enemy in range)
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

        // Aim the chop at the nearest enemy in range — the swing only fires
        // when one exists (hasMeleeTarget), so the cone always connects.
        let aim: Enemy | null = null;
        let aimDistSq = Infinity;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            const dSq = dx * dx + dz * dz;
            if (dSq <= rangeSq && dSq < aimDistSq) { aim = e; aimDistSq = dSq; }
        }
        if (!aim) return;
        let fx = aim.getPosition().x - heroPos.x;
        let fz = aim.getPosition().z - heroPos.z;
        const fLen = Math.hypot(fx, fz);
        if (fLen > 1e-3) { fx /= fLen; fz /= fLen; } else { fx = 1; fz = 0; }
        const cosHalf = Math.cos(MELEE_CONE_HALF_ANGLE_RAD);

        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const dx = e.getPosition().x - heroPos.x;
            const dz = e.getPosition().z - heroPos.z;
            if (dx * dx + dz * dz > rangeSq) continue;
            if (!isInMeleeCone(dx, dz, fx, fz, cosHalf)) continue;
            this.applyHit(e, heroPos, enemies);
            // Baseline shove radiating from the hero — the chop staggers the
            // front rank. Item knockback (applyHit) stacks on top.
            const d = Math.hypot(dx, dz);
            if (d > 0.001) e.applyKnockback(dx / d, dz / d, MELEE_BASE_KNOCKBACK);
            hitEnemies.push(e);
        }

        // Forward chop-arc visual aligned to the cone.
        const facingAngle = Math.atan2(fz, fx);
        this.spawnSwingCone(heroPos, range, facingAngle);
        // Per-enemy impact flash — capped so a crowded chop doesn't spike
        // draw calls; the cone arc + damage numbers carry the rest.
        for (let i = 0; i < Math.min(hitEnemies.length, 4); i++) {
            this.spawnImpactFlash(hitEnemies[i].getPosition());
        }
        // Co-op: broadcast the swing (range + facing) so the teammate sees the
        // same cone arc. "range:angle" — old builds parseFloat the range prefix.
        emitCoopFx('swing', heroPos.x, heroPos.z, undefined, undefined,
            `${range}:${facingAngle.toFixed(3)}`);

        // Weapon-trail FX (axe ribbon follows the weapon bone through the chop;
        // also drives the procedural fallback's attack timer).
        const hero = this.hero as any;
        if (typeof hero.triggerSpinAttack === 'function') {
            hero.triggerSpinAttack();
        }
        // GLB attack animation — face the cone's aim target so the chop clip
        // points where the hits land.
        if (typeof hero.triggerAttack === 'function') {
            hero.triggerAttack(aim.getPosition());
        }
    }

    /** Apply one full basic-attack hit to a single enemy: effective damage
     *  (crit is rolled inside Enemy.takeDamage), lifesteal, knockback radiating
     *  from `fromPos`, and element enchantments. Shared by the melee swing and
     *  Whirlwind ticks so both carry the exact same hit modifiers. */
    private applyHit(e: Enemy, fromPos: Vector3, enemies: Enemy[]): void {
        const dmg = this.effectiveDamage;
        if (this.damageRouter) {
            // Co-op guest: roll crit client-side (using the global provider, same
            // as the solo path's Enemy.takeDamage would) and send the post-crit
            // number + flag to the host, which applies it verbatim.
            const cp = Enemy.critProvider?.();
            const rolled = rollCrit(dmg, cp ?? undefined, Math.random);
            this.damageRouter(e, rolled.amount, 'physical', rolled.isCrit);
        } else {
            e.takeDamage(dmg, 'physical');
        }

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
        // Item-effect hit hook — fires on host/solo AND the co-op guest (each client
        // runs its OWN item effects; the primary hit already routed via damageRouter
        // above). Pre-crit `dmg`, identical to the solo path, for parity.
        this.onHitCallback?.(e, dmg);
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

    /** Forward chop-arc visual: a faint wedge showing the full cone plus a
     *  bright blade slice sweeping across it. `facingAngle` is the world XZ
     *  angle of the cone center (atan2(dz, dx)).
     *
     *  Yaw math: geometry theta θ maps to world angle θ − rotation.y after the
     *  x=π/2 pitch (order 'YXZ'), so aiming geometry-center θ=0 at the facing
     *  means rotation.y = −facingAngle. */
    private spawnSwingCone(center: Vector3, range: number, facingAngle: number): void {
        // Barbarian-only elemental tint: blend the colors of every active power
        // element. No elements (or non-barbarian) → the classic gold arc.
        const active = (this.powerSlots && (this.hero as any).championType === 'barbarian')
            ? Array.from(this.powerSlots.getActiveElements())
            : [];
        const tint = active.length > 0 ? blendElements(active) : null;
        const half = MELEE_CONE_HALF_ANGLE_RAD;

        // Faint full-cone wedge — the hit-area readout.
        const wedge = new Mesh(new CircleGeometry(range, 24, -half, half * 2));
        wedge.name = 'swingCone';
        this.scene.scene.add(wedge);
        wedge.position.copy(center);
        wedge.position.y = 0.3;
        wedge.rotation.order = 'YXZ';
        wedge.rotation.x = Math.PI / 2;
        wedge.rotation.y = -facingAngle;
        // Cache materials by tint hue — finitely many element blends, compiled
        // once, reused forever. Fades go through setMeshOpacity (clone-on-write)
        // so the shared cached material is NEVER mutated in place.
        const wedgeMat = tint
            ? getCachedMaterial('swingConeMatElem_' + tint.getHexString(), m => {
                m.emissive.copy(tint).multiplyScalar(1.1);
                m.color.set(0, 0, 0); // emissive-only look
                m.transparent = true;
                m.opacity = 0.4;
                m.depthWrite = false;
                m.side = DoubleSide; // flat wedge must read from above regardless of winding
            })
            : getCachedMaterial('swingConeMat', m => {
                m.emissive.set(1, 0.85, 0.4);
                m.color.set(0, 0, 0);
                m.transparent = true;
                m.opacity = 0.4;
                m.depthWrite = false;
                m.side = DoubleSide;
            });
        wedge.material = wedgeMat;
        wedge.scale.setScalar(0.75); // grows to full reach during the chop

        // Bright blade slice sweeping edge-to-edge across the cone.
        const bladeHalf = (14 * Math.PI) / 180;
        const blade = new Mesh(new CircleGeometry(range, 10, -bladeHalf, bladeHalf * 2));
        blade.name = 'swingBlade';
        this.scene.scene.add(blade);
        blade.position.copy(center);
        blade.position.y = 0.35;
        blade.rotation.order = 'YXZ';
        blade.rotation.x = Math.PI / 2;
        const bladeMat = tint
            ? getCachedMaterial('swingBladeMatElem_' + tint.getHexString(), m => {
                m.emissive.copy(tint).multiplyScalar(1.4);
                m.color.set(0, 0, 0);
                m.transparent = true;
                m.opacity = 0.75;
                m.depthWrite = false;
                m.side = DoubleSide;
            })
            : getCachedMaterial('swingBladeMat', m => {
                m.emissive.set(1, 0.95, 0.7);
                m.color.set(0, 0, 0);
                m.transparent = true;
                m.opacity = 0.75;
                m.depthWrite = false;
                m.side = DoubleSide;
            });
        blade.material = bladeMat;

        const duration = 0.3;
        const sweep = half - bladeHalf; // blade center travels ±this around facing
        let elapsed = 0;

        let token: UpdateToken | null = null;
        token = this.scene.onBeforeRender.add(() => {
            elapsed += this.scene.deltaSeconds;
            const t = Math.min(elapsed / duration, 1);

            // Wedge: expand to full reach and fade.
            const s = 0.75 + 0.25 * t;
            wedge.scale.set(s, s, s);
            setMeshOpacity(wedge, 0.4 * (1 - t));

            // Blade: sweep across the cone (clockwise viewed from above) and fade.
            blade.rotation.y = -(facingAngle + (1 - 2 * t) * sweep);
            setMeshOpacity(blade, 0.75 * (1 - t * t));

            if (t >= 1) {
                // disposeMesh frees the meshes + their setMeshOpacity clones (flagged
                // ownedMaterial); the cached shared materials are skipped —
                // clearMaterialCache() frees them on run teardown.
                disposeMesh(wedge);
                disposeMesh(blade);
                this.scene.onBeforeRender.remove(token);
            }
        });
    }

    /** Small expanding shockwave ring at a struck enemy — the same cached-
     *  material + setMeshOpacity(clone-on-write) + disposeMesh lifecycle as the
     *  swing ring, so nothing is orphaned. ~0.22 s, one draw call while live. */
    private spawnImpactFlash(pos: Vector3): void {
        const ring = createTorus('impactFlash', { diameter: 0.7, thickness: 0.14, tessellation: 16 }, this.scene);
        ring.position.set(pos.x, 0.45, pos.z);
        ring.material = getCachedMaterial('impactFlashMat', m => {
            m.emissive.set(1, 0.9, 0.6);
            m.color.set(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.85;
            m.depthWrite = false;
        });

        const duration = 0.22;
        let elapsed = 0;
        let token: UpdateToken | null = null;
        token = this.scene.onBeforeRender.add(() => {
            elapsed += this.scene.deltaSeconds;
            const t = Math.min(elapsed / duration, 1);
            const s = 0.6 + 1.5 * t;
            ring.scale.set(s, s, s);
            setMeshOpacity(ring, 0.85 * (1 - t));
            if (t >= 1) {
                disposeMesh(ring);
                this.scene.onBeforeRender.remove(token);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Projectile
    // ─────────────────────────────────────────────────────────────────────────

    /** Build the projectile mesh for this attack's configured shape.
     *
     *  IMPORTANT: the projectile pool resets the ROOT transform on reuse
     *  (acquireProjectile), so any baked orientation (the arrow's +Z pitch) is
     *  re-applied per spawn in spawnProjectile — never rely on rotation set here
     *  surviving a pool round-trip. Sub-parts (arrow tip/fletch, bolt halo) live
     *  as children whose LOCAL transforms the pool never touches. Materials are
     *  applied per spawn to the whole subtree (applyProjectileMaterial). */
    private createProjectileMesh(): Mesh {
        const scene = this.scene;
        switch (this.projectileShape) {
            case 'arrow':
                // Shaft + cone tip + fletching, forward = +Z (rotation.order 'YXZ' +
                // pitch, re-asserted per spawn). Shared with the power arrows.
                return buildArrowMesh(scene, 'basicArrow', new Color(0.7, 0.5, 0.3));
            case 'mageBolt': {
                // Glowing orb with a halo ring perpendicular to the flight axis
                const orb = createSphere('mageBolt',
                    { diameter: 0.4, segments: 4 }, scene);
                const halo = createTorus('mageBoltHalo',
                    { diameter: 0.55, thickness: 0.05, tessellation: 12 });
                halo.rotation.x = Math.PI / 2;
                orb.add(halo);
                return orb;
            }
            case 'sphere':
            default:
                return createSphere('basicProj', { diameter: 0.3, segments: 4 }, scene);
        }
    }

    /** Assign one material to the projectile root and every sub-part. */
    private applyProjectileMaterial(proj: Mesh, mat: MeshPhongMaterial): void {
        proj.traverse(node => {
            const m = node as Mesh;
            if (m.isMesh) m.material = mat;
        });
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
            enemy: target.enemy,
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

        // Top-k selection (k = extra projectiles, ≤ ~6): keep a small sorted
        // array of the nearest candidates instead of collecting + full-sorting
        // every enemy in range — this runs once per volley at ranger fire rates.
        const need = total - 1;
        const bestE: Enemy[] = [];
        const bestD2: number[] = [];
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
            if (bestD2.length === need && d2 >= bestD2[need - 1]) continue;
            // Insert sorted (k is tiny — linear shift beats any cleverness).
            let at = bestD2.length;
            while (at > 0 && bestD2[at - 1] > d2) at--;
            bestD2.splice(at, 0, d2);
            bestE.splice(at, 0, e);
            if (bestD2.length > need) { bestD2.pop(); bestE.pop(); }
        }

        for (const e of bestE) {
            out.push({
                position: e.getPosition(),
                takeDamage: (amount: number) => e.takeDamage(amount),
                isAlive: () => e.isAlive(),
                enemy: e,
            });
        }
        return out;
    }

    private spawnProjectile(from: Vector3, target: BasicAttackTarget): void {
        // Co-op: broadcast this projectile so the teammate sees the shot (cosmetic only —
        // damage is already routed authoritatively). No-op in single-player.
        emitCoopFx('proj', from.x, from.z, target.position.x, target.position.z, this.projectileShape);
        const poolKey = `basic_attack_proj_${this.projectileShape}`;
        const proj = acquireProjectile(poolKey, () => this.createProjectileMesh());
        proj.position.copy(from);
        proj.position.y = 1;

        // Element-matched tint: blend the colors of every equipped power element
        // (same rule as the barbarian's swing arc). The material is cached by the
        // blend's hex — element subsets are finite, so the cache stays bounded.
        const activeElements = this.powerSlots
            ? Array.from(this.powerSlots.getActiveElements())
            : [];
        const tint = activeElements.length > 0 ? blendElements(activeElements) : null;
        const matKey = tint
            ? `basic_attack_proj_mat_${this.projectileShape}_${tint.getHexString()}`
            : `basic_attack_proj_mat_${this.projectileShape}`;
        const mat = getCachedMaterial(matKey, m => {
            if (tint) {
                m.emissive.copy(tint).multiplyScalar(1.1);
                m.color.set(0, 0, 0); // was disableLighting — emissive-only look
                return;
            }
            switch (this.projectileShape) {
                case 'arrow':
                    m.emissive.set(0.7, 0.5, 0.3);
                    m.color.set(0.7, 0.5, 0.3);
                    break;
                case 'mageBolt':
                    m.emissive.set(0.6, 0.4, 1.0);
                    m.color.set(0.2, 0.1, 0.4);
                    break;
                case 'sphere':
                default:
                    m.emissive.set(1, 0.9, 0.4);
                    break;
            }
        });
        this.applyProjectileMaterial(proj, mat);

        // Re-assert the arrow's baked forward orientation (the pool reset zeroes the
        // root rotation) and face the target immediately — the per-frame orient below
        // only runs from the next render, which left one frame of stale facing.
        if (this.projectileShape === 'arrow') {
            proj.rotation.order = 'YXZ'; // yaw applied around world Y, then the +Z pitch
            proj.rotation.x = Math.PI / 2;
            proj.rotation.y = headingToYaw(target.position.x - from.x, target.position.z - from.z);
        }

        // Hand the flight to the single shared observer (see ensureFlightObserver).
        this.liveProjectiles.push({
            proj,
            poolKey,
            target,
            shape: this.projectileShape,
            // Element-colored streak behind the arrow while it flies (gold when
            // no elements are equipped yet).
            trailColor: tint ?? new Color(1, 0.85, 0.5),
            trailTimer: 0,
            // Snapshot damage at fire time — projectile carries that value;
            // upgrades mid-flight don't retroactively buff already-fired arrows.
            capturedDamage: this.effectiveDamage,
            heroPos: from,
            allEnemies: this.enemyProvider ? this.enemyProvider() : [],
            age: 0,
        });
        this.ensureFlightObserver();
    }

    /** Lazily register the ONE observer that advances every live projectile and
     *  trail puff. Replaces the old observer-per-projectile/per-puff pattern,
     *  whose observer count scaled with attack speed. */
    private ensureFlightObserver(): void {
        if (this.flightToken) return;
        this.flightToken = this.scene.onBeforeRender.add(() => {
            const dt = this.scene.deltaSeconds;

            // Backwards with swap-remove so releases don't shift the array.
            for (let i = this.liveProjectiles.length - 1; i >= 0; i--) {
                if (!this.stepProjectile(this.liveProjectiles[i], dt)) {
                    this.liveProjectiles[i] = this.liveProjectiles[this.liveProjectiles.length - 1];
                    this.liveProjectiles.pop();
                }
            }

            for (let i = this.liveStreaks.length - 1; i >= 0; i--) {
                const s = this.liveStreaks[i];
                s.elapsed += dt;
                const t = Math.min(s.elapsed / STREAK_LIFETIME_S, 1);
                s.mesh.scale.setScalar(1 - t);
                // Puff materials are per-mesh owned (see spawnFlightStreak) — safe
                // to mutate. Matches the old material.alpha × visibility product.
                (s.mesh.material as MeshBasicMaterial).opacity = STREAK_BASE_ALPHA * (1 - t);
                if (t >= 1) {
                    this.releaseStreak(s.mesh);
                    this.liveStreaks[i] = this.liveStreaks[this.liveStreaks.length - 1];
                    this.liveStreaks.pop();
                }
            }
        });
    }

    /** Advance one projectile by dt. Returns false when the flight ended (the
     *  projectile has been released back to the pool). */
    private stepProjectile(f: ProjectileFlight, dt: number): boolean {
        const { proj, target } = f;
        if (!target.isAlive()) {
            releaseProjectile(f.poolKey, proj);
            return false;
        }
        _scratchA.copy(target.position);
        _scratchA.y = 1;
        _scratchB.subVectors(_scratchA, proj.position);
        const dist = _scratchB.length();

        // Orient arrow to face travel direction
        if (f.shape === 'arrow' && dist > 0.01) {
            proj.rotation.y = headingToYaw(_scratchB.x, _scratchB.z);
        }

        if (dist < 0.4) {
            // Resolve the actual Enemy instance behind the BasicAttackTarget so we
            // have applyKnockback AND can route damage to the host in co-op. The
            // target usually carries its Enemy; the O(n) proximity find is only the
            // fallback for providers that don't set it.
            const hitEnemy = target.enemy ?? f.allEnemies.find(e => {
                const ep = e.getPosition();
                const dx = ep.x - target.position.x;
                const dz = ep.z - target.position.z;
                return dx * dx + dz * dz < 0.25 && e.isAlive();
            });
            // Co-op guest: always route to host, never mutate local HP.
            if (this.damageRouter) {
                // Roll crit client-side; send the post-crit number + flag to the host.
                if (hitEnemy) {
                    const cp = Enemy.critProvider?.();
                    const rolled = rollCrit(f.capturedDamage, cp ?? undefined, Math.random);
                    this.damageRouter(hitEnemy, rolled.amount, 'physical', rolled.isCrit);
                }
                // guest: never local takeDamage on a shared enemy
            } else {
                target.takeDamage(f.capturedDamage, 'physical');
            }
            if (this.healCallback && this.playerStats && this.playerStats.lifestealPct > 0) {
                this.healCallback(f.capturedDamage * this.playerStats.lifestealPct);
            }
            // Apply enchantments AND knockback on projectile hit.
            if (hitEnemy) {
                const knockback = this.playerStats?.knockbackOnHit ?? 0;
                if (knockback > 0) {
                    // Direction: hero → impact point (matches projectile travel direction).
                    const tx = target.position.x - f.heroPos.x;
                    const tz = target.position.z - f.heroPos.z;
                    const tlen = Math.hypot(tx, tz);
                    if (tlen > 0.001) {
                        hitEnemy.applyKnockback(tx / tlen, tz / tlen, knockback);
                    }
                }
                if (this.powerSlots) {
                    this.applyEnchantments(hitEnemy, f.heroPos, f.allEnemies);
                }
                // Item-effect hit hook — host/solo AND co-op guest (pre-crit, parity).
                this.onHitCallback?.(hitEnemy, f.capturedDamage);
            }
            releaseProjectile(f.poolKey, proj);
            return false;
        }

        const speed = 22;
        const step = Math.min(dist, speed * dt);
        _scratchB.normalize();
        _scratchB.multiplyScalar(step);
        proj.position.add(_scratchB);

        if (f.shape === 'arrow' || f.shape === 'mageBolt') {
            f.trailTimer += dt;
            if (f.trailTimer >= 0.06) {
                f.trailTimer = 0;
                this.spawnFlightStreak(proj.position, f.trailColor);
            }
        }

        // Safety: release after 3s of flight
        f.age += dt;
        if (f.age > 3) {
            releaseProjectile(f.poolKey, proj);
            return false;
        }
        return true;
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
            element: 'physical',
        };

        for (const enc of enchantments) {
            if (enc.slot.def.onHit) {
                ctx.element = enc.slot.def.element;
                enc.slot.def.onHit(enemy, enc.level, ctx);
            }
        }
    }

    /** Small fading puff behind an in-flight projectile. Meshes come from a
     *  pool (was: a fresh sphere + observer every 0.06s per arrow); the fade is
     *  driven by the shared flight observer. Each pooled puff owns ONE mutable
     *  unlit material (pool-capped, so bounded) that is recolored per spawn —
     *  never a shared cached material, since the fade mutates opacity per frame. */
    private spawnFlightStreak(position: Vector3, color: Color): void {
        const scene = this.scene;
        let puff = this.streakPool.pop();
        if (!puff) {
            puff = createSphere('basicAttackStreak', { diameter: 0.14, segments: 3 }, scene);
            puff.material = new MeshBasicMaterial({ transparent: true, depthWrite: false });
            puff.userData.ownedMaterial = true; // disposeMesh frees it with the puff
        }
        puff.visible = true;
        puff.scale.setScalar(1);
        const mat = puff.material as MeshBasicMaterial;
        mat.color.copy(color);
        mat.opacity = STREAK_BASE_ALPHA;
        puff.position.copy(position);
        this.liveStreaks.push({ mesh: puff, elapsed: 0 });
    }

    /** Return a faded puff to the pool (or dispose past the cap). */
    private releaseStreak(mesh: Mesh): void {
        if (this.streakPool.length < STREAK_POOL_MAX) {
            mesh.visible = false;
            this.streakPool.push(mesh);
        } else {
            disposeMesh(mesh); // ownedMaterial flag frees its material too
        }
    }

    /** Tear down the shared flight observer, live projectiles, and the streak
     *  pool. Called from HeroController.dispose() on run exit. */
    public dispose(): void {
        if (this.flightToken) {
            this.scene.onBeforeRender.remove(this.flightToken);
            this.flightToken = null;
        }
        for (const f of this.liveProjectiles) releaseProjectile(f.poolKey, f.proj);
        this.liveProjectiles.length = 0;
        for (const s of this.liveStreaks) disposeMesh(s.mesh);
        this.liveStreaks.length = 0;
        for (const m of this.streakPool) disposeMesh(m);
        this.streakPool.length = 0;
    }

    private getHeroPosition(): Vector3 {
        return (this.hero as any).position as Vector3;
    }
}
