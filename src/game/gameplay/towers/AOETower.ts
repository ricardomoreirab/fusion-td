import { Vector3, MeshBuilder, Color3, Mesh } from '@babylonjs/core';
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

        // Hex base
        const base = MeshBuilder.CreateCylinder('aoeBase', {
            height: 0.4, diameterTop: 1.8, diameterBottom: 2.0, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.2, 0);
        base.material = createLowPolyMaterial('aoeBaseMat', PALETTE.TOWER_AOE, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // Central pillar
        const pillar = MeshBuilder.CreateBox('aoePillar', {
            width: 0.6, height: 1.6, depth: 0.6
        }, this.scene);
        pillar.position = new Vector3(0, 1.2, 0);
        pillar.material = createLowPolyMaterial('aoePillarMat', PALETTE.TOWER_AOE, this.scene);
        makeFlatShaded(pillar);
        pillar.parent = this.mesh;

        // Crystal material (emissive)
        const crystalMat = createEmissiveMaterial('aoeCrystalMat', PALETTE.TOWER_AOE_CRYSTAL, 0.7, this.scene);

        // 5 angled crystal prisms around the pillar top
        const crystalCount = 5;
        for (let i = 0; i < crystalCount; i++) {
            const angle = (i / crystalCount) * Math.PI * 2;
            const radius = 0.5;

            // Each crystal is a polyhedron (octahedron type = 1)
            const crystal = MeshBuilder.CreatePolyhedron(`aoeCrystal${i}`, {
                type: 1, size: 0.2
            }, this.scene);

            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            crystal.position = new Vector3(x, 2.1, z);

            // Tilt crystals outward
            crystal.rotation.x = Math.cos(angle) * 0.4;
            crystal.rotation.z = -Math.sin(angle) * 0.4;
            crystal.rotation.y = angle;

            crystal.material = crystalMat;
            makeFlatShaded(crystal);
            crystal.parent = this.mesh;
        }

        // Top crystal (larger, centered)
        const topCrystal = MeshBuilder.CreatePolyhedron('aoeTopCrystal', {
            type: 1, size: 0.3
        }, this.scene);
        topCrystal.position = new Vector3(0, 2.4, 0);
        topCrystal.material = crystalMat;
        makeFlatShaded(topCrystal);
        topCrystal.parent = this.mesh;

        // Small accent crystal on base
        const accentCrystal = MeshBuilder.CreatePolyhedron('aoeAccentCrystal', {
            type: 1, size: 0.12
        }, this.scene);
        accentCrystal.position = new Vector3(0.7, 0.5, 0.3);
        accentCrystal.rotation.y = 0.8;
        accentCrystal.material = crystalMat;
        makeFlatShaded(accentCrystal);
        accentCrystal.parent = this.mesh;
    }

    protected updateVisuals(): void {
        // Could intensify crystal glow on upgrade
    }
}
