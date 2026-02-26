import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { PALETTE } from '../../rendering/StyleConstants';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';

export class BasicTower extends Tower {
    private levelMeshes: Mesh[] = [];

    constructor(game: Game, position: Vector3) {
        super(game, position, 10, 10, 1, 50);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("basicTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Stone foundation (octagonal) ---
        const base = MeshBuilder.CreateCylinder('base', {
            height: 0.25, diameterTop: 2.0, diameterBottom: 2.2, tessellation: 8
        }, this.scene);
        base.position = new Vector3(0, 0.125, 0);
        base.material = createLowPolyMaterial('baseMat', PALETTE.TOWER_BASIC_MERLON, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // --- 2. Round stone tower body (short, stocky watchtower) ---
        const body = MeshBuilder.CreateCylinder('body', {
            height: 1.3, diameterTop: 0.9, diameterBottom: 1.15, tessellation: 6
        }, this.scene);
        body.position = new Vector3(0, 1.0, 0);
        body.material = createLowPolyMaterial('bodyMat', PALETTE.TOWER_BASIC_STONE, this.scene);
        makeFlatShaded(body);
        body.parent = this.mesh;

        // --- 3. Wooden platform ---
        const platform = MeshBuilder.CreateCylinder('platform', {
            height: 0.12, diameterTop: 1.4, diameterBottom: 1.2, tessellation: 8
        }, this.scene);
        platform.position = new Vector3(0, 1.72, 0);
        platform.material = createLowPolyMaterial('platformMat', PALETTE.TOWER_BASIC_WOOD, this.scene);
        makeFlatShaded(platform);
        platform.parent = this.mesh;

        // --- 4. Four large stone merlons ---
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const merlon = MeshBuilder.CreateBox(`merlon${i}`, {
                width: 0.3, height: 0.35, depth: 0.2
            }, this.scene);
            merlon.position = new Vector3(
                Math.sin(angle) * 0.6,
                1.96,
                Math.cos(angle) * 0.6
            );
            merlon.rotation.y = angle;
            merlon.material = createLowPolyMaterial(`merlonMat${i}`, PALETTE.TOWER_BASIC_MERLON, this.scene);
            makeFlatShaded(merlon);
            merlon.parent = this.mesh;
        }

        // --- 5. Arrow slit strips on tower body ---
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const slit = MeshBuilder.CreateBox(`slit${i}`, {
                width: 0.05, height: 0.3, depth: 0.05
            }, this.scene);
            slit.position = new Vector3(
                Math.sin(angle) * 0.52,
                1.05,
                Math.cos(angle) * 0.52
            );
            slit.material = createLowPolyMaterial(`slitMat${i}`, PALETTE.TOWER_BASIC_MERLON, this.scene);
            slit.parent = this.mesh;
        }

        // --- 6. Stone band ring between body and platform ---
        const stoneRing = MeshBuilder.CreateTorus('stoneRing', {
            diameter: 1.15, thickness: 0.08, tessellation: 8
        }, this.scene);
        stoneRing.position = new Vector3(0, 1.65, 0);
        stoneRing.material = createLowPolyMaterial('stoneRingMat', PALETTE.TOWER_BASIC_MERLON, this.scene);
        makeFlatShaded(stoneRing);
        stoneRing.parent = this.mesh;

        // --- 7. Crossbow turret (single bow arm) ---
        const turret = new Mesh("crossbowTurret", this.scene);
        turret.parent = this.mesh;

        const leftArm = MeshBuilder.CreateBox('leftArm', {
            width: 0.45, height: 0.07, depth: 0.07
        }, this.scene);
        leftArm.position = new Vector3(-0.28, 1.85, 0.38);
        leftArm.rotation.y = -0.3;
        leftArm.material = createLowPolyMaterial('leftArmMat', PALETTE.TOWER_BASIC_WOOD, this.scene);
        makeFlatShaded(leftArm);
        leftArm.parent = turret;

        const rightArm = MeshBuilder.CreateBox('rightArm', {
            width: 0.45, height: 0.07, depth: 0.07
        }, this.scene);
        rightArm.position = new Vector3(0.28, 1.85, 0.38);
        rightArm.rotation.y = 0.3;
        rightArm.material = createLowPolyMaterial('rightArmMat', PALETTE.TOWER_BASIC_WOOD, this.scene);
        makeFlatShaded(rightArm);
        rightArm.parent = turret;

        const rail = MeshBuilder.CreateBox('rail', {
            width: 0.09, height: 0.06, depth: 0.55
        }, this.scene);
        rail.position = new Vector3(0, 1.85, 0.32);
        rail.material = createLowPolyMaterial('railMat', PALETTE.TOWER_BASIC_WOOD, this.scene);
        makeFlatShaded(rail);
        rail.parent = turret;

        // --- 8. Projectile system ---
        const arrowTemplate = MeshBuilder.CreateIcoSphere('basicArrowTemplate', {
            radius: 0.1, subdivisions: 0
        }, this.scene);
        makeFlatShaded(arrowTemplate);
        const arrowMat = createEmissiveMaterial('arrowMat', new Color3(0.9, 0.85, 0.6), 0.4, this.scene);
        arrowTemplate.material = arrowMat;
        arrowTemplate.isVisible = false;

        const activeBullets: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3 }[] = [];
        let lastFireTime = 0;
        let isInitialized = false;
        setTimeout(() => { isInitialized = true; }, 500);

        const animationCallback = () => {
            if (this.targetEnemy && isInitialized) {
                const currentTime = performance.now();
                if (currentTime - lastFireTime > (1000 / this.fireRate)) {
                    lastFireTime = currentTime;
                    const newBullet = arrowTemplate.clone("basicBullet_" + currentTime);
                    newBullet.isVisible = true;
                    const startPos = new Vector3(
                        this.position.x,
                        this.position.y + 1.85,
                        this.position.z
                    );
                    newBullet.position = startPos;
                    if (this.targetEnemy) {
                        const targetPosition = this.targetEnemy.getPosition();
                        newBullet.lookAt(targetPosition);
                        activeBullets.push({
                            mesh: newBullet,
                            distance: 0,
                            maxDistance: 20,
                            targetEnemy: this.targetEnemy,
                            targetPosition: targetPosition.clone()
                        });
                    }
                }
            }
            for (let i = activeBullets.length - 1; i >= 0; i--) {
                const bulletInfo = activeBullets[i];
                const moveDistance = 0.6;
                bulletInfo.mesh.translate(new Vector3(0, 0, 1), moveDistance, Space.LOCAL);
                bulletInfo.distance += moveDistance;
                const targetPos = bulletInfo.targetEnemy.getPosition();
                const distToTarget = Vector3.Distance(bulletInfo.mesh.position, targetPos);
                if (bulletInfo.distance >= bulletInfo.maxDistance || distToTarget < 0.5) {
                    if (distToTarget < 0.5) {
                        this.createBulletImpactEffect(bulletInfo.mesh.position);
                    }
                    bulletInfo.mesh.dispose();
                    activeBullets.splice(i, 1);
                }
            }
        };
        this.scene.registerBeforeRender(animationCallback);
        this.mesh!.metadata = { activeBullets, animationCallback };
    }

    private createBulletImpactEffect(position: Vector3): void {
        const ps = new ParticleSystem("bulletImpact", 12, this.scene);
        ps.emitter = position;
        ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        ps.color1 = new Color4(0.9, 0.85, 0.6, 1);
        ps.color2 = new Color4(0.7, 0.6, 0.3, 1);
        ps.colorDead = new Color4(0.4, 0.3, 0.1, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.35;
        ps.minLifeTime = 0.1;
        ps.maxLifeTime = 0.25;
        ps.emitRate = 80;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity = new Vector3(0, -5, 0);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 2;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 300); }, 80);
    }

    protected createProjectileEffect(targetPosition: Vector3): void {
        // Custom bullet system handles this
    }

    protected updateVisuals(): void {
        this.levelMeshes.forEach(m => m.dispose());
        this.levelMeshes = [];

        if (this.level >= 2) {
            // Wooden pyramid roof appears
            const roof = MeshBuilder.CreateCylinder('roof_l2', {
                height: 0.65, diameterTop: 0, diameterBottom: 1.25, tessellation: 4
            }, this.scene);
            roof.position = new Vector3(0, 2.45, 0);
            roof.rotation.y = Math.PI / 4;
            roof.material = createLowPolyMaterial('roofMat_l2', PALETTE.TOWER_BASIC_WOOD, this.scene);
            makeFlatShaded(roof);
            roof.parent = this.mesh;
            this.levelMeshes.push(roof);

            // Heraldic gold banner on side
            const banner = MeshBuilder.CreateBox('banner_l2', {
                width: 0.3, height: 0.5, depth: 0.03
            }, this.scene);
            banner.position = new Vector3(0.72, 1.55, 0);
            banner.material = createEmissiveMaterial('bannerMat_l2', PALETTE.TOWER_BASIC_BANNER, 0.45, this.scene);
            makeFlatShaded(banner);
            banner.parent = this.mesh;
            this.levelMeshes.push(banner);

            // Torch sconce + flame
            const torch = MeshBuilder.CreateCylinder('torch_l2', {
                height: 0.22, diameter: 0.08, tessellation: 4
            }, this.scene);
            torch.position = new Vector3(-0.65, 1.4, 0);
            torch.material = createLowPolyMaterial('torchMat_l2', PALETTE.TOWER_BASIC_WOOD, this.scene);
            makeFlatShaded(torch);
            torch.parent = this.mesh;
            this.levelMeshes.push(torch);

            const flame = MeshBuilder.CreateIcoSphere('flame_l2', {
                radius: 0.07, subdivisions: 0
            }, this.scene);
            flame.position = new Vector3(-0.65, 1.56, 0);
            flame.material = createEmissiveMaterial('flameMat_l2', new Color3(1.0, 0.5, 0.1), 0.85, this.scene);
            flame.parent = this.mesh;
            this.levelMeshes.push(flame);

            // Extra crossbow arm (dual fire)
            const extraArm = MeshBuilder.CreateBox('extraArm_l2', {
                width: 0.55, height: 0.06, depth: 0.06
            }, this.scene);
            extraArm.position = new Vector3(0, 1.95, 0.5);
            extraArm.material = createLowPolyMaterial('extraArmMat_l2', PALETTE.TOWER_BASIC_WOOD, this.scene);
            makeFlatShaded(extraArm);
            extraArm.parent = this.mesh;
            this.levelMeshes.push(extraArm);

            // 4 additional merlons (8 total)
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
                const merlon = MeshBuilder.CreateBox(`merlon_l2_${i}`, {
                    width: 0.25, height: 0.3, depth: 0.16
                }, this.scene);
                merlon.position = new Vector3(
                    Math.sin(angle) * 0.6,
                    1.96,
                    Math.cos(angle) * 0.6
                );
                merlon.rotation.y = angle;
                merlon.material = createLowPolyMaterial(`merlonMat_l2_${i}`, PALETTE.TOWER_BASIC_STONE, this.scene);
                makeFlatShaded(merlon);
                merlon.parent = this.mesh;
                this.levelMeshes.push(merlon);
            }
        }

        if (this.level >= 3) {
            // Stone flying buttresses (3 angled braces)
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const buttress = MeshBuilder.CreateBox(`buttress_l3_${i}`, {
                    width: 0.1, height: 0.75, depth: 0.5
                }, this.scene);
                buttress.position = new Vector3(
                    Math.sin(angle) * 0.85,
                    1.4,
                    Math.cos(angle) * 0.85
                );
                buttress.rotation.y = angle;
                buttress.rotation.x = 0.45;
                buttress.material = createLowPolyMaterial(`buttressMat_l3_${i}`, PALETTE.TOWER_BASIC_STONE, this.scene);
                makeFlatShaded(buttress);
                buttress.parent = this.mesh;
                this.levelMeshes.push(buttress);
            }

            // Golden crown ring at battlements
            const crown = MeshBuilder.CreateTorus('crown_l3', {
                diameter: 1.35, thickness: 0.07, tessellation: 8
            }, this.scene);
            crown.position = new Vector3(0, 2.15, 0);
            crown.material = createEmissiveMaterial('crownMat_l3', PALETTE.TOWER_BASIC_BANNER, 0.55, this.scene);
            crown.parent = this.mesh;
            this.levelMeshes.push(crown);

            // Arrow slit emissive glows (orange-gold light seeping out)
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const glow = MeshBuilder.CreateBox(`slitGlow_l3_${i}`, {
                    width: 0.04, height: 0.26, depth: 0.04
                }, this.scene);
                glow.position = new Vector3(
                    Math.sin(angle) * 0.53,
                    1.05,
                    Math.cos(angle) * 0.53
                );
                glow.material = createEmissiveMaterial(`slitGlowMat_l3_${i}`, new Color3(1.0, 0.65, 0.2), 0.8, this.scene);
                glow.parent = this.mesh;
                this.levelMeshes.push(glow);
            }

            // Ballista crossbeam (wide horizontal launcher)
            const ballista = MeshBuilder.CreateCylinder('ballista_l3', {
                height: 0.95, diameter: 0.1, tessellation: 4
            }, this.scene);
            ballista.rotation.z = Math.PI / 2;
            ballista.position = new Vector3(0, 1.92, 0.5);
            ballista.material = createLowPolyMaterial('ballistaMat_l3', PALETTE.TOWER_BASIC_WOOD, this.scene);
            makeFlatShaded(ballista);
            ballista.parent = this.mesh;
            this.levelMeshes.push(ballista);

            // Glowing bolt nock
            const nock = MeshBuilder.CreateIcoSphere('boltNock_l3', {
                radius: 0.07, subdivisions: 0
            }, this.scene);
            nock.position = new Vector3(0, 1.92, 0.78);
            nock.material = createEmissiveMaterial('boltNockMat_l3', PALETTE.TOWER_BASIC_BANNER, 0.9, this.scene);
            nock.parent = this.mesh;
            this.levelMeshes.push(nock);

            // Flagpole + flag (appears at level 3)
            const flagpole = MeshBuilder.CreateCylinder('flagpole_l3', {
                height: 0.7, diameter: 0.04, tessellation: 4
            }, this.scene);
            flagpole.position = new Vector3(0, 3.15, 0);
            flagpole.material = createLowPolyMaterial('flagpoleMat_l3', PALETTE.TOWER_BASIC_MERLON, this.scene);
            flagpole.parent = this.mesh;
            this.levelMeshes.push(flagpole);

            const flag = MeshBuilder.CreateBox('flag_l3', {
                width: 0.35, height: 0.2, depth: 0.02
            }, this.scene);
            flag.position = new Vector3(0.2, 3.4, 0);
            flag.material = createEmissiveMaterial('flagMat_l3', PALETTE.TOWER_BASIC_BANNER, 0.4, this.scene);
            makeFlatShaded(flag);
            flag.parent = this.mesh;
            this.levelMeshes.push(flag);
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
