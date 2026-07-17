import {
    Color, DoubleSide, Material, Mesh, MeshBasicMaterial, Plane, Raycaster, Vector2, Vector3,
} from 'three';
import { LifeTimeCurve, Shape, SimulationSpace } from '@newkrok/three-particles';
import { Game } from '../../engine/Game';
import { SceneHost, UpdateToken } from '../../engine/three/SceneHost';
import { fxRenderer, fxSize, ParticleEffect } from '../../engine/three/particles/ParticleEffect';
import { headingToYaw } from '../../engine/three/math';
import { tween } from '../../engine/three/tween';
import {
    createCylinder, createDisc, createIcoSphere, createPlane, createTorus,
    disposeMesh, isMeshDisposed,
} from '../../engine/three/primitives';
import { Enemy } from '../enemies/Enemy';
import { EnemyManager } from '../enemies/EnemyManager';
import { PowerSlotManager } from '../powers/PowerSlotManager';
import { PlayerStats } from '../PlayerStats';
import { StatusEffect } from '../GameTypes';
import { createEmissiveMaterial, setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { emitCoopFx, isCoopFxActive } from '../coop/CoopFx';
import { blendElements } from '../ElementColors';
import { PowerElement } from '../powers/PowerDefinitions';
import {
    scheduleMeteorBarrage, createMeteorVisual, createFrostNovaVisual,
    spawnSmashShockwave, spawnHurricaneVisual, spawnWhirlwindRing,
    spawnMultishotAura, spawnExplosiveArrowFlight, spawnExplosionVisual,
} from './AbilityVisuals';

/** Co-op cosmetic-burst tint for ults WITHOUT exact replication (dash + legacy ults).
 *  The class ults (meteor/frostNova/whirlwind/smash/multishot/explosiveArrow) emit
 *  parameterised exact fx at their cast sites instead (M6 C2). */
const ULT_FX_ELEMENT: Record<string, string> = {
    chainLightning: 'storm', fortify: 'arcane', goldRush: 'arcane',
};
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';

/** Mode passed to the dash-override callback, picks which interpolation HeroController uses. */
export type DashMode = 'linear' | 'arc' | 'instant';

/** Callback HeroController registers so AbilityManager can drive hero position
 *  during the brief dash/jump/teleport window. */
export type DashOverrideFn = (
    target: Vector3,
    duration: number,
    mode: DashMode,
    onComplete: (landingPos: Vector3) => void,
) => void;

export interface Ability {
    name: string;
    cooldown: number;      // Total cooldown in seconds
    currentCooldown: number; // Time remaining on cooldown
    isReady: boolean;
    needsTargeting: boolean; // true = click-to-target, false = instant cast
}

interface ActiveEffect {
    id: string;
    timeLeft: number;
    tickInterval: number;
    timeSinceLastTick: number;
    tick: () => void;
    /** Optional one-shot cleanup hook fired when timeLeft hits 0. */
    onEnd?: () => void;
}

export class AbilityManager {
    private game: Game;
    private host: SceneHost;
    private enemyManager: EnemyManager;
    private playerStats: PlayerStats | null = null;
    private abilities: Map<string, Ability> = new Map();

    // Targeting state
    private isTargeting: boolean = false;
    private targetingAbility: string | null = null;

    // Click-to-target support: raycast canvas clicks against the ground plane
    // y=0 (replaces Babylon scene.pick). Dormant unless an ability with
    // needsTargeting is armed via startTargeting().
    private readonly raycaster = new Raycaster();
    private static readonly GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0);
    private readonly onCanvasClick = (ev: MouseEvent): void => {
        if (!this.isTargeting || !this.targetingAbility) return;
        const canvas = this.game.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ndc = new Vector2(
            ((ev.clientX - rect.left) / rect.width) * 2 - 1,
            -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(ndc, this.game.getActiveCamera());
        const hit = new Vector3();
        if (this.raycaster.ray.intersectPlane(AbilityManager.GROUND_PLANE, hit)) {
            this.activate(this.targetingAbility, hit);
        }
    };

    // Hero reference for class-specific abilities (e.g. Whirlwind spin)
    private hero: any = null;

    // Hero position provider
    private heroProvider: (() => Vector3) | null = null;

    // Active timed effects (Whirlwind, Multishot, Explosive Arrow, Dash override window)
    private activeEffects: ActiveEffect[] = [];

    /** Equipped autocast power slots. Multishot force-fires each one repeatedly to
     *  layer the ranger's equipped magical arrows on top of the plain volley. */
    private powerSlots: PowerSlotManager | null = null;

    /** Provides current movement input direction (WASD + joystick) for the Space-bar
     *  dash. Falls back to hero facing if magnitude is 0. */
    private directionProvider: (() => { dx: number; dz: number } | null) | null = null;

    /** Provides current champion class for per-class dash flavor (dash/jump/teleport). */
    private championTypeProvider: (() => 'barbarian' | 'ranger' | 'mage') | null = null;

    /** HeroController-registered hook that drives the hero's position during the
     *  dash window. AbilityManager calls this with the target landing position. */
    private dashOverride: DashOverrideFn | null = null;

    /** Fires after a successful activate(). Used by SurvivorsGameplayState to drive
     *  hero animations (e.g. play the Aulus whirlwind clip on barbarian whirlwind). */
    private onActivateCallback: ((abilityId: string) => void) | null = null;

    /** Applies a full basic-attack hit (crit / lifesteal / knockback / enchantments)
     *  to every enemy in a radius. Wired to HeroController so Whirlwind ticks hit
     *  exactly like the basic attack. */
    private meleeAoeHit: ((center: Vector3, radius: number) => void) | null = null;

    constructor(game: Game, enemyManager: EnemyManager) {
        this.game = game;
        this.host = game.getScene();
        this.enemyManager = enemyManager;
        this.game.getCanvas().addEventListener('click', this.onCanvasClick);

        // Default to mage abilities. Call configureForClass() to switch.
        this.configureForClass('mage');
    }

    // ── Role-aware enemy source (co-op M4-9) ─────────────────────────────────
    // Abilities query enemies through these helpers, NOT this.enemyManager
    // directly, so the co-op guest can target its render-only GuestEnemies (the
    // host's EnemyManager is empty on the guest — same fix as the basic attack).
    // Default null = host / single-player → the authoritative EnemyManager.
    private enemiesProvider: (() => Enemy[]) | null = null;
    public setEnemiesProvider(fn: () => Enemy[]): void { this.enemiesProvider = fn; }

    /** The enemy list abilities act on (role-aware, evaluated per call). */
    private allEnemies(): Enemy[] {
        return this.enemiesProvider ? this.enemiesProvider() : this.enemyManager.getEnemies();
    }
    /** Alive enemies within `range` of `position` (mirrors EnemyManager.getEnemiesInRange). */
    private enemiesInRange(position: Vector3, range: number): Enemy[] {
        const rangeSq = range * range;
        return this.allEnemies().filter(e => {
            if (!e.isAlive()) return false;
            const ep = e.getPosition();
            const dx = ep.x - position.x, dy = ep.y - position.y, dz = ep.z - position.z;
            return dx * dx + dy * dy + dz * dz <= rangeSq;
        });
    }
    /** Nearest alive enemy within optional `maxRange` (mirrors EnemyManager.getClosestEnemy). */
    private closestEnemy(position: Vector3, maxRange?: number): Enemy | null {
        let closest: Enemy | null = null;
        let closestSq = maxRange !== undefined ? maxRange * maxRange : Number.MAX_VALUE;
        for (const e of this.allEnemies()) {
            if (!e.isAlive()) continue;
            const ep = e.getPosition();
            const dx = ep.x - position.x, dy = ep.y - position.y, dz = ep.z - position.z;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq < closestSq) { closestSq = dSq; closest = e; }
        }
        return closest;
    }

    // ========================================================================
    // Class-aware ability registration
    // ========================================================================

    public configureForClass(championType: 'barbarian' | 'ranger' | 'mage'): void {
        this.abilities.clear();
        switch (championType) {
            case 'barbarian':
                this.abilities.set('whirlwind', { name: 'Whirlwind',     cooldown: 35, currentCooldown: 0, isReady: true, needsTargeting: false });
                this.abilities.set('smash',     { name: 'Smash',         cooldown: 25, currentCooldown: 0, isReady: true, needsTargeting: false });
                break;
            case 'ranger':
                this.abilities.set('multishot',      { name: 'Multishot',       cooldown: 30, currentCooldown: 0, isReady: true, needsTargeting: false });
                this.abilities.set('explosiveArrow', { name: 'Explosive Arrow', cooldown: 25, currentCooldown: 0, isReady: true, needsTargeting: false });
                break;
            case 'mage':
            default:
                // Meteor auto-targets the nearest enemy when fired from the HUD button
                // (HeroHud.activate() doesn't supply a click position). Keep
                // needsTargeting false so the button fires instantly like other ults.
                this.abilities.set('meteor',    { name: 'Meteor Strike', cooldown: 45, currentCooldown: 0, isReady: true, needsTargeting: false });
                this.abilities.set('frostNova', { name: 'Frost Nova',    cooldown: 30, currentCooldown: 0, isReady: true, needsTargeting: false });
                break;
        }
        // Every class also gets the Space-bar mobility ability.
        this.abilities.set('dash', { name: 'Dash', cooldown: 7, currentCooldown: 0, isReady: true, needsTargeting: false });
    }

    /**
     * Returns the registered ability IDs in insertion order.
     * HeroHud uses this to build class-appropriate ultimate buttons.
     */
    public getRegisteredAbilityIds(): string[] {
        return Array.from(this.abilities.keys());
    }

    // ========================================================================
    // Hero provider (position + reference)
    // ========================================================================

    public setHeroProvider(fn: () => Vector3): void {
        this.heroProvider = fn;
    }

    public setHero(hero: any): void {
        this.hero = hero;
    }

    /** Wire the radial basic-attack hit (used by Whirlwind ticks). */
    public setMeleeAoeHit(fn: (center: Vector3, radius: number) => void): void {
        this.meleeAoeHit = fn;
    }

    private getHeroPosition(): Vector3 | null {
        return this.heroProvider ? this.heroProvider() : null;
    }

    // ========================================================================
    // Player stats
    // ========================================================================

    public setPlayerStats(stats: PlayerStats): void {
        this.playerStats = stats;
    }

    /** Combined power-damage multiplier (level bonus × run perks). Wired by
     *  SurvivorsGameplayState — the same source used for auto-cast powers. */
    private damageMultiplierProvider: (() => number) | null = null;
    public setDamageMultiplierProvider(fn: () => number): void {
        this.damageMultiplierProvider = fn;
    }

    /** Wire the PowerSlotManager so Multishot can force-fire equipped autocast slots. */
    public setPowerSlots(slots: PowerSlotManager): void {
        this.powerSlots = slots;
    }

    /** Provider for current movement input direction (normalized). Returning null
     *  or a zero vector means "use hero facing" — caller decides. */
    public setDirectionProvider(fn: () => { dx: number; dz: number } | null): void {
        this.directionProvider = fn;
    }

    /** Provider for current champion class — drives per-class dash flavor. */
    public setChampionTypeProvider(fn: () => 'barbarian' | 'ranger' | 'mage'): void {
        this.championTypeProvider = fn;
    }

    /** HeroController registers this so AbilityManager can drive position during dash. */
    public setDashOverride(fn: DashOverrideFn): void {
        this.dashOverride = fn;
    }

    // ========================================================================
    // Update — tick cooldowns + active effects
    // ========================================================================

    public update(deltaTime: number): void {
        // Cooldown ticking — for...of avoids the per-call closure allocation
        // that Map.forEach incurs.
        for (const ability of this.abilities.values()) {
            if (!ability.isReady) {
                ability.currentCooldown -= deltaTime;
                if (ability.currentCooldown <= 0) {
                    ability.currentCooldown = 0;
                    ability.isReady = true;
                }
            }
        }

        // Active timed effects (Whirlwind, Volley, Explosive Arrow). Single
        // backwards pass: tick, fire onEnd hook on expiry, swap-pop. Previous
        // version allocated two filter arrays per frame.
        const fx = this.activeEffects;
        for (let i = fx.length - 1; i >= 0; i--) {
            const eff = fx[i];
            eff.timeLeft -= deltaTime;
            eff.timeSinceLastTick += deltaTime;
            if (eff.timeSinceLastTick >= eff.tickInterval) {
                eff.tick();
                eff.timeSinceLastTick = 0;
            }
            if (eff.timeLeft <= 0) {
                if (eff.onEnd) {
                    try { eff.onEnd(); } catch { /* ignore */ }
                }
                const last = fx.length - 1;
                if (i !== last) fx[i] = fx[last];
                fx.pop();
            }
        }
    }

    /**
     * Shave `seconds` off every ability currently on cooldown — the kill-fueled
     * refund (each monster killed calls this with 0.5s). Ready abilities are left
     * untouched; a cooldown that reaches 0 clamps and flips to ready. Discrete
     * per-kill, so it is independent of frame time / slow-mo.
     */
    public reduceAllCooldowns(seconds: number): void {
        if (seconds <= 0) return;
        for (const ability of this.abilities.values()) {
            if (ability.isReady) continue;
            ability.currentCooldown -= seconds;
            if (ability.currentCooldown <= 0) {
                ability.currentCooldown = 0;
                ability.isReady = true;
            }
        }
    }

    // ========================================================================
    // Accessors
    // ========================================================================

    public getAbility(id: string): Ability | undefined {
        return this.abilities.get(id);
    }

    public getIsTargeting(): boolean {
        return this.isTargeting;
    }

    public getTargetingAbility(): string | null {
        return this.targetingAbility;
    }

    public startTargeting(abilityId: string): boolean {
        const ability = this.abilities.get(abilityId);
        if (!ability || !ability.isReady || !ability.needsTargeting) return false;
        this.isTargeting = true;
        this.targetingAbility = abilityId;
        return true;
    }

    public cancelTargeting(): void {
        this.isTargeting = false;
        this.targetingAbility = null;
    }

    // ========================================================================
    // Activate dispatcher
    // ========================================================================

    /** Co-op spectate guard (M4-11): when this returns false the local hero is dead /
     *  spectating and may not manually fire abilities or dash. Default = always active. */
    private activeProvider: (() => boolean) | null = null;
    public setActiveProvider(fn: () => boolean): void { this.activeProvider = fn; }

    public activate(abilityId: string, position?: Vector3): boolean {
        // A dead/spectating hero must not act — blocks the manual ult path (HUD button /
        // keys) AND dash, which the update()-loop suspension doesn't cover.
        if (this.activeProvider && !this.activeProvider()) return false;
        const ability = this.abilities.get(abilityId);
        if (!ability || !ability.isReady) return false;

        let success = false;

        switch (abilityId) {
            // ── Mage ─────────────────────────────────────────────────────────
            case 'meteor': {
                // HUD button fires without a position — fall back to nearest enemy
                // so the ult is always usable. A future click-to-target flow can still
                // pass an explicit position.
                let target = position;
                if (!target) {
                    const heroPos = this.getHeroPosition();
                    if (heroPos) {
                        let best: Vector3 | null = null;
                        let bestSq = Infinity;
                        for (const e of this.allEnemies()) {
                            if (!e.isAlive()) continue;
                            const p = e.getPosition();
                            const dx = p.x - heroPos.x;
                            const dz = p.z - heroPos.z;
                            const d2 = dx * dx + dz * dz;
                            if (d2 < bestSq) { bestSq = d2; best = p.clone(); }
                        }
                        target = best ?? heroPos.clone();
                    }
                }
                if (target) success = this.activateMeteor(target);
                break;
            }
            case 'frostNova':
                success = this.activateFrostNova();
                break;
            // ── Barbarian ─────────────────────────────────────────────────────
            case 'whirlwind':
                success = this.activateWhirlwind();
                break;
            case 'smash':
                success = this.activateSmash();
                break;
            // ── Ranger ───────────────────────────────────────────────────────
            case 'multishot':
                success = this.activateMultishot();
                break;
            case 'explosiveArrow':
                success = this.activateExplosiveArrow();
                break;
            // ── Universal ────────────────────────────────────────────────────
            case 'dash':
                success = this.activateDash();
                break;
            // ── Legacy (unused in class mode) ────────────────────────────────
            case 'chainLightning':
                if (position) {
                    success = this.activateChainLightning(position);
                }
                break;
            case 'fortify':
                success = this.activateFortify();
                break;
            case 'goldRush':
                success = this.activateGoldRush();
                break;
        }

        if (success) {
            ability.isReady = false;
            ability.currentCooldown = ability.cooldown;
            this.isTargeting = false;
            this.targetingAbility = null;
            if (this.onActivateCallback) this.onActivateCallback(abilityId);
            // Co-op (M6 C2): the class ults broadcast parameterised EXACT fx at their
            // cast sites ('ult' with a JSON hint, 'ultStart'/'ultStop' channels, or
            // per-projectile). Only dash + the legacy ults keep the generic
            // element-coloured burst placeholder.
            if (isCoopFxActive() && !AbilityManager.EXACT_FX_ULTS.has(abilityId)) {
                const hp = this.getHeroPosition();
                if (hp) emitCoopFx('ult', hp.x, hp.z, position?.x, position?.z, ULT_FX_ELEMENT[abilityId] ?? 'arcane');
            }
        }

        return success;
    }

    /** Register a callback fired after each successful ability activation. The
     *  callback receives the ability id ('whirlwind', 'smash', 'multishot', etc.).
     *  SurvivorsGameplayState uses this to drive hero GLB animations. */
    public setOnActivate(fn: (abilityId: string) => void): void {
        this.onActivateCallback = fn;
    }

    // ========================================================================
    // Mage: Meteor Strike — a barrage of 5 meteors, 100 damage each in radius 4
    // ========================================================================

    /** Ults whose cast sites emit parameterised EXACT co-op fx (M6 C2) — the
     *  generic element burst in activate() is suppressed for these. */
    private static readonly EXACT_FX_ULTS = new Set([
        'meteor', 'frostNova', 'whirlwind', 'smash', 'multishot', 'explosiveArrow',
    ]);

    private activateMeteor(position: Vector3): boolean {
        // Co-op: one message replays the whole barrage — the receiver runs the same
        // scheduler (scatter randomness differs per side; visually equivalent).
        if (isCoopFxActive()) {
            emitCoopFx('ult', position.x, position.z, undefined, undefined,
                JSON.stringify({ a: 'meteor' }));
        }
        // Each strike re-queries live enemies at its own impact time, so movement
        // and earlier kills are accounted for.
        scheduleMeteorBarrage(position, (target) => {
            try { this.strikeMeteorAt(target); } catch { /* run ended */ }
        });
        return true;
    }

    /** Damage every enemy within radius 4 of `center` and play one falling-meteor VFX. */
    private strikeMeteorAt(center: Vector3): void {
        const radius = 4;
        const damage = Math.round(150 * (this.damageMultiplierProvider?.() ?? 1));
        const enemies = this.enemiesInRange(center, radius);
        for (const enemy of enemies) {
            enemy.takeDamage(damage);
        }
        createMeteorVisual(this.host, center, radius);
    }

    // ========================================================================
    // Mage: Frost Nova — freeze ALL enemies for 2.5 seconds
    // ========================================================================

    private activateFrostNova(): boolean {
        const enemies = this.allEnemies();
        const duration = 2.5;

        for (const enemy of enemies) {
            if (enemy.isAlive()) {
                enemy.applyStatusEffect(StatusEffect.FROZEN, duration, 1.0);
            }
        }

        createFrostNovaVisual(this.host);
        // Co-op: the nova visual is arena-wide and parameterless — the ability id alone
        // replays it exactly.
        if (isCoopFxActive()) {
            const hp = this.getHeroPosition();
            emitCoopFx('ult', hp?.x ?? 0, hp?.z ?? 0, undefined, undefined,
                JSON.stringify({ a: 'frostNova' }));
        }
        return true;
    }

    // ========================================================================
    // Barbarian: Whirlwind — 5s spin AOE every 0.3s, radius 7, 18 dmg/tick
    // ========================================================================

    private activateWhirlwind(): boolean {
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        // Hurricane reach — double the barbarian's basic-attack range (3.5u → 7u).
        const radius = 7;
        const duration = 5.0;

        // Element-charged whirlwind: tint the hurricane + ground rings with the
        // blend of the equipped power elements (storm-grey default with none).
        const heroElems = (this.hero as { getActiveElements?: () => PowerElement[] } | null)
            ?.getActiveElements?.() ?? [];
        const tint = heroElems.length > 0 ? blendElements(heroElems) : undefined;

        // Updraft particles + spinning funnel cloud, following the hero (extracted to
        // AbilityVisuals so the co-op channel replays the identical look on the ghost).
        const hurricane = spawnHurricaneVisual(this.host, () => this.getHeroPosition(), duration, radius, tint);

        // Co-op (M6 C2): a persistent channel — the teammate starts a cosmetic
        // hurricane that follows the ghost, and stops it on 'ultStop' (or a
        // duration+2s safety timeout if the stop is lost).
        if (isCoopFxActive()) {
            emitCoopFx('ultStart', heroPos.x, heroPos.z, undefined, undefined,
                JSON.stringify({ a: 'whirlwind', d: duration, r: radius }));
        }

        this.activeEffects.push({
            id: 'whirlwind',
            timeLeft: duration,
            tickInterval: 0.3,
            timeSinceLastTick: 0,
            tick: () => {
                const pos = this.getHeroPosition();
                if (!pos) return;
                if (this.meleeAoeHit) {
                    // Each tick hits exactly like the basic attack — full damage
                    // plus crit / lifesteal / knockback / element enchantments —
                    // just far more often than a normal swing.
                    this.meleeAoeHit(pos, radius);
                } else {
                    // Fallback: flat damage if the hit pipeline isn't wired.
                    const radiusSq = radius * radius;
                    for (const e of this.allEnemies()) {
                        if (!e.isAlive()) continue;
                        if (pos.distanceToSquared(e.getPosition()) <= radiusSq) {
                            e.takeDamage(18);
                        }
                    }
                }
                spawnWhirlwindRing(this.host, pos, radius, tint);
                // Secondary outer ring — 1.4× scale, lighter, layered concentric tornado read.
                spawnWhirlwindRing(this.host, pos, radius * 1.4, tint);
                // Keep champion body spinning
                if (this.hero && typeof this.hero.triggerSpinAttack === 'function') {
                    this.hero.triggerSpinAttack();
                }
            },
            onEnd: () => {
                hurricane.dispose();
                if (isCoopFxActive()) {
                    const p = this.getHeroPosition();
                    emitCoopFx('ultStop', p?.x ?? 0, p?.z ?? 0, undefined, undefined, 'whirlwind');
                }
            },
        });

        return true;
    }

    // ========================================================================
    // Universal: Space-bar Dash / Jump / Teleport
    //
    // - 8u distance, 3u landing-push radius, ~2u push force, no damage.
    // - Hero invulnerable for the duration (HeroController gates takeDamage()
    //   via the override window).
    // - Per-class flavor:
    //     barbarian → linear ground dash, 0.20s
    //     ranger    → parabolic jump (sin arc up to ~2.5u apex), 0.35s
    //     mage      → instant teleport with blink VFX, 0.10s
    // ========================================================================

    private static readonly DASH_DISTANCE       = 8;
    private static readonly DASH_PUSH_RADIUS    = 3;
    private static readonly DASH_PUSH_DISTANCE  = 2;

    private activateDash(): boolean {
        if (!this.dashOverride) return false;
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        // ── Resolve direction ────────────────────────────────────────────────
        let dx = 0, dz = 0;
        const input = this.directionProvider?.();
        if (input) { dx = input.dx; dz = input.dz; }
        const mag = Math.hypot(dx, dz);
        if (mag < 0.01) {
            // Fallback to current hero facing (Champion writes rotation.y from
            // its velocity or attack-aim each frame).
            const meshRotY = this.hero?.mesh?.rotation?.y ?? 0;
            dx = Math.sin(meshRotY);
            dz = Math.cos(meshRotY);
        } else {
            dx /= mag;
            dz /= mag;
        }

        // ── Resolve class flavor ─────────────────────────────────────────────
        const championType = this.championTypeProvider?.() ?? 'barbarian';
        let mode: DashMode = 'linear';
        let duration = 0.20;
        if (championType === 'ranger')      { mode = 'arc';     duration = 0.35; }
        else if (championType === 'mage')   { mode = 'instant'; duration = 0.10; }

        const target = new Vector3(
            heroPos.x + dx * AbilityManager.DASH_DISTANCE,
            heroPos.y,
            heroPos.z + dz * AbilityManager.DASH_DISTANCE,
        );

        // Class-specific source/start VFX (mage gets a blink-out ring at origin).
        if (championType === 'mage') {
            this.spawnTeleportRing(heroPos.clone(), new Color(0.7, 0.3, 1.0));
        } else if (championType === 'barbarian') {
            this.spawnDashTrail(heroPos.clone());
        }

        this.dashOverride(target, duration, mode, (landingPos: Vector3) => {
            // Landing push: every enemy within DASH_PUSH_RADIUS shoved outward
            // by DASH_PUSH_DISTANCE over 0.2s. No damage.
            for (const e of this.allEnemies()) {
                if (!e.isAlive()) continue;
                const ePos = e.getPosition();
                const ddx = ePos.x - landingPos.x;
                const ddz = ePos.z - landingPos.z;
                const dist = Math.hypot(ddx, ddz);
                if (dist > AbilityManager.DASH_PUSH_RADIUS || dist < 0.001) continue;
                const tx = ePos.x + (ddx / dist) * AbilityManager.DASH_PUSH_DISTANCE;
                const tz = ePos.z + (ddz / dist) * AbilityManager.DASH_PUSH_DISTANCE;
                this.animateEnemyKnockback(e, tx, tz, 0.2);
            }
            // Landing VFX
            if (championType === 'mage') {
                this.spawnTeleportRing(landingPos, new Color(0.7, 0.3, 1.0));
            } else {
                this.spawnDashLandingDust(landingPos);
            }
        });

        return true;
    }

    /** Purple particle ring that marks both endpoints of a mage teleport. */
    private spawnTeleportRing(center: Vector3, color: Color): void {
        const ring = createTorus('teleportRing', {
            diameter: 1.0, thickness: 0.18, tessellation: 18,
        }, this.host);
        ring.position.set(center.x, center.y + 0.4, center.z);
        const mat = createEmissiveMaterial('teleportRingMat', color, 0.9);
        mat.transparent = true;
        mat.opacity = 0.85;
        ring.material = mat;
        ring.userData.ownedMaterial = true;

        // Expand 0.5 → 3.5 (XZ) + fade 0.85 → 0 over 10 frames (1/3 s).
        tween(this.host, 10 / 30, t => {
            const s = 0.5 + 3.0 * t;
            ring.scale.set(s, 1, s);
            setMeshOpacity(ring, 0.85 * (1 - t));
        }, { onEnd: () => disposeMesh(ring) });
    }

    /** Brief dust streak at the dash origin for barbarian. */
    private spawnDashTrail(origin: Vector3): void {
        const ps = new ParticleEffect('dashTrail', this.host, {
            transform: {
                position: new Vector3(origin.x, origin.y + 0.1, origin.z),
                rotation: new Vector3(-Math.PI / 2, 0, 0),
            },
            simulationSpace: SimulationSpace.WORLD,
            looping: false,
            duration: 0.767,
            maxParticles: 30,
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 30 }] },
            shape: { shape: Shape.CONE, cone: { angle: 40, radius: 0.3, radiusThickness: 1, arc: 360 } },
            startLifetime: { min: 0.333, max: 0.667 },
            startSpeed: { min: 1.53, max: 3.06 },
            startSize: { min: fxSize(0.15), max: fxSize(0.35) },
            startColor: {
                min: { r: 0.40, g: 0.32, b: 0.22 },
                max: { r: 0.65, g: 0.55, b: 0.40 },
            },
            startOpacity: 1,
            opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
            gravity: 0.72,
            renderer: fxRenderer('normal'),
        }, { autoDispose: true });
        setTimeout(() => { try { ps.stop(); } catch { /* ignore */ } }, 100);
    }

    /** Landing dust ring for barbarian dash and ranger jump. */
    private spawnDashLandingDust(center: Vector3): void {
        const ps = new ParticleEffect('dashLandDust', this.host, {
            transform: {
                position: new Vector3(center.x, center.y + 0.1, center.z),
                rotation: new Vector3(-Math.PI / 2, 0, 0),
            },
            simulationSpace: SimulationSpace.WORLD,
            looping: false,
            duration: 0.933,
            maxParticles: 40,
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 40 }] },
            shape: { shape: Shape.CONE, cone: { angle: 50, radius: 0.5, radiusThickness: 1, arc: 360 } },
            startLifetime: { min: 0.417, max: 0.833 },
            startSpeed: { min: 2.79, max: 6.51 },
            startSize: { min: fxSize(0.15), max: fxSize(0.40) },
            startColor: {
                min: { r: 0.45, g: 0.35, b: 0.25 },
                max: { r: 0.70, g: 0.60, b: 0.45 },
            },
            startOpacity: 1,
            opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
            gravity: 1.08,
            renderer: fxRenderer('normal'),
        }, { autoDispose: true });
        setTimeout(() => { try { ps.stop(); } catch { /* ignore */ } }, 120);
    }

    // ========================================================================
    // Barbarian: Smash — instant knock all enemies in 10u outward, 30 dmg
    // ========================================================================

    private activateSmash(): boolean {
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        const knockRadius = 10;
        const knockForce = 12;

        for (const e of this.allEnemies()) {
            if (!e.isAlive()) continue;
            const ePos = e.getPosition();
            const dx = ePos.x - heroPos.x;
            const dz = ePos.z - heroPos.z;
            const dist = Math.hypot(dx, dz);
            if (dist > knockRadius || dist < 0.001) continue;

            e.takeDamage(30);

            const dirX = dx / dist;
            const dirZ = dz / dist;
            const targetX = ePos.x + dirX * knockForce;
            const targetZ = ePos.z + dirZ * knockForce;
            this.animateEnemyKnockback(e, targetX, targetZ, 0.3);
        }

        spawnSmashShockwave(this.host, heroPos);
        // Co-op: the shockwave is fully described by its center — replay is exact.
        if (isCoopFxActive()) {
            emitCoopFx('ult', heroPos.x, heroPos.z, undefined, undefined,
                JSON.stringify({ a: 'smash' }));
        }
        return true;
    }

    private animateEnemyKnockback(enemy: any, targetX: number, targetZ: number, duration: number): void {
        // Co-op guest: enemies are host-authoritative render copies — never tween
        // them locally (fights the snapshot). Route the full displacement as one
        // knockback report; the host applies the push and snapshots it back.
        const kr = Enemy.guestKnockbackRedirect;
        if (kr) {
            const p = enemy.getPosition();
            const dx = targetX - p.x, dz = targetZ - p.z;
            const mag = Math.hypot(dx, dz);
            if (mag > 0.001) kr(enemy.id, dx / mag, dz / mag, mag);
            return;
        }
        let elapsed = 0;
        const startX = enemy.getPosition().x;
        const startZ = enemy.getPosition().z;
        const observer = this.host.onBeforeRender.add(() => {
            if (!enemy.isAlive()) {
                this.host.onBeforeRender.remove(observer);
                return;
            }
            elapsed += this.host.deltaSeconds;
            const t = Math.min(1, elapsed / duration);
            // Ease out
            const eased = 1 - (1 - t) * (1 - t);
            const pos = enemy.getPosition();
            pos.x = startX + (targetX - startX) * eased;
            pos.z = startZ + (targetZ - startZ) * eased;
            if (t >= 1) {
                this.host.onBeforeRender.remove(observer);
            }
        });
    }

    // ========================================================================
    // Ranger: Multishot — machine-gun volley layered with the ranger's equipped
    // magical arrows. Over MULTISHOT_DURATION seconds the ult fires:
    //   - MULTISHOT_PLAIN_COUNT plain homing arrows at nearest distinct enemies, and
    //   - MULTISHOT_MAGIC_COUNT of each equipped autocast power (Fire Arrow,
    //     Lightning Arrow, etc.) via force-cast — slot cooldowns are not consumed.
    // Decoupled from basic-attack timing so the burst stays continuous.
    // ========================================================================

    private static readonly MULTISHOT_DURATION     = 5.0;
    private static readonly MULTISHOT_PLAIN_COUNT  = 30;
    private static readonly MULTISHOT_MAGIC_COUNT  = 10;
    private static readonly MULTISHOT_ARROW_DAMAGE = 12;

    private activateMultishot(): boolean {
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        // Brief feedback: green aura ring + sparks at the ranger's feet, following the
        // hero for the burst window (extracted to AbilityVisuals — the co-op channel
        // replays the identical aura on the ghost).
        const aura = spawnMultishotAura(this.host, () => this.getHeroPosition());

        // Co-op (M6 C2): persistent channel — the teammate shows the aura + periodic
        // cosmetic volley arrows from the ghost until 'ultStop' (or safety timeout).
        if (isCoopFxActive()) {
            emitCoopFx('ultStart', heroPos.x, heroPos.z, undefined, undefined,
                JSON.stringify({ a: 'multishot', d: AbilityManager.MULTISHOT_DURATION }));
        }

        // Plain volley: 30 arrows spread evenly across the duration.
        this.activeEffects.push({
            id: 'multishot_plain',
            timeLeft: AbilityManager.MULTISHOT_DURATION,
            tickInterval: AbilityManager.MULTISHOT_DURATION / AbilityManager.MULTISHOT_PLAIN_COUNT,
            timeSinceLastTick: 0,
            tick: () => {
                const pos = this.getHeroPosition();
                if (!pos) return;
                // Pick the nearest alive enemy each tick — spreads naturally as they
                // die. Single inline pass (no intermediate filtered-array allocation).
                let nearest: Enemy | null = null;
                let bestSq = Infinity;
                for (const e of this.allEnemies()) {
                    if (!e.isAlive()) continue;
                    const d = pos.distanceToSquared(e.getPosition());
                    if (d < bestSq) { bestSq = d; nearest = e; }
                }
                if (!nearest) return;
                this.spawnVolleyArrow(pos, nearest, AbilityManager.MULTISHOT_ARROW_DAMAGE);
                if (this.hero && typeof this.hero.triggerAttack === 'function') {
                    this.hero.triggerAttack(nearest.getPosition());
                }
            },
            onEnd: () => {
                aura.dispose();
                if (isCoopFxActive()) {
                    const p = this.getHeroPosition();
                    emitCoopFx('ultStop', p?.x ?? 0, p?.z ?? 0, undefined, undefined, 'multishot');
                }
            },
        });

        // Magical layer: each equipped autocast slot fires MULTISHOT_MAGIC_COUNT times,
        // evenly spaced across the duration. Skips entirely when no autocast slots are
        // equipped (early game) so the plain volley still feels good on its own.
        if (this.powerSlots && this.powerSlots.forceCastAutocastSlots) {
            this.activeEffects.push({
                id: 'multishot_magic',
                timeLeft: AbilityManager.MULTISHOT_DURATION,
                tickInterval: AbilityManager.MULTISHOT_DURATION / AbilityManager.MULTISHOT_MAGIC_COUNT,
                timeSinceLastTick: 0,
                tick: () => {
                    this.powerSlots?.forceCastAutocastSlots();
                },
            });
        }

        if (this.hero && typeof this.hero.triggerSpecial === 'function') {
            this.hero.triggerSpecial();
        } else if (this.hero && typeof this.hero.triggerAttack === 'function') {
            this.hero.triggerAttack();
        }

        return true;
    }

    /** Homing arrow used by Multishot's per-tick volley. Spawns at the hero's
     *  shoulder height, tracks the target, deals fixed damage on impact. */
    private spawnVolleyArrow(from: Vector3, target: Enemy, damage: number): void {
        const arrow = createCylinder('volleyArrow', {
            height: 0.6, diameter: 0.08, tessellation: 5,
        }, this.host);
        arrow.position.set(from.x, from.y + 1.0, from.z);
        arrow.material = createEmissiveMaterial('volleyArrowMat', new Color(0.6, 1.0, 0.4), 0.8);
        arrow.userData.ownedMaterial = true;

        const speed = 22;
        const observer: UpdateToken = this.host.onBeforeRender.add(() => {
            if (isMeshDisposed(arrow) || !target.isAlive()) {
                if (!isMeshDisposed(arrow)) disposeMesh(arrow);
                this.host.onBeforeRender.remove(observer);
                return;
            }
            const dt = this.host.deltaSeconds;
            const tp = target.getPosition();
            const dx = tp.x - arrow.position.x;
            const dy = (tp.y + 1.0) - arrow.position.y;
            const dz = tp.z - arrow.position.z;
            const dist = Math.hypot(dx, dy, dz);
            if (dist < 0.4) {
                target.takeDamage(damage);
                disposeMesh(arrow);
                this.host.onBeforeRender.remove(observer);
                return;
            }
            // Orient toward travel direction (flat yaw is enough for a thin arrow)
            arrow.rotation.y = headingToYaw(dx, dz);
            arrow.rotation.x = Math.atan2(-dy, Math.hypot(dx, dz));
            const step = Math.min(dist, speed * dt);
            arrow.position.x += (dx / dist) * step;
            arrow.position.y += (dy / dist) * step;
            arrow.position.z += (dz / dist) * step;
        });
        // Safety: dispose after 3s of flight
        setTimeout(() => {
            if (!isMeshDisposed(arrow)) disposeMesh(arrow);
            this.host.onBeforeRender.remove(observer);
        }, 3000);
    }

    // ========================================================================
    // Ranger: Explosive Arrow — 3s, every 0.5s fire explosive arrow at nearest
    //         enemy; on impact AOE 25 dmg radius 3
    // ========================================================================

    private activateExplosiveArrow(): boolean {
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        this.activeEffects.push({
            id: 'explosiveArrow',
            timeLeft: 3.0,
            tickInterval: 0.5,
            timeSinceLastTick: 0,
            tick: () => {
                const pos = this.getHeroPosition();
                if (!pos) return;
                // Nearest alive enemy via a single inline pass — no filtered-array alloc.
                let nearest: Enemy | null = null;
                let bestDist = Infinity;
                for (const e of this.allEnemies()) {
                    if (!e.isAlive()) continue;
                    const d = pos.distanceToSquared(e.getPosition());
                    if (d < bestDist) { bestDist = d; nearest = e; }
                }
                if (!nearest) return;
                this.spawnExplosiveArrow(pos, nearest, 25, 3);
            },
        });

        return true;
    }

    private spawnExplosiveArrow(from: Vector3, target: any, damage: number, aoeRadius: number): void {
        const targetPos = target.getPosition().clone();
        targetPos.y += 1.0;
        // Co-op: the flight target is FIXED at spawn (so is the local flight's), so one
        // message per arrow replays the flight AND its impact blast exactly.
        if (isCoopFxActive()) {
            emitCoopFx('ult', from.x, from.z, targetPos.x, targetPos.z,
                JSON.stringify({ a: 'expArrow', r: aoeRadius }));
        }
        spawnExplosiveArrowFlight(this.host, from, targetPos, (impactPos) => {
            this.triggerExplosion(impactPos, damage, aoeRadius);
        });
    }

    private triggerExplosion(position: Vector3, damage: number, radius: number): void {
        // Damage all enemies in radius (squared compare — no sqrt per enemy).
        const radiusSq = radius * radius;
        for (const e of this.allEnemies()) {
            if (!e.isAlive()) continue;
            if (position.distanceToSquared(e.getPosition()) <= radiusSq) {
                e.takeDamage(damage);
            }
        }

        // Visual: expanding orange ring + ember burst (shared with the co-op replay)
        spawnExplosionVisual(this.host, position, radius);
    }

    // ========================================================================
    // Legacy abilities (chainLightning, fortify, goldRush)
    // ========================================================================

    private activateChainLightning(position: Vector3): boolean {
        const baseDamage = 80;
        const chainCount = 4;
        const decayRate = 0.7;
        const chainRange = 6;

        const firstTarget = this.closestEnemy(position, 8);
        if (!firstTarget || !firstTarget.isAlive()) return false;

        let currentTarget = firstTarget;
        let currentDamage = baseDamage;
        const hitEnemies = new Set<any>();
        hitEnemies.add(currentTarget);

        currentTarget.takeDamage(currentDamage);
        const chainPositions: Vector3[] = [currentTarget.getPosition().clone()];

        for (let i = 0; i < chainCount; i++) {
            currentDamage *= decayRate;
            const enemiesInRange = this.enemiesInRange(currentTarget.getPosition(), chainRange);
            let nextTarget = null;
            for (const enemy of enemiesInRange) {
                if (!hitEnemies.has(enemy) && enemy.isAlive()) {
                    nextTarget = enemy;
                    break;
                }
            }
            if (!nextTarget) break;
            hitEnemies.add(nextTarget);
            nextTarget.takeDamage(currentDamage);
            chainPositions.push(nextTarget.getPosition().clone());
            currentTarget = nextTarget;
        }

        this.createChainLightningVisual(chainPositions);
        return true;
    }

    private createChainLightningVisual(positions: Vector3[]): void {
        const lightningColor = new Color(0.6, 0.6, 1.0);

        for (let i = 0; i < positions.length - 1; i++) {
            const start = positions[i].clone();
            start.y += 1.5;
            const end = positions[i + 1].clone();
            end.y += 1.5;

            const distance = start.distanceTo(end);
            const bolt = createCylinder(`bolt_${i}`, {
                height: distance, diameter: 0.15, tessellation: 4
            }, this.host);
            bolt.position.lerpVectors(start, end, 0.5);

            // Align the Y-axis cylinder along the segment: aim +Z at the end
            // point, then pitch the length axis onto it. Skip when the segment
            // is (near-)vertical — the cylinder is already aligned.
            const direction = end.clone().sub(start).normalize();
            const cross = new Vector3().crossVectors(new Vector3(0, 1, 0), direction);
            if (cross.length() > 0.001) {
                bolt.lookAt(end);
                bolt.rotation.x += Math.PI / 2;
            }

            const boltMat = createEmissiveMaterial(`boltMat_${i}`, lightningColor, 0.9);
            boltMat.transparent = true;
            boltMat.opacity = 0.9;
            bolt.material = boltMat;
            bolt.userData.ownedMaterial = true;
            setTimeout(() => disposeMesh(bolt), 300);
        }

        for (const pos of positions) {
            const flash = createIcoSphere(`lightningFlash`, {
                radius: 0.5, subdivisions: 1
            }, this.host);
            flash.position.set(pos.x, pos.y + 1.5, pos.z);
            const flashMat = createEmissiveMaterial('flashMat', lightningColor, 1.0);
            flashMat.transparent = true;
            flashMat.opacity = 0.8;
            flash.material = flashMat;
            flash.userData.ownedMaterial = true;
            setTimeout(() => disposeMesh(flash), 200);
        }

        if (positions.length > 0) {
            const ps = new ParticleEffect('lightningBurst', this.host, {
                transform: {
                    position: new Vector3(positions[0].x, positions[0].y + 1.5, positions[0].z),
                    rotation: new Vector3(-Math.PI / 2, 0, 0),
                },
                simulationSpace: SimulationSpace.WORLD,
                looping: true,
                duration: 0.65,
                maxParticles: 30,
                emission: { rateOverTime: 60 },
                shape: { shape: Shape.CONE, cone: { angle: 55, radius: 0.3, radiusThickness: 1, arc: 360 } },
                startLifetime: { min: 0.333, max: 0.833 },
                startSpeed: { min: 1.26, max: 3.78 },
                startSize: { min: fxSize(0.1), max: fxSize(0.3) },
                startColor: {
                    min: { r: 0.6, g: 0.6, b: 1 },
                    max: { r: 0.8, g: 0.8, b: 1 },
                },
                startOpacity: 1,
                opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
                renderer: fxRenderer('additive'),
            }, { autoDispose: true });
            setTimeout(() => {
                try { ps.stop(); } catch { /* already disposed */ }
            }, 150);
        }
    }

    private activateFortify(): boolean {
        if (!this.playerStats) return false;
        this.playerStats.heal(15);
        this.createFortifyVisual();
        return true;
    }

    private createFortifyVisual(): void {
        const center = new Vector3(0, 0.1, 0);

        const ring = createDisc('fortifyRing', {
            radius: 0.5, tessellation: 32
        }, this.host);
        ring.position.copy(center);
        ring.rotation.x = Math.PI / 2;
        // Babylon disableLighting rendered emissive only → unlit basic material.
        const ringMat = new MeshBasicMaterial({
            color: new Color(0.8, 0.65, 0.1),
            transparent: true,
            opacity: 0.5,
            side: DoubleSide,
        });
        ringMat.name = 'fortifyRingMat';
        ring.material = ringMat;
        ring.userData.ownedMaterial = true;

        // Expand 1 → 80 (disc plane) + fade 0.5 → 0 over 30 frames (1s).
        tween(this.host, 30 / 30, t => {
            const s = 1 + 79 * t;
            ring.scale.set(s, s, 1);
            setMeshOpacity(ring, 0.5 * (1 - t));
        }, { onEnd: () => disposeMesh(ring) });
    }

    private activateGoldRush(): boolean {
        if (!this.playerStats) return false;
        const enemies = this.allEnemies();
        let totalBonus = 0;
        for (const enemy of enemies) {
            if (enemy.isAlive()) {
                const bonus = Math.floor(enemy.getReward() * 0.5);
                totalBonus += bonus;
            }
        }
        if (totalBonus > 0) {
            this.playerStats.addMoney(totalBonus);
        }
        this.createGoldRushVisual(totalBonus);
        return true;
    }

    private createGoldRushVisual(totalGold: number): void {
        const enemies = this.allEnemies();
        for (const enemy of enemies) {
            if (enemy.isAlive()) {
                const ePos = enemy.getPosition();
                const ps = new ParticleEffect('goldRainPS', this.host, {
                    transform: {
                        position: new Vector3(ePos.x, ePos.y + 3, ePos.z),
                        rotation: new Vector3(Math.PI / 2, 0, 0),
                    },
                    simulationSpace: SimulationSpace.WORLD,
                    looping: true,
                    duration: 1.967,
                    maxParticles: 15,
                    emission: { rateOverTime: 18 },
                    shape: { shape: Shape.CONE, cone: { angle: 15, radius: 0.5, radiusThickness: 1, arc: 360 } },
                    startLifetime: { min: 0.833, max: 1.667 },
                    startSpeed: { min: 0.96, max: 1.92 },
                    startSize: { min: fxSize(0.15), max: fxSize(0.3) },
                    startColor: {
                        min: { r: 1, g: 0.7, b: 0 },
                        max: { r: 1, g: 0.85, b: 0.1 },
                    },
                    startOpacity: 1,
                    opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
                    gravity: 1.8,
                    renderer: fxRenderer('normal'),
                }, { autoDispose: true });
                setTimeout(() => {
                    try { ps.stop(); } catch { /* already disposed */ }
                }, 300);
            }
        }

        if (totalGold > 0) {
            const flash = createPlane('goldFlash', { size: 2 }, this.host);
            flash.position.set(20, 5, 20);
            const flashMat = createEmissiveMaterial('goldFlashMat', new Color(1, 0.85, 0.2), 0.9);
            flashMat.transparent = true;
            flashMat.opacity = 0.6;
            flashMat.side = DoubleSide;
            flash.material = flashMat;
            flash.userData.ownedMaterial = true;

            // Fade 0.6 → 0 + rise y 5 → 7 over 30 frames (1s). Billboard
            // (Babylon BILLBOARDMODE_ALL): face the camera each update.
            tween(this.host, 30 / 30, t => {
                flash.position.y = 5 + 2 * t;
                setMeshOpacity(flash, 0.6 * (1 - t));
                flash.lookAt(this.game.getActiveCamera().position);
            }, { onEnd: () => disposeMesh(flash) });
        }
    }

    // ========================================================================
    // Shader pre-warm — call once at run start (during loading) so every
    // particle/FX shader variant is compiled before the first ability fires.
    // ========================================================================

    public prewarmAbilityEffects(): void {
        const host = this.host;
        const farAway = new Vector3(1000, -100, 1000);
        const warmups: ParticleEffect[] = [];

        // === Additive blend variant — covers meteor, frost, expBurst, lightning ===
        // All four effects share this blend mode; one prewarm pass compiles the shader.
        {
            const ps = new ParticleEffect('prewarmOneOne', host, {
                transform: { position: farAway.clone() },
                simulationSpace: SimulationSpace.WORLD,
                looping: false,
                duration: 0.6,
                maxParticles: 1,
                emission: { rateOverTime: 0, bursts: [{ time: 0, count: 1 }] },
                shape: { shape: Shape.SPHERE, sphere: { radius: 0.05, radiusThickness: 1, arc: 360 } },
                startLifetime: 0.2,
                startSpeed: 0.1,
                startSize: fxSize(0.1),
                startOpacity: 0.01,
                renderer: fxRenderer('additive'),
            });
            warmups.push(ps);
        }

        // === Normal blend variant — covers goldRainPS (default blend mode) ===
        {
            const ps = new ParticleEffect('prewarmStandard', host, {
                transform: { position: farAway.clone() },
                simulationSpace: SimulationSpace.WORLD,
                looping: false,
                duration: 0.6,
                maxParticles: 1,
                emission: { rateOverTime: 0, bursts: [{ time: 0, count: 1 }] },
                shape: { shape: Shape.SPHERE, sphere: { radius: 0.05, radiusThickness: 1, arc: 360 } },
                startLifetime: 0.2,
                startSpeed: 0.1,
                startSize: fxSize(0.1),
                startOpacity: 0.01,
                renderer: fxRenderer('normal'),
            });
            warmups.push(ps);
        }

        // === Mesh-material shader variants ===
        // Three compiles one program per property-combination (Babylon's
        // define-set caching, same idea) — compiling one material per variant
        // here means the first in-combat FX of each kind finds its program
        // already built, with no synchronous first-use compile hitch (the
        // ~1.4s first-elemental-swing stall).
        //   - litFx:     lit emissive Phong → spin arc-ring, weapon element
        //                decorations, and every ability ring/flash/arrow (createEmissiveMaterial).
        //   - elemSwing: unlit transparent basic → the barbarian elemental swing ring/arc
        //                (every per-tint swingRingMatElem_* / swingArcMatElem_* reuses this program).
        //   - the two gold swing materials are pre-created into the shared cache here
        //     (verbatim keys), so the first non-elemental swing reuses them already compiled.
        const litFx = createEmissiveMaterial('prewarmLitFx', new Color(1, 0.5, 0.2), 0.9);
        const elemSwing = new MeshBasicMaterial({
            color: new Color(1, 0.5, 0.5),
            transparent: true,
            opacity: 0.9,
        });
        elemSwing.name = 'prewarmElemSwing';
        const goldRing = getCachedMaterial('swingRingMat', m => {
            m.emissive = new Color(1, 0.85, 0.4); m.color = new Color(0, 0, 0);
            m.transparent = true; m.opacity = 0.9;
        });
        const goldArc = getCachedMaterial('swingArcMat', m => {
            m.emissive = new Color(1, 0.95, 0.7); m.color = new Color(0, 0, 0);
            m.transparent = true; m.opacity = 0.5;
        });
        const meshWarmups: Mesh[] = [];
        for (const mat of [litFx, elemSwing, goldRing, goldArc]) {
            const torus = createTorus('prewarmFxMesh', { diameter: 1, thickness: 0.2, tessellation: 12 }, host);
            torus.position.copy(farAway);
            torus.material = mat;
            torus.frustumCulled = false; // else frustum-culled → never compiled
            meshWarmups.push(torus);
        }

        // Compile all pending shader programs now, before any ability is
        // triggered (Babylon's forced scene.render()).
        this.game.getRendererHost().renderer.compile(host.scene, this.game.getActiveCamera());

        for (const ps of warmups) {
            ps.stop();
            ps.dispose();
        }
        // Dispose the warmup meshes. The two throwaway materials (litFx, elemSwing)
        // are freed with them; the gold swing materials are cached/shared and MUST
        // survive (the first real swing reuses them already compiled).
        for (const m of meshWarmups) {
            const mat = m.material as Material;
            disposeMesh(m);
            if (mat === litFx || mat === elemSwing) mat.dispose();
        }
    }

    // ========================================================================
    // Convenience helpers (kept for backwards compat with existing callers)
    // ========================================================================

    public triggerFrostNova(): boolean {
        return this.activate('frostNova');
    }

    public triggerMeteorAt(position: Vector3): boolean {
        return this.activate('meteor', position);
    }

    public triggerMeteorAtNearest(): boolean {
        const enemies = this.allEnemies();
        let target: Vector3 | null = null;
        let bestDistSq = Infinity;
        for (const e of enemies) {
            if (!e.isAlive()) continue;
            const p = e.getPosition();
            const dSq = p.x * p.x + p.z * p.z;
            if (dSq < bestDistSq) {
                bestDistSq = dSq;
                target = p.clone();
            }
        }
        return this.activate('meteor', target ?? new Vector3());
    }

    public dispose(): void {
        this.game.getCanvas().removeEventListener('click', this.onCanvasClick);
        this.abilities.clear();
        this.activeEffects = [];
        this.isTargeting = false;
        this.targetingAbility = null;
    }
}
