import { Vector3, MeshBuilder, Color3, Mesh, Animation, ParticleSystem, Color4 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class AOETower extends Tower {
    constructor(game: Game, position: Vector3) {
        super(game, position, 15, 5, 2, 150);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("aoeTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Ornate hexagonal base with glow trim ---
        const baseOuter = MeshBuilder.CreateCylinder('aoeBaseOuter', {
            height: 0.3, diameterTop: 2.0, diameterBottom: 2.2, tessellation: 6
        }, this.scene);
        baseOuter.position = new Vector3(0, 0.15, 0);
        baseOuter.material = createLowPolyMaterial('aoeBaseOuterMat', PALETTE.ROCK_DARK, this.scene);
        makeFlatShaded(baseOuter);
        baseOuter.parent = this.mesh;

        // Emissive trim ring at base
        const baseTrim = MeshBuilder.CreateTorus('baseTrim', {
            diameter: 2.1, thickness: 0.06, tessellation: 8
        }, this.scene);
        baseTrim.position = new Vector3(0, 0.32, 0);
        baseTrim.material = createEmissiveMaterial('baseTrimMat', PALETTE.TOWER_AOE_CRYSTAL, 0.5, this.scene);
        makeFlatShaded(baseTrim);
        baseTrim.parent = this.mesh;

        const baseInner = MeshBuilder.CreateCylinder('aoeBaseInner', {
            height: 0.2, diameterTop: 1.85, diameterBottom: 2.0, tessellation: 6
        }, this.scene);
        baseInner.position = new Vector3(0, 0.4, 0);
        baseInner.material = createLowPolyMaterial('aoeBaseInnerMat', PALETTE.TOWER_AOE, this.scene);
        makeFlatShaded(baseInner);
        baseInner.parent = this.mesh;

        // --- 2. Arcane pillar with carved channels ---
        const pillar = MeshBuilder.CreateCylinder('aoePillar', {
            height: 1.4, diameterTop: 0.5, diameterBottom: 0.8, tessellation: 6
        }, this.scene);
        pillar.position = new Vector3(0, 1.2, 0);
        pillar.material = createLowPolyMaterial('aoePillarMat', PALETTE.TOWER_AOE, this.scene);
        makeFlatShaded(pillar);
        pillar.parent = this.mesh;

        // Pillar glow channels (vertical strips)
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const channel = MeshBuilder.CreateBox(`channel${i}`, {
                width: 0.04, height: 1.2, depth: 0.04
            }, this.scene);
            channel.position = new Vector3(
                Math.sin(angle) * 0.35,
                1.2,
                Math.cos(angle) * 0.35
            );
            channel.material = createEmissiveMaterial(`channelMat${i}`, PALETTE.TOWER_AOE_CRYSTAL, 0.6, this.scene);
            channel.parent = this.mesh;
        }

        // --- 3. Crystal cradle platform ---
        const cradle = MeshBuilder.CreateCylinder('cradle', {
            height: 0.15, diameterTop: 1.0, diameterBottom: 0.7, tessellation: 6
        }, this.scene);
        cradle.position = new Vector3(0, 1.97, 0);
        cradle.material = createLowPolyMaterial('cradleMat', PALETTE.TOWER_AOE, this.scene);
        makeFlatShaded(cradle);
        cradle.parent = this.mesh;

        // --- 4. Orbiting crystal ring ---
        const crystalRing = new Mesh("crystalRing", this.scene);
        crystalRing.position = new Vector3(0, 2.3, 0);
        crystalRing.parent = this.mesh;

        const crystalMat = createEmissiveMaterial('aoeCrystalMat', PALETTE.TOWER_AOE_CRYSTAL, 0.7, this.scene);

        // 5 orbiting crystals (octahedra)
        const crystalCount = 5;
        for (let i = 0; i < crystalCount; i++) {
            const angle = (i / crystalCount) * Math.PI * 2;
            const radius = 0.55;

            const crystal = MeshBuilder.CreatePolyhedron(`aoeCrystal${i}`, {
                type: 1, size: 0.18
            }, this.scene);

            crystal.position = new Vector3(
                Math.cos(angle) * radius,
                0,
                Math.sin(angle) * radius
            );
            crystal.rotation.x = Math.cos(angle) * 0.4;
            crystal.rotation.z = -Math.sin(angle) * 0.4;
            crystal.rotation.y = angle;
            crystal.material = crystalMat;
            makeFlatShaded(crystal);
            crystal.parent = crystalRing;
        }

        // Crystal ring orbit animation
        const orbitAnim = new Animation("crystalOrbit", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        orbitAnim.setKeys([
            { frame: 0, value: 0 },
            { frame: 120, value: Math.PI * 2 }
        ]);
        crystalRing.animations = [orbitAnim];
        this.scene.beginAnimation(crystalRing, 0, 120, true);

        // --- 5. Central floating gem (large, pulsing) ---
        const centerGem = MeshBuilder.CreatePolyhedron('aoeGem', {
            type: 1, size: 0.3
        }, this.scene);
        centerGem.position = new Vector3(0, 2.5, 0);
        centerGem.material = createEmissiveMaterial('aoeGemMat', PALETTE.TOWER_AOE_CRYSTAL, 0.9, this.scene);
        makeFlatShaded(centerGem);
        centerGem.parent = this.mesh;

        // Gem float animation
        const floatAnim = new Animation("gemFloat", "position.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        floatAnim.setKeys([
            { frame: 0, value: 2.5 },
            { frame: 45, value: 2.65 },
            { frame: 90, value: 2.5 }
        ]);

        // Gem spin animation
        const gemSpin = new Animation("gemSpin", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        gemSpin.setKeys([
            { frame: 0, value: 0 },
            { frame: 90, value: Math.PI * 2 }
        ]);

        // Gem pulse animation
        const gemPulse = new Animation("gemPulse", "scaling", 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        gemPulse.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 45, value: new Vector3(1.12, 1.12, 1.12) },
            { frame: 90, value: new Vector3(1, 1, 1) }
        ]);

        centerGem.animations = [floatAnim, gemSpin, gemPulse];
        this.scene.beginAnimation(centerGem, 0, 90, true);

        // --- 6. Ambient arcane sparkle particles ---
        const sparklePS = new ParticleSystem("aoeSparkle", 15, this.scene);
        sparklePS.emitter = new Vector3(this.position.x, this.position.y + 2.4, this.position.z);
        sparklePS.minEmitBox = new Vector3(-0.4, -0.2, -0.4);
        sparklePS.maxEmitBox = new Vector3(0.4, 0.2, 0.4);
        sparklePS.color1 = new Color4(0.85, 0.50, 0.95, 0.8);
        sparklePS.color2 = new Color4(0.70, 0.30, 0.80, 0.6);
        sparklePS.colorDead = new Color4(0.50, 0.20, 0.60, 0);
        sparklePS.minSize = 0.05;
        sparklePS.maxSize = 0.15;
        sparklePS.minLifeTime = 0.8;
        sparklePS.maxLifeTime = 1.5;
        sparklePS.emitRate = 8;
        sparklePS.direction1 = new Vector3(-0.2, 0.3, -0.2);
        sparklePS.direction2 = new Vector3(0.2, 0.5, 0.2);
        sparklePS.minEmitPower = 0.1;
        sparklePS.maxEmitPower = 0.3;
        sparklePS.updateSpeed = 0.01;
        sparklePS.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        sparklePS.start();

        // --- 7. Small accent crystals on base ---
        const accentPositions = [
            new Vector3(0.7, 0.5, 0.3),
            new Vector3(-0.5, 0.45, 0.6),
            new Vector3(-0.3, 0.48, -0.7)
        ];
        for (let i = 0; i < accentPositions.length; i++) {
            const accent = MeshBuilder.CreatePolyhedron(`aoeAccent${i}`, {
                type: 1, size: 0.1
            }, this.scene);
            accent.position = accentPositions[i];
            accent.rotation.y = i * 1.2;
            accent.material = crystalMat;
            makeFlatShaded(accent);
            accent.parent = this.mesh;
        }

        this.mesh!.metadata = { sparklePS };
    }

    protected updateVisuals(): void {
        // Could intensify crystal glow on upgrade
    }

    public override dispose(): void {
        if (this.mesh && this.mesh.metadata) {
            if (this.mesh.metadata.sparklePS) {
                this.mesh.metadata.sparklePS.stop();
                this.mesh.metadata.sparklePS.dispose();
            }
        }
        super.dispose();
    }
}
