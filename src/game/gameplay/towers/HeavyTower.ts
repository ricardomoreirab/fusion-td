import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class HeavyTower extends Tower {
    constructor(game: Game, position: Vector3) {
        super(game, position, 12, 40, 0.3, 125);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("heavyTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // Wide hex base
        const base = MeshBuilder.CreateCylinder('heavyBase', {
            height: 0.5, diameterTop: 2.2, diameterBottom: 2.4, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.25, 0);
        base.material = createLowPolyMaterial('heavyBaseMat', PALETTE.TOWER_HEAVY, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // Short wide box body
        const body = MeshBuilder.CreateBox('heavyBody', {
            width: 1.6, height: 0.8, depth: 1.6
        }, this.scene);
        body.position = new Vector3(0, 0.9, 0);
        body.material = createLowPolyMaterial('heavyBodyMat', PALETTE.TOWER_HEAVY, this.scene);
        makeFlatShaded(body);
        body.parent = this.mesh;

        // Turret group for rotation
        const turret = new Mesh("heavyTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;

        // Turret top box
        const turretTop = MeshBuilder.CreateBox('heavyTurretTop', {
            width: 1.0, height: 0.5, depth: 1.0
        }, this.scene);
        turretTop.position = new Vector3(0, 1.55, 0);
        turretTop.material = createLowPolyMaterial('heavyTurretMat', PALETTE.TOWER_HEAVY, this.scene);
        makeFlatShaded(turretTop);
        turretTop.parent = turret;

        // Cannon barrel (cylinder pointing forward)
        const barrel = MeshBuilder.CreateCylinder('heavyBarrel', {
            height: 1.8, diameter: 0.4, tessellation: 8
        }, this.scene);
        barrel.rotation.x = Math.PI / 2;
        barrel.position = new Vector3(0, 1.55, 0.9);
        barrel.material = createLowPolyMaterial('heavyBarrelMat', PALETTE.TOWER_HEAVY_BARREL, this.scene);
        makeFlatShaded(barrel);
        barrel.parent = turret;

        // Muzzle ring (wider cylinder at tip)
        const muzzle = MeshBuilder.CreateCylinder('heavyMuzzle', {
            height: 0.2, diameter: 0.55, tessellation: 8
        }, this.scene);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position = new Vector3(0, 1.55, 1.7);
        muzzle.material = createLowPolyMaterial('heavyMuzzleMat', PALETTE.TOWER_HEAVY_BARREL, this.scene);
        makeFlatShaded(muzzle);
        muzzle.parent = turret;

        // Cannonball template (IcoSphere)
        const ballTemplate = MeshBuilder.CreateIcoSphere('heavyBallTemplate', {
            radius: 0.18, subdivisions: 1
        }, this.scene);
        makeFlatShaded(ballTemplate);
        ballTemplate.material = createLowPolyMaterial('heavyBallMat', new Color3(0.1, 0.1, 0.1), this.scene);
        ballTemplate.isVisible = false;

        // Track active cannonballs (visual only -- damage is handled by base fire())
        const activeProjectiles: { mesh: Mesh, distance: number, maxDistance: number, targetEnemy: any, startPos: Vector3, direction: Vector3 }[] = [];
        let lastFireTime = 0;
        let isInitialized = false;
        setTimeout(() => { isInitialized = true; }, 500);

        const animationCallback = () => {
            if (this.targetEnemy && isInitialized) {
                const currentTime = performance.now();
                if (currentTime - lastFireTime > (1000 / this.fireRate)) {
                    lastFireTime = currentTime;

                    const ball = ballTemplate.clone("heavyBall_" + currentTime);
                    ball.isVisible = true;

                    // Start at muzzle position
                    const startPos = new Vector3(
                        this.position.x,
                        this.position.y + 1.55,
                        this.position.z
                    );
                    // Offset forward based on turret facing
                    const forward = new Vector3(
                        Math.sin(turret.rotation.y),
                        0,
                        Math.cos(turret.rotation.y)
                    );
                    const muzzlePos = startPos.add(forward.scale(1.7));
                    ball.position = muzzlePos;

                    if (this.targetEnemy) {
                        const targetPosition = this.targetEnemy.getPosition();
                        const direction = targetPosition.subtract(muzzlePos).normalize();
                        const maxDist = Vector3.Distance(muzzlePos, targetPosition);

                        activeProjectiles.push({
                            mesh: ball,
                            distance: 0,
                            maxDistance: maxDist,
                            targetEnemy: this.targetEnemy,
                            startPos: muzzlePos.clone(),
                            direction: direction
                        });

                        // Muzzle flash effect
                        this.createCannonFlash(muzzlePos);
                    }
                }
            }

            // Animate cannonballs
            for (let i = activeProjectiles.length - 1; i >= 0; i--) {
                const info = activeProjectiles[i];
                const speed = 0.5;
                info.distance += speed;

                // Parabolic arc
                const t = info.distance / info.maxDistance;
                const arcHeight = Math.sin(Math.PI * t) * 1.0;
                const newPos = info.startPos.add(info.direction.scale(info.distance));
                newPos.y += arcHeight;
                info.mesh.position = newPos;

                // Spin
                info.mesh.rotation.x += 0.1;
                info.mesh.rotation.z += 0.07;

                if (info.distance >= info.maxDistance) {
                    this.createHeavyImpactEffect(info.mesh.position);
                    info.mesh.dispose();
                    activeProjectiles.splice(i, 1);
                }
            }
        };

        this.scene.registerBeforeRender(animationCallback);
        this.mesh!.metadata = { activeProjectiles, animationCallback };
    }

    private createCannonFlash(position: Vector3): void {
        const ps = new ParticleSystem("cannonFlash", 12, this.scene);
        ps.emitter = position;
        ps.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
        ps.maxEmitBox = new Vector3(0.05, 0.05, 0.05);
        ps.color1 = new Color4(1.0, 0.7, 0.3, 1);
        ps.color2 = new Color4(0.8, 0.5, 0.1, 1);
        ps.colorDead = new Color4(0.4, 0.4, 0.4, 0);
        ps.minSize = 0.3;
        ps.maxSize = 0.7;
        ps.minLifeTime = 0.05;
        ps.maxLifeTime = 0.15;
        ps.emitRate = 150;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity = new Vector3(0, 1, 0);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 1.5;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 300); }, 60);
    }

    private createHeavyImpactEffect(position: Vector3): void {
        // Explosion burst (reduced from 200 to 60 particles, sizes doubled)
        const ps = new ParticleSystem("heavyImpact", 60, this.scene);
        ps.emitter = position;
        ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        ps.color1 = new Color4(1.0, 0.7, 0.3, 1);
        ps.color2 = new Color4(0.8, 0.3, 0.1, 1);
        ps.colorDead = new Color4(0.4, 0.4, 0.4, 0);
        ps.minSize = 0.4;
        ps.maxSize = 1.0;
        ps.minLifeTime = 0.1;
        ps.maxLifeTime = 0.3;
        ps.emitRate = 200;
        ps.manualEmitCount = 60;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity = new Vector3(0, -2, 0);
        ps.direction1 = new Vector3(-1, -1, -1);
        ps.direction2 = new Vector3(1, 1, 1);
        ps.minEmitPower = 2;
        ps.maxEmitPower = 5;
        ps.start();

        // Play explosion sound
        this.game.getAssetManager().playSound('explosion');

        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 150);
    }

    protected createProjectileEffect(targetPosition: Vector3): void {
        // Custom cannonball system handles visuals
    }

    protected updateVisuals(): void {
        // Could scale barrel on upgrade
    }

    public override dispose(): void {
        if (this.mesh && this.mesh.metadata) {
            if (this.mesh.metadata.animationCallback) {
                this.scene.unregisterBeforeRender(this.mesh.metadata.animationCallback);
            }
            const activeProjectiles = this.mesh.metadata.activeProjectiles;
            if (activeProjectiles) {
                for (let i = activeProjectiles.length - 1; i >= 0; i--) {
                    if (activeProjectiles[i].mesh && !activeProjectiles[i].mesh.isDisposed()) {
                        activeProjectiles[i].mesh.dispose();
                    }
                }
                activeProjectiles.length = 0;
            }
        }
        super.dispose();
    }
}
