import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Space, ParticleSystem, Texture, Color4 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { PALETTE } from '../../rendering/StyleConstants';
import { createLowPolyMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';

export class BasicTower extends Tower {
    constructor(game: Game, position: Vector3) {
        super(game, position, 10, 10, 1, 50);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("basicTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // Hex base
        const base = MeshBuilder.CreateCylinder('towerBase', {
            height: 0.4, diameterTop: 1.8, diameterBottom: 2.0, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.2, 0);
        base.material = createLowPolyMaterial('baseMat', PALETTE.TOWER_BASIC, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // Box pillar
        const pillar = MeshBuilder.CreateBox('pillar', {
            width: 0.8, height: 1.2, depth: 0.8
        }, this.scene);
        pillar.position = new Vector3(0, 1.0, 0);
        pillar.material = createLowPolyMaterial('pillarMat', PALETTE.TOWER_BASIC, this.scene);
        makeFlatShaded(pillar);
        pillar.parent = this.mesh;

        // Platform
        const platform = MeshBuilder.CreateBox('platform', {
            width: 1.4, height: 0.15, depth: 1.4
        }, this.scene);
        platform.position = new Vector3(0, 1.7, 0);
        platform.material = createLowPolyMaterial('platformMat', PALETTE.TOWER_BASIC, this.scene);
        makeFlatShaded(platform);
        platform.parent = this.mesh;

        // Pyramid roof (cone with 4 sides)
        const roof = MeshBuilder.CreateCylinder('roof', {
            height: 0.8, diameterTop: 0, diameterBottom: 1.6, tessellation: 4
        }, this.scene);
        roof.position = new Vector3(0, 2.2, 0);
        roof.rotation.y = Math.PI / 4;
        roof.material = createLowPolyMaterial('roofMat', PALETTE.TOWER_BASIC_ROOF, this.scene);
        makeFlatShaded(roof);
        roof.parent = this.mesh;

        // Create turret group for rotation (holds the firing mechanism)
        const turret = new Mesh("ballistaTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;

        // Simple crossbow arm on turret
        const arm = MeshBuilder.CreateBox('arm', {
            width: 1.0, height: 0.1, depth: 0.1
        }, this.scene);
        arm.position = new Vector3(0, 1.85, 0.3);
        arm.material = createLowPolyMaterial('armMat', PALETTE.TOWER_BASIC_ROOF, this.scene);
        arm.parent = turret;

        // Create arrow template for firing (icosphere bullet)
        const arrowTemplate = MeshBuilder.CreateIcoSphere('basicArrowTemplate', {
            radius: 0.1, subdivisions: 0
        }, this.scene);
        makeFlatShaded(arrowTemplate);
        const arrowMat = createLowPolyMaterial('arrowMat', new Color3(0.8, 0.8, 0.8), this.scene);
        arrowMat.emissiveColor = new Color3(0.4, 0.4, 0.4);
        arrowTemplate.material = arrowMat;
        arrowTemplate.isVisible = false;

        // Track active bullets
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
        ps.color1 = new Color4(0.8, 0.8, 0.8, 1);
        ps.color2 = new Color4(0.5, 0.5, 0.5, 1);
        ps.colorDead = new Color4(0.3, 0.3, 0.3, 0);
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
        // Could scale parts on upgrade but keeping simple for now
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
