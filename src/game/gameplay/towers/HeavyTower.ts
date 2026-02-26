import { Vector3, MeshBuilder, Color3, Mesh, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class HeavyTower extends Tower {
    private levelMeshes: Mesh[] = [];

    constructor(game: Game, position: Vector3) {
        super(game, position, 12, 40, 0.3, 125);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("heavyTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Wide stone siege platform base ---
        const base = MeshBuilder.CreateCylinder('siegeBase', {
            height: 0.35, diameterTop: 2.5, diameterBottom: 2.7, tessellation: 8
        }, this.scene);
        base.position = new Vector3(0, 0.175, 0);
        base.material = createLowPolyMaterial('siegeBaseMat', PALETTE.TOWER_HEAVY_SIEGE, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // --- 2. Low stone wall ring around platform ---
        const wallRing = MeshBuilder.CreateCylinder('wallRing', {
            height: 0.4, diameterTop: 2.2, diameterBottom: 2.4, tessellation: 8
        }, this.scene);
        wallRing.position = new Vector3(0, 0.55, 0);
        wallRing.material = createLowPolyMaterial('wallRingMat', PALETTE.TOWER_HEAVY_SIEGE, this.scene);
        makeFlatShaded(wallRing);
        wallRing.parent = this.mesh;

        // --- 3. 4 low merlons on platform edge ---
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const merlon = MeshBuilder.CreateBox(`merlon${i}`, {
                width: 0.3, height: 0.25, depth: 0.18
            }, this.scene);
            merlon.position = new Vector3(
                Math.sin(angle) * 1.05,
                0.88,
                Math.cos(angle) * 1.05
            );
            merlon.rotation.y = angle;
            merlon.material = createLowPolyMaterial(`merlonMat${i}`, PALETTE.TOWER_HEAVY_SIEGE, this.scene);
            makeFlatShaded(merlon);
            merlon.parent = this.mesh;
        }

        // --- 4. Trebuchet support frame (2 tall wooden A-frame posts) ---
        const turret = new Mesh("heavyTurret", this.scene);
        turret.parent = this.mesh;

        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -0.4 : 0.4;
            const supportPost = MeshBuilder.CreateBox(`supportPost${i}`, {
                width: 0.14, height: 1.2, depth: 0.14
            }, this.scene);
            supportPost.position = new Vector3(side, 1.35, 0);
            supportPost.material = createLowPolyMaterial(`supportPostMat${i}`, PALETTE.TOWER_HEAVY_ARM, this.scene);
            makeFlatShaded(supportPost);
            supportPost.parent = turret;
        }

        // Crossbeam axle between posts
        const axle = MeshBuilder.CreateCylinder('axle', {
            height: 0.95, diameter: 0.1, tessellation: 5
        }, this.scene);
        axle.rotation.z = Math.PI / 2;
        axle.position = new Vector3(0, 1.7, 0);
        axle.material = createLowPolyMaterial('axleMat', PALETTE.TOWER_HEAVY_IRON, this.scene);
        makeFlatShaded(axle);
        axle.parent = turret;

        // --- 5. Trebuchet arm (long wooden beam, angled) ---
        const arm = MeshBuilder.CreateBox('trebArm', {
            width: 0.1, height: 0.1, depth: 2.2
        }, this.scene);
        arm.position = new Vector3(0, 1.85, 0.2);
        arm.rotation.x = -0.25;
        arm.material = createLowPolyMaterial('trebArmMat', PALETTE.TOWER_HEAVY_ARM, this.scene);
        makeFlatShaded(arm);
        arm.parent = turret;

        // Counterweight ball on short end
        const counterweight = MeshBuilder.CreateIcoSphere('counterweight', {
            radius: 0.2, subdivisions: 1
        }, this.scene);
        counterweight.position = new Vector3(0, 1.55, -0.85);
        counterweight.material = createLowPolyMaterial('counterweightMat', PALETTE.TOWER_HEAVY_IRON, this.scene);
        makeFlatShaded(counterweight);
        counterweight.parent = turret;

        // Sling rope at long end (thin box)
        const sling = MeshBuilder.CreateBox('sling', {
            width: 0.04, height: 0.4, depth: 0.04
        }, this.scene);
        sling.position = new Vector3(0, 1.7, 1.15);
        sling.material = createLowPolyMaterial('slingMat', PALETTE.TOWER_HEAVY_ARM, this.scene);
        sling.parent = turret;

        // --- 6. Idle arm rock animation ---
        const rockAnim = new Animation("armRock", "rotation.x", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        rockAnim.setKeys([
            { frame: 0, value: -0.25 },
            { frame: 45, value: -0.15 },
            { frame: 90, value: -0.25 }
        ]);
        arm.animations = [rockAnim];
        this.scene.beginAnimation(arm, 0, 90, true);

        // --- 7. Smoke wisps from arm pivot ---
        const smokePS = new ParticleSystem("barrelSmoke", 6, this.scene);
        smokePS.emitter = new Vector3(this.position.x, this.position.y + 1.7, this.position.z);
        smokePS.minEmitBox = new Vector3(-0.15, 0, -0.15);
        smokePS.maxEmitBox = new Vector3(0.15, 0.1, 0.15);
        smokePS.color1 = new Color4(0.5, 0.5, 0.5, 0.25);
        smokePS.color2 = new Color4(0.4, 0.4, 0.4, 0.15);
        smokePS.colorDead = new Color4(0.3, 0.3, 0.3, 0);
        smokePS.minSize = 0.2;
        smokePS.maxSize = 0.5;
        smokePS.minLifeTime = 1.0;
        smokePS.maxLifeTime = 2.0;
        smokePS.emitRate = 2;
        smokePS.direction1 = new Vector3(-0.1, 0.4, -0.1);
        smokePS.direction2 = new Vector3(0.1, 0.6, 0.1);
        smokePS.minEmitPower = 0.1;
        smokePS.maxEmitPower = 0.25;
        smokePS.updateSpeed = 0.01;
        smokePS.start();

        // --- 8. Projectile system (arcing boulder) ---
        const ballTemplate = MeshBuilder.CreateIcoSphere('heavyBallTemplate', {
            radius: 0.18, subdivisions: 1
        }, this.scene);
        makeFlatShaded(ballTemplate);
        ballTemplate.material = createLowPolyMaterial('heavyBallMat', new Color3(0.35, 0.28, 0.18), this.scene);
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
                        this.position.y + 1.85,
                        this.position.z
                    );
                    const forward = new Vector3(
                        Math.sin(turret.rotation.y),
                        0,
                        Math.cos(turret.rotation.y)
                    );
                    const muzzlePos = startPos.add(forward.scale(1.15));
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
                const arcHeight = Math.sin(Math.PI * t) * 1.5;
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
        // Custom trebuchet projectile system handles visuals
    }

    protected updateVisuals(): void {
        this.levelMeshes.forEach(m => m.dispose());
        this.levelMeshes = [];

        if (this.level >= 2) {
            // Reinforced stone battlements — 4 more merlons
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
                const merlon = MeshBuilder.CreateBox(`siegeMerlon_l2_${i}`, {
                    width: 0.25, height: 0.28, depth: 0.16
                }, this.scene);
                merlon.position = new Vector3(
                    Math.sin(angle) * 1.05,
                    0.88,
                    Math.cos(angle) * 1.05
                );
                merlon.rotation.y = angle;
                merlon.material = createLowPolyMaterial(`siegeMerlonMat_l2_${i}`, PALETTE.TOWER_HEAVY_SIEGE, this.scene);
                makeFlatShaded(merlon);
                merlon.parent = this.mesh;
                this.levelMeshes.push(merlon);
            }

            // Iron counterweight box (heavier, visible)
            const ironBox = MeshBuilder.CreateBox('ironBox_l2', {
                width: 0.32, height: 0.32, depth: 0.32
            }, this.scene);
            ironBox.position = new Vector3(0, 1.4, -1.0);
            ironBox.material = createLowPolyMaterial('ironBoxMat_l2', PALETTE.TOWER_HEAVY_IRON, this.scene);
            makeFlatShaded(ironBox);
            ironBox.parent = this.mesh;
            this.levelMeshes.push(ironBox);

            // Chain torus at pivot
            const chain = MeshBuilder.CreateTorus('chain_l2', {
                diameter: 0.5, thickness: 0.04, tessellation: 8
            }, this.scene);
            chain.position = new Vector3(0, 1.7, 0);
            chain.material = createLowPolyMaterial('chainMat_l2', PALETTE.TOWER_HEAVY_IRON, this.scene);
            makeFlatShaded(chain);
            chain.parent = this.mesh;
            this.levelMeshes.push(chain);

            // Arm guide rail posts (2 upright stone pillars flanking arm)
            for (let i = 0; i < 2; i++) {
                const side = i === 0 ? -0.55 : 0.55;
                const rail = MeshBuilder.CreateBox(`rail_l2_${i}`, {
                    width: 0.12, height: 0.6, depth: 0.12
                }, this.scene);
                rail.position = new Vector3(side, 1.65, 0.4);
                rail.material = createLowPolyMaterial(`railMat_l2_${i}`, PALETTE.TOWER_HEAVY_SIEGE, this.scene);
                makeFlatShaded(rail);
                rail.parent = this.mesh;
                this.levelMeshes.push(rail);
            }
        }

        if (this.level >= 3) {
            // 4 corner mini towers with conical caps
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
                const miniTower = MeshBuilder.CreateCylinder(`cornerTower_l3_${i}`, {
                    height: 0.8, diameter: 0.4, tessellation: 5
                }, this.scene);
                miniTower.position = new Vector3(
                    Math.sin(angle) * 1.3,
                    0.55,
                    Math.cos(angle) * 1.3
                );
                miniTower.material = createLowPolyMaterial(`cornerTowerMat_l3_${i}`, PALETTE.TOWER_HEAVY_SIEGE, this.scene);
                makeFlatShaded(miniTower);
                miniTower.parent = this.mesh;
                this.levelMeshes.push(miniTower);

                const cap = MeshBuilder.CreateCylinder(`cornerCap_l3_${i}`, {
                    height: 0.25, diameterTop: 0, diameterBottom: 0.44, tessellation: 5
                }, this.scene);
                cap.position = new Vector3(
                    Math.sin(angle) * 1.3,
                    1.07,
                    Math.cos(angle) * 1.3
                );
                cap.material = createLowPolyMaterial(`cornerCapMat_l3_${i}`, PALETTE.TOWER_HEAVY_ARM, this.scene);
                makeFlatShaded(cap);
                cap.parent = this.mesh;
                this.levelMeshes.push(cap);
            }

            // Greek fire orb (emissive orange-green)
            const fireOrb = MeshBuilder.CreateIcoSphere('fireOrb_l3', {
                radius: 0.2, subdivisions: 1
            }, this.scene);
            fireOrb.position = new Vector3(0, 2.3, 1.0);
            fireOrb.material = createEmissiveMaterial('fireOrbMat_l3', new Color3(0.85, 0.55, 0.12), 0.85, this.scene);
            makeFlatShaded(fireOrb);
            fireOrb.parent = this.mesh;
            this.levelMeshes.push(fireOrb);

            // Iron-reinforced arm bar
            const ironArm = MeshBuilder.CreateBox('ironArm_l3', {
                width: 0.14, height: 0.06, depth: 2.0
            }, this.scene);
            ironArm.position = new Vector3(0, 1.92, 0.2);
            ironArm.rotation.x = -0.2;
            ironArm.material = createLowPolyMaterial('ironArmMat_l3', PALETTE.TOWER_HEAVY_IRON, this.scene);
            makeFlatShaded(ironArm);
            ironArm.parent = this.mesh;
            this.levelMeshes.push(ironArm);

            // Crossed chains on base
            for (let i = 0; i < 2; i++) {
                const cross = MeshBuilder.CreateBox(`chainCross_l3_${i}`, {
                    width: 1.8, height: 0.04, depth: 0.05
                }, this.scene);
                cross.position = new Vector3(0, 0.56, 0);
                cross.rotation.y = i * Math.PI / 4;
                cross.material = createLowPolyMaterial(`chainCrossMat_l3_${i}`, PALETTE.TOWER_HEAVY_IRON, this.scene);
                makeFlatShaded(cross);
                cross.parent = this.mesh;
                this.levelMeshes.push(cross);
            }
        }
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
