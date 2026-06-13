import { Scene, Vector3, FreeCamera, KeyboardEventTypes, ParticleSystem, Color4 } from '@babylonjs/core';
import { Champion } from './champions/Champion';
import { HeroBasicAttack, BasicAttackTarget, BasicAttackMode, ProjectileShape } from './champions/HeroBasicAttack';
import { PowerSlotManager } from './powers/PowerSlotManager';
import { Enemy } from './enemies/Enemy';
import { PlayerStats } from './PlayerStats';
import { DashMode } from './abilities/AbilityManager';
import { capInputLen, arenaClampScale } from './integrateMove';

/** Hero damage-feedback tuning — adjust here, not deep in the update loop. */
const HIT_REACTION_COOLDOWN_S = 0.5;
const KNOCKBACK_SPEED         = 7.0;   // units / sec
const KNOCKBACK_DURATION_S    = 0.15;
const CAMERA_SHAKE_MAGNITUDE  = 0.6;   // world units added to camera position XZ per shake frame
const CAMERA_SHAKE_DURATION_S = 0.10;

/** Isometric (Diablo 4 / BG3-style) follow camera over the globe map.
 *  PITCH is the look-down angle from horizontal; FOV narrows the lens
 *  (telephoto flattens perspective toward an isometric read — Babylon default
 *  is 0.8); DISTANCE is the slant range from the focus point. Camera height
 *  and Z-offset derive from pitch + distance, so tune these three only.
 *  Pitch is capped so a slim band of curved horizon + sky still clears the
 *  top of the frame — that band is what sells the infinite-globe illusion. */
const CAMERA_PITCH_DEG       = 42;
const CAMERA_FOV             = 0.55;  // rad
const CAMERA_DISTANCE        = 26;    // desktop slant distance
const CAMERA_DISTANCE_MOBILE = 23;    // narrow screens pull in slightly

/** How far ahead of the hero the camera aims — nudges the hero just below
 *  screen centre so more of the threat-bearing far field is visible. */
const CAMERA_AIM_AHEAD = 2;
const BLOOD_BURST_COUNT       = 12;

/** Per-class basic-attack configuration */
const CLASS_ATTACK_CONFIG: Record<string, { mode: BasicAttackMode; fireRate: number; damage: number; range: number; shape: ProjectileShape; multiTargetFromAttackSpeed?: boolean }> = {
    barbarian: { mode: 'melee',      fireRate: 1.0, damage: 18, range: 3.5, shape: 'sphere'   },
    ranger:    { mode: 'projectile', fireRate: 1.8, damage: 8,  range: 9,   shape: 'arrow',    multiTargetFromAttackSpeed: true },
    mage:      { mode: 'projectile', fireRate: 1.0, damage: 10, range: 8,   shape: 'mageBolt' },
};

export class HeroController {
    private scene: Scene;
    private hero: Champion;
    private camera: FreeCamera;
    private arenaRadius: number;
    private keys: { [k: string]: boolean } = {};
    private moveSpeed: number;
    private cameraHeight: number;
    private cameraOffsetZ: number;

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

    // Extra Life (wave-5 boss item): each charge turns the next lethal hit into a
    // full-HP revive plus a timed invulnerability shield instead of death.
    private reviveCharges: number = 0;
    private shieldTimer: number = 0; // seconds of post-revive invulnerability remaining
    private static readonly REVIVE_SHIELD_SECONDS = 5;
    /** Fired when a revive triggers (gameplay layer spawns the shield VFX + HUD sync). */
    private onReviveCallback: () => void = () => {};
    /** Fired when the post-revive shield expires (gameplay layer removes the bubble). */
    private onShieldEndCallback: () => void = () => {};

    // Move speed multiplier (from Swiftness shop purchases)
    private moveSpeedMultiplier: number = 1.0;

    // Damage-feedback state — see HIT_REACTION_* / KNOCKBACK_* constants.
    private lastHitReactionTime: number = -Infinity;
    private elapsedTime: number = 0;

    // Knockback impulse — decays over KNOCKBACK_DURATION_S, added to player velocity.
    private knockbackVelocity: Vector3 = new Vector3();
    private knockbackTimeRemaining: number = 0;

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

    // Co-op: when set, the camera frames this point (+ height) instead of just
    // the local hero. Lets a shared/tethered camera reuse the existing lerp/shake.
    private cameraFocusProvider: (() => { x: number; z: number; height: number }) | null = null;

    constructor(
        scene: Scene,
        hero: Champion,
        arenaRadius: number,
        moveSpeed: number = 7,
        maxHealth: number = 100,
        championType: string = 'barbarian',
    ) {
        this.scene = scene;
        this.hero = hero;
        this.arenaRadius = arenaRadius;
        this.moveSpeed = moveSpeed;
        this.maxHealth = maxHealth;
        this.currentHealth = maxHealth;

        // Isometric globe-map camera: height + Z-offset derive from the pitch
        // and slant distance so the tuning knobs stay independent. On narrow
        // mobile screens (< 700px) pull the camera in slightly closer.
        const viewportWidth = scene.getEngine().getRenderWidth();
        const pitchRad = CAMERA_PITCH_DEG * Math.PI / 180;
        const camDist = viewportWidth < 700 ? CAMERA_DISTANCE_MOBILE : CAMERA_DISTANCE;
        this.cameraHeight = camDist * Math.sin(pitchRad);
        this.cameraOffsetZ = -camDist * Math.cos(pitchRad);

        // Isometric follow camera: steep look-down + narrow (telephoto) FOV.
        // Aim slightly AHEAD of the hero so the hero sits just below centre
        // and the top of the frame keeps the curved horizon + sky band.
        this.camera = new FreeCamera('heroCam', new Vector3(0, this.cameraHeight, this.cameraOffsetZ), scene);
        this.camera.fov = CAMERA_FOV;
        this.camera.setTarget(new Vector3(0, 0, CAMERA_AIM_AHEAD));
        // Snapshot the look-down rotation once. We never call setTarget() again — only
        // position is lerped per frame. Calling setTarget() each frame recomputes rotation
        // from the lerped position, producing a tiny drift each frame that reads as the
        // map slowly rotating.
        this.camera.rotation = this.camera.rotation.clone();
        scene.activeCamera = this.camera;

        // No user camera manipulation
        this.camera.inputs.clear();

        // Keyboard input
        scene.onKeyboardObservable.add((kbInfo) => {
            const key = kbInfo.event.key.toLowerCase();
            if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
                this.keys[key] = true;
            }
            if (kbInfo.type === KeyboardEventTypes.KEYUP) {
                this.keys[key] = false;
            }
        });

        // Build basic attack based on champion class
        const cfg = CLASS_ATTACK_CONFIG[championType] ?? CLASS_ATTACK_CONFIG['barbarian'];
        this.basicAttack = new HeroBasicAttack(scene, hero, {
            mode:             cfg.mode,
            fireRate:         cfg.fireRate,
            damage:           cfg.damage,
            range:            cfg.range,
            projectileShape:  cfg.shape,
            targetProvider:   () => this.targetProvider(),
            enemyProvider:    () => this.enemyProvider?.() ?? [],
            multiTargetFromAttackSpeed: cfg.multiTargetFromAttackSpeed,
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

    public setCameraFocusProvider(fn: (() => { x: number; z: number; height: number }) | null): void {
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

        if (sourcePos) {
            const heroPos = this.hero.getPosition();
            const dx = heroPos.x - sourcePos.x;
            const dz = heroPos.z - sourcePos.z;
            const len = Math.hypot(dx, dz);
            if (len > 0.0001) {
                this.knockbackVelocity.set(
                    (dx / len) * KNOCKBACK_SPEED,
                    0,
                    (dz / len) * KNOCKBACK_SPEED,
                );
                this.knockbackTimeRemaining = KNOCKBACK_DURATION_S;
            }
        }
    }

    /** One-shot red particle burst at the hero's torso to signal damage taken. */
    private spawnHeroBloodBurst(): void {
        const heroPos = this.hero.getPosition();
        const burstPos = new Vector3(heroPos.x, heroPos.y + 0.8, heroPos.z);

        const ps = new ParticleSystem('heroBloodBurst', BLOOD_BURST_COUNT, this.scene);
        ps.emitter = burstPos;
        ps.minEmitBox = new Vector3(-0.10, 0, -0.10);
        ps.maxEmitBox = new Vector3(0.10, 0, 0.10);
        ps.color1 = new Color4(0.80, 0.05, 0.05, 1);
        ps.color2 = new Color4(0.50, 0.02, 0.02, 1);
        ps.colorDead = new Color4(0.10, 0, 0, 0);
        ps.minSize = 0.10;
        ps.maxSize = 0.20;
        ps.minLifeTime = 0.25;
        ps.maxLifeTime = 0.40;
        ps.emitRate = 80;
        ps.manualEmitCount = BLOOD_BURST_COUNT; // one-shot
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1, 0.4, -1);
        ps.direction2 = new Vector3(1, 1.2, 1);
        ps.minEmitPower = 1.5;
        ps.maxEmitPower = 3.0;
        ps.gravity = new Vector3(0, -15, 0);
        ps.start();
        // Stop emission shortly after, then dispose once particles finish their lifetime.
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 80);
    }

    /** DEV ?test: when true, the hero ignores all damage (set by test mode so a
     *  stress horde can't kill you). Separate from the transient dash i-frame flag. */
    public debugInvulnerable: boolean = false;

    public takeDamage(amount: number, sourcePos?: Vector3): void {
        if (this.isDead) return;
        if (this.isInvulnerable || this.shieldTimer > 0 || this.debugInvulnerable) return;
        this.currentHealth -= amount;
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
            this.currentHealth = 0;
            this.isDead = true;
            this.onDeathCallback();
            return;
        }
        this.triggerHitReaction(sourcePos);
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

    /** Restore HP (capped at max). No-op while dead. Used by the Heal power-choice card. */
    public heal(amount: number): void {
        if (this.isDead || amount <= 0) return;
        this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
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

    public getHealth(): { current: number; max: number } {
        return { current: this.currentHealth, max: this.maxHealth };
    }

    /** Apply full basic-attack hits to all enemies within `radius` of `center`.
     *  Used by Whirlwind so its ticks reuse the basic attack's hit pipeline
     *  (crit / lifesteal / knockback / element enchantments). */
    public applyAttackHitsInRadius(center: Vector3, radius: number): void {
        this.basicAttack?.applyAttackHitsInRadius(center, radius);
    }

    /** Increase max HP (and current HP) by amount — used by the Vitality shop item. */
    public addMaxHealth(amount: number): void {
        this.maxHealth += amount;
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

    /** Current effective move speed: base × shop/level multiplier × active boss slow.
     *  This is exactly the speed update() integrates input with — the co-op guest
     *  passes it to the input replay so the replayed prediction matches the local
     *  one (M6 E2). Note the HOST simulates the guest at the champion's BASE speed
     *  (it doesn't know multipliers/slows) — that divergence is documented at the
     *  replay site and absorbed by the reconcile dead-zone/lerp. */
    public getEffectiveMoveSpeed(): number {
        const slow = this.elapsedTime < this.externalSlowUntil ? this.externalSlowMultiplier : 1;
        return this.moveSpeed * this.moveSpeedMultiplier * slow;
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
        return { dx, dz };
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

        this.dashStartPos.copyFrom(this.hero.getPosition());
        this.dashTargetPos.copyFrom(target);
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

        // ── Post-revive invulnerability shield ─────────────────────────────
        if (this.shieldTimer > 0) {
            this.shieldTimer -= deltaTime;
            if (this.shieldTimer <= 0) {
                this.shieldTimer = 0;
                this.onShieldEndCallback();
            }
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
                const decay = Math.max(0, this.knockbackTimeRemaining / KNOCKBACK_DURATION_S);
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
        // In co-op a focus provider supplies a midpoint + zoomed height; solo
        // play falls back to the local hero at the constructed height.
        const focus = this.cameraFocusProvider
            ? this.cameraFocusProvider()
            : { x: pos.x, z: pos.z, height: this.cameraHeight };
        // Only lerp from a FINITE focus + delta. A NaN/Infinity here would poison
        // camera.position permanently (LerpToRef of NaN stays NaN forever), making
        // the view matrix NaN → every mesh clips out → the canvas blanks to the
        // near-black clear color: a sticky black screen that never recovers. We keep
        // _scratchCamTarget at its last finite value so recovery has somewhere to go.
        const ft = Number.isFinite;
        if (ft(focus.x) && ft(focus.height) && ft(focus.z) && ft(deltaTime)) {
            this._scratchCamTarget.set(focus.x, focus.height, focus.z + this.cameraOffsetZ);
            Vector3.LerpToRef(
                this.camera.position,
                this._scratchCamTarget,
                Math.min(1, deltaTime * 6),
                this.camera.position,
            );
        }
        // If the position was already poisoned (or focus was non-finite this frame),
        // snap back to the last finite follow target so rendering never goes dark.
        const cp = this.camera.position;
        if (!ft(cp.x) || !ft(cp.y) || !ft(cp.z)) {
            console.error('[camera] non-finite hero-follow position — recovered to last finite target');
            cp.copyFrom(this._scratchCamTarget);
        }

        // Shake is applied *after* the lerp — otherwise the lerp's smoothing
        // eats the per-frame jitter and the shake reads as ~1 pixel of motion.
        // The next few frames' lerp then naturally decays the offset back to neutral.
        if (this.cameraShakeTimeRemaining > 0) {
            const k = this.cameraShakeTimeRemaining / CAMERA_SHAKE_DURATION_S;
            const angle = Math.random() * Math.PI * 2;
            this.camera.position.x += Math.cos(angle) * CAMERA_SHAKE_MAGNITUDE * k;
            this.camera.position.z += Math.sin(angle) * CAMERA_SHAKE_MAGNITUDE * k;
            this.cameraShakeTimeRemaining -= deltaTime;
        }

        // Basic auto-attack (suspended while spectating / dead)
        if (this.basicAttack && !this.isDead && !this.spectating) this.basicAttack.update(deltaTime);
    }

    public getCamera(): FreeCamera {
        return this.camera;
    }

    public dispose(): void {
        this.basicAttack?.dispose(); // shared flight observer + streak pool
        this.camera.dispose();
    }
}
