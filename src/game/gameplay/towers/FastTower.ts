import { Vector3, MeshBuilder, Color3, Mesh, Space, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower } from './Tower';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { PALETTE } from '../../rendering/StyleConstants';

export class FastTower extends Tower {
    private levelMeshes: Mesh[] = [];

    constructor(game: Game, position: Vector3) {
        super(game, position, 8, 5, 4, 75);
    }

    protected createMesh(): void {
        this.mesh = new Mesh("fastTowerRoot", this.scene);
        this.mesh.position = this.position.clone();

        // --- 1. Stone foundation slab ---
        const foundation = MeshBuilder.CreateCylinder('foundation', {
            height: 0.18, diameterTop: 1.7, diameterBottom: 1.85, tessellation: 4
        }, this.scene);
        foundation.position = new Vector3(0, 0.09, 0);
        foundation.rotation.y = Math.PI / 4;
        foundation.material = createLowPolyMaterial('foundationMat', PALETTE.TOWER_BASIC_MERLON, this.scene);
        makeFlatShaded(foundation);
        foundation.parent = this.mesh;

        // --- 2. Four timber log posts at square corners ---
        const postPositions = [
            new Vector3(-0.45, 0.75, -0.45),
            new Vector3(0.45, 0.75, -0.45),
            new Vector3(0.45, 0.75, 0.45),
            new Vector3(-0.45, 0.75, 0.45)
        ];
        for (let i = 0; i < 4; i++) {
            const post = MeshBuilder.CreateCylinder(`post${i}`, {
                height: 1.5, diameter: 0.16, tessellation: 5
            }, this.scene);
            post.position = postPositions[i];
            post.material = createLowPolyMaterial(`postMat${i}`, PALETTE.TOWER_FAST_TIMBER, this.scene);
            makeFlatShaded(post);
            post.parent = this.mesh;
        }

        // --- 3. Diagonal cross-braces between posts ---
        const braceAngle = Math.atan2(1.5, 0.9);
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const brace = MeshBuilder.CreateBox(`brace${i}`, {
                width: 0.06, height: 1.1, depth: 0.06
            }, this.scene);
            const cx = Math.sin(angle) * 0.45;
            const cz = Math.cos(angle) * 0.45;
            brace.position = new Vector3(cx, 0.65, cz);
            brace.rotation.y = angle;
            brace.rotation.z = 0.45;
            brace.material = createLowPolyMaterial(`braceMat${i}`, PALETTE.TOWER_FAST_TIMBER, this.scene);
            makeFlatShaded(brace);
            brace.parent = this.mesh;
        }

        // --- 4. Wooden platform on top ---
        const platform = MeshBuilder.CreateBox('platform', {
            width: 1.15, height: 0.1, depth: 1.15
        }, this.scene);
        platform.position = new Vector3(0, 1.55, 0);
        platform.material = createLowPolyMaterial('platformMat', PALETTE.TOWER_FAST_TIMBER, this.scene);
        makeFlatShaded(platform);
        platform.parent = this.mesh;

        // --- 5. Low wooden railing around platform ---
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const railing = MeshBuilder.CreateBox(`railing${i}`, {
                width: 0.95, height: 0.12, depth: 0.06
            }, this.scene);
            railing.position = new Vector3(
                Math.sin(angle) * 0.55,
                1.67,
                Math.cos(angle) * 0.55
            );
            railing.rotation.y = angle;
            railing.material = createLowPolyMaterial(`railingMat${i}`, PALETTE.TOWER_FAST_TIMBER, this.scene);
            makeFlatShaded(railing);
            railing.parent = this.mesh;
        }

        // --- 6. Repeating crossbow on platform ---
        const turret = new Mesh("fastTurret", this.scene);
        turret.parent = this.mesh;

        // Crossbow body
        const bowBody = MeshBuilder.CreateBox('bowBody', {
            width: 0.3, height: 0.18, depth: 0.55
        }, this.scene);
        bowBody.position = new Vector3(0, 1.72, 0.08);
        bowBody.material = createLowPolyMaterial('bowBodyMat', PALETTE.TOWER_FAST_TORSION, this.scene);
        makeFlatShaded(bowBody);
        bowBody.parent = turret;

        // Crossbow arms
        const leftArm = MeshBuilder.CreateBox('leftArm', {
            width: 0.42, height: 0.06, depth: 0.06
        }, this.scene);
        leftArm.position = new Vector3(-0.25, 1.72, 0.35);
        leftArm.rotation.y = -0.25;
        leftArm.material = createLowPolyMaterial('leftArmMat', PALETTE.TOWER_FAST_TIMBER, this.scene);
        makeFlatShaded(leftArm);
        leftArm.parent = turret;

        const rightArm = MeshBuilder.CreateBox('rightArm', {
            width: 0.42, height: 0.06, depth: 0.06
        }, this.scene);
        rightArm.position = new Vector3(0.25, 1.72, 0.35);
        rightArm.rotation.y = 0.25;
        rightArm.material = createLowPolyMaterial('rightArmMat', PALETTE.TOWER_FAST_TIMBER, this.scene);
        makeFlatShaded(rightArm);
        rightArm.parent = turret;

        // --- 7. Projectile system ---
        const bulletTemplate = MeshBuilder.CreateIcoSphere('fastBulletTemplate', {
            radius: 0.08, subdivisions: 0
        }, this.scene);
        makeFlatShaded(bulletTemplate);
        bulletTemplate.material = createEmissiveMaterial('fastBulletMat', new Color3(0.75, 0.6, 0.25), 0.5, this.scene);
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
                        this.position.y + 1.72,
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
        this.levelMeshes.forEach(m => m.dispose());
        this.levelMeshes = [];

        if (this.level >= 2) {
            // Replace wood with stone column underneath
            const stoneCol = MeshBuilder.CreateCylinder('stoneCol_l2', {
                height: 0.5, diameterTop: 1.1, diameterBottom: 1.3, tessellation: 6
            }, this.scene);
            stoneCol.position = new Vector3(0, 0.43, 0);
            stoneCol.material = createLowPolyMaterial('stoneColMat_l2', PALETTE.TOWER_BASIC_STONE, this.scene);
            makeFlatShaded(stoneCol);
            stoneCol.parent = this.mesh;
            this.levelMeshes.push(stoneCol);

            // Torsion spring coils (bronze torus on each crossbow arm side)
            for (let i = 0; i < 2; i++) {
                const side = i === 0 ? -1 : 1;
                const coil = MeshBuilder.CreateTorus(`coil_l2_${i}`, {
                    diameter: 0.25, thickness: 0.05, tessellation: 8
                }, this.scene);
                coil.position = new Vector3(side * 0.38, 1.72, 0.32);
                coil.rotation.x = Math.PI / 2;
                coil.material = createLowPolyMaterial(`coilMat_l2_${i}`, PALETTE.TOWER_FAST_TORSION, this.scene);
                makeFlatShaded(coil);
                coil.parent = this.mesh;
                this.levelMeshes.push(coil);
            }

            // Protective stone parapet (front shield)
            const parapet = MeshBuilder.CreateBox('parapet_l2', {
                width: 1.0, height: 0.3, depth: 0.1
            }, this.scene);
            parapet.position = new Vector3(0, 1.75, 0.6);
            parapet.material = createLowPolyMaterial('parapetMat_l2', PALETTE.TOWER_BASIC_STONE, this.scene);
            makeFlatShaded(parapet);
            parapet.parent = this.mesh;
            this.levelMeshes.push(parapet);

            // Arrow slit in parapet
            const parapetSlit = MeshBuilder.CreateBox('parapetSlit_l2', {
                width: 0.04, height: 0.2, depth: 0.04
            }, this.scene);
            parapetSlit.position = new Vector3(0, 1.75, 0.66);
            parapetSlit.material = createEmissiveMaterial('parapetSlitMat_l2', new Color3(0.7, 0.55, 0.2), 0.5, this.scene);
            parapetSlit.parent = this.mesh;
            this.levelMeshes.push(parapetSlit);
        }

        if (this.level >= 3) {
            // Full stone fortification base
            const stoneFort = MeshBuilder.CreateCylinder('stoneFort_l3', {
                height: 0.6, diameterTop: 1.5, diameterBottom: 1.7, tessellation: 4
            }, this.scene);
            stoneFort.position = new Vector3(0, 0.3, 0);
            stoneFort.rotation.y = Math.PI / 4;
            stoneFort.material = createLowPolyMaterial('stoneFortMat_l3', PALETTE.TOWER_BASIC_MERLON, this.scene);
            makeFlatShaded(stoneFort);
            stoneFort.parent = this.mesh;
            this.levelMeshes.push(stoneFort);

            // Emissive power coil rings (3 around barrel area)
            for (let i = 0; i < 3; i++) {
                const ring = MeshBuilder.CreateTorus(`powerRing_l3_${i}`, {
                    diameter: 0.2, thickness: 0.035, tessellation: 6
                }, this.scene);
                ring.rotation.x = Math.PI / 2;
                ring.position = new Vector3(0, 1.72, 0.15 + i * 0.12);
                ring.material = createEmissiveMaterial(`powerRingMat_l3_${i}`, new Color3(0.8, 0.7, 0.3), 0.65, this.scene);
                ring.parent = this.mesh;
                this.levelMeshes.push(ring);
            }

            // Iron reinforcement plates on sides
            for (let i = 0; i < 2; i++) {
                const side = i === 0 ? -1 : 1;
                const plate = MeshBuilder.CreateBox(`ironPlate_l3_${i}`, {
                    width: 0.08, height: 0.35, depth: 0.6
                }, this.scene);
                plate.position = new Vector3(side * 0.55, 1.72, 0.1);
                plate.material = createLowPolyMaterial(`ironPlateMat_l3_${i}`, PALETTE.TOWER_HEAVY_IRON, this.scene);
                makeFlatShaded(plate);
                plate.parent = this.mesh;
                this.levelMeshes.push(plate);
            }

            // Glowing bolt nock at front
            const boltNock = MeshBuilder.CreateIcoSphere('boltNock_l3', {
                radius: 0.06, subdivisions: 0
            }, this.scene);
            boltNock.position = new Vector3(0, 1.72, 0.55);
            boltNock.material = createEmissiveMaterial('boltNockMat_l3', new Color3(1.0, 0.9, 0.4), 0.9, this.scene);
            boltNock.parent = this.mesh;
            this.levelMeshes.push(boltNock);
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
