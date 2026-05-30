import { Scene, Vector3, FreeCamera, KeyboardEventTypes, ParticleSystem, Color4 } from '@babylonjs/core';
import { Champion } from './champions/Champion';
import { HeroBasicAttack, BasicAttackTarget, BasicAttackMode, ProjectileShape } from './champions/HeroBasicAttack';
import { PowerSlotManager } from './powers/PowerSlotManager';
import { Enemy } from './enemies/Enemy';
import { PlayerStats } from './PlayerStats';
import { DashMode } from './abilities/AbilityManager';

/** Hero damage-feedback tuning — adjust here, not deep in the update loop. */
const HIT_REACTION_COOLDOWN_S = 0.5;
const KNOCKBACK_SPEED         = 7.0;   // units / sec
const KNOCKBACK_DURATION_S    = 0.15;
const CAMERA_SHAKE_MAGNITUDE  = 0.6;   // world units added to camera position XZ per shake frame
const CAMERA_SHAKE_DURATION_S = 0.10;
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
    private onDeathCallback: () => void = () => {};

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

        // Pick camera parameters based on viewport width at construction time.
        // On narrow mobile screens (< 700px) pull the camera in closer so the hero
        // appears larger and more close-range threats are visible.
        const viewportWidth = scene.getEngine().getRenderWidth();
        if (viewportWidth < 700) {
            this.cameraHeight = 16;    // closer than desktop (20)
            this.cameraOffsetZ = -3;   // less tilt back
        } else {
            this.cameraHeight = 20;
            this.cameraOffsetZ = -5;   // slight tilt back for depth
        }

        // Top-down follow camera — replace the old isometric camera from Game.setupScene
        this.camera = new FreeCamera('heroCam', new Vector3(0, this.cameraHeight, this.cameraOffsetZ), scene);
        this.camera.setTarget(Vector3.Zero());
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

    public setExternalInput(dx: number, dz: number): void {
        this.externalDx = dx;
        this.externalDz = dz;
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

    public takeDamage(amount: number, sourcePos?: Vector3): void {
        if (this.isDead) return;
        if (this.isInvulnerable) return;
        this.currentHealth -= amount;
        if (this.currentHealth <= 0) {
            this.currentHealth = 0;
            this.isDead = true;
            this.onDeathCallback();
            return;
        }
        this.triggerHitReaction(sourcePos);
    }

    public getHealthRatio(): number {
        return Math.max(0, this.currentHealth / this.maxHealth);
    }

    public getHealth(): { current: number; max: number } {
        return { current: this.currentHealth, max: this.maxHealth };
    }

    public heal(amount: number): void {
        this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
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

            // Normalize — cap at magnitude 1, allow joystick analog below 1
            const len = Math.hypot(dx, dz);
            if (len > 1) { dx /= len; dz /= len; }

            // Boss slow: multiplies the player's own move speed only (knockback and
            // pull are external forces and are NOT slowed). Expires on its timer.
            const slow = this.elapsedTime < this.externalSlowUntil ? this.externalSlowMultiplier : 1;
            const effectiveSpeed = this.moveSpeed * this.moveSpeedMultiplier * slow;

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

        // Clamp hero position inside arena after Champion.update applies velocity
        const pos = this.hero.getPosition();
        const distFromCenter = Math.hypot(pos.x, pos.z);
        if (distFromCenter > this.arenaRadius - 0.5) {
            const k = (this.arenaRadius - 0.5) / distFromCenter;
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
        this._scratchCamTarget.set(pos.x, this.cameraHeight, pos.z + this.cameraOffsetZ);
        Vector3.LerpToRef(
            this.camera.position,
            this._scratchCamTarget,
            Math.min(1, deltaTime * 6),
            this.camera.position,
        );

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

        // Basic auto-attack
        if (this.basicAttack) this.basicAttack.update(deltaTime);
    }

    public getCamera(): FreeCamera {
        return this.camera;
    }

    public dispose(): void {
        this.camera.dispose();
    }
}
