import { Vector3, OrthographicCamera, Camera } from 'three';
import { Game } from '../engine/Game';
import { Champion } from './champions/Champion';
import { HeroBasicAttack, BasicAttackTarget, BasicAttackMode, ProjectileShape } from './champions/HeroBasicAttack';
import { PowerSlotManager } from './powers/PowerSlotManager';
import { Enemy } from './enemies/Enemy';
import { PlayerStats } from './PlayerStats';
import { DashMode } from './abilities/AbilityManager';
import { capInputLen, arenaClampScale } from './integrateMove';
import { IsoCameraRig } from './world/IsoCameraRig';
import { screenToWorldDir } from './world/isoProjection';
import { fxRenderer, fxSize, ParticleEffect } from '../engine/three/particles/ParticleEffect';
import { LifeTimeCurve, Shape } from '@newkrok/three-particles';
import type { SceneHost } from '../engine/three/SceneHost';

/** Hero damage-feedback tuning — adjust here, not deep in the update loop. */
const HIT_REACTION_COOLDOWN_S = 0.5;
const KNOCKBACK_SPEED         = 7.0;   // units / sec
const KNOCKBACK_DURATION_S    = 0.15;
const CAMERA_SHAKE_MAGNITUDE  = 0.6;   // world units added to camera position XZ per shake frame
const CAMERA_SHAKE_DURATION_S = 0.10;

const BLOOD_BURST_COUNT       = 12;

/** Per-class basic-attack configuration */
const CLASS_ATTACK_CONFIG: Record<string, { mode: BasicAttackMode; fireRate: number; damage: number; range: number; shape: ProjectileShape; multiTargetFromAttackSpeed?: boolean }> = {
    barbarian: { mode: 'melee',      fireRate: 1.0, damage: 18, range: 4.5, shape: 'sphere'   },
    ranger:    { mode: 'projectile', fireRate: 1.8, damage: 8,  range: 9,   shape: 'arrow',    multiTargetFromAttackSpeed: true },
    mage:      { mode: 'projectile', fireRate: 1.0, damage: 10, range: 8,   shape: 'mageBolt' },
};

export class HeroController {
    private game: Game;
    private scene: SceneHost;
    private hero: Champion;
    /** The active camera. Consumers only project through it. */
    private camera: OrthographicCamera;
    /** Owns framing, zoom, shake and the follow lerp. */
    private isoRig: IsoCameraRig;
    /** Reused by the screen→world input conversion so movement allocates nothing. */
    private readonly _scratchDir = { dx: 0, dz: 0 };
    private arenaRadius: number;
    private keys: { [k: string]: boolean } = {};
    private moveSpeed: number;

    // External joystick input
    private externalDx: number = 0;
    private externalDz: number = 0;

    // Basic attack
    private basicAttack: HeroBasicAttack | null = null;
    private targetProvider: () => BasicAttackTarget | null = () => null;
    private enemyProvider: (() => Enemy[]) | null = null;

    // Hero HP
    private maxHealth: number;
    private currentHealth: number;
    private isDead: boolean = false;
    /** Co-op spectate (M4-11): hero is alive in bookkeeping but inert — no input,
     *  no movement, no basic attack — while waiting to respawn on the next wave clear.
     *  Camera still follows (so the spectator tracks the surviving teammate). */
    public spectating: boolean = false;
    private onDeathCallback: () => void = () => {};
    /** Item-effect hook: fired with the post-mitigation damage actually applied. */
    private onHurtCallback: ((amount: number) => void) | null = null;

    // Extra Life (wave-5 boss item): each charge turns the next lethal hit into a
    // full-HP revive plus a timed invulnerability shield instead of death.
    private reviveCharges: number = 0;
    private shieldTimer: number = 0; // seconds of post-revive invulnerability remaining
    private static readonly REVIVE_SHIELD_SECONDS = 5;
    // FireBeetle contact ignites a lightweight fire DoT (no general hero status system).
    private burnTimer: number = 0; // seconds of remaining hero burn
    private burnDps: number = 0;   // damage/sec while burnTimer > 0
    /** Fired when a revive triggers (gameplay layer spawns the shield VFX + HUD sync). */
    private onReviveCallback: () => void = () => {};
    /** Fired when the post-revive shield expires (gameplay layer removes the bubble). */
    private onShieldEndCallback: () => void = () => {};

    // Move speed multiplier (from Swiftness shop purchases)
    private moveSpeedMultiplier: number = 1.0;

    // Damage-feedback state — see HIT_REACTION_* / KNOCKBACK_* constants.
    private lastHitReactionTime: number = -Infinity;
    private elapsedTime: number = 0;

    // Knockback impulse — decays linearly over knockbackDuration, added to player
    // velocity. The duration is per-impulse (not the KNOCKBACK_DURATION_S constant)
    // so a hit reaction's short nudge and a dragon-turtle quake's long shove can
    // both use one decay path.
    private knockbackVelocity: Vector3 = new Vector3();
    private knockbackTimeRemaining: number = 0;
    private knockbackDuration: number = KNOCKBACK_DURATION_S;

    // Boss "pull" — a sustained drag toward a world point (the boss). While active,
    // a velocity of pullSpeed toward (pullSourceX, pullSourceZ) is added on top of
    // the player's own input every frame (so the hero can still fight it, but loses
    // ground). Recomputed each frame so it always aims at the current source. Set
    // by HeroController.applyPull (driven by the tier-2/4 boss grab).
    private pullSourceX: number = 0;
    private pullSourceZ: number = 0;
    private pullSpeed: number = 0;
    private pullTimeRemaining: number = 0;

    // Boss "slow" — a temporary multiplier on move speed that stacks MULTIPLICATIVELY
    // with the shop moveSpeedMultiplier (so it never clobbers shop upgrades). Last
    // application wins; expires at externalSlowUntil (elapsedTime clock).
    private externalSlowMultiplier: number = 1;
    private externalSlowUntil: number = -Infinity;

    // Camera shake — decays to zero over CAMERA_SHAKE_DURATION_S.
    private cameraShakeTimeRemaining: number = 0;

    // Dash override state (Space-bar mobility) — when active, position is driven
    // by interpolation between dashStartPos/dashTargetPos instead of velocity, and
    // the hero is invulnerable to contact damage for the duration.
    private dashActive: boolean = false;
    private dashStartPos: Vector3 = new Vector3();
    private dashTargetPos: Vector3 = new Vector3();
    private dashDuration: number = 0;
    private dashElapsed: number = 0;
    private dashMode: DashMode = 'linear';
    private dashOnComplete: ((landingPos: Vector3) => void) | null = null;
    private isInvulnerable: boolean = false;
    private static readonly DASH_ARC_APEX = 2.5;

    // Scratch Vector3 fields — reused every frame to eliminate per-frame allocations
    private _scratchVel: Vector3 = new Vector3();
    private _scratchCamTarget: Vector3 = new Vector3();
    private _scratchInput = { dx: 0, dz: 0 };
    private _scratchHealth = { current: 0, max: 0 };

    // Co-op: when set, the camera frames this point (+ a slant-distance multiplier)
    // instead of just the local hero. distanceScale === 1 means "frame exactly like
    // solo"; >1 pulls the camera straight back. Lets a shared/tethered camera reuse the
    // existing zoom/lerp/shake while keeping the look-down pitch identical to solo.
    private cameraFocusProvider: (() => { x: number; z: number; distanceScale: number }) | null = null;

    private readonly canvas: HTMLCanvasElement | null;
    // Window keyboard listeners (replaces the Babylon scene keyboard observable) —
    // stored so dispose() removes them.
    private readonly onKeyDown: (e: KeyboardEvent) => void;
    private readonly onKeyUp: (e: KeyboardEvent) => void;

    constructor(
        game: Game,
        hero: Champion,
        arenaRadius: number,
        moveSpeed: number = 7,
        maxHealth: number = 100,
        championType: string = 'barbarian',
    ) {
        this.game = game;
        this.scene = game.getScene();
        this.hero = hero;
        this.arenaRadius = arenaRadius;
        this.moveSpeed = moveSpeed;
        this.maxHealth = maxHealth;
        this.currentHealth = maxHealth;

        // Isometric globe-map camera: height + Z-offset derive from the pitch
        // and slant distance so the tuning knobs stay independent. On narrow
        // mobile screens (< 700px) pull the camera in slightly closer.
        const canvas = game.getCanvas();
        const viewportWidth = canvas.clientWidth || window.innerWidth;
        const viewportHeight = Math.max(1, canvas.clientHeight || window.innerHeight);
        this.canvas = canvas;

        // True orthographic isometric follow rig. It owns framing, zoom, shake,
        // finite-guards and its own wheel listener.
        this.isoRig = new IsoCameraRig(canvas);
        this.camera = this.isoRig.getCamera();
        game.setActiveCamera(this.camera);

        // Keyboard input (window listeners; removed in dispose())
        this.onKeyDown = (e: KeyboardEvent) => {
            this.keys[e.key.toLowerCase()] = true;
        };
        this.onKeyUp = (e: KeyboardEvent) => {
            this.keys[e.key.toLowerCase()] = false;
        };
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);

        // Build basic attack based on champion class
        const cfg = CLASS_ATTACK_CONFIG[championType] ?? CLASS_ATTACK_CONFIG['barbarian'];
        this.basicAttack = new HeroBasicAttack(this.scene, hero, {
            mode:             cfg.mode,
            fireRate:         cfg.fireRate,
            damage:           cfg.damage,
            range:            cfg.range,
            projectileShape:  cfg.shape,
            targetProvider:   () => this.targetProvider(),
            enemyProvider:    () => this.enemyProvider?.() ?? [],
            multiTargetFromAttackSpeed: cfg.multiTargetFromAttackSpeed,
            onAttack:         () => game.getAssetManager().playSound('heroAttack'),
        });
    }

    /** Expose the inner HeroBasicAttack so co-op wiring can set damageRouter. */
    public getBasicAttack(): HeroBasicAttack | null {
        return this.basicAttack;
    }

    public setExternalInput(dx: number, dz: number): void {
        this.externalDx = dx;
        this.externalDz = dz;
    }

    public setCameraFocusProvider(fn: (() => { x: number; z: number; distanceScale: number }) | null): void {
        this.cameraFocusProvider = fn;
    }

    public setTargetProvider(fn: () => BasicAttackTarget | null): void {
        this.targetProvider = fn;
    }

    /** Supply the full enemy list (required for melee AOE and projectile enchantments). */
    public setEnemyProvider(fn: () => Enemy[]): void {
        this.enemyProvider = fn;
        // Rebuild basic attack with enemy provider wired in
        // (It's already passed as a closure, so no rebuild needed.)
    }

    /** Wire the power slot manager into the basic attack for enchantments. */
    public setPowerSlots(slots: PowerSlotManager): void {
        this.basicAttack?.setPowerSlots(slots);
    }

    /** Forward the global damage multiplier (shop + run perks) into basic-attack
     *  damage so every weapon swing / arrow / etc. respects upgrades. */
    public setDamageMultiplierProvider(fn: () => number): void {
        this.basicAttack?.setDamageMultiplierProvider(fn);
    }

    public setOnDeath(fn: () => void): void {
        this.onDeathCallback = fn;
    }

    public isDeadOrSpectating(): boolean {
        return this.isDead || this.spectating;
    }

    /** Co-op respawn (M4-11): clear death + spectate, restore full HP, and place the
     *  hero at (x,z). Revive charges / shield are untouched (Extra Life is separate). */
    public respawn(x: number, z: number): void {
        this.isDead = false;
        this.spectating = false;
        // Never inherit an in-flight/aborted dash across a revive (stale invuln or a
        // teleport-snap to an old dash target).
        this.dashActive = false;
        this.isInvulnerable = false;
        this.dashElapsed = 0;
        this.currentHealth = this.maxHealth;
        this.writeHeroPosition(x, 0, z);
    }

    /**
     * Trigger a camera shake of the given duration (seconds). Larger durations
     * read as stronger shakes because the magnitude scales with
     * remaining / CAMERA_SHAKE_DURATION_S. Used for fusion/ultimate forges.
     */
    public triggerScreenShake(durationS: number = 0.3): void {
        this.cameraShakeTimeRemaining = Math.max(this.cameraShakeTimeRemaining, durationS);
    }

    /**
     * Fire the four damage-feedback effects (red flash, blood burst, camera shake,
     * knockback). Rate-limited to once per HIT_REACTION_COOLDOWN_S so per-frame
     * contact damage doesn't produce a permanent strobe.
     */
    private triggerHitReaction(sourcePos: Vector3 | undefined): void {
        if (this.elapsedTime - this.lastHitReactionTime < HIT_REACTION_COOLDOWN_S) return;
        this.lastHitReactionTime = this.elapsedTime;

        this.hero.flashHitRed();
        this.spawnHeroBloodBurst();
        this.cameraShakeTimeRemaining = CAMERA_SHAKE_DURATION_S;
        // Audio rides the same rate limit as the visual feedback, so per-frame
        // contact damage cannot machine-gun the hurt sound.
        this.game.getAssetManager().playSound('heroHit');

        if (sourcePos) {
            const heroPos = this.hero.getPosition();
            const dx = heroPos.x - sourcePos.x;
            const dz = heroPos.z - sourcePos.z;
            const len = Math.hypot(dx, dz);
            if (len > 0.0001) {
                this.applyKnockback(dx / len, dz / len, KNOCKBACK_SPEED, KNOCKBACK_DURATION_S);
            }
        }
    }

    /**
     * Shove the hero along a normalized heading. Used by the dragon-turtle quake,
     * which needs a far bigger push over a far longer window than the per-hit
     * reaction nudge — hence the explicit speed/duration instead of the
     * KNOCKBACK_* constants.
     *
     * Strongest-wins rather than last-wins: a quake landing during the tail of a
     * hit-reaction nudge must not be cut short by it. A shove big enough to be
     * felt also shakes the camera — the two are the same event.
     */
    public applyKnockback(dirX: number, dirZ: number, speed: number, durationS: number): void {
        if (this.isDead) return;
        const live = this.knockbackTimeRemaining > 0
            ? this.knockbackVelocity.length() * (this.knockbackTimeRemaining / this.knockbackDuration)
            : 0;
        if (speed < live) return;
        this.knockbackVelocity.set(dirX * speed, 0, dirZ * speed);
        this.knockbackTimeRemaining = durationS;
        this.knockbackDuration = durationS;
        if (speed > KNOCKBACK_SPEED) this.triggerScreenShake(durationS);
    }

    /** One-shot red particle burst at the hero's torso to signal damage taken. */
    private spawnHeroBloodBurst(): void {
        const heroPos = this.hero.getPosition();
        const burstPos = new Vector3(heroPos.x, heroPos.y + 0.8, heroPos.z);

        const ps = new ParticleEffect(
            'heroBloodBurst',
            this.scene,
            {
                looping: false,
                duration: 0.58,
                maxParticles: BLOOD_BURST_COUNT,
                emission: { rateOverTime: 0, bursts: [{ time: 0, count: BLOOD_BURST_COUNT }] },
                startLifetime: { min: 0.417, max: 0.667 },
                startSize: { min: fxSize(0.10), max: fxSize(0.20) },
                startSpeed: { min: 1.323, max: 3.339 },
                startColor: { min: { r: 0.80, g: 0.05, b: 0.05 }, max: { r: 0.50, g: 0.02, b: 0.02 } },
                startOpacity: 1,
                opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: t => 1 - t } },
                gravity: 5.4,
                shape: { shape: Shape.CONE, cone: { angle: 65, radius: 0.10, radiusThickness: 1, arc: 360 } },
                transform: { position: burstPos, rotation: new Vector3(-Math.PI / 2, 0, 0) },
                renderer: fxRenderer('additive'),
            },
            { autoDispose: true }
        );
        // Emission is a single instantaneous burst, so stopping early is a no-op
        // safety net preserved from the old two-timeout dance; disposal itself is
        // driven by autoDispose once the burst's short duration elapses.
        setTimeout(() => ps.stop(), 80);
    }

    /** DEV ?test: when true, the hero ignores all damage (set by test mode so a
     *  stress horde can't kill you). Separate from the transient dash i-frame flag. */
    public debugInvulnerable: boolean = false;

    /**
     * ONE ordered pipeline, not three independent ifs — the order below is the
     * contract several Ascension nodes depend on and it is easy to break.
     */
    public takeDamage(amount: number, sourcePos?: Vector3): void {
        if (this.isDead) return;
        if (this.isInvulnerable || this.shieldTimer > 0 || this.debugInvulnerable) return;
        // (1) NEGATE — Standing Stone / Unseen / Untethered r3. Returns BEFORE
        //     onHurtCallback, so it also suppresses thorns, the hit flash and the
        //     hurt SFX: the node text says "negated", never "reduced". The
        //     provider consumes its own charge when it returns true.
        if (this.negateProvider?.()) return;
        // (2) ABSORB — Sanguine Ward's stored-overheal pool. Returns the damage
        //     REMAINING; the pipeline falls through with that reduced value so
        //     onHurtCallback reports what actually reached HP.
        if (this.absorbProvider) {
            amount = this.absorbProvider(amount);
            if (amount <= 0) return;
        }
        this.currentHealth -= amount;
        // Fires before the revive-charge check with the POST-absorb amount: what
        // actually landed. A revive may still absorb the lethal outcome below.
        this.onHurtCallback?.(amount);
        if (this.currentHealth <= 0) {
            // Extra Life: spend a charge to revive at full HP with a timed shield
            // instead of dying. The shield gate above blocks further hits this frame.
            if (this.reviveCharges > 0) {
                this.reviveCharges--;
                this.currentHealth = this.maxHealth;
                this.shieldTimer = HeroController.REVIVE_SHIELD_SECONDS;
                this.onReviveCallback();
                return;
            }
            // (3) CHEAT DEATH — The Debt r3. MUST intercept above onDeathCallback:
            //     that callback runs exit() synchronously and nulls heroController
            //     / playerStats mid-frame.
            if (this.cheatDeathProvider?.()) {
                this.currentHealth = 1;
                this.shieldTimer = HeroController.REVIVE_SHIELD_SECONDS;
                return;
            }
            this.currentHealth = 0;
            this.isDead = true;
            this.onDeathCallback();
            return;
        }
        this.triggerHitReaction(sourcePos);
    }

    /** Item-effect hook: fired with the post-mitigation damage actually applied. */
    public setOnHurt(fn: ((amount: number) => void) | null): void {
        this.onHurtCallback = fn;
    }

    /** Ordered damage-pipeline hooks (Ascension). All PULLED — never assigned
     *  onto PlayerStats, which applyLevelBonuses() re-assigns several times a wave. */
    private negateProvider: (() => boolean) | null = null;
    private absorbProvider: ((amount: number) => number) | null = null;
    private cheatDeathProvider: (() => boolean) | null = null;
    private onOverhealCallback: ((overflow: number) => void) | null = null;
    /** Return true to fully negate the incoming hit (and consume the charge). */
    public setDamageNegateProvider(fn: (() => boolean) | null): void { this.negateProvider = fn; }
    /** Return the damage REMAINING after absorption. */
    public setDamageAbsorbProvider(fn: ((amount: number) => number) | null): void { this.absorbProvider = fn; }
    /** Return true to survive a lethal hit at 1 HP. */
    public setCheatDeathProvider(fn: (() => boolean) | null): void { this.cheatDeathProvider = fn; }
    /** Healing that exceeded max HP — Sanguine Ward banks it as a shield. */
    public setOnOverheal(fn: ((overflow: number) => void) | null): void { this.onOverhealCallback = fn; }

    /** Transient multiplicative move-speed term (Hurricane Heart while
     *  channelling, Untethered after a blink, The Wild Hunt while moving).
     *  PULLED per frame — pushing it through updateMoveSpeed() would be erased
     *  by the next applyLevelBonuses(). */
    private transientSpeedProvider: (() => number) | null = null;
    public setTransientSpeedProvider(fn: (() => number) | null): void {
        this.transientSpeedProvider = fn;
    }

    /** Grant one Extra Life revive charge (called by RunItems on item pickup). */
    public addReviveCharge(): void {
        this.reviveCharges++;
    }

    /** Register the revive / shield-end hooks (gameplay layer drives the VFX + HUD). */
    public setOnRevive(onRevive: () => void, onShieldEnd: () => void): void {
        this.onReviveCallback = onRevive;
        this.onShieldEndCallback = onShieldEnd;
    }

    /** True while the post-revive invulnerability shield is active. */
    public hasActiveShield(): boolean {
        return this.shieldTimer > 0;
    }

    /** Ignite/refresh a fire DoT on the hero (FireBeetle contact). Refreshes the
     *  timer and raises the dps to the strongest active source. */
    public applyBurn(durationS: number, dps: number): void {
        if (this.isDead || this.spectating) return;
        this.burnTimer = Math.max(this.burnTimer, durationS);
        this.burnDps = Math.max(this.burnDps, dps);
    }

    /** Restore HP (capped at max). No-op while dead. Used by the Heal power-choice card. */
    public heal(amount: number): void {
        if (this.isDead || amount <= 0) return;
        const before = this.currentHealth;
        this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
        // Report the clamped remainder so Sanguine Ward can bank overheal as a
        // shield. Fires only when healing was actually wasted.
        const overflow = amount - (this.currentHealth - before);
        if (overflow > 0) this.onOverhealCallback?.(overflow);
    }

    /**
     * Snapshot-authoritative HP write from the host (co-op guest side).
     * Sets currentHealth to the given value (clamped [0, max]) and triggers
     * the death path if hp reaches 0 — reusing the same flow as takeDamage.
     * No-op if already dead.
     */
    public setHealth(hp: number): void {
        if (this.isDead) return;
        this.currentHealth = Math.max(0, Math.min(this.maxHealth, hp));
        if (this.currentHealth <= 0 && !this.isDead) {
            this.currentHealth = 0;
            this.isDead = true;
            this.onDeathCallback();
        }
    }

    /** Maximum HP (for percentage-of-max heals). */
    public getMaxHealth(): number {
        return this.maxHealth;
    }

    public getHealthRatio(): number {
        return Math.max(0, this.currentHealth / this.maxHealth);
    }

    /** Current + max HP. Returns a REUSED struct (read it before calling again) —
     *  the HUD, the co-op snapshot builder and the debug overlay all call this
     *  every frame. */
    public getHealth(): { current: number; max: number } {
        this._scratchHealth.current = this.currentHealth;
        this._scratchHealth.max = this.maxHealth;
        return this._scratchHealth;
    }

    /** Apply full basic-attack hits to all enemies within `radius` of `center`.
     *  Used by Whirlwind so its ticks reuse the basic attack's hit pipeline
     *  (crit / lifesteal / knockback / element enchantments). */
    public applyAttackHitsInRadius(center: Vector3, radius: number): void {
        this.basicAttack?.applyAttackHitsInRadius(center, radius);
    }

    /** Adjust max HP by amount (may be negative when equipment is replaced). */
    public addMaxHealth(amount: number): void {
        this.maxHealth += amount;
        if (amount < 0) this.currentHealth = Math.min(this.currentHealth, this.maxHealth);
    }

    /**
     * Update the base move-speed multiplier.
     * @param multiplier — absolute multiplier (e.g. 1.1 after one Swiftness purchase)
     */
    public updateMoveSpeed(multiplier: number): void {
        this.moveSpeedMultiplier = multiplier;
    }

    /**
     * Update the basic attack speed multiplier.
     * @param multiplier — absolute multiplier (e.g. 1.1 after two Haste purchases)
     */
    public updateBasicAttackSpeed(multiplier: number): void {
        this.basicAttack?.updateAttackSpeed(multiplier);
    }

    /**
     * Drag the hero toward a world point over `durationS` seconds. Used by the
     * tier-2/4 boss "grab": a velocity of `speed` toward (towardX, towardZ) is
     * added on top of player input every frame until the timer runs out. No
     * effect while the hero is mid-dash (the dash override owns position then).
     */
    public applyPull(towardX: number, towardZ: number, speed: number, durationS: number): void {
        if (this.isDead) return;
        this.pullSourceX = towardX;
        this.pullSourceZ = towardZ;
        this.pullSpeed = speed;
        this.pullTimeRemaining = Math.max(this.pullTimeRemaining, durationS);
    }

    /**
     * Apply a temporary move-speed slow (multiplicative on top of the shop
     * move-speed multiplier, so shop upgrades are preserved). `multiplier` < 1
     * slows; `durationS` is how long it lasts. Last application wins.
     */
    public applySlow(multiplier: number, durationS: number): void {
        if (this.isDead) return;
        this.externalSlowMultiplier = Math.max(0.1, Math.min(1, multiplier));
        this.externalSlowUntil = this.elapsedTime + durationS;
    }

    /** The pushed move-speed multiplier (playerStats × runPerks), EXCLUDING the
     *  transient boss-slow term. This is the value `update()` integrates input with
     *  (modulo slow), so the co-op guest reports it to the host (P6) and the host
     *  scales its ghost integrator by it → host & guest movement math match. */
    public getMoveSpeedMultiplier(): number {
        return this.moveSpeedMultiplier;
    }

    /** Current effective move speed: base × shop/level multiplier × active boss slow.
     *  This is exactly the speed update() integrates input with — the co-op guest
     *  passes it to the input replay so the replayed prediction matches the local
     *  one (M6 E2). Note the HOST simulates the guest at the champion's BASE speed
     *  (it doesn't know multipliers/slows) — that divergence is documented at the
     *  replay site and absorbed by the reconcile dead-zone/lerp. */
    public getEffectiveMoveSpeed(): number {
        const slow = this.elapsedTime < this.externalSlowUntil ? this.externalSlowMultiplier : 1;
        return this.moveSpeed * this.moveSpeedMultiplier * slow * (this.transientSpeedProvider?.() ?? 1);
    }

    /** Push player-stats reference into the inner basic-attack instance, and also wire
     *  the lifesteal heal callback to this controller's heal() so lifesteal updates the
     *  real hero HP (not the phantom PlayerStats.health that the HUD doesn't read). */
    public setPlayerStats(stats: PlayerStats): void {
        this.basicAttack?.setPlayerStats(stats);
        this.basicAttack?.setHealCallback((amount: number) => this.heal(amount));
    }

    /**
     * Update the basic attack range multiplier.
     * @param multiplier — absolute multiplier (e.g. 1.1 after one Reach purchase)
     */
    public updateBasicAttackRange(multiplier: number): void {
        this.basicAttack?.updateRange(multiplier);
    }

    /**
     * Returns the current movement input direction (WASD + joystick), unnormalized.
     * Returns null when input magnitude is below the deadzone — caller falls back
     * to hero facing for the dash direction in that case.
     */
    public getMoveInput(): { dx: number; dz: number } | null {
        if (this.isDead || this.spectating) return null; // inert while spectating (sends no co-op input)
        let dx = this.externalDx;
        let dz = this.externalDz;
        if (this.keys['w'] || this.keys['arrowup']) dz += 1;
        if (this.keys['s'] || this.keys['arrowdown']) dz -= 1;
        if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
        if (this.keys['d'] || this.keys['arrowright']) dx += 1;
        if (Math.hypot(dx, dz) < 0.01) return null;
        // Screen→world. This is THE conversion point between screen-space intent
        // and world motion, and its output is what co-op puts on the wire — so
        // host and guest can never disagree about what "up" meant.
        // The ground axes run diagonally across the screen at 45°, so raw WASD
        // has to be rotated or "up" walks the hero sideways.
        screenToWorldDir(dx, dz, this._scratchDir);
        return { dx: this._scratchDir.dx, dz: this._scratchDir.dz };
    }

    /**
     * Drive the hero's position via interpolation between current position and
     * `target` over `duration` seconds. Hero becomes invulnerable for the
     * window. AbilityManager calls this when 'dash' activates.
     */
    public startDashOverride(
        target: Vector3,
        duration: number,
        mode: DashMode,
        onComplete: (landingPos: Vector3) => void,
    ): void {
        // Clamp target inside the arena (same buffer the normal clamp uses).
        const dist = Math.hypot(target.x, target.z);
        const limit = this.arenaRadius - 0.5;
        if (dist > limit) {
            const k = limit / dist;
            target = new Vector3(target.x * k, target.y, target.z * k);
        }

        this.dashStartPos.copy(this.hero.getPosition());
        this.dashTargetPos.copy(target);
        this.dashDuration = Math.max(0.01, duration);
        this.dashElapsed = 0;
        this.dashMode = mode;
        this.dashOnComplete = onComplete;
        this.dashActive = true;
        this.isInvulnerable = true;

        // Mage instant teleport: snap to target on the first frame.
        if (mode === 'instant') {
            this.writeHeroPosition(target.x, 0, target.z);
        }
    }

    /** Co-op guest (M4-8): nudge the predicted local hero toward the host-
     *  authoritative snapshot position. Writes position + mesh only; velocity is
     *  untouched so the next update() re-predicts from fresh input. The caller
     *  decides snap-vs-lerp via reconcilePosition(); this just applies the result. */
    public reconcileNetworkPosition(x: number, z: number): void {
        this.writeHeroPosition(x, 0, z);
    }

    /** Internal helper: write a position to both this.position and the mesh, in
     *  the exact same shape Champion.update would naturally produce. */
    private writeHeroPosition(x: number, y: number, z: number): void {
        const h = this.hero as unknown as { position: Vector3; mesh?: { position: Vector3 } };
        h.position.x = x;
        h.position.y = y;
        h.position.z = z;
        if (h.mesh) {
            h.mesh.position.x = x;
            h.mesh.position.z = z;
            // y is set by Champion.update next frame (adds GLB feet offset).
            h.mesh.position.y = y;
        }
    }

    public update(deltaTime: number): void {
        this.elapsedTime += deltaTime;

        // ── Camera aspect tracking ─────────────────────────────────────────
        // Game.resize() updates the ACTIVE camera on window resizes; this cheap
        // per-frame check is the belt-and-braces for a canvas that changed size
        // without a resize event (and for the first frames after construction).
        // The iso rig recomputes its own frustum from the live aspect every
        // frame and only rebuilds the matrix when it actually moved, so there is
        // no per-frame aspect fixup to do here.

        // ── Post-revive invulnerability shield ─────────────────────────────
        if (this.shieldTimer > 0) {
            this.shieldTimer -= deltaTime;
            if (this.shieldTimer <= 0) {
                this.shieldTimer = 0;
                this.onShieldEndCallback();
            }
        }

        // ── Fire DoT (FireBeetle contact) ──────────────────────────────────
        // Route through takeDamage so the revive/invuln gates still apply. No source
        // position → no knockback. takeDamage no-ops while dead/shielded.
        if (this.burnTimer > 0) {
            this.burnTimer -= deltaTime;
            this.takeDamage(this.burnDps * deltaTime, undefined);
            if (this.burnTimer <= 0) { this.burnTimer = 0; this.burnDps = 0; }
        }

        // ── Co-op spectate / death: hero is inert ──────────────────────────
        // Zero velocity (Champion.update adds nothing), no input, no basic attack
        // below. Camera follow still runs so the spectator tracks the survivor.
        if (this.isDead || this.spectating) {
            this._scratchVel.set(0, 0, 0);
            this.hero.setPlayerVelocity(this._scratchVel);
            // Cancel any dash that was in flight when death/spectate began — otherwise
            // its invulnerability flag would stick for the whole spectate window.
            if (this.dashActive) { this.dashActive = false; this.isInvulnerable = false; this.dashElapsed = 0; }
        } else
        // ── Dash override (Space-bar mobility) ─────────────────────────────
        // When active, position is driven by interpolation between start/target;
        // velocity is forced to zero so Champion.update doesn't add to it. The
        // hero is invulnerable for the whole window via this.isInvulnerable.
        if (this.dashActive) {
            this.dashElapsed += deltaTime;
            const t = Math.min(1, this.dashElapsed / this.dashDuration);
            if (this.dashMode === 'linear') {
                const eased = 1 - (1 - t) * (1 - t); // ease-out quad
                const x = this.dashStartPos.x + (this.dashTargetPos.x - this.dashStartPos.x) * eased;
                const z = this.dashStartPos.z + (this.dashTargetPos.z - this.dashStartPos.z) * eased;
                this.writeHeroPosition(x, 0, z);
            } else if (this.dashMode === 'arc') {
                const x = this.dashStartPos.x + (this.dashTargetPos.x - this.dashStartPos.x) * t;
                const z = this.dashStartPos.z + (this.dashTargetPos.z - this.dashStartPos.z) * t;
                const y = Math.sin(t * Math.PI) * HeroController.DASH_ARC_APEX;
                this.writeHeroPosition(x, y, z);
            }
            // 'instant' was snapped on start — no per-frame position writes needed.

            // Hero stays still in input terms; force velocity to zero so
            // Champion.update doesn't add anything on top.
            this._scratchVel.set(0, 0, 0);
            this.hero.setPlayerVelocity(this._scratchVel);

            if (t >= 1) {
                // Reset y to ground so subsequent frames don't have arc residue.
                const finalX = this.dashTargetPos.x;
                const finalZ = this.dashTargetPos.z;
                this.writeHeroPosition(finalX, 0, finalZ);
                const cb = this.dashOnComplete;
                const landing = new Vector3(finalX, 0, finalZ);
                this.dashActive = false;
                this.isInvulnerable = false;
                this.dashOnComplete = null;
                if (cb) cb(landing);
            }

            // Update camera follow + basic attack still run below.
        } else {
            // Compute movement input from keyboard + external joystick
            let dx = this.externalDx;
            let dz = this.externalDz;
            if (this.keys['w'] || this.keys['arrowup']) dz += 1;
            if (this.keys['s'] || this.keys['arrowdown']) dz -= 1;
            if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
            if (this.keys['d'] || this.keys['arrowright']) dx += 1;

            // Screen→world — must stay identical to getMoveInput()'s conversion,
            // which is what co-op transmits. See isoProjection.screenToWorldDir.
            screenToWorldDir(dx, dz, this._scratchDir);
            dx = this._scratchDir.dx;
            dz = this._scratchDir.dz;

            // Normalize — cap at magnitude 1, allow joystick analog below 1.
            // Shared with the co-op input replay (integrateMove.ts) — same math.
            capInputLen(dx, dz, this._scratchInput);
            dx = this._scratchInput.dx;
            dz = this._scratchInput.dz;

            // Boss slow: multiplies the player's own move speed only (knockback and
            // pull are external forces and are NOT slowed). Expires on its timer.
            const effectiveSpeed = this.getEffectiveMoveSpeed();

            this._scratchVel.set(dx * effectiveSpeed, 0, dz * effectiveSpeed);

            // Decay knockback impulse, add it on top of player input.
            if (this.knockbackTimeRemaining > 0) {
                const decay = Math.max(0, this.knockbackTimeRemaining / this.knockbackDuration);
                this._scratchVel.x += this.knockbackVelocity.x * decay;
                this._scratchVel.z += this.knockbackVelocity.z * decay;
                this.knockbackTimeRemaining -= deltaTime;
            }

            // Boss pull: drag the hero toward the source point (recomputed each
            // frame so it tracks a moving boss). Added on top of input + knockback.
            if (this.pullTimeRemaining > 0) {
                const hp = this.hero.getPosition();
                const pdx = this.pullSourceX - hp.x;
                const pdz = this.pullSourceZ - hp.z;
                const plen = Math.hypot(pdx, pdz);
                if (plen > 0.4) {  // stop tugging once basically on top of the boss
                    this._scratchVel.x += (pdx / plen) * this.pullSpeed;
                    this._scratchVel.z += (pdz / plen) * this.pullSpeed;
                }
                this.pullTimeRemaining -= deltaTime;
            }

            this.hero.setPlayerVelocity(this._scratchVel);
        }

        // Clamp hero position inside arena after Champion.update applies velocity.
        // Shared with the co-op input replay (integrateMove.ts) — same math.
        const pos = this.hero.getPosition();
        const k = arenaClampScale(pos.x, pos.z, this.arenaRadius);
        if (k !== 1) {
            // hero.getPosition() returns the live position by reference, so write the
            // clamped values straight to it (and the mesh) — no scratch, no double-write.
            const clampedX = pos.x * k;
            const clampedZ = pos.z * k;
            (this.hero as any).position.x = clampedX;
            (this.hero as any).position.z = clampedZ;
            if ((this.hero as any).mesh) {
                (this.hero as any).mesh.position.x = clampedX;
                (this.hero as any).mesh.position.z = clampedZ;
            }
        }

        // Camera follow — position only, rotation is locked at construction.
        // In co-op a focus provider supplies a midpoint + a slant-distance multiplier;
        // solo play has no provider and frames the local hero at scale 1 (base distance).
        // The rig owns follow, zoom, finite-guards and shake.
        {
            this.isoRig.setFocusProvider(this.cameraFocusProvider);
            this.isoRig.update(deltaTime, pos.x, pos.z);
            if (this.cameraShakeTimeRemaining > 0) {
                this.isoRig.shake(this.cameraShakeTimeRemaining);
                this.cameraShakeTimeRemaining -= deltaTime;
            }
        }

        // Basic auto-attack (suspended while spectating / dead)
        if (this.basicAttack && !this.isDead && !this.spectating) this.basicAttack.update(deltaTime);
    }

    /** The active camera. Consumers (off-screen indicators, ability targeting)
     *  only project through it, and THREE's Raycaster/Object3D.project support
     *  orthographic natively, so the union needs no special-casing downstream. */
    public getCamera(): Camera {
        return this.camera;
    }

    /** Viewport changed — the iso rig re-picks its mobile/desktop view height. */
    public resizeCamera(): void {
        this.isoRig.resize();
    }

    /** Visible ground half-diagonal, used by the world to size prop spawn rings. */
    public getViewHalfDiagonal(): number {
        return this.isoRig.getViewHalfDiagonal();
    }

    /** Current eased camera-zoom multiplier. */
    public getZoomMultiplier(): number {
        return this.isoRig.getZoom();
    }

    public dispose(): void {
        this.basicAttack?.dispose(); // shared flight observer + streak pool
        this.isoRig.dispose();
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        // Three cameras own no GPU resources; hand rendering back to the boot
        // camera (Game.cleanupScene would also do this on state teardown).
        this.game.restoreDefaultCamera();
    }
}
