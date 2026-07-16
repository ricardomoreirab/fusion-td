import { Box3, Color, Mesh, Vector3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy } from './Enemy';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { AnimGroup } from '../../engine/three/AnimGroup';
import type { GlbContainer } from '../../engine/three/assets';
import { headingToYaw } from '../../engine/three/math';
import { createBox, createCylinder, createPlane, createPolyhedron, createSphere } from '../../engine/three/primitives';

export class TankEnemy extends Enemy {
    /** Static slot used by EnemyManager.spawnSurvivorsEnemy to stage a preloaded GLB
     *  asset before constructing a TankEnemy. createMesh() consumes + clears it. */
    public static pendingAsset: GlbContainer | null = null;

    private stompTime: number = 0;
    private rocks: Mesh[] = [];
    private legs: Mesh[] = [];
    private mandibleLeft: Mesh | null = null;
    private mandibleRight: Mesh | null = null;
    private shellTop: Mesh | null = null;

    /** True when this instance renders via the lava-golem GLB. */
    private usingGLB: boolean = false;
    private glbWalkAnim: AnimGroup | null = null;
    private glbAttackAnim: AnimGroup | null = null;
    private glbIdleAnim: AnimGroup | null = null;
    private glbCurrentAnim: AnimGroup | null = null;
    private glbAttackHoldTimer: number = 0;
    private static readonly GLB_ATTACK_RANGE = 4.0;
    private static readonly GLB_ATTACK_HOLD = 0.8;
    /** GLB mesh scale. Instance field so subclasses (DragonTurtle) can shrink/grow. */
    protected glbScale: number = 1.6;

    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Tank enemy has low speed, 5x health, high damage, and high reward
        super(game, position, path, 1.5, 150, 20, 30);

        // Set as a heavy enemy type
        this.isHeavy = true;
        this.contactDamagePerSecond = 20;

        // Heavy shell-slam — long windup, big chunk of damage. The rooted pause
        // during windup acts as the telegraph (no ground disc — too much churn
        // when a swarm of tanks all cycle swings at once).
        this.meleeRange            = 1.9;
        this.meleeHitRange         = 2.3;
        this.meleeHitDamage        = 25;
        this.meleeWindupDuration   = 0.55;
        this.meleeStrikeDuration   = 0.15;
        this.meleeCooldownDuration = 0.95;

        // Build mesh + health bar AFTER field initializers have run (see Enemy
        // constructor note). new.target guard → fires only for the concrete leaf.
        if (new.target === TankEnemy) this._initEnemyVisuals();
    }

    /**
     * Create the enemy mesh. If a GLB asset was staged via TankEnemy.pendingAsset
     * (set by EnemyManager just before construction), instantiate it. Otherwise fall
     * back to the procedural ironclad-beetle build below.
     */
    protected createMesh(): void {
        const asset = TankEnemy.pendingAsset;
        TankEnemy.pendingAsset = null;
        if (asset) {
            this.createMeshFromGLB(asset);
            return;
        }
        this.createMeshProcedural();
    }

    private createMeshFromGLB(asset: GlbContainer): void {
        this.usingGLB = true;
        this.mesh = new Mesh(); // empty transform host (renders nothing)
        this.mesh.name = 'tankEnemyGlbRoot';
        this.scene.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        const inst = asset.instantiate(this.scene, 'tank_');
        // Base Enemy field; its dispose() frees cloned materials + skeletons + mixer hook.
        this.glbInstance = inst;
        const root = inst.root;
        this.mesh.add(root);
        root.scale.multiplyScalar(this.glbScale);
        // Keep the Babylon-era 180-degree Y pre-rotation so facing math stays aligned
        // (Phase D handedness audit may remove it). Enemy.update's seek-rotation
        // expects the model to be authored facing -z.
        root.rotation.y += Math.PI;

        // Feet-on-ground offset.
        this.mesh.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(this.mesh);
        const feetOffset = -bbox.min.y;
        root.position.y += feetOffset;

        // Categorize animation clips for walk/attack/idle state.
        // Register groups on the base class so the release path can stop them
        // (glbInstance.dispose() owns their actual disposal).
        this.glbAnimationGroups = inst.animationGroups;

        for (const ag of inst.animationGroups) ag.stop();
        for (const ag of inst.animationGroups) {
            const n = ag.name.toLowerCase();
            if (!this.glbWalkAnim && (n.includes('walk') || n.includes('run') || n.includes('move'))) {
                this.glbWalkAnim = ag;
            } else if (!this.glbAttackAnim && (n.includes('attack') || n.includes('slam') || n.includes('smash') || n.includes('strike') || n.includes('swing') || n.includes('punch') || n.includes('hit'))) {
                this.glbAttackAnim = ag;
            } else if (!this.glbIdleAnim && (n.includes('idle') || n === 'stand')) {
                this.glbIdleAnim = ag;
            }
        }
        if (!this.glbWalkAnim && inst.animationGroups.length > 0) this.glbWalkAnim = inst.animationGroups[0];
        if (!this.glbIdleAnim) this.glbIdleAnim = this.glbWalkAnim;
        if (!this.glbAttackAnim) this.glbAttackAnim = this.glbWalkAnim;
        if (this.glbWalkAnim) {
            this.glbWalkAnim.start(true);
            this.glbCurrentAnim = this.glbWalkAnim;
        }
    }

    private playGlbAnim(slot: AnimGroup | null, loop: boolean): void {
        if (!slot) return;
        if (this.glbCurrentAnim === slot) return;
        if (this.glbCurrentAnim) this.glbCurrentAnim.stop();
        slot.start(loop);
        this.glbCurrentAnim = slot;
    }

    /**
     * Create the enemy mesh - low-poly Ironclad Beetle (procedural fallback)
     * Massive armored insect: domed shell on top, segmented body underneath,
     * 6 short legs, two large mandibles, glowing amber thorax vents, armored plates
     */
    private createMeshProcedural(): void {
        // Ensure arrays are initialized
        this.rocks = [];
        this.legs = [];

        // --- Main body: wide squat box (beetle thorax) ---
        this.mesh = createBox('tankEnemyBody', {
            width: 1.30,
            height: 0.55,
            depth: 1.10
        }, this.scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.35;
        this.mesh.material = createLowPolyMaterial('tankBodyMat', PALETTE.ENEMY_TANK);

        // --- Domed shell: large flattened polyhedron on top ---
        this.shellTop = createPolyhedron('tankShell', {
            type: 2, // Icosahedron
            size: 0.55
        }, this.scene);
        makeFlatShaded(this.shellTop);
        this.mesh.add(this.shellTop);
        this.shellTop.position.set(0, 0.35, -0.05);
        this.shellTop.scale.set(1.20, 0.50, 1.05); // Wide and flat dome
        this.shellTop.material = createLowPolyMaterial('tankShellMat', PALETTE.ENEMY_TANK_SHELL);

        // --- Shell ridge plates: 3 boxes along the top of the shell ---
        for (let i = 0; i < 3; i++) {
            const ridge = createBox(`tankRidge${i}`, {
                width: 0.12,
                height: 0.10,
                depth: 0.28
            }, this.scene);
            makeFlatShaded(ridge);
            this.shellTop.add(ridge);
            ridge.position.set(0, 0.28, -0.25 + i * 0.25);
            ridge.material = createLowPolyMaterial(`tankRidgeMat${i}`, PALETTE.ENEMY_TANK);
            this.rocks.push(ridge);
        }

        // --- Head: smaller box protruding forward ---
        const head = createBox('tankHead', {
            width: 0.60,
            height: 0.35,
            depth: 0.40
        }, this.scene);
        makeFlatShaded(head);
        this.mesh.add(head);
        head.position.set(0, 0.05, 0.65);
        head.material = createLowPolyMaterial('tankHeadMat', PALETTE.ENEMY_TANK);

        // --- Eyes: two emissive amber orbs ---
        const leftEye = createSphere('tankLeftEye', {
            diameter: 0.12,
            segments: 4
        }, this.scene);
        makeFlatShaded(leftEye);
        head.add(leftEye);
        leftEye.position.set(-0.20, 0.08, 0.18);
        leftEye.material = createEmissiveMaterial('tankLeftEyeMat', PALETTE.ENEMY_TANK_AMBER, 1.0);

        const rightEye = createSphere('tankRightEye', {
            diameter: 0.12,
            segments: 4
        }, this.scene);
        makeFlatShaded(rightEye);
        head.add(rightEye);
        rightEye.position.set(0.20, 0.08, 0.18);
        rightEye.material = createEmissiveMaterial('tankRightEyeMat', PALETTE.ENEMY_TANK_AMBER, 1.0);

        // --- Mandibles: two curved cone shapes flanking the head ---
        this.mandibleLeft = createCylinder('tankMandibleL', {
            height: 0.40,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(this.mandibleLeft);
        head.add(this.mandibleLeft);
        this.mandibleLeft.position.set(-0.28, -0.08, 0.25);
        this.mandibleLeft.rotation.x = Math.PI / 2.2;
        this.mandibleLeft.rotation.z = 0.4;
        this.mandibleLeft.material = createLowPolyMaterial('tankMandibleLMat', PALETTE.ENEMY_TANK_MANDIBLE);

        this.mandibleRight = createCylinder('tankMandibleR', {
            height: 0.40,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(this.mandibleRight);
        head.add(this.mandibleRight);
        this.mandibleRight.position.set(0.28, -0.08, 0.25);
        this.mandibleRight.rotation.x = Math.PI / 2.2;
        this.mandibleRight.rotation.z = -0.4;
        this.mandibleRight.material = createLowPolyMaterial('tankMandibleRMat', PALETTE.ENEMY_TANK_MANDIBLE);

        // --- Antennae: two thin cones on top of head ---
        const leftAntenna = createCylinder('tankAntennaL', {
            height: 0.35,
            diameterTop: 0.0,
            diameterBottom: 0.04,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(leftAntenna);
        head.add(leftAntenna);
        leftAntenna.position.set(-0.15, 0.18, 0.10);
        leftAntenna.rotation.x = -0.4;
        leftAntenna.rotation.z = -0.3;
        leftAntenna.material = createLowPolyMaterial('tankAntennaLMat', PALETTE.ENEMY_TANK_LEG);

        const rightAntenna = createCylinder('tankAntennaR', {
            height: 0.35,
            diameterTop: 0.0,
            diameterBottom: 0.04,
            tessellation: 3
        }, this.scene);
        makeFlatShaded(rightAntenna);
        head.add(rightAntenna);
        rightAntenna.position.set(0.15, 0.18, 0.10);
        rightAntenna.rotation.x = -0.4;
        rightAntenna.rotation.z = 0.3;
        rightAntenna.material = createLowPolyMaterial('tankAntennaRMat', PALETTE.ENEMY_TANK_LEG);

        // --- 6 Legs: 3 per side, box segments ---
        const legSide = [-1, 1]; // Left (-1) and Right (1)
        const legZOffsets = [0.30, 0.0, -0.30]; // Front, Mid, Back

        for (const side of legSide) {
            for (let i = 0; i < legZOffsets.length; i++) {
                // Upper leg segment
                const upperLeg = createBox(`tankLeg_${side}_${i}`, {
                    width: 0.35,
                    height: 0.10,
                    depth: 0.10
                }, this.scene);
                makeFlatShaded(upperLeg);
                this.mesh.add(upperLeg);
                upperLeg.position.set(
                    side * 0.65,
                    -0.15,
                    legZOffsets[i]
                );
                upperLeg.rotation.z = side * 0.3; // Angle outward
                upperLeg.material = createLowPolyMaterial(`tankLegMat_${side}_${i}`, PALETTE.ENEMY_TANK_LEG);

                // Lower leg segment (foot)
                const foot = createBox(`tankFoot_${side}_${i}`, {
                    width: 0.08,
                    height: 0.20,
                    depth: 0.08
                }, this.scene);
                makeFlatShaded(foot);
                upperLeg.add(foot);
                foot.position.set(side * 0.18, -0.12, 0);
                foot.material = createLowPolyMaterial(`tankFootMat_${side}_${i}`, PALETTE.ENEMY_TANK_LEG);

                this.legs.push(upperLeg);
            }
        }

        // --- Thorax glow vents: 2 emissive amber slits on the sides ---
        const leftVent = createBox('tankVentL', {
            width: 0.06,
            height: 0.06,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(leftVent);
        this.mesh.add(leftVent);
        leftVent.position.set(-0.66, 0.10, 0);
        leftVent.material = createEmissiveMaterial('tankVentLMat', PALETTE.ENEMY_TANK_AMBER, 0.8);

        const rightVent = createBox('tankVentR', {
            width: 0.06,
            height: 0.06,
            depth: 0.35
        }, this.scene);
        makeFlatShaded(rightVent);
        this.mesh.add(rightVent);
        rightVent.position.set(0.66, 0.10, 0);
        rightVent.material = createEmissiveMaterial('tankVentRMat', PALETTE.ENEMY_TANK_AMBER, 0.8);

        // --- Rear plate: angled box at the back ---
        const rearPlate = createBox('tankRear', {
            width: 0.80,
            height: 0.25,
            depth: 0.10
        }, this.scene);
        makeFlatShaded(rearPlate);
        this.mesh.add(rearPlate);
        rearPlate.position.set(0, 0.10, -0.58);
        rearPlate.rotation.x = -0.3;
        rearPlate.material = createLowPolyMaterial('tankRearMat', PALETTE.ENEMY_TANK_SHELL);

        // --- Armor plates: dark metallic slabs on the sides for a bulkier silhouette ---
        const armorPlateColor = new Color(0.22, 0.20, 0.26); // Near-black dark metal

        const leftPlate = createBox('tankLeftPlate', {
            width: 0.10,
            height: 0.38,
            depth: 0.75
        }, this.scene);
        makeFlatShaded(leftPlate);
        this.mesh.add(leftPlate);
        leftPlate.position.set(-0.72, 0.05, 0);
        leftPlate.material = createLowPolyMaterial('tankLeftPlateMat', armorPlateColor);

        const rightPlate = createBox('tankRightPlate', {
            width: 0.10,
            height: 0.38,
            depth: 0.75
        }, this.scene);
        makeFlatShaded(rightPlate);
        this.mesh.add(rightPlate);
        rightPlate.position.set(0.72, 0.05, 0);
        rightPlate.material = createLowPolyMaterial('tankRightPlateMat', armorPlateColor);

        // Front armor brow: thick horizontal slab above the head for an imposing forehead
        const frontBrow = createBox('tankFrontBrow', {
            width: 0.70,
            height: 0.14,
            depth: 0.16
        }, this.scene);
        makeFlatShaded(frontBrow);
        this.mesh.add(frontBrow);
        frontBrow.position.set(0, 0.22, 0.60);
        frontBrow.material = createLowPolyMaterial('tankFrontBrowMat', armorPlateColor);

        // Helmet horn: small polyhedron spike on top centre for an intimidating silhouette
        const helmetHorn = createCylinder('tankHelmetHorn', {
            height: 0.28,
            diameterTop: 0.0,
            diameterBottom: 0.12,
            tessellation: 4
        }, this.scene);
        makeFlatShaded(helmetHorn);
        this.shellTop.add(helmetHorn);
        helmetHorn.position.set(0, 0.28, 0);
        helmetHorn.material = createLowPolyMaterial('tankHelmetHornMat', armorPlateColor);

        // Store original scale
        this.originalScale = 1.0;
    }

    /**
     * Override the health bar creation for tank enemies (wider bar)
     */
    protected createHealthBar(): void {
        if (!this.mesh) return;

        this._barBand = null; // force the fill-material assignment in updateHealthBar

        // Two meshes, shared cached materials (see Enemy.createHealthBar): the
        // frame-sized near-black background doubles as the outline. Same cached
        // keys as the base class; depthTest=false + the base renderOrder band
        // keep the bar always on top (the Babylon depth-clear group equivalent).
        this.healthBarBackgroundMesh = createPlane('healthBarBg', {
            width: 1.58,
            height: 0.14
        }, this.scene);
        this.healthBarBackgroundMesh.position.set(this.position.x, this.position.y + 1.2, this.position.z);
        this.healthBarBackgroundMesh.material = getCachedMaterial('healthBarBgFrameMat', m => {
            m.color    = new Color(0.05, 0.05, 0.05);
            m.specular = new Color(0, 0, 0);
            m.depthTest = false;
            m.depthWrite = false;
        });

        // Health fill — material assigned by updateHealthBar's band swap.
        this.healthBarMesh = createPlane('healthBar', {
            width: 1.5,
            height: 0.08
        }, this.scene);
        this.healthBarMesh.position.set(this.position.x, this.position.y + 1.2, this.position.z);

        this.updateHealthBar();
    }

    /**
     * Override the updateHealthBar method for tank enemies
     */
    protected updateHealthBar(): void {
        if (!this.mesh || !this.healthBarMesh || !this.healthBarBackgroundMesh) return;

        const healthPercent = Math.max(0, this.health / this.maxHealth);

        this.healthBarMesh.scale.x = healthPercent;

        const offset = (1 - healthPercent) * 0.75; // Adjusted for wider bar (1.5 width)
        this.healthBarMesh.position.x = this.position.x - offset;

        this.applyHealthBarBand(healthPercent);

        this.healthBarBackgroundMesh.position.x = this.position.x;
        this.healthBarBackgroundMesh.position.y = this.position.y + 1.2;
        this.healthBarBackgroundMesh.position.z = this.position.z;

        this.healthBarMesh.position.y = this.position.y + 1.2;
        this.healthBarMesh.position.z = this.position.z;

        this._billboardHealthBar();
    }

    /**
     * Update the enemy with beetle scuttling animation
     * @param deltaTime Time elapsed since last update in seconds
     * @returns True if the enemy reached the end of the path
     */
    public update(deltaTime: number): boolean {
        if (!this.alive || !this.mesh) return false;

        // Get the result from the parent update method
        const result = super.update(deltaTime);

        // GLB golem skips the procedural scuttle anim — the asset's own clips drive it.
        // Facing is handled by Enemy.update's seek-rotation; the GLB root is pre-rotated
        // 180° in createMeshFromGLB so the model ends up facing the hero.
        if (this.usingGLB) {
            if (this.glbAttackHoldTimer > 0) {
                this.glbAttackHoldTimer = Math.max(0, this.glbAttackHoldTimer - deltaTime);
            }
            if (this.isFrozen || this.isStunned) {
                this.playGlbAnim(this.glbIdleAnim, true);
            } else if (this.seekTarget) {
                const heroPos = this.seekTarget.getPosition();
                const dx = heroPos.x - this.position.x;
                const dz = heroPos.z - this.position.z;
                const distSq = dx * dx + dz * dz;
                const inRange = distSq <= TankEnemy.GLB_ATTACK_RANGE * TankEnemy.GLB_ATTACK_RANGE;
                if (inRange) {
                    this.glbAttackHoldTimer = TankEnemy.GLB_ATTACK_HOLD;
                }
                if (this.glbAttackHoldTimer > 0) {
                    this.playGlbAnim(this.glbAttackAnim, true);
                } else {
                    this.playGlbAnim(this.glbWalkAnim, true);
                }
            } else {
                this.playGlbAnim(this.glbWalkAnim, true);
            }
            return result;
        }

        // Update scuttling animation
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length) {
            this.animateProceduralParts(deltaTime);

            // Face direction of movement
            if (this.currentPathIndex < this.path.length) {
                const targetPoint = this.path[this.currentPathIndex];
                const dx = targetPoint.x - this.position.x;
                const dz = targetPoint.z - this.position.z;

                if (dx * dx + dz * dz > 0.0001) {
                    this.mesh.rotation.y = headingToYaw(dx, dz);
                }
            }
        }

        return result;
    }

    /** Beetle scuttle pose — advances the stomp phase and animates the body,
     *  tripod legs, mandibles, and shell. Called by update() while scuttling
     *  and by tickNetworkProceduralAnim on the guest. */
    protected animateProceduralParts(deltaTime: number): void {
        this.stompTime += deltaTime * 4; // Moderate speed for heavy scuttling

        if (this.mesh) {
            // Heavy body: slow vertical stomp with slight forward pitch
            const verticalStomp = Math.abs(Math.sin(this.stompTime * 2)) * 0.08;
            this.mesh.position.y = this.position.y + 0.35 + verticalStomp;

            // Slight body pitch forward and back (like a charging beetle)
            this.mesh.rotation.x = Math.sin(this.stompTime) * 0.04;

            // Minimal side-to-side rock
            this.mesh.rotation.z = Math.sin(this.stompTime * 0.5) * 0.03;
        }

        // Animate 6 legs: alternating tripod gait (left-front, right-mid, left-back move together)
        for (let i = 0; i < this.legs.length; i++) {
            const leg = this.legs[i];
            // Even-indexed legs (left-front, right-mid, left-back) vs odd-indexed
            const phase = (i % 2 === 0) ? 0 : Math.PI;
            // Legs pump up and down and rotate slightly
            leg.rotation.z = leg.position.x > 0
                ? -0.3 + Math.sin(this.stompTime * 3 + phase) * 0.20
                : 0.3 + Math.sin(this.stompTime * 3 + phase) * 0.20;
        }

        // Mandibles: open-close clacking
        if (this.mandibleLeft && this.mandibleRight) {
            const clack = Math.sin(this.stompTime * 2.5) * 0.15;
            this.mandibleLeft.rotation.z = 0.4 + clack;
            this.mandibleRight.rotation.z = -0.4 - clack;
        }

        // Shell ridge plates: subtle vibration
        for (let i = 0; i < this.rocks.length; i++) {
            const ridge = this.rocks[i];
            ridge.position.y = 0.28 + Math.sin(this.stompTime * 3 + i * 1.5) * 0.008;
        }

        // Shell: very subtle breathing
        if (this.shellTop) {
            this.shellTop.scale.y = 0.50 + Math.sin(this.stompTime * 1.5) * 0.02;
        }
    }

    /**
     * Apply damage to the enemy with innate tank damage reduction
     * @param amount The amount of damage to apply
     * @returns True if the enemy died from this damage
     */
    public takeDamage(amount: number): boolean {
        // Tank enemies have innate 20% damage reduction (reduced from 30% for fairness)
        const tankReduction = amount * 0.2; // 20% damage reduction
        const reducedAmount = amount - tankReduction;

        // Let the parent class handle additional resistance from difficulty
        return super.takeDamage(reducedAmount);
    }

    /**
     * Create a death effect
     */
    protected createDeathEffect(): void {
        if (!this.mesh) return;

        // Call the parent method to create the base death effect
        super.createDeathEffect();

        // Play a special sound for tank enemy death
        this.game.getAssetManager().playSound('enemyDeath');
    }
}
