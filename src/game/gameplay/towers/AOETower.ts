import { Vector3, MeshBuilder, Color3, Mesh, Animation, ParticleSystem, Color4 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class AOETower extends Tower {
    private levelMeshes: Mesh[] = [];

    constructor(game: Game, position: Vector3) {
        super(game, position, 15, 5, 2, 150);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("aoeTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Wide round dark stone base ---
        const base = MeshBuilder.CreateCylinder('aoeBase', {
            height: 0.3, diameterTop: 2.1, diameterBottom: 2.3, tessellation: 8
        }, this.scene);
        base.position = new Vector3(0, 0.15, 0);
        base.material = createLowPolyMaterial('aoeBaseMat', PALETTE.TOWER_AOE_STONE, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // --- 2. Eight rune pillar cylinders arranged in circle ---
        const pillarMat = createLowPolyMaterial('runePostMat', PALETTE.TOWER_AOE_STONE, this.scene);
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const radius = 0.85;

            // Stone pillar
            const pillar = MeshBuilder.CreateCylinder(`runePillar${i}`, {
                height: 1.1, diameter: 0.14, tessellation: 5
            }, this.scene);
            pillar.position = new Vector3(
                Math.cos(angle) * radius,
                0.85,
                Math.sin(angle) * radius
            );
            pillar.material = pillarMat;
            makeFlatShaded(pillar);
            pillar.parent = this.mesh;

            // Emissive rune strip on each pillar
            const runeStrip = MeshBuilder.CreateBox(`runeStrip${i}`, {
                width: 0.035, height: 0.6, depth: 0.035
            }, this.scene);
            runeStrip.position = new Vector3(
                Math.cos(angle) * radius,
                0.85,
                Math.sin(angle) * radius
            );
            runeStrip.material = createEmissiveMaterial(`runeStripMat${i}`, PALETTE.TOWER_AOE_RUNE, 0.5, this.scene);
            runeStrip.parent = this.mesh;
        }

        // --- 3. Low central stone platform ---
        const centralPlatform = MeshBuilder.CreateCylinder('centralPlatform', {
            height: 0.15, diameterTop: 0.9, diameterBottom: 0.7, tessellation: 6
        }, this.scene);
        centralPlatform.position = new Vector3(0, 0.38, 0);
        centralPlatform.material = createLowPolyMaterial('centralPlatformMat', PALETTE.TOWER_AOE_STONE, this.scene);
        makeFlatShaded(centralPlatform);
        centralPlatform.parent = this.mesh;

        // --- 4. Central short tower body ---
        const towerBody = MeshBuilder.CreateCylinder('towerBody', {
            height: 0.9, diameterTop: 0.4, diameterBottom: 0.6, tessellation: 6
        }, this.scene);
        towerBody.position = new Vector3(0, 0.9, 0);
        towerBody.material = createLowPolyMaterial('towerBodyMat', PALETTE.TOWER_AOE_STONE, this.scene);
        makeFlatShaded(towerBody);
        towerBody.parent = this.mesh;

        // Pillar glow channels (vertical emissive strips on central body)
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const channel = MeshBuilder.CreateBox(`channel${i}`, {
                width: 0.035, height: 0.7, depth: 0.035
            }, this.scene);
            channel.position = new Vector3(
                Math.sin(angle) * 0.28,
                0.9,
                Math.cos(angle) * 0.28
            );
            channel.material = createEmissiveMaterial(`channelMat${i}`, PALETTE.TOWER_AOE_RUNE, 0.45, this.scene);
            channel.parent = this.mesh;
        }

        // --- 5. Single orbiting orb (octahedron) ---
        const orbRing = new Mesh("orbRing", this.scene);
        orbRing.position = new Vector3(0, 1.6, 0);
        orbRing.parent = this.mesh;

        const orb = MeshBuilder.CreatePolyhedron('mainOrb', {
            type: 1, size: 0.22
        }, this.scene);
        orb.position = new Vector3(0.5, 0, 0);
        orb.material = createEmissiveMaterial('mainOrbMat', PALETTE.TOWER_AOE_ORB, 0.8, this.scene);
        makeFlatShaded(orb);
        orb.parent = orbRing;

        // Orbit animation
        const orbitAnim = new Animation("orbOrbit", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        orbitAnim.setKeys([
            { frame: 0, value: 0 },
            { frame: 90, value: Math.PI * 2 }
        ]);
        orbRing.animations = [orbitAnim];
        this.scene.beginAnimation(orbRing, 0, 90, true);

        // Orb pulse
        const orbPulse = new Animation("orbPulse", "scaling", 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        orbPulse.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 30, value: new Vector3(1.15, 1.15, 1.15) },
            { frame: 60, value: new Vector3(1, 1, 1) }
        ]);
        orb.animations = [orbPulse];
        this.scene.beginAnimation(orb, 0, 60, true);

        // --- 6. Emissive trim ring at base ---
        const baseTrim = MeshBuilder.CreateTorus('baseTrim', {
            diameter: 2.15, thickness: 0.05, tessellation: 8
        }, this.scene);
        baseTrim.position = new Vector3(0, 0.32, 0);
        baseTrim.material = createEmissiveMaterial('baseTrimMat', PALETTE.TOWER_AOE_RUNE, 0.35, this.scene);
        makeFlatShaded(baseTrim);
        baseTrim.parent = this.mesh;

        // --- 7. Ambient arcane sparkle particles ---
        const sparklePS = new ParticleSystem("aoeSparkle", 12, this.scene);
        sparklePS.emitter = new Vector3(this.position.x, this.position.y + 1.5, this.position.z);
        sparklePS.minEmitBox = new Vector3(-0.5, -0.2, -0.5);
        sparklePS.maxEmitBox = new Vector3(0.5, 0.3, 0.5);
        sparklePS.color1 = new Color4(0.72, 0.40, 0.95, 0.7);
        sparklePS.color2 = new Color4(0.60, 0.28, 0.85, 0.5);
        sparklePS.colorDead = new Color4(0.40, 0.15, 0.55, 0);
        sparklePS.minSize = 0.04;
        sparklePS.maxSize = 0.12;
        sparklePS.minLifeTime = 0.8;
        sparklePS.maxLifeTime = 1.5;
        sparklePS.emitRate = 6;
        sparklePS.direction1 = new Vector3(-0.2, 0.3, -0.2);
        sparklePS.direction2 = new Vector3(0.2, 0.5, 0.2);
        sparklePS.minEmitPower = 0.1;
        sparklePS.maxEmitPower = 0.3;
        sparklePS.updateSpeed = 0.01;
        sparklePS.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        sparklePS.start();

        this.mesh!.metadata = { sparklePS };
    }

    protected updateVisuals(): void {
        this.levelMeshes.forEach(m => m.dispose());
        this.levelMeshes = [];

        if (this.level >= 2) {
            // Arcane circle etched into platform (emissive disc)
            const arcaneCircle = MeshBuilder.CreateDisc('arcaneCircle_l2', {
                radius: 0.85, tessellation: 6, sideOrientation: Mesh.DOUBLESIDE
            }, this.scene);
            arcaneCircle.position = new Vector3(0, 0.47, 0);
            arcaneCircle.rotation = new Vector3(Math.PI / 2, 0, 0);
            arcaneCircle.material = createEmissiveMaterial('arcaneCircleMat_l2', PALETTE.TOWER_AOE_RUNE, 0.3, this.scene);
            arcaneCircle.parent = this.mesh;
            this.levelMeshes.push(arcaneCircle);

            // 3 extra supporting orbs (static around pillar)
            const orbMat = createEmissiveMaterial('supportOrbMat_l2', PALETTE.TOWER_AOE_ORB, 0.6, this.scene);
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
                const supportOrb = MeshBuilder.CreateIcoSphere(`supportOrb_l2_${i}`, {
                    radius: 0.09, subdivisions: 0
                }, this.scene);
                supportOrb.position = new Vector3(
                    Math.cos(angle) * 0.4,
                    1.2,
                    Math.sin(angle) * 0.4
                );
                supportOrb.material = orbMat;
                makeFlatShaded(supportOrb);
                supportOrb.parent = this.mesh;
                this.levelMeshes.push(supportOrb);
            }

            // Emissive window strips on central body
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
                const winStrip = MeshBuilder.CreateBox(`win_l2_${i}`, {
                    width: 0.035, height: 0.3, depth: 0.035
                }, this.scene);
                winStrip.position = new Vector3(
                    Math.sin(angle) * 0.35,
                    0.9,
                    Math.cos(angle) * 0.35
                );
                winStrip.material = createEmissiveMaterial(`winMat_l2_${i}`, PALETTE.TOWER_AOE_ORB, 0.5, this.scene);
                winStrip.parent = this.mesh;
                this.levelMeshes.push(winStrip);
            }

            // Arcane crown ring on top of central body
            const cradleCrown = MeshBuilder.CreateTorus('cradleCrown_l2', {
                diameter: 0.55, thickness: 0.045, tessellation: 8
            }, this.scene);
            cradleCrown.position = new Vector3(0, 1.38, 0);
            cradleCrown.material = createEmissiveMaterial('cradleCrownMat_l2', PALETTE.TOWER_AOE_RUNE, 0.4, this.scene);
            cradleCrown.parent = this.mesh;
            this.levelMeshes.push(cradleCrown);
        }

        if (this.level >= 3) {
            // Floating master crystal at apex
            const masterCrystal = MeshBuilder.CreatePolyhedron('masterCrystal_l3', {
                type: 1, size: 0.35
            }, this.scene);
            masterCrystal.position = new Vector3(0, 2.5, 0);
            masterCrystal.material = createEmissiveMaterial('masterCrystalMat_l3', PALETTE.TOWER_AOE_ORB, 0.95, this.scene);
            makeFlatShaded(masterCrystal);
            masterCrystal.parent = this.mesh;
            this.levelMeshes.push(masterCrystal);

            const masterSpin = new Animation("masterSpin_l3", "rotation.y", 30,
                Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
            masterSpin.setKeys([
                { frame: 0, value: 0 },
                { frame: 60, value: Math.PI * 2 }
            ]);
            masterCrystal.animations = [masterSpin];
            this.scene.beginAnimation(masterCrystal, 0, 60, true);

            // Gargoyle box-shapes at 4 corners of base
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
                const gargoyle = MeshBuilder.CreateBox(`gargoyle_l3_${i}`, {
                    width: 0.2, height: 0.32, depth: 0.2
                }, this.scene);
                gargoyle.position = new Vector3(
                    Math.sin(angle) * 1.05,
                    0.46,
                    Math.cos(angle) * 1.05
                );
                gargoyle.rotation.y = angle;
                gargoyle.material = createLowPolyMaterial(`gargoyleMat_l3_${i}`, PALETTE.TOWER_AOE_STONE, this.scene);
                makeFlatShaded(gargoyle);
                gargoyle.parent = this.mesh;
                this.levelMeshes.push(gargoyle);

                // Gargoyle emissive eyes
                const eye = MeshBuilder.CreateIcoSphere(`eye_l3_${i}`, {
                    radius: 0.035, subdivisions: 0
                }, this.scene);
                eye.position = new Vector3(
                    Math.sin(angle) * 1.14,
                    0.58,
                    Math.cos(angle) * 1.14
                );
                eye.material = createEmissiveMaterial(`eyeMat_l3_${i}`, PALETTE.TOWER_AOE_RUNE, 0.9, this.scene);
                eye.parent = this.mesh;
                this.levelMeshes.push(eye);
            }

            // Golden crown ring
            const crown = MeshBuilder.CreateTorus('crown_l3', {
                diameter: 0.6, thickness: 0.06, tessellation: 8
            }, this.scene);
            crown.position = new Vector3(0, 2.1, 0);
            crown.material = createEmissiveMaterial('crownMat_l3', PALETTE.TOWER_BASIC_BANNER, 0.5, this.scene);
            crown.parent = this.mesh;
            this.levelMeshes.push(crown);

            // Full outer rune circle (larger, brighter)
            const outerRune = MeshBuilder.CreateDisc('outerRune_l3', {
                radius: 1.1, tessellation: 8, sideOrientation: Mesh.DOUBLESIDE
            }, this.scene);
            outerRune.position = new Vector3(0, 0.48, 0);
            outerRune.rotation = new Vector3(Math.PI / 2, 0, 0);
            outerRune.material = createEmissiveMaterial('outerRuneMat_l3', PALETTE.TOWER_AOE_ORB, 0.18, this.scene);
            outerRune.parent = this.mesh;
            this.levelMeshes.push(outerRune);

            // Stone ribbed buttresses up central body
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const rib = MeshBuilder.CreateBox(`rib_l3_${i}`, {
                    width: 0.07, height: 0.85, depth: 0.07
                }, this.scene);
                rib.position = new Vector3(
                    Math.sin(angle) * 0.38,
                    0.9,
                    Math.cos(angle) * 0.38
                );
                rib.material = createLowPolyMaterial(`ribMat_l3_${i}`, PALETTE.TOWER_AOE_STONE, this.scene);
                makeFlatShaded(rib);
                rib.parent = this.mesh;
                this.levelMeshes.push(rib);
            }
        }
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
