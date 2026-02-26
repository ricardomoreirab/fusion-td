import { Vector3, MeshBuilder, Color3, Mesh, Space, ParticleSystem, Color4 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class SniperTower extends Tower {
    constructor(game: Game, position: Vector3) {
        super(game, position, 20, 30, 0.5, 100);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("sniperTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // Narrow hex base
        const base = MeshBuilder.CreateCylinder('sniperBase', {
            height: 0.4, diameterTop: 1.4, diameterBottom: 1.6, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.2, 0);
        base.material = createLowPolyMaterial('sniperBaseMat', PALETTE.TOWER_SNIPER, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // Very tall thin pillar
        const pillar = MeshBuilder.CreateBox('sniperPillar', {
            width: 0.5, height: 3, depth: 0.5
        }, this.scene);
        pillar.position = new Vector3(0, 1.9, 0);
        pillar.material = createLowPolyMaterial('sniperPillarMat', PALETTE.TOWER_SNIPER, this.scene);
        makeFlatShaded(pillar);
        pillar.parent = this.mesh;

        // Small platform near top
        const platform = MeshBuilder.CreateBox('sniperPlatform', {
            width: 0.8, height: 0.1, depth: 0.8
        }, this.scene);
        platform.position = new Vector3(0, 3.3, 0);
        platform.material = createLowPolyMaterial('sniperPlatMat', PALETTE.TOWER_SNIPER, this.scene);
        makeFlatShaded(platform);
        platform.parent = this.mesh;

        // Emissive lens sphere at top (IcoSphere subdivisions: 1)
        const lens = MeshBuilder.CreateIcoSphere('sniperLens', {
            radius: 0.3, subdivisions: 1
        }, this.scene);
        lens.position = new Vector3(0, 3.65, 0);
        lens.material = createEmissiveMaterial('sniperLensMat', PALETTE.TOWER_SNIPER_LENS, 0.8, this.scene);
        makeFlatShaded(lens);
        lens.parent = this.mesh;

        // Bullet template (IcoSphere)
        const bulletTemplate = MeshBuilder.CreateIcoSphere('sniperBulletTemplate', {
            radius: 0.12, subdivisions: 0
        }, this.scene);
        makeFlatShaded(bulletTemplate);
        const bulletMat = createEmissiveMaterial('sniperBulletMat', PALETTE.TOWER_SNIPER_LENS, 0.6, this.scene);
        bulletTemplate.material = bulletMat;
        bulletTemplate.isVisible = false;

        // Track active bullets (visual only -- damage is handled by base fire())
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
                        this.position.y + 3.65,
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

            // Animate bullets
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
