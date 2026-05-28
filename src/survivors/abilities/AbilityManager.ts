import { Vector3, Color3, Color4, MeshBuilder, ParticleSystem, Animation, Scene, Mesh, StandardMaterial } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { EnemyManager } from '../enemies/EnemyManager';
import { PlayerStats } from '../PlayerStats';
import { StatusEffect } from '../GameTypes';
import { PowerSlotManager } from '../powers/PowerSlotManager';
import { createEmissiveMaterial } from '../../engine/rendering/LowPolyMaterial';
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

// =============================================================================
// WHIRLWIND RING POOL — 8 pre-allocated torus meshes reused across ring spawns.
// Material is cached once (shared); alpha fade is done via scale-only so the
// shared material isn't mutated per-instance.
// =============================================================================

const WHIRLWIND_POOL_SIZE = 8;
const whirlwindPool: Mesh[] = [];
let whirlwindPoolInit = false;

function acquireWhirlwindRing(scene: Scene): Mesh {
    if (!whirlwindPoolInit) {
        for (let i = 0; i < WHIRLWIND_POOL_SIZE; i++) {
            const t = MeshBuilder.CreateTorus(
                `whirlwindRing${i}`,
                { diameter: 1.0, thickness: 0.08, tessellation: 16 },
                scene,
            ) as Mesh;
            t.setEnabled(false);
            t.material = getCachedMaterial(scene, 'whirlwindRingMat', m => {
                m.emissiveColor = new Color3(0.5, 0.8, 1.0);
                m.diffuseColor = new Color3(0, 0, 0);
                m.alpha = 0.85;
            });
            whirlwindPool.push(t);
        }
        whirlwindPoolInit = true;
    }
    for (const r of whirlwindPool) {
        if (!r.isEnabled()) {
            r.setEnabled(true);
            return r;
        }
    }
    // Fallback: pool exhausted — allocate fresh, will be disposed on completion.
    return MeshBuilder.CreateTorus(
        `whirlwindRingX${performance.now()}`,
        { diameter: 1.0, thickness: 0.08, tessellation: 16 },
        scene,
    ) as Mesh;
}

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
    private scene: Scene;
    private enemyManager: EnemyManager;
    private playerStats: PlayerStats | null = null;
    private abilities: Map<string, Ability> = new Map();

    // Targeting state
    private isTargeting: boolean = false;
    private targetingAbility: string | null = null;

    // Hero reference for class-specific abilities (e.g. Whirlwind spin)
    private hero: any = null;

    // Hero position provider
    private heroProvider: (() => Vector3) | null = null;

    // Active timed effects (Whirlwind, Multishot, Explosive Arrow, Dash override window)
    private activeEffects: ActiveEffect[] = [];

    /** PowerSlotManager handle — used by Multishot to force-fire all equipped autocast slots. */
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

    constructor(game: Game, enemyManager: EnemyManager) {
        this.game = game;
        this.scene = game.getScene();
        this.enemyManager = enemyManager;

        // Default to mage abilities. Call configureForClass() to switch.
        this.configureForClass('mage');
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
                this.abilities.set('meteor',    { name: 'Meteor Strike', cooldown: 45, currentCooldown: 0, isReady: true, needsTargeting: true });
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

    private getHeroPosition(): Vector3 | null {
        return this.heroProvider ? this.heroProvider() : null;
    }

    // ========================================================================
    // Player stats
    // ========================================================================

    public setPlayerStats(stats: PlayerStats): void {
        this.playerStats = stats;
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
        // Cooldown ticking
        this.abilities.forEach((ability) => {
            if (!ability.isReady) {
                ability.currentCooldown -= deltaTime;
                if (ability.currentCooldown <= 0) {
                    ability.currentCooldown = 0;
                    ability.isReady = true;
                }
            }
        });

        // Active timed effects (Whirlwind, Volley, Explosive Arrow)
        for (const eff of this.activeEffects) {
            eff.timeLeft -= deltaTime;
            eff.timeSinceLastTick += deltaTime;
            if (eff.timeSinceLastTick >= eff.tickInterval) {
                eff.tick();
                eff.timeSinceLastTick = 0;
            }
        }
        // Fire onEnd hooks for effects that just expired, then drop them.
        const ended = this.activeEffects.filter(e => e.timeLeft <= 0);
        for (const e of ended) {
            if (e.onEnd) {
                try { e.onEnd(); } catch { /* ignore */ }
            }
        }
        this.activeEffects = this.activeEffects.filter(e => e.timeLeft > 0);
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

    public activate(abilityId: string, position?: Vector3): boolean {
        const ability = this.abilities.get(abilityId);
        if (!ability || !ability.isReady) return false;

        let success = false;

        switch (abilityId) {
            // ── Mage ─────────────────────────────────────────────────────────
            case 'meteor':
                if (position) {
                    success = this.activateMeteor(position);
                }
                break;
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
    // Mage: Meteor Strike — 100 damage in radius 4
    // ========================================================================

    private activateMeteor(position: Vector3): boolean {
        const radius = 4;
        const damage = 100;

        const enemies = this.enemyManager.getEnemiesInRange(position, radius);
        for (const enemy of enemies) {
            enemy.takeDamage(damage);
        }

        this.createMeteorVisual(position, radius);
        return true;
    }

    private createMeteorVisual(position: Vector3, radius: number): void {
        const fireball = MeshBuilder.CreateIcoSphere('meteorBall', {
            radius: 0.8, subdivisions: 1
        }, this.scene);
        fireball.position = new Vector3(position.x, position.y + 15, position.z);
        fireball.material = createEmissiveMaterial('meteorMat', new Color3(1, 0.3, 0), 0.9, this.scene);

        const descentAnim = new Animation('meteorDescent', 'position.y', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        descentAnim.setKeys([
            { frame: 0, value: position.y + 15 },
            { frame: 12, value: position.y + 0.5 }
        ]);
        fireball.animations = [descentAnim];

        this.scene.beginAnimation(fireball, 0, 12, false, 1, () => {
            fireball.dispose();

            const ring = MeshBuilder.CreateTorus('meteorRing', {
                diameter: 0.5, thickness: 0.3, tessellation: 16
            }, this.scene);
            ring.position = new Vector3(position.x, position.y + 0.1, position.z);
            ring.material = createEmissiveMaterial('meteorRingMat', new Color3(1, 0.5, 0), 0.8, this.scene);
            (ring.material as StandardMaterial).alpha = 0.8;

            const expandAnim = new Animation('ringExpand', 'scaling', 30,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
            expandAnim.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 20, value: new Vector3(radius * 2, 1, radius * 2) }
            ]);
            const fadeAnim = new Animation('ringFade', 'material.alpha', 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
            fadeAnim.setKeys([
                { frame: 0, value: 0.8 },
                { frame: 20, value: 0 }
            ]);
            ring.animations = [expandAnim, fadeAnim];
            this.scene.beginAnimation(ring, 0, 20, false, 1, () => ring.dispose());

            const ps = new ParticleSystem('meteorImpact', 60, this.scene);
            ps.emitter = new Vector3(position.x, position.y + 0.5, position.z);
            ps.minEmitBox = new Vector3(-0.5, 0, -0.5);
            ps.maxEmitBox = new Vector3(0.5, 0, 0.5);
            ps.color1 = new Color4(1, 0.5, 0, 1);
            ps.color2 = new Color4(1, 0.2, 0, 1);
            ps.colorDead = new Color4(0.3, 0, 0, 0);
            ps.minSize = 0.3;
            ps.maxSize = 0.8;
            ps.minLifeTime = 0.3;
            ps.maxLifeTime = 0.8;
            ps.emitRate = 200;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.direction1 = new Vector3(-2, 2, -2);
            ps.direction2 = new Vector3(2, 4, 2);
            ps.minEmitPower = 2;
            ps.maxEmitPower = 5;
            ps.gravity = new Vector3(0, -8, 0);
            ps.start();
            setTimeout(() => {
                try { ps.stop(); } catch { /* already disposed */ }
                setTimeout(() => {
                    try { ps.dispose(); } catch { /* already disposed */ }
                }, 800);
            }, 200);
        });
    }

    // ========================================================================
    // Mage: Frost Nova — freeze ALL enemies for 2.5 seconds
    // ========================================================================

    private activateFrostNova(): boolean {
        const enemies = this.enemyManager.getEnemies();
        const duration = 2.5;

        for (const enemy of enemies) {
            if (enemy.isAlive()) {
                enemy.applyStatusEffect(StatusEffect.FROZEN, duration, 1.0);
            }
        }

        this.createFrostNovaVisual();
        return true;
    }

    private createFrostNovaVisual(): void {
        const center = new Vector3(20, 0.1, 20);

        const ring = MeshBuilder.CreateDisc('frostRing', {
            radius: 0.5, tessellation: 32
        }, this.scene);
        ring.position = center;
        ring.rotation.x = Math.PI / 2;
        const ringMat = new StandardMaterial('frostRingMat', this.scene);
        ringMat.diffuseColor = new Color3(0.5, 0.8, 1);
        ringMat.emissiveColor = new Color3(0.3, 0.5, 0.8);
        ringMat.alpha = 0.5;
        ringMat.disableLighting = true;
        ring.material = ringMat;

        const expandAnim = new Animation('frostExpand', 'scaling', 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
        expandAnim.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 30, value: new Vector3(80, 80, 1) }
        ]);
        const fadeAnim = new Animation('frostFade', 'material.alpha', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        fadeAnim.setKeys([
            { frame: 0, value: 0.5 },
            { frame: 30, value: 0 }
        ]);
        ring.animations = [expandAnim, fadeAnim];
        this.scene.beginAnimation(ring, 0, 30, false, 1, () => ring.dispose());

        const ps = new ParticleSystem('frostParticles', 100, this.scene);
        ps.emitter = center;
        ps.minEmitBox = new Vector3(-20, 0, -20);
        ps.maxEmitBox = new Vector3(20, 0.5, 20);
        ps.color1 = new Color4(0.7, 0.9, 1, 1);
        ps.color2 = new Color4(0.4, 0.6, 1, 1);
        ps.colorDead = new Color4(0.2, 0.3, 0.5, 0);
        ps.minSize = 0.1;
        ps.maxSize = 0.3;
        ps.minLifeTime = 0.5;
        ps.maxLifeTime = 1.5;
        ps.emitRate = 200;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-0.5, 1, -0.5);
        ps.direction2 = new Vector3(0.5, 2, 0.5);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 1.5;
        ps.start();
        setTimeout(() => {
            try { ps.stop(); } catch { /* already disposed */ }
            setTimeout(() => {
                try { ps.dispose(); } catch { /* already disposed */ }
            }, 1500);
        }, 300);
    }

    // ========================================================================
    // Barbarian: Whirlwind — 5s spin AOE every 0.3s, radius 5, 18 dmg/tick
    // ========================================================================

    private activateWhirlwind(): boolean {
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        // Vortex dust PS — swirling tan particles around the hero, rising up.
        // Emitter is a Vector3 we update each frame via an onBeforeRender hook
        // so the PS tracks the hero's actual position.
        const vortexEmitter = heroPos.clone();
        const vortexPs = new ParticleSystem('whirlwindVortex', 80, this.scene);
        vortexPs.emitter = vortexEmitter;
        vortexPs.minEmitBox = new Vector3(-1.2, 0, -1.2);
        vortexPs.maxEmitBox = new Vector3(1.2, 0.2, 1.2);
        vortexPs.color1 = new Color4(0.75, 0.62, 0.42, 1);
        vortexPs.color2 = new Color4(0.55, 0.42, 0.28, 1);
        vortexPs.colorDead = new Color4(0.20, 0.15, 0.10, 0);
        vortexPs.minSize = 0.10;
        vortexPs.maxSize = 0.28;
        vortexPs.minLifeTime = 0.35;
        vortexPs.maxLifeTime = 0.65;
        vortexPs.emitRate = 220;
        vortexPs.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        // Tangential / upward emission so the swarm reads as a rising swirl
        vortexPs.direction1 = new Vector3(-3, 1.2, -3);
        vortexPs.direction2 = new Vector3(3, 2.4, 3);
        vortexPs.minEmitPower = 2;
        vortexPs.maxEmitPower = 4;
        vortexPs.gravity = new Vector3(0, 1.2, 0); // positive — debris rises
        vortexPs.start();

        const emitterObs = this.scene.onBeforeRenderObservable.add(() => {
            const pos = this.getHeroPosition();
            if (!pos) return;
            vortexEmitter.copyFrom(pos);
            vortexEmitter.y += 0.2;
        });

        this.activeEffects.push({
            id: 'whirlwind',
            timeLeft: 5.0,
            tickInterval: 0.3,
            timeSinceLastTick: 0,
            tick: () => {
                const pos = this.getHeroPosition();
                if (!pos) return;
                const radius = 5;
                for (const e of this.enemyManager.getEnemies()) {
                    if (!e.isAlive()) continue;
                    const ePos = e.getPosition();
                    if (Vector3.Distance(pos, ePos) <= radius) {
                        e.takeDamage(18);
                    }
                }
                this.spawnWhirlwindRing(pos, radius);
                // Secondary outer ring — 1.4× scale, lighter, layered concentric tornado read.
                this.spawnWhirlwindRing(pos, radius * 1.4);
                // Keep champion body spinning
                if (this.hero && typeof this.hero.triggerSpinAttack === 'function') {
                    this.hero.triggerSpinAttack();
                }
            },
            onEnd: () => {
                this.scene.onBeforeRenderObservable.remove(emitterObs);
                try { vortexPs.stop(); } catch { /* ignore */ }
                setTimeout(() => {
                    try { vortexPs.dispose(); } catch { /* ignore */ }
                }, 700);
            },
        });

        return true;
    }

    private spawnWhirlwindRing(center: Vector3, radius: number): void {
        const scene = this.scene;
        const ring = acquireWhirlwindRing(scene);
        const isPooled = whirlwindPool.indexOf(ring) >= 0;

        // Diameter stored as scaling; pool torus has diameter=1.0, so scale by target.
        const targetScale = radius * 0.6;
        ring.position.set(center.x, center.y + 0.3, center.z);
        // Start small, expand to targetScale over the duration (scale-only fade).
        ring.scaling.set(targetScale * 0.3, 1, targetScale * 0.3);

        const duration = 0.4; // seconds (~12 frames at 30 fps, matching original)
        let elapsed = 0;
        const obs = scene.onBeforeRenderObservable.add(() => {
            const dt = scene.getEngine().getDeltaTime() / 1000;
            elapsed += dt;
            const t = Math.min(elapsed / duration, 1);
            const s = targetScale * (0.3 + 0.7 * t);
            ring.scaling.set(s, 1 - t, s); // shrink vertically to "vanish"
            if (t >= 1) {
                scene.onBeforeRenderObservable.remove(obs);
                if (isPooled) {
                    ring.setEnabled(false);
                    ring.scaling.setAll(1);
                } else {
                    ring.dispose();
                }
            }
        });
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
            this.spawnTeleportRing(heroPos.clone(), new Color3(0.7, 0.3, 1.0));
        } else if (championType === 'barbarian') {
            this.spawnDashTrail(heroPos.clone());
        }

        this.dashOverride(target, duration, mode, (landingPos: Vector3) => {
            // Landing push: every enemy within DASH_PUSH_RADIUS shoved outward
            // by DASH_PUSH_DISTANCE over 0.2s. No damage.
            for (const e of this.enemyManager.getEnemies()) {
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
                this.spawnTeleportRing(landingPos, new Color3(0.7, 0.3, 1.0));
            } else {
                this.spawnDashLandingDust(landingPos);
            }
        });

        return true;
    }

    /** Purple particle ring that marks both endpoints of a mage teleport. */
    private spawnTeleportRing(center: Vector3, color: Color3): void {
        const ring = MeshBuilder.CreateTorus('teleportRing', {
            diameter: 1.0, thickness: 0.18, tessellation: 18,
        }, this.scene);
        ring.position.set(center.x, center.y + 0.4, center.z);
        const mat = createEmissiveMaterial('teleportRingMat', color, 0.9, this.scene);
        (mat as StandardMaterial).alpha = 0.85;
        ring.material = mat;

        const expandAnim = new Animation('teleportExpand', 'scaling', 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
        expandAnim.setKeys([
            { frame: 0,  value: new Vector3(0.5, 1, 0.5) },
            { frame: 10, value: new Vector3(3.5, 1, 3.5) },
        ]);
        const fadeAnim = new Animation('teleportFade', 'material.alpha', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        fadeAnim.setKeys([
            { frame: 0,  value: 0.85 },
            { frame: 10, value: 0.0 },
        ]);
        ring.animations = [expandAnim, fadeAnim];
        this.scene.beginAnimation(ring, 0, 10, false, 1, () => ring.dispose());
    }

    /** Brief dust streak at the dash origin for barbarian. */
    private spawnDashTrail(origin: Vector3): void {
        const ps = new ParticleSystem('dashTrail', 30, this.scene);
        ps.emitter = new Vector3(origin.x, origin.y + 0.1, origin.z);
        ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0.1, 0.3);
        ps.color1 = new Color4(0.65, 0.55, 0.40, 1);
        ps.color2 = new Color4(0.40, 0.32, 0.22, 1);
        ps.colorDead = new Color4(0.15, 0.12, 0.08, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.35;
        ps.minLifeTime = 0.20;
        ps.maxLifeTime = 0.40;
        ps.emitRate = 0;
        ps.manualEmitCount = 30;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.direction1 = new Vector3(-1, 0.5, -1);
        ps.direction2 = new Vector3(1, 1.2, 1);
        ps.minEmitPower = 1.5;
        ps.maxEmitPower = 3.0;
        ps.gravity = new Vector3(0, -2, 0);
        ps.start();
        setTimeout(() => {
            try { ps.stop(); } catch { /* ignore */ }
            setTimeout(() => { try { ps.dispose(); } catch { /* ignore */ } }, 500);
        }, 100);
    }

    /** Landing dust ring for barbarian dash and ranger jump. */
    private spawnDashLandingDust(center: Vector3): void {
        const ps = new ParticleSystem('dashLandDust', 40, this.scene);
        ps.emitter = new Vector3(center.x, center.y + 0.1, center.z);
        ps.minEmitBox = new Vector3(-0.5, 0, -0.5);
        ps.maxEmitBox = new Vector3(0.5, 0.1, 0.5);
        ps.color1 = new Color4(0.70, 0.60, 0.45, 1);
        ps.color2 = new Color4(0.45, 0.35, 0.25, 1);
        ps.colorDead = new Color4(0.15, 0.12, 0.08, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.40;
        ps.minLifeTime = 0.25;
        ps.maxLifeTime = 0.50;
        ps.emitRate = 0;
        ps.manualEmitCount = 40;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.direction1 = new Vector3(-2, 0.8, -2);
        ps.direction2 = new Vector3(2, 1.6, 2);
        ps.minEmitPower = 1.5;
        ps.maxEmitPower = 3.5;
        ps.gravity = new Vector3(0, -3, 0);
        ps.start();
        setTimeout(() => {
            try { ps.stop(); } catch { /* ignore */ }
            setTimeout(() => { try { ps.dispose(); } catch { /* ignore */ } }, 600);
        }, 120);
    }

    // ========================================================================
    // Barbarian: Smash — instant knock all enemies in 10u outward, 30 dmg
    // ========================================================================

    private activateSmash(): boolean {
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        const knockRadius = 10;
        const knockForce = 12;

        for (const e of this.enemyManager.getEnemies()) {
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

        this.spawnSmashShockwave(heroPos);
        return true;
    }

    private animateEnemyKnockback(enemy: any, targetX: number, targetZ: number, duration: number): void {
        let elapsed = 0;
        const startX = enemy.getPosition().x;
        const startZ = enemy.getPosition().z;
        const observer = this.scene.onBeforeRenderObservable.add(() => {
            if (!enemy.isAlive()) {
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            elapsed += this.scene.getEngine().getDeltaTime() / 1000;
            const t = Math.min(1, elapsed / duration);
            // Ease out
            const eased = 1 - (1 - t) * (1 - t);
            const pos = enemy.getPosition();
            pos.x = startX + (targetX - startX) * eased;
            pos.z = startZ + (targetZ - startZ) * eased;
            if (t >= 1) {
                this.scene.onBeforeRenderObservable.remove(observer);
            }
        });
    }

    private spawnSmashShockwave(center: Vector3): void {
        const ring = MeshBuilder.CreateTorus('smashRing', {
            diameter: 2, thickness: 0.5, tessellation: 24,
        }, this.scene);
        ring.position = new Vector3(center.x, center.y + 0.2, center.z);
        const mat = createEmissiveMaterial('smashMat', new Color3(1.0, 0.65, 0.1), 0.9, this.scene);
        (mat as StandardMaterial).alpha = 0.85;
        ring.material = mat;

        const expandAnim = new Animation('smashExpand', 'scaling', 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
        expandAnim.setKeys([
            { frame: 0,  value: new Vector3(1, 1, 1) },
            { frame: 15, value: new Vector3(12, 1, 12) },
        ]);
        const fadeAnim = new Animation('smashFade', 'material.alpha', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        fadeAnim.setKeys([
            { frame: 0,  value: 0.85 },
            { frame: 15, value: 0.0 },
        ]);
        ring.animations = [expandAnim, fadeAnim];
        this.scene.beginAnimation(ring, 0, 15, false, 1, () => ring.dispose());
    }

    // ========================================================================
    // Ranger: Multishot — 5s; every 0.4s force-fire every equipped autocast
    // power-slot (Fire Arrow / Frost Arrow / Seeking / Piercing / Lightning).
    // Each power picks its own nearest target via its existing cast() logic, so
    // damage multipliers + perks apply automatically. Power-slot cooldowns are
    // intentionally NOT consumed — regular autocast resumes from where it was.
    //
    // Fallback: when no autocast slots are equipped (early game), fire a single
    // plain volley arrow at the nearest enemy each tick so the ult never no-ops.
    // ========================================================================

    private activateMultishot(): boolean {
        const heroPos = this.getHeroPosition();
        if (!heroPos) return false;

        this.activeEffects.push({
            id: 'multishot',
            timeLeft: 5.0,
            tickInterval: 0.4,
            timeSinceLastTick: 0,
            tick: () => {
                const pos = this.getHeroPosition();
                if (!pos) return;
                let fired = 0;
                if (this.powerSlots) {
                    fired = this.powerSlots.forceCastAutocastSlots();
                }
                // Fallback when no autocast powers are equipped: keep the
                // ult feeling useful with a plain arrow at the nearest enemy.
                if (fired === 0) {
                    const alive = this.enemyManager.getEnemies().filter(e => e.isAlive());
                    if (alive.length === 0) return;
                    let nearest = alive[0];
                    let bestSq = Vector3.DistanceSquared(pos, nearest.getPosition());
                    for (const e of alive) {
                        const d = Vector3.DistanceSquared(pos, e.getPosition());
                        if (d < bestSq) { bestSq = d; nearest = e; }
                    }
                    this.spawnVolleyArrow(pos, nearest, 10);
                }
                // Re-trigger the ranger's special/attack animation each burst for feedback.
                if (this.hero && typeof this.hero.triggerSpecial === 'function') {
                    this.hero.triggerSpecial();
                } else if (this.hero && typeof this.hero.triggerAttack === 'function') {
                    this.hero.triggerAttack();
                }
            },
        });

        return true;
    }

    private spawnVolleyArrow(from: Vector3, target: any, damage: number): void {
        const arrow = MeshBuilder.CreateCylinder('volleyArrow', {
            height: 0.6, diameter: 0.08, tessellation: 5,
        }, this.scene);
        arrow.position = new Vector3(from.x, from.y + 1.0, from.z);

        const mat = createEmissiveMaterial('volleyArrowMat', new Color3(0.6, 1.0, 0.4), 0.8, this.scene);
        arrow.material = mat;

        // Orient toward target
        const targetPos = target.getPosition().clone();
        targetPos.y += 1.0;
        const dir = targetPos.subtract(arrow.position).normalize();
        arrow.lookAt(targetPos);
        arrow.rotation.x += Math.PI / 2;

        const speed = 18; // units/sec
        let observer: any = null;
        observer = this.scene.onBeforeRenderObservable.add(() => {
            if (arrow.isDisposed()) {
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            const toTarget = targetPos.subtract(arrow.position);
            const dist = toTarget.length();
            if (dist < 0.4) {
                // Impact
                if (target.isAlive()) {
                    target.takeDamage(damage);
                }
                arrow.dispose();
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const move = toTarget.normalize().scale(speed * dt);
            arrow.position.addInPlace(move);
        });
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
                const alive = this.enemyManager.getEnemies().filter(e => e.isAlive());
                if (alive.length === 0) return;
                let nearest = alive[0];
                let bestDist = Vector3.DistanceSquared(pos, nearest.getPosition());
                for (const e of alive) {
                    const d = Vector3.DistanceSquared(pos, e.getPosition());
                    if (d < bestDist) { bestDist = d; nearest = e; }
                }
                this.spawnExplosiveArrow(pos, nearest, 25, 3);
            },
        });

        return true;
    }

    private spawnExplosiveArrow(from: Vector3, target: any, damage: number, aoeRadius: number): void {
        const arrow = MeshBuilder.CreateCylinder('expArrow', {
            height: 0.8, diameter: 0.12, tessellation: 5,
        }, this.scene);
        arrow.position = new Vector3(from.x, from.y + 1.0, from.z);

        const mat = createEmissiveMaterial('expArrowMat', new Color3(1.0, 0.55, 0.1), 0.9, this.scene);
        (mat as StandardMaterial).alpha = 0.95;
        arrow.material = mat;

        const targetPos = target.getPosition().clone();
        targetPos.y += 1.0;
        arrow.lookAt(targetPos);
        arrow.rotation.x += Math.PI / 2;

        const speed = 14;
        let observer: any = null;
        observer = this.scene.onBeforeRenderObservable.add(() => {
            if (arrow.isDisposed()) {
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            const toTarget = targetPos.subtract(arrow.position);
            const dist = toTarget.length();
            if (dist < 0.5) {
                // AOE explosion on impact
                const impactPos = arrow.position.clone();
                arrow.dispose();
                this.scene.onBeforeRenderObservable.remove(observer);
                this.triggerExplosion(impactPos, damage, aoeRadius);
                return;
            }
            arrow.position.addInPlace(toTarget.normalize().scale(speed * dt));
        });
    }

    private triggerExplosion(position: Vector3, damage: number, radius: number): void {
        // Damage all enemies in radius
        for (const e of this.enemyManager.getEnemies()) {
            if (!e.isAlive()) continue;
            if (Vector3.Distance(position, e.getPosition()) <= radius) {
                e.takeDamage(damage);
            }
        }

        // Visual: expanding orange ring
        const ring = MeshBuilder.CreateTorus('expRing', {
            diameter: 1.0, thickness: 0.4, tessellation: 20,
        }, this.scene);
        ring.position = new Vector3(position.x, position.y, position.z);
        const mat = createEmissiveMaterial('expRingMat', new Color3(1.0, 0.4, 0.0), 0.9, this.scene);
        (mat as StandardMaterial).alpha = 0.85;
        ring.material = mat;

        const targetScale = radius * 2;
        const expandAnim = new Animation('expExpand', 'scaling', 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
        expandAnim.setKeys([
            { frame: 0,  value: new Vector3(0.5, 1, 0.5) },
            { frame: 12, value: new Vector3(targetScale, 1, targetScale) },
        ]);
        const fadeAnim = new Animation('expFade', 'material.alpha', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        fadeAnim.setKeys([
            { frame: 0,  value: 0.85 },
            { frame: 12, value: 0.0 },
        ]);
        ring.animations = [expandAnim, fadeAnim];
        this.scene.beginAnimation(ring, 0, 12, false, 1, () => ring.dispose());

        // Particle burst
        const ps = new ParticleSystem('expBurst', 40, this.scene);
        ps.emitter = new Vector3(position.x, position.y + 0.5, position.z);
        ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0, 0.3);
        ps.color1 = new Color4(1, 0.6, 0.1, 1);
        ps.color2 = new Color4(1, 0.3, 0, 1);
        ps.colorDead = new Color4(0.4, 0.1, 0, 0);
        ps.minSize = 0.2;
        ps.maxSize = 0.6;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.6;
        ps.emitRate = 150;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-2, 2, -2);
        ps.direction2 = new Vector3(2, 4, 2);
        ps.minEmitPower = 2;
        ps.maxEmitPower = 5;
        ps.gravity = new Vector3(0, -6, 0);
        ps.start();
        setTimeout(() => {
            try { ps.stop(); } catch { /* already disposed */ }
            setTimeout(() => {
                try { ps.dispose(); } catch { /* already disposed */ }
            }, 600);
        }, 150);
    }

    // ========================================================================
    // Legacy abilities (chainLightning, fortify, goldRush)
    // ========================================================================

    private activateChainLightning(position: Vector3): boolean {
        const baseDamage = 80;
        const chainCount = 4;
        const decayRate = 0.7;
        const chainRange = 6;

        const firstTarget = this.enemyManager.getClosestEnemy(position, 8);
        if (!firstTarget || !firstTarget.isAlive()) return false;

        let currentTarget = firstTarget;
        let currentDamage = baseDamage;
        const hitEnemies = new Set<any>();
        hitEnemies.add(currentTarget);

        currentTarget.takeDamage(currentDamage);
        const chainPositions: Vector3[] = [currentTarget.getPosition().clone()];

        for (let i = 0; i < chainCount; i++) {
            currentDamage *= decayRate;
            const enemiesInRange = this.enemyManager.getEnemiesInRange(currentTarget.getPosition(), chainRange);
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
        const lightningColor = new Color3(0.6, 0.6, 1.0);

        for (let i = 0; i < positions.length - 1; i++) {
            const start = positions[i].clone();
            start.y += 1.5;
            const end = positions[i + 1].clone();
            end.y += 1.5;

            const distance = Vector3.Distance(start, end);
            const bolt = MeshBuilder.CreateCylinder(`bolt_${i}`, {
                height: distance, diameter: 0.15, tessellation: 4
            }, this.scene);
            const mid = Vector3.Lerp(start, end, 0.5);
            bolt.position = mid;

            const direction = end.subtract(start).normalize();
            const up = new Vector3(0, 1, 0);
            const cross = Vector3.Cross(up, direction);
            const dot = Vector3.Dot(up, direction);
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (cross.length() > 0.001) {
                bolt.rotationQuaternion = null;
                const axis = cross.normalize();
                bolt.rotation.x = axis.x * angle;
                bolt.rotation.y = axis.y * angle;
                bolt.rotation.z = axis.z * angle;
                bolt.lookAt(end);
                bolt.rotation.x += Math.PI / 2;
            }

            bolt.material = createEmissiveMaterial(`boltMat_${i}`, lightningColor, 0.9, this.scene);
            (bolt.material as StandardMaterial).alpha = 0.9;
            setTimeout(() => bolt.dispose(), 300);
        }

        for (const pos of positions) {
            const flash = MeshBuilder.CreateIcoSphere(`lightningFlash`, {
                radius: 0.5, subdivisions: 1
            }, this.scene);
            flash.position = new Vector3(pos.x, pos.y + 1.5, pos.z);
            flash.material = createEmissiveMaterial('flashMat', lightningColor, 1.0, this.scene);
            (flash.material as StandardMaterial).alpha = 0.8;
            setTimeout(() => flash.dispose(), 200);
        }

        if (positions.length > 0) {
            const ps = new ParticleSystem('lightningBurst', 30, this.scene);
            ps.emitter = new Vector3(positions[0].x, positions[0].y + 1.5, positions[0].z);
            ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
            ps.maxEmitBox = new Vector3(0.3, 0, 0.3);
            ps.color1 = new Color4(0.6, 0.6, 1, 1);
            ps.color2 = new Color4(0.8, 0.8, 1, 1);
            ps.colorDead = new Color4(0.3, 0.3, 0.5, 0);
            ps.minSize = 0.1;
            ps.maxSize = 0.3;
            ps.minLifeTime = 0.2;
            ps.maxLifeTime = 0.5;
            ps.emitRate = 100;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.direction1 = new Vector3(-1, 1, -1);
            ps.direction2 = new Vector3(1, 2, 1);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 3;
            ps.start();
            setTimeout(() => {
                try { ps.stop(); } catch { /* already disposed */ }
                setTimeout(() => {
                    try { ps.dispose(); } catch { /* already disposed */ }
                }, 500);
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

        const ring = MeshBuilder.CreateDisc('fortifyRing', {
            radius: 0.5, tessellation: 32
        }, this.scene);
        ring.position = center;
        ring.rotation.x = Math.PI / 2;
        const ringMat = new StandardMaterial('fortifyRingMat', this.scene);
        ringMat.diffuseColor = new Color3(1, 0.85, 0.2);
        ringMat.emissiveColor = new Color3(0.8, 0.65, 0.1);
        ringMat.alpha = 0.5;
        ringMat.disableLighting = true;
        ring.material = ringMat;

        const expandAnim = new Animation('fortifyExpand', 'scaling', 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
        expandAnim.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 30, value: new Vector3(80, 80, 1) }
        ]);
        const fadeAnim = new Animation('fortifyFade', 'material.alpha', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        fadeAnim.setKeys([
            { frame: 0, value: 0.5 },
            { frame: 30, value: 0 }
        ]);
        ring.animations = [expandAnim, fadeAnim];
        this.scene.beginAnimation(ring, 0, 30, false, 1, () => ring.dispose());
    }

    private activateGoldRush(): boolean {
        if (!this.playerStats) return false;
        const enemies = this.enemyManager.getEnemies();
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
        const enemies = this.enemyManager.getEnemies();
        for (const enemy of enemies) {
            if (enemy.isAlive()) {
                const ePos = enemy.getPosition();
                const ps = new ParticleSystem('goldRainPS', 15, this.scene);
                ps.emitter = new Vector3(ePos.x, ePos.y + 3, ePos.z);
                ps.minEmitBox = new Vector3(-0.5, 0, -0.5);
                ps.maxEmitBox = new Vector3(0.5, 0, 0.5);
                ps.color1 = new Color4(1, 0.85, 0.1, 1);
                ps.color2 = new Color4(1, 0.7, 0, 1);
                ps.colorDead = new Color4(0.6, 0.5, 0, 0);
                ps.minSize = 0.15;
                ps.maxSize = 0.3;
                ps.minLifeTime = 0.5;
                ps.maxLifeTime = 1.0;
                ps.emitRate = 30;
                ps.direction1 = new Vector3(-0.3, -2, -0.3);
                ps.direction2 = new Vector3(0.3, -1, 0.3);
                ps.minEmitPower = 1;
                ps.maxEmitPower = 2;
                ps.gravity = new Vector3(0, -5, 0);
                ps.start();
                setTimeout(() => {
                    try { ps.stop(); } catch { /* already disposed */ }
                    setTimeout(() => {
                        try { ps.dispose(); } catch { /* already disposed */ }
                    }, 1000);
                }, 300);
            }
        }

        if (totalGold > 0) {
            const flash = MeshBuilder.CreatePlane('goldFlash', { size: 2 }, this.scene);
            flash.position = new Vector3(20, 5, 20);
            flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
            const flashMat = createEmissiveMaterial('goldFlashMat', new Color3(1, 0.85, 0.2), 0.9, this.scene);
            flashMat.alpha = 0.6;
            flash.material = flashMat;

            const fadeAnim = new Animation('goldFade', 'material.alpha', 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
            fadeAnim.setKeys([
                { frame: 0, value: 0.6 },
                { frame: 30, value: 0 }
            ]);
            const riseAnim = new Animation('goldRise', 'position.y', 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
            riseAnim.setKeys([
                { frame: 0, value: 5 },
                { frame: 30, value: 7 }
            ]);
            flash.animations = [fadeAnim, riseAnim];
            this.scene.beginAnimation(flash, 0, 30, false, 1, () => flash.dispose());
        }
    }

    // ========================================================================
    // Shader pre-warm — call once at run start (during loading) so every
    // ParticleSystem shader variant is compiled before the first ability fires.
    // ========================================================================

    public prewarmAbilityEffects(): void {
        const scene = this.game.getScene();
        const farAway = new Vector3(1000, -100, 1000);
        const warmups: ParticleSystem[] = [];

        // === BLENDMODE_ONEONE variant — covers meteor, frost, expBurst, lightning ===
        // All four PS share this blend mode; one prewarm pass compiles the shader.
        {
            const ps = new ParticleSystem('prewarmOneOne', 60, scene);
            ps.emitter = farAway;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.color1 = new Color4(1, 0.5, 0, 1);
            ps.color2 = new Color4(1, 0.2, 0, 1);
            ps.colorDead = new Color4(0.3, 0, 0, 0);
            ps.minSize = 0.1;
            ps.maxSize = 0.5;
            ps.minLifeTime = 0.1;
            ps.maxLifeTime = 0.5;
            ps.emitRate = 100;
            ps.direction1 = new Vector3(-2, 2, -2);
            ps.direction2 = new Vector3(2, 4, 2);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 3;
            ps.gravity = new Vector3(0, -8, 0);
            ps.manualEmitCount = 60;
            ps.start();
            warmups.push(ps);
        }

        // === BLENDMODE_STANDARD variant — covers goldRainPS (default blend mode) ===
        {
            const ps = new ParticleSystem('prewarmStandard', 15, scene);
            ps.emitter = farAway;
            // blendMode intentionally left at default (BLENDMODE_STANDARD)
            ps.color1 = new Color4(1, 0.85, 0.1, 1);
            ps.color2 = new Color4(1, 0.7, 0, 1);
            ps.colorDead = new Color4(0.6, 0.5, 0, 0);
            ps.minSize = 0.15;
            ps.maxSize = 0.3;
            ps.minLifeTime = 0.5;
            ps.maxLifeTime = 1.0;
            ps.emitRate = 30;
            ps.direction1 = new Vector3(-0.3, -2, -0.3);
            ps.direction2 = new Vector3(0.3, -1, 0.3);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 2;
            ps.gravity = new Vector3(0, -5, 0);
            ps.manualEmitCount = 15;
            ps.start();
            warmups.push(ps);
        }

        // Force a render so shaders compile now, before any ability is triggered.
        scene.render();

        for (const ps of warmups) {
            ps.stop();
            ps.dispose();
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
        const enemies = this.enemyManager.getEnemies();
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
        return this.activate('meteor', target ?? Vector3.Zero());
    }

    public dispose(): void {
        this.abilities.clear();
        this.activeEffects = [];
        this.isTargeting = false;
        this.targetingAbility = null;
    }
}
