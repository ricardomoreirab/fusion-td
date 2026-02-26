import { Vector3, MeshBuilder, Color3, ParticleSystem, Color4, Mesh, Animation, StandardMaterial } from '@babylonjs/core';
import { Game } from '../../../Game';
import { Tower, ElementType, StatusEffect, EnemyType } from '../Tower';
import { Enemy } from '../../enemies/Enemy';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../../rendering/LowPolyMaterial';
import { PALETTE } from '../../../rendering/StyleConstants';

/**
 * Ice Tower - Combines Water and Wind elements
 * Frozen crystalline spire with orbiting snowflakes and frost aura
 */
export class IceTower extends Tower {
    private iceParticles: ParticleSystem | null = null;
    private frozenEnemies: Set<Enemy> = new Set();
    private spire: Mesh | null = null;
    private iceRing: Mesh | null = null;

    constructor(game: Game, position: Vector3) {
        const damage = 10;
        const range = 6.5;
        const fireRate = 1.2;
        const cost = 225;

        super(game, position, range, damage, fireRate, cost);

        this.secondaryEffectChance = 0.3;
        this.statusEffectDuration = 2;
        this.statusEffectStrength = 0.6;
        this.targetPriorities = [EnemyType.FIRE, EnemyType.FLYING];
        this.weakAgainst = [EnemyType.EARTH];

        this.createMesh();
    }

    protected createMesh(): void {
        try {
            this.mesh = new Mesh("iceTowerRoot", this.scene);
            this.mesh.position = this.position.clone();

            // --- 1. Frost-covered octagonal base (water heritage) ---
            const base = MeshBuilder.CreateCylinder('iceBase', {
                height: 0.6, diameterTop: 1.8, diameterBottom: 2.1, tessellation: 8
            }, this.scene);
            makeFlatShaded(base);
            base.parent = this.mesh;
            base.position.y = 0.3;
            base.material = createLowPolyMaterial('iceBaseMat', PALETTE.TOWER_ICE_FROST, this.scene);

            // Frost trim ring
            const frostTrim = MeshBuilder.CreateTorus('frostTrim', {
                diameter: 1.9, thickness: 0.05, tessellation: 8
            }, this.scene);
            makeFlatShaded(frostTrim);
            frostTrim.parent = this.mesh;
            frostTrim.position.y = 0.62;
            frostTrim.material = createEmissiveMaterial('frostTrimMat', PALETTE.TOWER_ICE_DEEP, 0.4, this.scene);

            // --- 2. Frozen column body ---
            const body = MeshBuilder.CreateCylinder('iceBody', {
                height: 1.8, diameterTop: 0.8, diameterBottom: 1.1, tessellation: 8
            }, this.scene);
            makeFlatShaded(body);
            body.parent = this.mesh;
            body.position.y = 1.5;
            body.material = createLowPolyMaterial('iceBodyMat', PALETTE.TOWER_ICE_CRYSTAL, this.scene);

            // --- 3. Tall ice spire ---
            this.spire = MeshBuilder.CreateCylinder('iceSpire', {
                height: 2.2, diameterTop: 0.08, diameterBottom: 0.7, tessellation: 8
            }, this.scene);
            makeFlatShaded(this.spire);
            this.spire.parent = this.mesh;
            this.spire.position.y = 3.5;
            const spireMat = createEmissiveMaterial('iceSPireMat', PALETTE.TOWER_ICE_CRYSTAL, 0.3, this.scene);
            spireMat.alpha = 0.8;
            this.spire.material = spireMat;

            // --- 4. Crystal formations around base (water + wind) ---
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const crystal = MeshBuilder.CreateCylinder(`iceCrystal${i}`, {
                    height: 0.6 + Math.random() * 0.4, diameterTop: 0, diameterBottom: 0.15, tessellation: 4
                }, this.scene);
                makeFlatShaded(crystal);
                crystal.parent = this.mesh;
                crystal.position.x = Math.sin(angle) * (0.8 + Math.random() * 0.2);
                crystal.position.z = Math.cos(angle) * (0.8 + Math.random() * 0.2);
                crystal.position.y = 0.5 + Math.random() * 0.2;
                crystal.rotation.x = Math.sin(angle) * 0.2;
                crystal.rotation.z = Math.cos(angle) * 0.2;
                const crystalMat = createEmissiveMaterial(`iceCrystalMat${i}`, PALETTE.TOWER_ICE_DEEP, 0.3, this.scene);
                crystalMat.alpha = 0.7;
                crystal.material = crystalMat;
            }

            // --- 5. Orbiting frost motes ring ---
            this.iceRing = new Mesh("iceRingParent", this.scene);
            this.iceRing.parent = this.mesh;
            this.iceRing.position.y = 2.8;

            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const mote = MeshBuilder.CreatePolyhedron(`iceMote${i}`, {
                    type: 2, size: 0.06 + Math.random() * 0.04
                }, this.scene);
                makeFlatShaded(mote);
                mote.parent = this.iceRing;
                mote.position.x = Math.sin(angle) * 1.1;
                mote.position.z = Math.cos(angle) * 1.1;
                mote.position.y = (i % 2) * 0.15;
                mote.material = createEmissiveMaterial(`icMoteMat${i}`, PALETTE.TOWER_ICE_FROST, 0.6, this.scene);
            }

            // Ice ring rotation (slow, majestic)
            const ringRotate = new Animation("iceRingRotation", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            ringRotate.setKeys([
                { frame: 0, value: 0 },
                { frame: 300, value: Math.PI * 2 }
            ]);
            this.iceRing.animations = [ringRotate];
            this.scene.beginAnimation(this.iceRing, 0, 300, true);

            // --- 6. Emissive tip crystal ---
            const tipCrystal = MeshBuilder.CreatePolyhedron('iceTip', {
                type: 2, size: 0.12
            }, this.scene);
            makeFlatShaded(tipCrystal);
            tipCrystal.parent = this.mesh;
            tipCrystal.position.y = 4.7;
            tipCrystal.material = createEmissiveMaterial('iceTipMat', PALETTE.TOWER_ICE_DEEP, 0.8, this.scene);

            // Tip pulse animation
            const tipPulse = new Animation("iceTipPulse", "scaling", 30,
                Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
            tipPulse.setKeys([
                { frame: 0, value: new Vector3(1, 1, 1) },
                { frame: 30, value: new Vector3(1.2, 1.2, 1.2) },
                { frame: 60, value: new Vector3(1, 1, 1) }
            ]);
            tipCrystal.animations = [tipPulse];
            this.scene.beginAnimation(tipCrystal, 0, 60, true);

            // --- 7. Frost particle effect ---
            this.createIceEffect();

        } catch (error) {
            console.error("Error creating Ice Tower mesh:", error);
        }
    }

    private createIceEffect(): void {
        if (!this.mesh) return;
        try {
            this.iceParticles = new ParticleSystem('iceParticles', 30, this.scene);
            this.iceParticles.emitter = new Vector3(this.position.x, this.position.y + 4.0, this.position.z);
            this.iceParticles.minSize = 0.04;
            this.iceParticles.maxSize = 0.12;
            this.iceParticles.minLifeTime = 1.5;
            this.iceParticles.maxLifeTime = 2.5;
            this.iceParticles.emitRate = 15;
            this.iceParticles.color1 = new Color4(0.8, 0.9, 1.0, 0.7);
            this.iceParticles.color2 = new Color4(0.7, 0.8, 1.0, 0.6);
            this.iceParticles.colorDead = new Color4(0.6, 0.7, 0.9, 0.0);
            this.iceParticles.direction1 = new Vector3(-0.5, -0.2, -0.5);
            this.iceParticles.direction2 = new Vector3(0.5, 0.0, 0.5);
            this.iceParticles.minEmitPower = 0.3;
            this.iceParticles.maxEmitPower = 0.7;
            this.iceParticles.gravity = new Vector3(0, -0.1, 0);
            this.iceParticles.updateSpeed = 0.01;
            this.iceParticles.start();
        } catch (error) {
            console.error("Error creating ice effect:", error);
        }
    }

    protected fire(): void {
        if (!this.targetEnemy) return;
        let finalDamage = this.calculateDamage(this.targetEnemy);
        this.targetEnemy.takeDamage(finalDamage);
        this.applyStatusEffect(this.targetEnemy, StatusEffect.SLOWED, this.statusEffectDuration, this.statusEffectStrength);
        if (Math.random() < this.secondaryEffectChance) {
            this.applyStatusEffect(this.targetEnemy, StatusEffect.FROZEN, 1.0, 1.0);
            this.frozenEnemies.add(this.targetEnemy);
            setTimeout(() => { this.frozenEnemies.delete(this.targetEnemy!); }, 1000);
        }
        this.createProjectileEffect(this.targetEnemy.getPosition());
        this.game.getAssetManager().playSound('towerShoot');
    }

    protected calculateDamage(enemy: Enemy): number {
        let damage = super.calculateDamage(enemy);
        if (this.frozenEnemies.has(enemy)) damage *= 2.0;
        return damage;
    }

    public dispose(): void {
        if (this.iceParticles) { this.iceParticles.stop(); this.iceParticles.dispose(); this.iceParticles = null; }
        if (this.iceRing) { this.scene.stopAnimation(this.iceRing); }
        this.frozenEnemies.clear();
        if (this.mesh) {
            this.scene.particleSystems.forEach(ps => {
                if (ps.name.startsWith('snowflakePS') || ps.name.startsWith('frostPS')) ps.dispose();
            });
        }
        super.dispose();
    }
}
