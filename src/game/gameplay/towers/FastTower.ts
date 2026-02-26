import { Vector3, MeshBuilder, Color3, Mesh, Space, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class FastTower extends Tower {
    constructor(game: Game, position: Vector3) {
        super(game, position, 8, 5, 4, 75);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("fastTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Slim hexagonal base ---
        const base = MeshBuilder.CreateCylinder('fastBase', {
            height: 0.3, diameterTop: 1.5, diameterBottom: 1.7, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.15, 0);
        base.material = createLowPolyMaterial('fastBaseMat', PALETTE.ROCK_DARK, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // --- 2. Mechanical housing body ---
        const body = MeshBuilder.CreateBox('fastBody', {
            width: 0.9, height: 0.9, depth: 0.9
        }, this.scene);
        body.position = new Vector3(0, 0.8, 0);
        body.rotation.y = Math.PI / 4;
        body.material = createLowPolyMaterial('fastBodyMat', PALETTE.TOWER_FAST, this.scene);
        makeFlatShaded(body);
        body.parent = this.mesh;

        // --- 3. Side armor plates ---
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const plate = MeshBuilder.CreateBox(`plate${i}`, {
                width: 0.6, height: 0.5, depth: 0.08
            }, this.scene);
            plate.position = new Vector3(
                Math.sin(angle) * 0.52,
                0.8,
                Math.cos(angle) * 0.52
            );
            plate.rotation.y = angle;
            plate.material = createLowPolyMaterial(`plateMat${i}`, PALETTE.TOWER_FAST_BARREL, this.scene);
            makeFlatShaded(plate);
            plate.parent = this.mesh;
        }

        // --- 4. Elevated turret platform ---
        const turretBase = MeshBuilder.CreateCylinder('turretBase', {
            height: 0.15, diameterTop: 0.8, diameterBottom: 0.7, tessellation: 6
        }, this.scene);
        turretBase.position = new Vector3(0, 1.32, 0);
        turretBase.material = createLowPolyMaterial('turretBaseMat', PALETTE.TOWER_FAST, this.scene);
        makeFlatShaded(turretBase);
        turretBase.parent = this.mesh;

        // --- 5. Turret group for rotation ---
        const turret = new Mesh("fastTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;

        // Turret head (box)
        const turretHead = MeshBuilder.CreateBox('turretHead', {
            width: 0.6, height: 0.35, depth: 0.7
        }, this.scene);
        turretHead.position = new Vector3(0, 1.57, 0.05);
        turretHead.material = createLowPolyMaterial('turretHeadMat', PALETTE.TOWER_FAST, this.scene);
        makeFlatShaded(turretHead);
        turretHead.parent = turret;

        // --- 6. Spinning barrel assembly (3 barrels around central axis) ---
        const barrelHub = new Mesh("barrelHub", this.scene);
        barrelHub.position = new Vector3(0, 1.57, 0.6);
        barrelHub.parent = turret;

        // Central hub disc
        const hubDisc = MeshBuilder.CreateCylinder('hubDisc', {
            height: 0.08, diameter: 0.4, tessellation: 6
        }, this.scene);
        hubDisc.rotation.x = Math.PI / 2;
        hubDisc.material = createEmissiveMaterial('hubDiscMat', PALETTE.TOWER_FAST, 0.3, this.scene);
        makeFlatShaded(hubDisc);
        hubDisc.parent = barrelHub;

        // Three barrels arranged in a triangle
        const barrelCount = 3;
        for (let i = 0; i < barrelCount; i++) {
            const angle = (i / barrelCount) * Math.PI * 2;
            const barrel = MeshBuilder.CreateCylinder(`barrel${i}`, {
                height: 0.8, diameter: 0.12, tessellation: 6
            }, this.scene);
            barrel.rotation.x = Math.PI / 2;
            barrel.position = new Vector3(
                Math.sin(angle) * 0.12,
                Math.cos(angle) * 0.12,
                0.4
            );
            barrel.material = createLowPolyMaterial(`barrelMat${i}`, PALETTE.TOWER_FAST_BARREL, this.scene);
            makeFlatShaded(barrel);
            barrel.parent = barrelHub;
        }

        // Barrel spin animation (idle)
        const spinAnim = new Animation("barrelSpin", "rotation.z", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        spinAnim.setKeys([
            { frame: 0, value: 0 },
            { frame: 60, value: Math.PI * 2 }
        ]);
        barrelHub.animations = [spinAnim];
        this.scene.beginAnimation(barrelHub, 0, 60, true);

        // --- 7. Emissive energy core (visible through top) ---
        const core = MeshBuilder.CreateIcoSphere('core', {
            radius: 0.12, subdivisions: 0
        }, this.scene);
        core.position = new Vector3(0, 1.57, -0.1);
        core.material = createEmissiveMaterial('coreMat', PALETTE.TOWER_FAST, 0.8, this.scene);
        makeFlatShaded(core);
        core.parent = turret;

        // Core pulse animation
        const pulseAnim = new Animation("corePulse", "scaling", 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        pulseAnim.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 15, value: new Vector3(1.3, 1.3, 1.3) },
            { frame: 30, value: new Vector3(1, 1, 1) }
        ]);
        core.animations = [pulseAnim];
        this.scene.beginAnimation(core, 0, 30, true);

        // --- 8. Bullet template & projectile system ---
        const bulletTemplate = MeshBuilder.CreateIcoSphere('fastBulletTemplate', {
            radius: 0.08, subdivisions: 0
        }, this.scene);
        makeFlatShaded(bulletTemplate);
        bulletTemplate.material = createEmissiveMaterial('fastBulletMat', PALETTE.TOWER_FAST, 0.5, this.scene);
        bulletTemplate.isVisible = false;

        const activeBullets: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, targetPosition: Vector3 }[] = [];
        let lastFireTime = 0;
        let isInitialized = false;
        let alternateBarrel = false;
        setTimeout(() => { isInitialized = true; }, 500);

        const animationCallback = () => {
            if (this.targetEnemy && isInitialized) {
                const currentTime = performance.now();
                if (currentTime - lastFireTime > (1000 / this.fireRate)) {
                    lastFireTime = currentTime;

                    const bullet = bulletTemplate.clone("fastBullet_" + currentTime);
                    bullet.isVisible = true;

                    const xOffset = alternateBarrel ? -0.12 : 0.12;
                    alternateBarrel = !alternateBarrel;

                    const startPos = new Vector3(
                        this.position.x + xOffset,
                        this.position.y + 1.57,
                        this.position.z
                    );
                    bullet.position = startPos;

                    if (this.targetEnemy) {
                        const targetPosition = this.targetEnemy.getPosition();
                        bullet.lookAt(targetPosition);
                        activeBullets.push({
                            mesh: bullet,
                            distance: 0,
                            maxDistance: 12,
                            targetEnemy: this.targetEnemy,
                            targetPosition: targetPosition.clone()
                        });
                    }
                }
            }

            for (let i = activeBullets.length - 1; i >= 0; i--) {
                const info = activeBullets[i];
                const moveDistance = 0.7;
                info.mesh.translate(new Vector3(0, 0, 1), moveDistance, Space.LOCAL);
                info.distance += moveDistance;

                const targetPos = info.targetEnemy.getPosition();
                const distToTarget = Vector3.Distance(info.mesh.position, targetPos);

                if (info.distance >= info.maxDistance || distToTarget < 0.5) {
                    if (distToTarget < 0.5) {
                        this.createFastImpactEffect(info.mesh.position);
                    }
                    info.mesh.dispose();
                    activeBullets.splice(i, 1);
                }
            }
        };

        this.scene.registerBeforeRender(animationCallback);
        this.mesh!.metadata = { activeBullets, animationCallback };
    }

    private createFastImpactEffect(position: Vector3): void {
        const ps = new ParticleSystem("fastImpact", 10, this.scene);
        ps.emitter = position;
        ps.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
        ps.maxEmitBox = new Vector3(0.05, 0.05, 0.05);
        ps.color1 = new Color4(0.85, 0.75, 0.25, 1);
        ps.color2 = new Color4(0.65, 0.55, 0.18, 1);
        ps.colorDead = new Color4(0.3, 0.25, 0.0, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.3;
        ps.minLifeTime = 0.08;
        ps.maxLifeTime = 0.2;
        ps.emitRate = 60;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity = new Vector3(0, -5, 0);
        ps.minEmitPower = 0.8;
        ps.maxEmitPower = 1.5;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 250); }, 60);
    }

    protected createProjectileEffect(targetPosition: Vector3): void {
        // Custom rapid-fire bullet system handles visuals
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
