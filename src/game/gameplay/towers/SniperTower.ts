import { Vector3, MeshBuilder, Color3, Mesh, Space, ParticleSystem, Color4, Animation } from '@babylonjs/core';
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

        // --- 1. Narrow hexagonal base ---
        const base = MeshBuilder.CreateCylinder('sniperBase', {
            height: 0.3, diameterTop: 1.3, diameterBottom: 1.5, tessellation: 6
        }, this.scene);
        base.position = new Vector3(0, 0.15, 0);
        base.material = createLowPolyMaterial('sniperBaseMat', PALETTE.ROCK_DARK, this.scene);
        makeFlatShaded(base);
        base.parent = this.mesh;

        // --- 2. First tier -- wider lower section ---
        const lowerTier = MeshBuilder.CreateCylinder('lowerTier', {
            height: 0.8, diameterTop: 0.7, diameterBottom: 1.0, tessellation: 6
        }, this.scene);
        lowerTier.position = new Vector3(0, 0.7, 0);
        lowerTier.material = createLowPolyMaterial('lowerTierMat', PALETTE.TOWER_SNIPER, this.scene);
        makeFlatShaded(lowerTier);
        lowerTier.parent = this.mesh;

        // Decorative ring between tiers
        const tierRing = MeshBuilder.CreateTorus('tierRing', {
            diameter: 0.8, thickness: 0.08, tessellation: 8
        }, this.scene);
        tierRing.position = new Vector3(0, 1.15, 0);
        tierRing.material = createLowPolyMaterial('tierRingMat', PALETTE.ROCK, this.scene);
        makeFlatShaded(tierRing);
        tierRing.parent = this.mesh;

        // --- 3. Tall thin pillar (spire) ---
        const pillar = MeshBuilder.CreateCylinder('sniperPillar', {
            height: 2.2, diameterTop: 0.35, diameterBottom: 0.6, tessellation: 6
        }, this.scene);
        pillar.position = new Vector3(0, 2.3, 0);
        pillar.material = createLowPolyMaterial('sniperPillarMat', PALETTE.TOWER_SNIPER, this.scene);
        makeFlatShaded(pillar);
        pillar.parent = this.mesh;

        // --- 4. Observation platform (small widening near top) ---
        const obsRing = MeshBuilder.CreateCylinder('obsRing', {
            height: 0.12, diameterTop: 0.7, diameterBottom: 0.5, tessellation: 6
        }, this.scene);
        obsRing.position = new Vector3(0, 3.45, 0);
        obsRing.material = createLowPolyMaterial('obsRingMat', PALETTE.TOWER_SNIPER, this.scene);
        makeFlatShaded(obsRing);
        obsRing.parent = this.mesh;

        // Small railing posts
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const post = MeshBuilder.CreateBox(`post${i}`, {
                width: 0.06, height: 0.2, depth: 0.06
            }, this.scene);
            post.position = new Vector3(
                Math.sin(angle) * 0.3,
                3.62,
                Math.cos(angle) * 0.3
            );
            post.material = createLowPolyMaterial(`postMat${i}`, PALETTE.ROCK_DARK, this.scene);
            makeFlatShaded(post);
            post.parent = this.mesh;
        }

        // --- 5. Rotating focus ring around the lens ---
        const focusRing = MeshBuilder.CreateTorus('focusRing', {
            diameter: 0.65, thickness: 0.05, tessellation: 8
        }, this.scene);
        focusRing.position = new Vector3(0, 3.85, 0);
        focusRing.material = createEmissiveMaterial('focusRingMat', PALETTE.TOWER_SNIPER_LENS, 0.4, this.scene);
        makeFlatShaded(focusRing);
        focusRing.parent = this.mesh;

        // Focus ring rotation
        const ringSpinAnim = new Animation("focusRingSpin", "rotation.y", 30,
            Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        ringSpinAnim.setKeys([
            { frame: 0, value: 0 },
            { frame: 120, value: Math.PI * 2 }
        ]);
        focusRing.animations = [ringSpinAnim];
        this.scene.beginAnimation(focusRing, 0, 120, true);

        // --- 6. Emissive crimson lens at top ---
        const lens = MeshBuilder.CreateIcoSphere('sniperLens', {
            radius: 0.25, subdivisions: 1
        }, this.scene);
        lens.position = new Vector3(0, 3.85, 0);
        lens.material = createEmissiveMaterial('sniperLensMat', PALETTE.TOWER_SNIPER_LENS, 0.9, this.scene);
        makeFlatShaded(lens);
        lens.parent = this.mesh;

        // Lens pulse animation
        const lensPulse = new Animation("lensPulse", "scaling", 30,
            Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        lensPulse.setKeys([
            { frame: 0, value: new Vector3(1, 1, 1) },
            { frame: 30, value: new Vector3(1.15, 1.15, 1.15) },
            { frame: 60, value: new Vector3(1, 1, 1) }
        ]);
        lens.animations = [lensPulse];
        this.scene.beginAnimation(lens, 0, 60, true);

        // --- 7. Small antenna/spike on very top ---
        const antenna = MeshBuilder.CreateCylinder('antenna', {
            height: 0.5, diameterTop: 0, diameterBottom: 0.06, tessellation: 4
        }, this.scene);
        antenna.position = new Vector3(0, 4.35, 0);
        antenna.material = createLowPolyMaterial('antennaMat', PALETTE.ROCK_DARK, this.scene);
        antenna.parent = this.mesh;

        // Tiny emissive tip
        const tip = MeshBuilder.CreateIcoSphere('antennaTip', {
            radius: 0.04, subdivisions: 0
        }, this.scene);
        tip.position = new Vector3(0, 4.6, 0);
        tip.material = createEmissiveMaterial('tipMat', PALETTE.TOWER_SNIPER_LENS, 0.7, this.scene);
        tip.parent = this.mesh;

        // --- 8. Bullet template & projectile system ---
        const bulletTemplate = MeshBuilder.CreateIcoSphere('sniperBulletTemplate', {
            radius: 0.12, subdivisions: 0
        }, this.scene);
        makeFlatShaded(bulletTemplate);
        const bulletMat = createEmissiveMaterial('sniperBulletMat', PALETTE.TOWER_SNIPER_LENS, 0.6, this.scene);
        bulletTemplate.material = bulletMat;
        bulletTemplate.isVisible = false;

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
                        this.position.y + 3.85,
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
