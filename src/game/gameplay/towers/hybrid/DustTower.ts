import { Vector3, MeshBuilder, Color3, ParticleSystem, Color4, Mesh, Animation } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Dust Tower - Combines Earth and Wind elements
 * Desert monolith with sandstone pillars, spinning vortex funnel, and orbiting dust clouds
 */
export class DustTower extends Tower {
    private areaOfEffect: number = 3.5;
    private dustParticles: ParticleSystem | null = null;
    private dustVortex: Mesh | null = null;
    private dustRing: Mesh | null = null;
    private vortexFunnel: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 7;
        const range = 6;
        const fireRate = 1.2;
        const cost = 225;

        super(game, position, range, damage, fireRate, cost);

        this.secondaryEffectChance = 0.3;
        this.statusEffectDuration = 2.5;
        this.statusEffectStrength = 0.8;
        this.targetPriorities = [EnemyType.FIRE, EnemyType.ELECTRIC];
        this.weakAgainst = [EnemyType.WATER, EnemyType.FLYING];

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh("dustTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Rough hexagonal base (earth heritage) ---
            const base = MeshBuilder.CreateCylinder('dustBase', {
                height: 0.7, diameterTop: 2.0, diameterBottom: 2.4, tessellation: 6
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.35;
            base.material = createLowPolyMaterial('dustBaseMat', PALETTE.TOWER_DUST_ROCK, this.scene);

            // Sand-coloured trim ring (wind heritage)
            const sandTrim = MeshBuilder.CreateTorus('dustSandTrim', {
                diameter: 2.1, thickness: 0.05, tessellation: 8
            }, this.scene);
            makeFlatShaded(sandTrim);
            sandTrim.parent = this.mesh;
            sandTrim.position.y = 0.72;
            sandTrim.material = createEmissiveMaterial('dustSandTrimMat', PALETTE.TOWER_DUST_VORTEX, 0.3, this.scene);

            // --- 2. Standing stone pillars around base (earth heritage) ---
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
                const pillar = MeshBuilder.CreateCylinder(`dustPillar${i}`, {
                    height: 1.0 + (i % 2) * 0.3, diameterTop: 0.15, diameterBottom: 0.25, tessellation: 5
                }, this.scene);
                makeFlatShaded(pillar);
                pillar.parent = this.mesh;
                pillar.position.x = Math.sin(angle) * 0.95;
                pillar.position.z = Math.cos(angle) * 0.95;
                pillar.position.y = 0.8 + (i % 2) * 0.15;
                pillar.rotation.x = Math.sin(angle) * 0.1;
                pillar.rotation.z = Math.cos(angle) * 0.1;
                pillar.material = createLowPolyMaterial(`dustPillarMat${i}`, PALETTE.ROCK_DARK, this.scene);
            }

            // --- 3. Sandstone body (earth + wind blend) ---
            const body = MeshBuilder.CreateCylinder('dustBody', {
                height: 1.8, diameterTop: 1.0, diameterBottom: 1.4, tessellation: 8
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.6;
            body.material = createLowPolyMaterial('dustBodyMat', PALETTE.TOWER_DUST_SAND, this.scene);

            // Wind-carved grooves (wind heritage accent)
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const groove = MeshBuilder.CreateBox(`dustGroove${i}`, {
                    width: 0.04, height: 1.4, depth: 0.04
                }, this.scene);
                groove.position = new Vector3(Math.sin(angle) * 0.42, 1.6, Math.cos(angle) * 0.42);
                groove.rotation.y = angle;
                groove.material = createEmissiveMaterial(`dustGrooveMat${i}`, PALETTE.TOWER_DUST_VORTEX, 0.3, this.scene);
                groove.parent = this.mesh;
            }

            // --- 4. Vortex funnel at top (wind heritage) ---
            this.vortexFunnel = MeshBuilder.CreateCylinder('dustFunnel', {
                height: 1.4, diameterTop: 1.6, diameterBottom: 0.8, tessellation: 8
            }, this.scene);
            makeFlatShaded(this.vortexFunnel);
            this.vortexFunnel.parent = this.mesh;
            this.vortexFunnel.position.y = 3.2;
            const funnelMat = createLowPolyMaterial('dustFunnelMat', PALETTE.TOWER_DUST_SAND, this.scene);
            funnelMat.alpha = 0.85;
            this.vortexFunnel.material = funnelMat;

            // --- 5. Spinning inner vortex (wind heritage -- translucent) ---
            this.dustVortex = MeshBuilder.CreateCylinder('dustVortex', {
                height: 1.0, diameterTop: 0.7, diameterBottom: 0.3, tessellation: 6
            }, this.scene);
            makeFlatShaded(this.dustVortex);
            this.dustVortex.parent = this.mesh;
            this.dustVortex.position.y = 3.3;
            const vortexMat = createEmissiveMaterial('dustVortexMat', PALETTE.TOWER_DUST_VORTEX, 0.4, this.scene);
            vortexMat.alpha = 0.6;
            this.dustVortex.material = vortexMat;

            // Fast vortex spin
            const vortexSpin = new Animation("dustVortexSpin", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            vortexSpin.setKeys([
                { frame: 0, value: 0 },
                { frame: 60, value: Math.PI * 2 }
            ]);
            this.dustVortex.animations = [vortexSpin];
            this.scene.beginAnimation(this.dustVortex, 0, 60, true);

            // --- 6. Rock accent polyhedra around base (earth heritage) ---
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const rock = MeshBuilder.CreatePolyhedron(`dustRock${i}`, {
                    type: i % 3, size: 0.15 + Math.random() * 0.08
                }, this.scene);
                makeFlatShaded(rock);
                rock.parent = this.mesh;
                rock.position.x = Math.sin(angle) * 1.05;
                rock.position.z = Math.cos(angle) * 1.05;
                rock.position.y = 0.3;
                rock.rotation.y = Math.random() * Math.PI;
                rock.material = createLowPolyMaterial(`dustRockMat${i}`, PALETTE.TOWER_DUST_ROCK, this.scene);
            }

            // --- 7. Orbiting dust clouds (wind heritage -- counter-rotate) ---
            this.dustRing = new Mesh("dustRingParent", this.scene);
            this.dustRing.parent = this.mesh;
            this.dustRing.position.y = 2.8;

            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const cloud = MeshBuilder.CreateSphere(`dustCloud${i}`, {
                    diameter: 0.4 + Math.random() * 0.15, segments: 4
                }, this.scene);
                makeFlatShaded(cloud);
                cloud.scaling.y = 0.4;
                cloud.parent = this.dustRing;
                cloud.position.x = Math.sin(angle) * 1.2;
                cloud.position.z = Math.cos(angle) * 1.2;
                cloud.position.y = (i % 2) * 0.12;
                const cloudMat = createLowPolyMaterial(`dustCloudMat${i}`, PALETTE.TOWER_DUST_VORTEX, this.scene);
                cloudMat.alpha = 0.6;
                cloud.material = cloudMat;
            }

            // Cloud ring counter-rotation (opposite to vortex)
            const ringRotate = new Animation("dustRingRotation", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            ringRotate.setKeys([
                { frame: 0, value: 0 },
                { frame: 120, value: -Math.PI * 2 }
            ]);
            this.dustRing.animations = [ringRotate];
            this.scene.beginAnimation(this.dustRing, 0, 120, true);

            // --- 8. Floating rune stone at funnel peak (earth heritage) ---
            const runeStone = MeshBuilder.CreatePolyhedron('dustRuneStone', {
                type: 2, size: 0.14
            }, this.scene);
            makeFlatShaded(runeStone);
            runeStone.parent = this.mesh;
            runeStone.position.y = 4.1;
            runeStone.material = createEmissiveMaterial('dustRuneStoneMat', PALETTE.TOWER_DUST_VORTEX, 0.6, this.scene);

            // Rune stone float + spin
            const runeFloat = new Animation("dustRuneFloat", "position.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            runeFloat.setKeys([
                { frame: 0, value: 4.1 },
                { frame: 40, value: 4.3 },
                { frame: 80, value: 4.1 }
            ]);
            const runeSpin = new Animation("dustRuneSpin", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            runeSpin.setKeys([
                { frame: 0, value: 0 },
                { frame: 80, value: Math.PI * 2 }
            ]);
            runeStone.animations = [runeFloat, runeSpin];
            this.scene.beginAnimation(runeStone, 0, 80, true);

            // --- 9. Swirling dust particles ---
            this.createDustEffect();

        } catch (error) {
            console.error("Error creating Dust Tower mesh:", error);
        }
    }

    private createDustEffect(): void {
        if (!this.mesh) return;
        try {
            this.dustParticles = new ParticleSystem('dustParticles', 40, this.scene);
            this.dustParticles.emitter = new Vector3(this.position.x, this.position.y + 3.8, this.position.z);
            this.dustParticles.minSize = 0.08;
            this.dustParticles.maxSize = 0.25;
            this.dustParticles.minLifeTime = 1.0;
            this.dustParticles.maxLifeTime = 2.0;
            this.dustParticles.emitRate = 18;
            this.dustParticles.color1 = new Color4(0.72, 0.62, 0.45, 0.7);
            this.dustParticles.color2 = new Color4(0.62, 0.52, 0.38, 0.6);
            this.dustParticles.colorDead = new Color4(0.50, 0.42, 0.30, 0);
            this.dustParticles.direction1 = new Vector3(-0.6, 0.2, -0.6);
            this.dustParticles.direction2 = new Vector3(0.6, 0.5, 0.6);
            this.dustParticles.minEmitPower = 0.3;
            this.dustParticles.maxEmitPower = 0.8;
            this.dustParticles.gravity = new Vector3(0, -0.1, 0);
            this.dustParticles.updateSpeed = 0.01;
            this.dustParticles.start();
        } catch (error) {
            console.error("Error creating dust effect:", error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;
        this.createDustCloud(this.targetEnemy.getPosition());
        const enemiesInRange = this.getEnemiesInRange(this.targetEnemy.getPosition(), this.areaOfEffect);
        for (const enemy of enemiesInRange) {
            let finalDamage = this.calculateDamage(enemy);
            enemy.takeDamage(finalDamage);
            this.applyStatusEffect(enemy, StatusEffect.CONFUSED, this.statusEffectDuration, this.statusEffectStrength);
            if (Math.random() < this.secondaryEffectChance) {
                this.applyStatusEffect(enemy, StatusEffect.STUNNED, 0.5, 1.0);
            }
        }
        this.game.getAssetManager().playSound('towerShoot');
    }

    private createDustCloud(position: Vector3): void {
        try {
            const dustCloudPS = new ParticleSystem('dustCloudEffect', 60, this.scene);
            dustCloudPS.emitter = new Vector3(position.x, 0.5, position.z);
            dustCloudPS.minEmitBox = new Vector3(-0.5, 0, -0.5);
            dustCloudPS.maxEmitBox = new Vector3(0.5, 0.2, 0.5);
            dustCloudPS.minSize = 0.2;
            dustCloudPS.maxSize = 0.5;
            dustCloudPS.minLifeTime = 0.6;
            dustCloudPS.maxLifeTime = 1.2;
            dustCloudPS.emitRate = 40;
            dustCloudPS.color1 = new Color4(0.72, 0.62, 0.45, 0.7);
            dustCloudPS.color2 = new Color4(0.62, 0.52, 0.38, 0.6);
            dustCloudPS.colorDead = new Color4(0.50, 0.42, 0.30, 0);
            dustCloudPS.direction1 = new Vector3(-0.6, 0.1, -0.6);
            dustCloudPS.direction2 = new Vector3(0.6, 0.4, 0.6);
            dustCloudPS.minEmitPower = 0.2;
            dustCloudPS.maxEmitPower = 0.6;
            dustCloudPS.gravity = new Vector3(0, -0.1, 0);
            dustCloudPS.updateSpeed = 0.01;
            dustCloudPS.start();
            setTimeout(() => { dustCloudPS.stop(); setTimeout(() => dustCloudPS.dispose(), 1500); }, 600);
        } catch (error) {
            console.error("Error creating dust cloud:", error);
        }
    }

    private getEnemiesInRange(position: Vector3, radius: number): Enemy[] {
        if (this.targetEnemy) return [this.targetEnemy];
        return [];
    }

    public dispose(): void {
        if (this.dustParticles) { this.dustParticles.stop(); this.dustParticles.dispose(); this.dustParticles = null; }
        if (this.dustVortex) this.scene.stopAnimation(this.dustVortex);
        if (this.dustRing) this.scene.stopAnimation(this.dustRing);
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('dustCloudPS') || ps.name.startsWith('rockDustPS')) ps.dispose();
            });
        }
        super.dispose();
    }
}
