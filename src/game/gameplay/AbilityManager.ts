import { Vector3, Color3, Color4, MeshBuilder, ParticleSystem, Animation, Scene, Mesh, StandardMaterial } from '@babylonjs/core';
import { Game } from '../Game';
import { EnemyManager } from './EnemyManager';
import { PlayerStats } from './PlayerStats';
import { TowerManager } from './TowerManager';
import { StatusEffect } from './towers/Tower';
import { createEmissiveMaterial } from '../rendering/LowPolyMaterial';

export interface Ability {
    name: string;
    cooldown: number;      // Total cooldown in seconds
    currentCooldown: number; // Time remaining on cooldown
    isReady: boolean;
    needsTargeting: boolean; // true = click-to-target, false = instant cast
}

export class AbilityManager {
    private game: Game;
    private scene: Scene;
    private enemyManager: EnemyManager;
    private playerStats: PlayerStats | null = null;
    private towerManager: TowerManager | null = null;
    private abilities: Map<string, Ability> = new Map();

    // Targeting state
    private isTargeting: boolean = false;
    private targetingAbility: string | null = null;

    constructor(game: Game, enemyManager: EnemyManager) {
        this.game = game;
        this.scene = game.getScene();
        this.enemyManager = enemyManager;

        // Register abilities
        this.abilities.set('meteor', {
            name: 'Meteor Strike',
            cooldown: 45,
            currentCooldown: 0,
            isReady: true,
            needsTargeting: true
        });

        this.abilities.set('frostNova', {
            name: 'Frost Nova',
            cooldown: 30,
            currentCooldown: 0,
            isReady: true,
            needsTargeting: false
        });

        this.abilities.set('chainLightning', {
            name: 'Chain Lightning',
            cooldown: 35,
            currentCooldown: 0,
            isReady: true,
            needsTargeting: true
        });

        this.abilities.set('fortify', {
            name: 'Fortify',
            cooldown: 60,
            currentCooldown: 0,
            isReady: true,
            needsTargeting: false
        });

        this.abilities.set('goldRush', {
            name: 'Gold Rush',
            cooldown: 90,
            currentCooldown: 0,
            isReady: true,
            needsTargeting: false
        });
    }

    public setPlayerStats(stats: PlayerStats): void {
        this.playerStats = stats;
    }

    public setTowerManager(manager: TowerManager): void {
        this.towerManager = manager;
    }

    /**
     * Update cooldowns
     */
    public update(deltaTime: number): void {
        this.abilities.forEach((ability) => {
            if (!ability.isReady) {
                ability.currentCooldown -= deltaTime;
                if (ability.currentCooldown <= 0) {
                    ability.currentCooldown = 0;
                    ability.isReady = true;
                }
            }
        });
    }

    /**
     * Get an ability by ID
     */
    public getAbility(id: string): Ability | undefined {
        return this.abilities.get(id);
    }

    /**
     * Check if currently in targeting mode
     */
    public getIsTargeting(): boolean {
        return this.isTargeting;
    }

    /**
     * Get the ability being targeted
     */
    public getTargetingAbility(): string | null {
        return this.targetingAbility;
    }

    /**
     * Start targeting mode for an ability
     */
    public startTargeting(abilityId: string): boolean {
        const ability = this.abilities.get(abilityId);
        if (!ability || !ability.isReady || !ability.needsTargeting) return false;

        this.isTargeting = true;
        this.targetingAbility = abilityId;
        return true;
    }

    /**
     * Cancel targeting mode
     */
    public cancelTargeting(): void {
        this.isTargeting = false;
        this.targetingAbility = null;
    }

    /**
     * Activate an ability. For targeting abilities, provide a position.
     */
    public activate(abilityId: string, position?: Vector3): boolean {
        const ability = this.abilities.get(abilityId);
        if (!ability || !ability.isReady) return false;

        let success = false;

        switch (abilityId) {
            case 'meteor':
                if (position) {
                    success = this.activateMeteor(position);
                }
                break;
            case 'frostNova':
                success = this.activateFrostNova();
                break;
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
        }

        return success;
    }

    // ========================================================================
    // Meteor Strike — 100 damage in radius 4
    // ========================================================================
    private activateMeteor(position: Vector3): boolean {
        const radius = 4;
        const damage = 100;

        // Deal damage to all enemies in range
        const enemies = this.enemyManager.getEnemiesInRange(position, radius);
        for (const enemy of enemies) {
            enemy.takeDamage(damage);
        }

        // Visual: fireball descending + impact ring
        this.createMeteorVisual(position, radius);

        return true;
    }

    private createMeteorVisual(position: Vector3, radius: number): void {
        // Fireball mesh descending from above
        const fireball = MeshBuilder.CreateIcoSphere('meteorBall', {
            radius: 0.8, subdivisions: 1
        }, this.scene);
        fireball.position = new Vector3(position.x, position.y + 15, position.z);
        fireball.material = createEmissiveMaterial('meteorMat', new Color3(1, 0.3, 0), 0.9, this.scene);

        // Animate descent
        const descentAnim = new Animation('meteorDescent', 'position.y', 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        descentAnim.setKeys([
            { frame: 0, value: position.y + 15 },
            { frame: 12, value: position.y + 0.5 }
        ]);
        fireball.animations = [descentAnim];

        this.scene.beginAnimation(fireball, 0, 12, false, 1, () => {
            fireball.dispose();

            // Impact ring expanding outward
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

            // Impact particles
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
            setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 800); }, 200);
        });
    }

    // ========================================================================
    // Frost Nova — freeze ALL enemies for 2.5 seconds
    // ========================================================================
    private activateFrostNova(): boolean {
        const enemies = this.enemyManager.getEnemies();
        const duration = 2.5;

        for (const enemy of enemies) {
            if (enemy.isAlive()) {
                enemy.applyStatusEffect(StatusEffect.FROZEN, duration, 1.0);
            }
        }

        // Visual: blue wave expanding from map center
        this.createFrostNovaVisual();

        return true;
    }

    private createFrostNovaVisual(): void {
        // Get map center (approximate)
        const center = new Vector3(20, 0.1, 20);

        // Expanding frost ring
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

        // Ice particles scattered across the map
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
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 1500); }, 300);
    }

    // ========================================================================
    // Chain Lightning — 80 dmg to closest, chains to 4 more at 70% decay
    // ========================================================================
    private activateChainLightning(position: Vector3): boolean {
        const baseDamage = 80;
        const chainCount = 4;
        const decayRate = 0.7;
        const chainRange = 6;

        // Find closest enemy to click position
        const firstTarget = this.enemyManager.getClosestEnemy(position, 8);
        if (!firstTarget || !firstTarget.isAlive()) return false;

        let currentTarget = firstTarget;
        let currentDamage = baseDamage;
        const hitEnemies = new Set<any>();
        hitEnemies.add(currentTarget);

        // Hit first target
        currentTarget.takeDamage(currentDamage);
        const chainPositions: Vector3[] = [currentTarget.getPosition().clone()];

        // Chain to additional targets
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

        // Create bolt segments between each pair of positions
        for (let i = 0; i < positions.length - 1; i++) {
            const start = positions[i].clone();
            start.y += 1.5;
            const end = positions[i + 1].clone();
            end.y += 1.5;

            // Bolt mesh (thin cylinder)
            const distance = Vector3.Distance(start, end);
            const bolt = MeshBuilder.CreateCylinder(`bolt_${i}`, {
                height: distance, diameter: 0.15, tessellation: 4
            }, this.scene);
            const mid = Vector3.Lerp(start, end, 0.5);
            bolt.position = mid;

            // Orient bolt towards target
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
                // Use lookAt approach instead
                bolt.lookAt(end);
                bolt.rotation.x += Math.PI / 2;
            }

            bolt.material = createEmissiveMaterial(`boltMat_${i}`, lightningColor, 0.9, this.scene);
            (bolt.material as StandardMaterial).alpha = 0.9;

            setTimeout(() => bolt.dispose(), 300);
        }

        // Impact flash at each hit position
        for (const pos of positions) {
            const flash = MeshBuilder.CreateIcoSphere(`lightningFlash`, {
                radius: 0.5, subdivisions: 1
            }, this.scene);
            flash.position = new Vector3(pos.x, pos.y + 1.5, pos.z);
            flash.material = createEmissiveMaterial('flashMat', lightningColor, 1.0, this.scene);
            (flash.material as StandardMaterial).alpha = 0.8;
            setTimeout(() => flash.dispose(), 200);
        }

        // Particle burst at first target
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
            setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 150);
        }
    }

    // ========================================================================
    // Fortify — Heal 3 HP + all towers +50% fire rate for 8s
    // ========================================================================
    private activateFortify(): boolean {
        if (!this.playerStats || !this.towerManager) return false;

        // Heal player
        this.playerStats.heal(3);

        // Boost all towers
        const towers = this.towerManager.getTowers();
        for (const tower of towers) {
            tower.applyFireRateBoost(1.5, 8);
        }

        this.createFortifyVisual();
        return true;
    }

    private createFortifyVisual(): void {
        const center = new Vector3(20, 0.1, 20);

        // Golden expanding ring
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

        // Golden sparkle particles on each tower
        if (this.towerManager) {
            for (const tower of this.towerManager.getTowers()) {
                const tPos = tower.getPosition();
                const ps = new ParticleSystem('fortifySparkle', 20, this.scene);
                ps.emitter = new Vector3(tPos.x, tPos.y + 2, tPos.z);
                ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
                ps.maxEmitBox = new Vector3(0.3, 0.5, 0.3);
                ps.color1 = new Color4(1, 0.85, 0.2, 1);
                ps.color2 = new Color4(1, 0.7, 0.1, 1);
                ps.colorDead = new Color4(0.5, 0.4, 0, 0);
                ps.minSize = 0.08;
                ps.maxSize = 0.2;
                ps.minLifeTime = 0.3;
                ps.maxLifeTime = 0.8;
                ps.emitRate = 40;
                ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
                ps.direction1 = new Vector3(-0.3, 1, -0.3);
                ps.direction2 = new Vector3(0.3, 2, 0.3);
                ps.minEmitPower = 0.5;
                ps.maxEmitPower = 1.5;
                ps.start();
                setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 800); }, 400);
            }
        }
    }

    // ========================================================================
    // Gold Rush — All alive enemies drop 50% bonus gold
    // ========================================================================
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
        // Gold coins raining on each alive enemy
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
                setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 1000); }, 300);
            }
        }

        // Floating text showing total gold gained
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

    public dispose(): void {
        this.abilities.clear();
        this.isTargeting = false;
        this.targetingAbility = null;
    }
}
