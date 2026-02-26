import { Vector3, MeshBuilder, Color3, ParticleSystem, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Mud Tower - Combines Earth and Water elements
 * Swamp cauldron with dripping mud pipes and bubbling pool
 */
export class MudTower extends Tower {
    private areaOfEffect: number = 3;
    private mudParticles: ParticleSystem | null = null;
    private armorReducedEnemies: Map<Enemy, number> = new Map();
    private mudRing: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 8;
        const range = 5;
        const fireRate = 1.0;
        const cost = 200;

        super(game, position, range, damage, fireRate, cost);

        this.secondaryEffectChance = 0.5;
        this.statusEffectDuration = 3;
        this.statusEffectStrength = 0.5;
        this.targetPriorities = [EnemyType.FIRE, EnemyType.HEAVY];
        this.weakAgainst = [EnemyType.WIND, EnemyType.FLYING];
        this.canTargetFlying = false;

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh("mudTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Organic base (earth heritage -- rough hex) ---
            const base = MeshBuilder.CreateCylinder('mudBase', {
                height: 0.7, diameterTop: 2.0, diameterBottom: 2.3, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.35;
            base.material = createLowPolyMaterial('mudBaseMat', PALETTE.TOWER_MUD_DARK, this.scene);

            // Small rock accents
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const rock = MeshBuilder.CreatePolyhedron(`mudRock${i}`, {
                    type: 1, size: 0.12
                }, this.scene);
                makeFlatShaded(rock);
                rock.parent = this.mesh;
                rock.position.x = Math.sin(angle) * 0.9;
                rock.position.z = Math.cos(angle) * 0.9;
                rock.position.y = 0.5;
                rock.rotation.y = i * 1.5;
                rock.material = createLowPolyMaterial(`mudRockMat${i}`, PALETTE.ROCK_DARK, this.scene);
            }

            // --- 2. Stone body (earth + water blend) ---
            const body = MeshBuilder.CreateCylinder('mudBody', {
                height: 1.7, diameterTop: 1.1, diameterBottom: 1.5, tessellation: 8
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.55;
            body.material = createLowPolyMaterial('mudBodyMat', PALETTE.TOWER_MUD_WET, this.scene);

            // --- 3. Mud pool basin at top ---
            const basin = MeshBuilder.CreateTorus('mudBasin', {
                diameter: 1.3, thickness: 0.3, tessellation: 8
            }, this.scene);
            makeFlatShaded(basin);
            basin.parent = this.mesh;
            basin.position.y = 2.65;
            basin.material = createLowPolyMaterial('mudBasinMat', PALETTE.ROCK_DARK, this.scene);

            // Mud surface (water heritage -- translucent)
            const mudSurface = MeshBuilder.CreateDisc('mudSurface', {
                radius: 0.55, tessellation: 8
            }, this.scene);
            makeFlatShaded(mudSurface);
            mudSurface.parent = this.mesh;
            mudSurface.position.y = 2.7;
            mudSurface.rotation.x = -Math.PI / 2;
            const mudSurfaceMat = createEmissiveMaterial('mudSurfaceMat', PALETTE.TOWER_MUD_POOL, 0.3, this.scene);
            mudSurfaceMat.alpha = 0.85;
            mudSurface.material = mudSurfaceMat;

            // Bubbling animation
            const bubbleAnim = new Animation("mudBubble", "position.y", 15,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            bubbleAnim.setKeys([
                { frame: 0, value: 2.7 },
                { frame: 8, value: 2.74 },
                { frame: 15, value: 2.7 }
            ]);
            mudSurface.animations = [bubbleAnim];
            this.scene.beginAnimation(mudSurface, 0, 15, true);

            // --- 4. Dripping pipes (water heritage) ---
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const pipe = MeshBuilder.CreateCylinder(`mudPipe${i}`, {
                    height: 0.6, diameter: 0.2, tessellation: 6
                }, this.scene);
                makeFlatShaded(pipe);
                pipe.parent = this.mesh;
                pipe.rotation.x = Math.PI / 2;
                pipe.rotation.y = angle;
                pipe.position.x = Math.sin(angle) * 0.55;
                pipe.position.z = Math.cos(angle) * 0.55;
                pipe.position.y = 2.0;
                pipe.material = createLowPolyMaterial(`mudPipeMat${i}`, PALETTE.TOWER_MUD_DARK, this.scene);
            }

            // --- 5. Orbiting mud blobs ---
            this.mudRing = new Mesh("mudRingParent", this.scene);
            this.mudRing.parent = this.mesh;
            this.mudRing.position.y = 2.2;

            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                const blob = MeshBuilder.CreateSphere(`mudBlob${i}`, {
                    diameter: 0.25 + Math.random() * 0.12, segments: 4
                }, this.scene);
                makeFlatShaded(blob);
                blob.scaling.set(0.9, 0.6, 0.9);
                blob.parent = this.mudRing;
                blob.position.x = Math.sin(angle) * 1.0;
                blob.position.z = Math.cos(angle) * 1.0;
                blob.position.y = (i % 2) * 0.12;
                blob.material = createLowPolyMaterial(`mudBlobMat${i}`, PALETTE.TOWER_MUD_WET, this.scene);
            }

            // Ring rotation
            const ringRotate = new Animation("mudRingRotation", "rotation.y", 15,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            ringRotate.setKeys([
                { frame: 0, value: 0 },
                { frame: 180, value: Math.PI * 2 }
            ]);
            this.mudRing.animations = [ringRotate];
            this.scene.beginAnimation(this.mudRing, 0, 180, true);

            // --- 6. Water accent (glowing ring at base -- water heritage) ---
            const waterAccent = MeshBuilder.CreateTorus('mudWaterAccent', {
                diameter: 2.0, thickness: 0.04, tessellation: 8
            }, this.scene);
            makeFlatShaded(waterAccent);
            waterAccent.parent = this.mesh;
            waterAccent.position.y = 0.72;
            waterAccent.material = createEmissiveMaterial('mudWaterAccentMat', PALETTE.TOWER_WATER, 0.3, this.scene);

            // --- 7. Mud bubble particles ---
            this.createMudEffect();

        } catch (error) {
            console.error("Error creating Mud Tower mesh:", error);
        }
    }

    private createMudEffect(): void {
        if (!this.mesh) return;
        try {
            this.mudParticles = new ParticleSystem('mudParticles', 15, this.scene);
            this.mudParticles.emitter = new Vector3(this.position.x, this.position.y + 2.8, this.position.z);
            this.mudParticles.minSize = 0.08;
            this.mudParticles.maxSize = 0.2;
            this.mudParticles.minLifeTime = 0.8;
            this.mudParticles.maxLifeTime = 1.5;
            this.mudParticles.emitRate = 8;
            this.mudParticles.color1 = new Color4(0.42, 0.32, 0.18, 0.7);
            this.mudParticles.color2 = new Color4(0.38, 0.28, 0.15, 0.6);
            this.mudParticles.colorDead = new Color4(0.32, 0.22, 0.12, 0);
            this.mudParticles.direction1 = new Vector3(-0.2, 0.5, -0.2);
            this.mudParticles.direction2 = new Vector3(0.2, 0.8, 0.2);
            this.mudParticles.minEmitPower = 0.1;
            this.mudParticles.maxEmitPower = 0.3;
            this.mudParticles.gravity = new Vector3(0, -0.5, 0);
            this.mudParticles.updateSpeed = 0.01;
            this.mudParticles.start();
        } catch (error) {
            console.error("Error creating mud effect:", error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;
        this.createMudSplash(this.targetEnemy.getPosition());
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        for (const enemy of enemiesInRange) {
            if (enemy.getEnemyType() === EnemyType.FLYING) continue;
            let finalDamage = this.calculateDamage(enemy);
            if (this.armorReducedEnemies.has(enemy)) {
                finalDamage *= (1 + (this.armorReducedEnemies.get(enemy) || 0));
            }
            enemy.takeDamage(finalDamage);
            this.applyStatusEffect(enemy, StatusEffect.SLOWED, this.statusEffectDuration, this.statusEffectStrength);
            if (Math.random() < this.secondaryEffectChance) {
                this.armorReducedEnemies.set(enemy, 0.3);
                setTimeout(() => this.armorReducedEnemies.delete(enemy), this.statusEffectDuration * 1000);
            }
        }
        this.game.getAssetManager().playSound('towerShoot');
    }

    private createMudSplash(position: Vector3): void {
        try {
            const splash = new ParticleSystem('mudSplash', 30, this.scene);
            splash.emitter = position;
            splash.minEmitBox = new Vector3(-0.2, 0, -0.2);
            splash.maxEmitBox = new Vector3(0.2, 0.1, 0.2);
            splash.minSize = 0.15;
            splash.maxSize = 0.4;
            splash.minLifeTime = 0.4;
            splash.maxLifeTime = 1.0;
            splash.emitRate = 25;
            splash.color1 = new Color4(0.42, 0.32, 0.18, 0.8);
            splash.color2 = new Color4(0.38, 0.28, 0.15, 0.7);
            splash.colorDead = new Color4(0.32, 0.22, 0.12, 0);
            splash.direction1 = new Vector3(-0.8, 1, -0.8);
            splash.direction2 = new Vector3(0.8, 2, 0.8);
            splash.minEmitPower = 0.5;
            splash.maxEmitPower = 1.5;
            splash.gravity = new Vector3(0, -9.8, 0);
            splash.updateSpeed = 0.01;
            splash.start();
            setTimeout(() => { splash.stop(); setTimeout(() => splash.dispose(), 1000); }, 400);
        } catch (error) {
            console.error("Error creating mud splash:", error);
        }
    }

    private getEnemiesInRange(position: Vector3, radius: number): Enemy[] {
        if (this.targetEnemy) return [this.targetEnemy];
        return [];
    }

    public dispose(): void {
        if (this.mudParticles) { this.mudParticles.stop(); this.mudParticles.dispose(); this.mudParticles = null; }
        if (this.mudRing) this.scene.stopAnimation(this.mudRing);
        this.armorReducedEnemies.clear();
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('mudStream') || ps.name.startsWith('mudDripPS')) ps.dispose();
            });
        }
        super.dispose();
    }
}
