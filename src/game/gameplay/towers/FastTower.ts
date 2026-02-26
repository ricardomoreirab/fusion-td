import { Vector3, MeshBuilder, Color3, Mesh, Space, ParticleSystem, Color4 } from '@babylonjs/core';
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

        // Small hex base
        const base = MeshBuilder.CreateCylinder('fastBase', {
            height: 0.3, diameterTop: 1.4, diameterBottom: 1.6, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.15, 0);
        base.material = createLowPolyMaterial('fastBaseMat', PALETTE.TOWER_FAST, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // Twin thin pillars
        const leftPillar = MeshBuilder.CreateBox('fastLeftPillar', {
            width: 0.3, height: 1.4, depth: 0.3
        }, this.scene);
        leftPillar.position = new Vector3(-0.35, 1.0, 0);
        leftPillar.material = createLowPolyMaterial('fastLPillarMat', PALETTE.TOWER_FAST, this.scene);
        makeFlatShaded(leftPillar);
        leftPillar.parent = this.mesh;

        const rightPillar = MeshBuilder.CreateBox('fastRightPillar', {
            width: 0.3, height: 1.4, depth: 0.3
        }, this.scene);
        rightPillar.position = new Vector3(0.35, 1.0, 0);
        rightPillar.material = createLowPolyMaterial('fastRPillarMat', PALETTE.TOWER_FAST, this.scene);
        makeFlatShaded(rightPillar);
        rightPillar.parent = this.mesh;

        // Turret group for rotation
        const turret = new Mesh("fastTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;

        // Connecting crossbar between pillars at top
        const crossbar = MeshBuilder.CreateBox('fastCrossbar', {
            width: 1.0, height: 0.2, depth: 0.3
        }, this.scene);
        crossbar.position = new Vector3(0, 1.7, 0);
        crossbar.material = createLowPolyMaterial('fastCrossbarMat', PALETTE.TOWER_FAST, this.scene);
        makeFlatShaded(crossbar);
        crossbar.parent = turret;

        // Left barrel (cylinder pointing forward)
        const leftBarrel = MeshBuilder.CreateCylinder('fastLeftBarrel', {
            height: 1.0, diameter: 0.2, tessellation: 6
        }, this.scene);
        leftBarrel.rotation.x = Math.PI / 2;
        leftBarrel.position = new Vector3(-0.3, 1.7, 0.5);
        leftBarrel.material = createLowPolyMaterial('fastLBarrelMat', PALETTE.TOWER_FAST_BARREL, this.scene);
        makeFlatShaded(leftBarrel);
        leftBarrel.parent = turret;

        // Right barrel (cylinder pointing forward)
        const rightBarrel = MeshBuilder.CreateCylinder('fastRightBarrel', {
            height: 1.0, diameter: 0.2, tessellation: 6
        }, this.scene);
        rightBarrel.rotation.x = Math.PI / 2;
        rightBarrel.position = new Vector3(0.3, 1.7, 0.5);
        rightBarrel.material = createLowPolyMaterial('fastRBarrelMat', PALETTE.TOWER_FAST_BARREL, this.scene);
        makeFlatShaded(rightBarrel);
        rightBarrel.parent = turret;

        // Bullet template (small IcoSphere)
        const bulletTemplate = MeshBuilder.CreateIcoSphere('fastBulletTemplate', {
            radius: 0.08, subdivisions: 0
        }, this.scene);
        makeFlatShaded(bulletTemplate);
        bulletTemplate.material = createEmissiveMaterial('fastBulletMat', PALETTE.TOWER_FAST, 0.5, this.scene);
        bulletTemplate.isVisible = false;

        // Track active bullets (visual only -- damage is handled by base fire())
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

                    // Alternate between left and right barrel
                    const xOffset = alternateBarrel ? -0.3 : 0.3;
                    alternateBarrel = !alternateBarrel;

                    const startPos = new Vector3(
                        this.position.x + xOffset,
                        this.position.y + 1.7,
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

            // Animate bullets
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
