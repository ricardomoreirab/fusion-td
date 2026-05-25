import { Scene, Vector3, FreeCamera, KeyboardEventTypes, ParticleSystem, Color4 } from '@babylonjs/core';
import { Champion } from './Champion';
import { HeroBasicAttack, BasicAttackTarget, BasicAttackMode, ProjectileShape } from './HeroBasicAttack';
import { PowerSlotManager } from './PowerSlotManager';
import { Enemy } from './enemies/Enemy';
import { PlayerStats } from './PlayerStats';

/** Hero damage-feedback tuning — adjust here, not deep in the update loop. */
const HIT_REACTION_COOLDOWN_S = 0.5;
const KNOCKBACK_SPEED         = 7.0;   // units / sec
const KNOCKBACK_DURATION_S    = 0.15;
const CAMERA_SHAKE_MAGNITUDE  = 0.6;   // world units added to camera position XZ per shake frame
const CAMERA_SHAKE_DURATION_S = 0.10;
const BLOOD_BURST_COUNT       = 12;

/** Per-class basic-attack configuration */
const CLASS_ATTACK_CONFIG: Record<string, { mode: BasicAttackMode; fireRate: number; damage: number; range: number; shape: ProjectileShape }> = {
    barbarian: { mode: 'melee',      fireRate: 1.0, damage: 18, range: 3.5, shape: 'sphere'   },
    ranger:    { mode: 'projectile', fireRate: 1.8, damage: 8,  range: 9,   shape: 'arrow'    },
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

    // Camera shake — decays to zero over CAMERA_SHAKE_DURATION_S.
    private cameraShakeTimeRemaining: number = 0;

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
     * @param multiplier — absolute multiplier (e.g. 1.1 after one Quickness purchase)
     */
    public updateBasicAttackSpeed(multiplier: number): void {
        this.basicAttack?.updateAttackSpeed(multiplier);
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

    public update(deltaTime: number): void {
        this.elapsedTime += deltaTime;

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

        this._scratchVel.set(
            dx * this.moveSpeed * this.moveSpeedMultiplier,
            0,
            dz * this.moveSpeed * this.moveSpeedMultiplier,
        );

        // Decay knockback impulse, add it on top of player input.
        if (this.knockbackTimeRemaining > 0) {
            const decay = Math.max(0, this.knockbackTimeRemaining / KNOCKBACK_DURATION_S);
            this._scratchVel.x += this.knockbackVelocity.x * decay;
            this._scratchVel.z += this.knockbackVelocity.z * decay;
            this.knockbackTimeRemaining -= deltaTime;
        }

        this.hero.setPlayerVelocity(this._scratchVel);

        // Clamp hero position inside arena after Champion.update applies velocity
        const pos = this.hero.getPosition();
        const distFromCenter = Math.hypot(pos.x, pos.z);
        if (distFromCenter > this.arenaRadius - 0.5) {
            const k = (this.arenaRadius - 0.5) / distFromCenter;
            pos.x *= k;
            pos.z *= k;
            (this.hero as any).position.x = pos.x;
            (this.hero as any).position.z = pos.z;
            if ((this.hero as any).mesh) {
                (this.hero as any).mesh.position.x = pos.x;
                (this.hero as any).mesh.position.z = pos.z;
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
