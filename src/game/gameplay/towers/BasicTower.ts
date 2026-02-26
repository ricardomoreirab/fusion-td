import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { PALETTE } from '../../rendering/StyleConstants';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';

export class BasicTower extends Tower {
    constructor(game: Game, position: Vector3) {
        super(game, position, 10, 10, 1, 50);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("basicTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Stepped octagonal base with beveled edge ---
        const baseBottom = MeshBuilder.CreateCylinder('baseBottom', {
            height: 0.25, diameterTop: 2.0, diameterBottom: 2.2, tessellation: 8
        }, this.scene);
        baseBottom.position = new Vector3(0, 0.125, 0);
        baseBottom.material = createLowPolyMaterial('baseBottomMat', PALETTE.ROCK_DARK, this.scene);
        makeFlatShaded(baseBottom);
        baseBottom.parent = this.mesh;

        const baseTop = MeshBuilder.CreateCylinder('baseTop', {
            height: 0.2, diameterTop: 1.85, diameterBottom: 2.0, tessellation: 8
        }, this.scene);
        baseTop.position = new Vector3(0, 0.35, 0);
        baseTop.material = createLowPolyMaterial('baseTopMat', PALETTE.ROCK, this.scene);
        makeFlatShaded(baseTop);
        baseTop.parent = this.mesh;

        // --- 2. Tapered stone tower body ---
        const body = MeshBuilder.CreateCylinder('towerBody', {
            height: 1.4, diameterTop: 0.9, diameterBottom: 1.2, tessellation: 6
        }, this.scene);
        body.position = new Vector3(0, 1.15, 0);
        body.material = createLowPolyMaterial('bodyMat', PALETTE.TOWER_BASIC, this.scene);
        makeFlatShaded(body);
        body.parent = this.mesh;

        // --- 3. Wide platform with battlements ---
        const platform = MeshBuilder.CreateCylinder('platform', {
            height: 0.15, diameterTop: 1.5, diameterBottom: 1.3, tessellation: 8
        }, this.scene);
        platform.position = new Vector3(0, 1.92, 0);
        platform.material = createLowPolyMaterial('platformMat', PALETTE.TOWER_BASIC, this.scene);
        makeFlatShaded(platform);
        platform.parent = this.mesh;

        // Crenellations (merlons) around the platform
        const merlonCount = 8;
        for (let i = 0; i < merlonCount; i++) {
            const angle = (i / merlonCount) * Math.PI * 2;
            const merlon = MeshBuilder.CreateBox(`merlon${i}`, {
                width: 0.22, height: 0.25, depth: 0.15
            }, this.scene);
            merlon.position = new Vector3(
                Math.sin(angle) * 0.65,
                2.12,
                Math.cos(angle) * 0.65
            );
            merlon.rotation.y = angle;
            merlon.material = createLowPolyMaterial(`merlonMat${i}`, PALETTE.TOWER_BASIC, this.scene);
            makeFlatShaded(merlon);
            merlon.parent = this.mesh;
        }

        // --- 4. Pyramid roof with 4-sided facets ---
        const roof = MeshBuilder.CreateCylinder('roof', {
            height: 0.7, diameterTop: 0, diameterBottom: 1.3, tessellation: 4
        }, this.scene);
        roof.position = new Vector3(0, 2.6, 0);
        roof.rotation.y = Math.PI / 4;
        roof.material = createLowPolyMaterial('roofMat', PALETTE.TOWER_BASIC_ROOF, this.scene);
        makeFlatShaded(roof);
        roof.parent = this.mesh;

        // --- 5. Flag on top ---
        const flagpole = MeshBuilder.CreateCylinder('flagpole', {
            height: 0.8, diameter: 0.05, tessellation: 4
        }, this.scene);
        flagpole.position = new Vector3(0, 3.35, 0);
        flagpole.material = createLowPolyMaterial('flagpoleMat', PALETTE.ROCK_DARK, this.scene);
        flagpole.parent = this.mesh;

        const flag = MeshBuilder.CreateBox('flag', {
            width: 0.35, height: 0.2, depth: 0.02
        }, this.scene);
        flag.position = new Vector3(0.2, 3.6, 0);
        flag.material = createEmissiveMaterial('flagMat', new Color3(0.85, 0.65, 0.20), 0.3, this.scene);
        makeFlatShaded(flag);
        flag.parent = this.mesh;

        // Flag wave animation
        const flagWave = new Animation("flagWave", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        flagWave.setKeys([
            { frame: 0, value: -0.15 },
            { frame: 30, value: 0.15 },
            { frame: 60, value: -0.15 }
        ]);
        flag.animations = [flagWave];
        this.scene.beginAnimation(flag, 0, 60, true);

        // --- 6. Turret group for rotation (holds the crossbow) ---
        const turret = new Mesh("ballistaTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;

        // Crossbow arms (angled outward)
        const leftArm = MeshBuilder.CreateBox('leftArm', {
            width: 0.5, height: 0.08, depth: 0.08
        }, this.scene);
        leftArm.position = new Vector3(-0.3, 1.95, 0.4);
        leftArm.rotation.y = -0.3;
        leftArm.material = createLowPolyMaterial('leftArmMat', PALETTE.TOWER_BASIC_ROOF, this.scene);
        makeFlatShaded(leftArm);
        leftArm.parent = turret;

        const rightArm = MeshBuilder.CreateBox('rightArm', {
            width: 0.5, height: 0.08, depth: 0.08
        }, this.scene);
        rightArm.position = new Vector3(0.3, 1.95, 0.4);
        rightArm.rotation.y = 0.3;
        rightArm.material = createLowPolyMaterial('rightArmMat', PALETTE.TOWER_BASIC_ROOF, this.scene);
        makeFlatShaded(rightArm);
        rightArm.parent = turret;

        // Crossbow rail
        const rail = MeshBuilder.CreateBox('rail', {
            width: 0.1, height: 0.06, depth: 0.6
        }, this.scene);
        rail.position = new Vector3(0, 1.95, 0.35);
        rail.material = createLowPolyMaterial('railMat', PALETTE.TOWER_BASIC_ROOF, this.scene);
        makeFlatShaded(rail);
        rail.parent = turret;

        // --- 7. Projectile system ---
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
                        this.position.y + 1.95,
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
        // Could scale parts on upgrade
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
