import { Vector3, MeshBuilder, Color3, Mesh, Space, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class SniperTower extends Tower {
    private levelMeshes: Mesh[] = [];

    constructor(game: Game, position: Vector3) {
        super(game, position, 20, 30, 0.5, 100);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("sniperTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Narrow round stone base ---
        const base = MeshBuilder.CreateCylinder('sniperBase', {
            height: 0.3, diameterTop: 1.35, diameterBottom: 1.5, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.15, 0);
        base.material = createLowPolyMaterial('sniperBaseMat', PALETTE.TOWER_BASIC_MERLON, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // --- 2. Lower limestone tier ---
        const lowerTier = MeshBuilder.CreateCylinder('lowerTier', {
            height: 0.8, diameterTop: 0.7, diameterBottom: 1.0, tessellation: 6
        }, this.scene);
        lowerTier.position = new Vector3(0, 0.7, 0);
        lowerTier.material = createLowPolyMaterial('lowerTierMat', PALETTE.TOWER_SNIPER_LIMESTONE, this.scene);
        makeFlatShaded(lowerTier);
        lowerTier.parent = this.mesh;

        // Stone band ring between tiers
        const tierRing = MeshBuilder.CreateTorus('tierRing', {
            diameter: 0.8, thickness: 0.08, tessellation: 8
        }, this.scene);
        tierRing.position = new Vector3(0, 1.15, 0);
        tierRing.material = createLowPolyMaterial('tierRingMat', PALETTE.TOWER_BASIC_MERLON, this.scene);
        makeFlatShaded(tierRing);
        tierRing.parent = this.mesh;

        // --- 3. Tall thin stone spire ---
        const spire = MeshBuilder.CreateCylinder('spire', {
            height: 2.2, diameterTop: 0.32, diameterBottom: 0.6, tessellation: 6
        }, this.scene);
        spire.position = new Vector3(0, 2.3, 0);
        spire.material = createLowPolyMaterial('spireMat', PALETTE.TOWER_SNIPER_LIMESTONE, this.scene);
        makeFlatShaded(spire);
        spire.parent = this.mesh;

        // --- 4. Arrow slit cutouts on spire ---
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const slit = MeshBuilder.CreateBox(`slit${i}`, {
                width: 0.04, height: 0.35, depth: 0.04
            }, this.scene);
            slit.position = new Vector3(
                Math.sin(angle) * 0.28,
                2.0,
                Math.cos(angle) * 0.28
            );
            slit.material = createLowPolyMaterial(`slitMat${i}`, PALETTE.TOWER_SNIPER_SLATE, this.scene);
            slit.parent = this.mesh;
        }

        // --- 5. Pointed conical roof ---
        const roof = MeshBuilder.CreateCylinder('roof', {
            height: 0.6, diameterTop: 0, diameterBottom: 0.55, tessellation: 6
        }, this.scene);
        roof.position = new Vector3(0, 3.7, 0);
        roof.material = createLowPolyMaterial('roofMat', PALETTE.TOWER_SNIPER_SLATE, this.scene);
        makeFlatShaded(roof);
        roof.parent = this.mesh;

        // --- 6. Simple longbow arm at top ---
        const bow = MeshBuilder.CreateBox('bow', {
            width: 0.5, height: 0.06, depth: 0.06
        }, this.scene);
        bow.position = new Vector3(0, 3.4, 0.22);
        bow.material = createLowPolyMaterial('bowMat', PALETTE.TOWER_BASIC_WOOD, this.scene);
        makeFlatShaded(bow);
        bow.parent = this.mesh;

        // Bowstring (thin vertical strip)
        const bowstring = MeshBuilder.CreateBox('bowstring', {
            width: 0.02, height: 0.02, depth: 0.35
        }, this.scene);
        bowstring.position = new Vector3(0, 3.4, 0.05);
        bowstring.material = createLowPolyMaterial('bowstringMat', PALETTE.TOWER_SNIPER_SLATE, this.scene);
        bowstring.parent = this.mesh;

        // --- 7. Small railing posts around top of spire ---
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const post = MeshBuilder.CreateBox(`post${i}`, {
                width: 0.05, height: 0.18, depth: 0.05
            }, this.scene);
            post.position = new Vector3(
                Math.sin(angle) * 0.25,
                3.48,
                Math.cos(angle) * 0.25
            );
            post.material = createLowPolyMaterial(`postMat${i}`, PALETTE.TOWER_SNIPER_LIMESTONE, this.scene);
            makeFlatShaded(post);
            post.parent = this.mesh;
        }

        // --- 8. Projectile system ---
        const bulletTemplate = MeshBuilder.CreateIcoSphere('sniperBulletTemplate', {
            radius: 0.12, subdivisions: 0
        }, this.scene);
        makeFlatShaded(bulletTemplate);
        const bulletMat = createEmissiveMaterial('sniperBulletMat', PALETTE.TOWER_SNIPER_LENS, 0.6, this.scene);
        bulletTemplate.material = bulletMat;
        bulletTemplate.isVisible = false;

        const activeBullets: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3 }[] = [];
        let lastFireTime = 0;
        let isInitialized = false;
        setTimeout(() => { isInitialized = true; }, 500);

        const animationCallback = () => {
            if (this.targetEnemy && isInitialized) {
                const currentTime = performance.now();
                if (currentTime - lastFireTime > (1000 / this.fireRate)) {
                    lastFireTime = currentTime;

                    const bullet = bulletTemplate.clone("sniperBullet_" + currentTime);
                    bullet.isVisible = true;
                    const startPos = new Vector3(
                        this.position.x,
                        this.position.y + 3.4,
                        this.position.z
                    );
                    bullet.position = startPos;

                    if (this.targetEnemy) {
                        const targetPosition = this.targetEnemy.getPosition();
                        bullet.lookAt(targetPosition);
                        activeBullets.push({
                            mesh: bullet,
                            distance: 0,
                            maxDistance: 25,
                            targetEnemy: this.targetEnemy,
                            targetPosition: targetPosition.clone()
                        });
                    }
                }
            }

            for (let i = activeBullets.length - 1; i >= 0; i--) {
                const info = activeBullets[i];
                const moveDistance = 0.9;
                info.mesh.translate(new Vector3(0, 0, 1), moveDistance, Space.LOCAL);
                info.distance += moveDistance;

                const targetPos = info.targetEnemy.getPosition();
                const distToTarget = Vector3.Distance(info.mesh.position, targetPos);

                if (info.distance >= info.maxDistance || distToTarget < 0.5) {
                    if (distToTarget < 0.5) {
                        this.createSniperImpactEffect(info.mesh.position);
                    }
                    info.mesh.dispose();
                    activeBullets.splice(i, 1);
                }
            }
        };

        this.scene.registerBeforeRender(animationCallback);
        this.mesh!.metadata = { activeBullets, animationCallback };
    }

    private createSniperImpactEffect(position: Vector3): void {
        const ps = new ParticleSystem("sniperImpact", 15, this.scene);
        ps.emitter = position;
        ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        ps.color1 = new Color4(0.9, 0.2, 0.2, 1);
        ps.color2 = new Color4(0.7, 0.1, 0.1, 1);
        ps.colorDead = new Color4(0.3, 0.0, 0.0, 0);
        ps.minSize = 0.2;
        ps.maxSize = 0.5;
        ps.minLifeTime = 0.1;
        ps.maxLifeTime = 0.3;
        ps.emitRate = 80;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity = new Vector3(0, -4, 0);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 2.5;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 400); }, 100);
    }

    protected createProjectileEffect(targetPosition: Vector3): void {
        // Custom bullet system handles visuals
    }

    protected updateVisuals(): void {
        this.levelMeshes.forEach(m => m.dispose());
        this.levelMeshes = [];

        if (this.level >= 2) {
            // Wider crow's nest observation platform
            const crowsNest = MeshBuilder.CreateCylinder('crowsNest_l2', {
                height: 0.12, diameterTop: 0.9, diameterBottom: 0.7, tessellation: 6
            }, this.scene);
            crowsNest.position = new Vector3(0, 3.46, 0);
            crowsNest.material = createLowPolyMaterial('crowsNestMat_l2', PALETTE.TOWER_SNIPER_LIMESTONE, this.scene);
            makeFlatShaded(crowsNest);
            crowsNest.parent = this.mesh;
            this.levelMeshes.push(crowsNest);

            // Nest railing torus
            const nestRail = MeshBuilder.CreateTorus('nestRail_l2', {
                diameter: 0.9, thickness: 0.04, tessellation: 8
            }, this.scene);
            nestRail.position = new Vector3(0, 3.54, 0);
            nestRail.material = createLowPolyMaterial('nestRailMat_l2', PALETTE.TOWER_SNIPER_SLATE, this.scene);
            makeFlatShaded(nestRail);
            nestRail.parent = this.mesh;
            this.levelMeshes.push(nestRail);

            // Crystal scope sight
            const scope = MeshBuilder.CreateIcoSphere('scope_l2', {
                radius: 0.08, subdivisions: 1
            }, this.scene);
            scope.position = new Vector3(0, 3.4, 0.38);
            scope.material = createEmissiveMaterial('scopeMat_l2', new Color3(0.5, 0.8, 1.0), 0.85, this.scene);
            makeFlatShaded(scope);
            scope.parent = this.mesh;
            this.levelMeshes.push(scope);

            // Mid-tower emissive window
            const glowWin = MeshBuilder.CreateBox('glowWin_l2', {
                width: 0.04, height: 0.22, depth: 0.04
            }, this.scene);
            glowWin.position = new Vector3(0.3, 2.0, 0);
            glowWin.material = createEmissiveMaterial('glowWinMat_l2', new Color3(1.0, 0.6, 0.2), 0.7, this.scene);
            glowWin.parent = this.mesh;
            this.levelMeshes.push(glowWin);

            // Recurve bow detail (wider arms)
            const recurve = MeshBuilder.CreateBox('recurve_l2', {
                width: 0.65, height: 0.06, depth: 0.06
            }, this.scene);
            recurve.position = new Vector3(0, 3.4, 0.22);
            recurve.material = createLowPolyMaterial('recurveMat_l2', PALETTE.TOWER_BASIC_WOOD, this.scene);
            makeFlatShaded(recurve);
            recurve.parent = this.mesh;
            this.levelMeshes.push(recurve);
        }

        if (this.level >= 3) {
            // Golden weather vane arrow at apex
            const vane = MeshBuilder.CreateCylinder('vane_l3', {
                height: 0.35, diameter: 0.04, tessellation: 4
            }, this.scene);
            vane.rotation.z = Math.PI / 2;
            vane.position = new Vector3(0, 4.15, 0);
            vane.material = createEmissiveMaterial('vaneMat_l3', PALETTE.TOWER_BASIC_BANNER, 0.5, this.scene);
            vane.parent = this.mesh;
            this.levelMeshes.push(vane);

            // Eagle nest ring (twig boxes around top)
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const twig = MeshBuilder.CreateBox(`twig_l3_${i}`, {
                    width: 0.05, height: 0.05, depth: 0.25
                }, this.scene);
                twig.position = new Vector3(
                    Math.sin(angle) * 0.32,
                    3.92,
                    Math.cos(angle) * 0.32
                );
                twig.rotation.y = angle;
                twig.rotation.x = 0.3;
                twig.material = createLowPolyMaterial(`twigMat_l3_${i}`, PALETTE.TOWER_BASIC_WOOD, this.scene);
                makeFlatShaded(twig);
                twig.parent = this.mesh;
                this.levelMeshes.push(twig);
            }

            // Crystal lens elements (2 emissive blue-white)
            for (let i = 0; i < 2; i++) {
                const side = i === 0 ? -0.25 : 0.25;
                const lens = MeshBuilder.CreateIcoSphere(`lens_l3_${i}`, {
                    radius: 0.065, subdivisions: 1
                }, this.scene);
                lens.position = new Vector3(side, 3.4, 0.35);
                lens.material = createEmissiveMaterial(`lensMat_l3_${i}`, new Color3(0.6, 0.85, 1.0), 0.9, this.scene);
                makeFlatShaded(lens);
                lens.parent = this.mesh;
                this.levelMeshes.push(lens);
            }

            // Golden emissive crown trim
            const crown = MeshBuilder.CreateTorus('crown_l3', {
                diameter: 0.65, thickness: 0.06, tessellation: 8
            }, this.scene);
            crown.position = new Vector3(0, 3.92, 0);
            crown.material = createEmissiveMaterial('crownMat_l3', PALETTE.TOWER_BASIC_BANNER, 0.6, this.scene);
            crown.parent = this.mesh;
            this.levelMeshes.push(crown);
        }
    }

    public override dispose(): void {
        if (this.mesh && this.mesh.metadata) {
            if (this.mesh.metadata.animationCallback) {
                this.scene.unregisterBeforeRender(this.mesh.metadata.animationCallback);
            }
            const activeBullets = this.mesh.metadata.activeBullets;
            if (activeBullets) {
                for (let i = activeBullets.length - 1; i >= 0; i--) {
                    if (activeBullets[i].mesh && !activeBullets[i].mesh.isDisposed()) {
                        activeBullets[i].mesh.dispose();
                    }
                }
                activeBullets.length = 0;
            }
        }
        super.dispose();
    }
}
