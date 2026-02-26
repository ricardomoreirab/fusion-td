import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
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

        // --- 1. Massive octagonal base with reinforced look ---
        const baseOuter = MeshBuilder.CreateCylinder('heavyBaseOuter', {
            height: 0.35, diameterTop: 2.4, diameterBottom: 2.6, tessellation: 8
        }, this.scene);
        baseOuter.position = new Vector3(0, 0.175, 0);
        baseOuter.material = createLowPolyMaterial('heavyBaseOuterMat', PALETTE.ROCK_DARK, this.scene);
        makeFlatShaded(baseOuter);
        baseOuter.parent = this.mesh;

        const baseInner = MeshBuilder.CreateCylinder('heavyBaseInner', {
            height: 0.25, diameterTop: 2.2, diameterBottom: 2.4, tessellation: 8
        }, this.scene);
        baseInner.position = new Vector3(0, 0.47, 0);
        baseInner.material = createLowPolyMaterial('heavyBaseInnerMat', PALETTE.TOWER_HEAVY, this.scene);
        makeFlatShaded(baseInner);
        baseInner.parent = this.mesh;

        // --- 2. Squat fortress body ---
        const body = MeshBuilder.CreateBox('heavyBody', {
            width: 1.7, height: 0.8, depth: 1.7
        }, this.scene);
        body.position = new Vector3(0, 1.0, 0);
        body.material = createLowPolyMaterial('heavyBodyMat', PALETTE.TOWER_HEAVY, this.scene);
        makeFlatShaded(body);
        body.parent = this.mesh;

        // Corner buttresses
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const buttress = MeshBuilder.CreateBox(`buttress${i}`, {
                width: 0.3, height: 1.0, depth: 0.3
            }, this.scene);
            buttress.position = new Vector3(
                Math.sin(angle) * 0.85,
                0.85,
                Math.cos(angle) * 0.85
            );
            buttress.rotation.y = angle;
            buttress.material = createLowPolyMaterial(`buttressMat${i}`, PALETTE.ROCK_DARK, this.scene);
            makeFlatShaded(buttress);
            buttress.parent = this.mesh;
        }

        // --- 3. Turret group for rotation ---
        const turret = new Mesh("heavyTurret", this.scene);
        turret.position = new Vector3(0, 0, 0);
        turret.parent = this.mesh;

        // Turret housing (rotates with cannon)
        const turretBox = MeshBuilder.CreateBox('turretBox', {
            width: 1.1, height: 0.5, depth: 1.1
        }, this.scene);
        turretBox.position = new Vector3(0, 1.65, 0);
        turretBox.material = createLowPolyMaterial('turretBoxMat', PALETTE.TOWER_HEAVY, this.scene);
        makeFlatShaded(turretBox);
        turretBox.parent = turret;

        // Angled armor plate on front
        const armorPlate = MeshBuilder.CreateBox('armorPlate', {
            width: 0.8, height: 0.45, depth: 0.12
        }, this.scene);
        armorPlate.position = new Vector3(0, 1.65, 0.6);
        armorPlate.rotation.x = 0.2;
        armorPlate.material = createLowPolyMaterial('armorPlateMat', PALETTE.TOWER_HEAVY_BARREL, this.scene);
        makeFlatShaded(armorPlate);
        armorPlate.parent = turret;

        // --- 4. Heavy cannon barrel (thick with reinforcement rings) ---
        const barrel = MeshBuilder.CreateCylinder('heavyBarrel', {
            height: 1.6, diameterTop: 0.3, diameterBottom: 0.4, tessellation: 8
        }, this.scene);
        barrel.rotation.x = Math.PI / 2;
        barrel.position = new Vector3(0, 1.65, 0.9);
        barrel.material = createLowPolyMaterial('heavyBarrelMat', PALETTE.TOWER_HEAVY_BARREL, this.scene);
        makeFlatShaded(barrel);
        barrel.parent = turret;

        // Barrel reinforcement rings
        for (let i = 0; i < 3; i++) {
            const ring = MeshBuilder.CreateTorus(`barrelRing${i}`, {
                diameter: 0.48, thickness: 0.06, tessellation: 8
            }, this.scene);
            ring.rotation.x = Math.PI / 2;
            ring.position = new Vector3(0, 1.65, 0.3 + i * 0.45);
            ring.material = createLowPolyMaterial(`ringMat${i}`, PALETTE.ROCK_DARK, this.scene);
            makeFlatShaded(ring);
            ring.parent = turret;
        }

        // Muzzle flare cap
        const muzzle = MeshBuilder.CreateCylinder('muzzleCap', {
            height: 0.12, diameterTop: 0.5, diameterBottom: 0.38, tessellation: 8
        }, this.scene);
        muzzle.rotation.x = Math.PI / 2;
        muzzle.position = new Vector3(0, 1.65, 1.7);
        muzzle.material = createLowPolyMaterial('muzzleCapMat', PALETTE.TOWER_HEAVY_BARREL, this.scene);
        makeFlatShaded(muzzle);
        muzzle.parent = turret;

        // --- 5. Idle smoke wisps from barrel ---
        const smokePS = new ParticleSystem("barrelSmoke", 8, this.scene);
        smokePS.emitter = new Vector3(this.position.x, this.position.y + 1.65, this.position.z);
        smokePS.minEmitBox = new Vector3(-0.1, 0, 0.7);
        smokePS.maxEmitBox = new Vector3(0.1, 0.1, 0.9);
        smokePS.color1 = new Color4(0.5, 0.5, 0.5, 0.3);
        smokePS.color2 = new Color4(0.4, 0.4, 0.4, 0.2);
        smokePS.colorDead = new Color4(0.3, 0.3, 0.3, 0);
        smokePS.minSize = 0.2;
        smokePS.maxSize = 0.5;
        smokePS.minLifeTime = 1.0;
        smokePS.maxLifeTime = 2.0;
        smokePS.emitRate = 3;
        smokePS.direction1 = new Vector3(-0.1, 0.3, 0.1);
        smokePS.direction2 = new Vector3(0.1, 0.5, 0.2);
        smokePS.minEmitPower = 0.1;
        smokePS.maxEmitPower = 0.3;
        smokePS.updateSpeed = 0.01;
        smokePS.start();

        // --- 6. Cannonball template & projectile system ---
        const ballTemplate = MeshBuilder.CreateIcoSphere('heavyBallTemplate', {
            radius: 0.18, subdivisions: 1
        }, this.scene);
        makeFlatShaded(ballTemplate);
        ballTemplate.material = createLowPolyMaterial('heavyBallMat', new Color3(0.1, 0.1, 0.1), this.scene);
        ballTemplate.isVisible = false;

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

                    const startPos = new Vector3(
                        this.position.x,
                        this.position.y + 1.65,
                        this.position.z
                    );
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

                        this.createCannonFlash(muzzlePos);
                    }
                }
            }

            for (let i = activeProjectiles.length - 1; i >= 0; i--) {
                const info = activeProjectiles[i];
                const speed = 0.5;
                info.distance += speed;

                const t = info.distance / info.maxDistance;
                const arcHeight = Math.sin(Math.PI * t) * 1.2;
                const newPos = info.startPos.add(info.direction.scale(info.distance));
                newPos.y += arcHeight;
                info.mesh.position = newPos;

                info.mesh.rotation.x += 0.12;
                info.mesh.rotation.z += 0.08;

                if (info.distance >= info.maxDistance) {
                    this.createHeavyImpactEffect(info.mesh.position);
                    info.mesh.dispose();
                    activeProjectiles.splice(i, 1);
                }
            }
        };

        this.scene.registerBeforeRender(animationCallback);
        this.mesh!.metadata = { activeProjectiles, animationCallback, smokePS };
    }

    private createCannonFlash(position: Vector3): void {
        const ps = new ParticleSystem("cannonFlash", 15, this.scene);
        ps.emitter = position;
        ps.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
        ps.maxEmitBox = new Vector3(0.05, 0.05, 0.05);
        ps.color1 = new Color4(1.0, 0.8, 0.4, 1);
        ps.color2 = new Color4(1.0, 0.5, 0.1, 1);
        ps.colorDead = new Color4(0.5, 0.4, 0.3, 0);
        ps.minSize = 0.3;
        ps.maxSize = 0.8;
        ps.minLifeTime = 0.05;
        ps.maxLifeTime = 0.15;
        ps.emitRate = 150;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.gravity = new Vector3(0, 1, 0);
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 2.0;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 300); }, 60);
    }

    private createHeavyImpactEffect(position: Vector3): void {
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
            if (this.mesh.metadata.smokePS) {
                this.mesh.metadata.smokePS.stop();
                this.mesh.metadata.smokePS.dispose();
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
