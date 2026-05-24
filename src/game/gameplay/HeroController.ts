import { Scene, Vector3, FreeCamera, KeyboardEventTypes } from '@babylonjs/core';
import { Champion } from './Champion';
import { HeroBasicAttack, BasicAttackTarget, BasicAttackMode, ProjectileShape } from './HeroBasicAttack';
import { PowerSlotManager } from './PowerSlotManager';
import { Enemy } from './enemies/Enemy';

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
            this.cameraHeight = 25;    // closer than desktop (30)
            this.cameraOffsetZ = -5;   // less tilt back
        } else {
            this.cameraHeight = 30;
            this.cameraOffsetZ = -7;   // slight tilt back for depth; ~13° off vertical
        }

        // Top-down follow camera — replace the old isometric camera from Game.setupScene
        this.camera = new FreeCamera('heroCam', new Vector3(0, this.cameraHeight, this.cameraOffsetZ), scene);
        this.camera.setTarget(Vector3.Zero());
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

    public setOnDeath(fn: () => void): void {
        this.onDeathCallback = fn;
    }

    public takeDamage(amount: number): void {
        if (this.isDead) return;
        this.currentHealth -= amount;
        if (this.currentHealth <= 0) {
            this.currentHealth = 0;
            this.isDead = true;
            this.onDeathCallback();
        }
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

    /**
     * Update the basic attack range multiplier.
     * @param multiplier — absolute multiplier (e.g. 1.1 after one Reach purchase)
     */
    public updateBasicAttackRange(multiplier: number): void {
        this.basicAttack?.updateRange(multiplier);
    }

    public update(deltaTime: number): void {
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

        const velocity = new Vector3(
            dx * this.moveSpeed * this.moveSpeedMultiplier,
            0,
            dz * this.moveSpeed * this.moveSpeedMultiplier,
        );
        this.hero.setPlayerVelocity(velocity);

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

        // Camera follow
        const targetCamPos = new Vector3(pos.x, this.cameraHeight, pos.z + this.cameraOffsetZ);
        this.camera.position = Vector3.Lerp(
            this.camera.position,
            targetCamPos,
            Math.min(1, deltaTime * 6),
        );
        this.camera.setTarget(new Vector3(pos.x, 0, pos.z));

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
