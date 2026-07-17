import { Vector3, Mesh, Color, Group, Material, MeshPhongMaterial, Object3D, PointLight, Box3 } from 'three';
import { Game } from '../../engine/Game';
import { Enemy, getStatusEffectTexture } from '../enemies/Enemy';
import { EnemyManager } from '../enemies/EnemyManager';
import { StatusEffect } from '../GameTypes';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded, setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import { buildBarbarianMesh } from './BarbarianBuilder';
import { ELEMENT_COLOR, blendElements } from '../ElementColors';
import { PowerElement } from '../powers/PowerDefinitions';
import { MythicFxConfig } from '../items/ItemTypes';
import { fxRenderer, fxSize, ParticleEffect } from '../../engine/three/particles/ParticleEffect';
import { LifeTimeCurve, Shape, SimulationSpace } from '@newkrok/three-particles';
import { elementAuraConfig, elementBurstConfig } from '../fx/ElementParticles';
import { GlbContainer, ContainerInstance } from '../../engine/three/assets';
import { AnimGroup } from '../../engine/three/AnimGroup';
import { createBox, createCylinder, createSphere, createTorus, createPolyhedron, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';
import { headingToYaw } from '../../engine/three/math';

/** Any material carrying an emissive color (Phong for procedural parts,
 *  Standard for GLB-cloned materials) — the tint/flash code only touches
 *  `.emissive`, so this structural type covers both. */
type EmissiveMaterial = Material & { emissive: Color };

// Module-level scratch vector — safe because update() is not reentrant (frames serialize)
const _scratchDir = new Vector3();

/**
 * Champion — a friendly boss-like unit that walks the path in reverse,
 * attacks nearby enemies, and slows enemies near it.
 * Extends Enemy for path movement, health bar, and mesh lifecycle.
 */
export class Champion extends Enemy {
    private enemyManager: EnemyManager | null;

    /** Visual class type — determines which mesh is built */
    public readonly championType: 'barbarian' | 'ranger' | 'mage';

    // Player control
    public controlMode: 'ai' | 'player' = 'ai';
    private playerVelocity: Vector3 = new Vector3(0, 0, 0);
    /** Last finite hero position; restored if a NaN velocity ever poisons position
     *  (a non-finite hero position propagates into the camera follow → black screen). */
    private _lastFiniteHeroPos: Vector3 = new Vector3(0, 0, 0);

    // Combat
    private attackDamage: number = 40;
    private attackRange: number = 3.0;
    private attackCooldown: number = 1.0; // seconds between attacks
    private attackTimer: number = 0;
    private blockRadius: number = 1.5;

    // Blocking throttle
    private blockTimer: number = 0;
    private blockInterval: number = 0.4; // re-apply slow every 0.4s (overlaps 0.5s duration)

    // Animation (walkTime approach like BasicEnemy)
    private walkTime: number = 0;
    private lastDeltaTime: number = 0;
    // Spin-attack state (player-controlled knight): runs a 360° body spin on melee swing
    private spinAttackTimer: number = 0;
    private static readonly SPIN_ATTACK_DURATION = 0.4;
    private swordArm: Mesh | null = null;
    private shieldArm: Mesh | null = null;
    private head: Mesh | null = null;
    private leftLeg: Mesh | null = null;
    private rightLeg: Mesh | null = null;
    private cape: Mesh | null = null;

    // Ranger-specific animated parts
    private rangerBow: Mesh | null = null;
    private rangerQuiver: Mesh | null = null;
    private rangerLeftLeg: Mesh | null = null;
    private rangerRightLeg: Mesh | null = null;

    // Mage-specific animated parts
    private mageStaffOrb: Mesh | null = null;
    private mageOrbMat: MeshPhongMaterial | null = null;

    // Barbarian axe head — weapon anchor for element decorations
    private barbAxeHead: Mesh | null = null;

    // GLB path: invisible anchor node parented to the rig's weapon bone
    // ('Bip001 Prop1' on Miya/Framis, 'Bip001 R Hand' on Aulus). Element
    // decorations and spin-trail particle emitters attach here — the procedural
    // part refs (barbAxeHead / rangerBow / mageStaffOrb) stay null on this path.
    private glbWeaponAnchor: Group | null = null;

    // GLB path: per-instance cloned materials that belong to the weapon primitive
    // (e.g. Aulus' '*_weapon' material). Element tint drives their emissive
    // directly; baseEmissive restores the resting look when no elements are active.
    private glbWeaponMats: { mat: EmissiveMaterial; baseEmissive: Color }[] = [];

    // Mythic weapon: ONE persistent aura particle system at the weapon bone.
    // Keyed by style+color so it only rebuilds when the equipped mythic changes.
    private mythicAuraPs: ParticleEffect | null = null;
    private mythicAuraKey: string | null = null;

    // Barbarian berserker animated parts
    private barbKiltFlaps: Mesh[] = [];
    private barbBeltTrophy: Mesh | null = null;
    private barbSnarlJaw: Mesh | null = null;
    private barbChestPulseGroup: Mesh | null = null;

    // Barbarian snarl-twitch timing
    private barbSnarlTimer: number = 2;
    private barbSnarlActive: number = 0;

    // Footstep dust throttle — last sign of sin(walkTime) when dust was emitted
    private barbLastStepSign: number = 0;

    // Spin-attack arc ring (temporary mesh + lifetime)
    private barbSpinArcMesh: Mesh | null = null;
    private barbSpinArcTimer: number = 0;
    // Spin-attack blood trail particles
    private barbSpinBloodPs: ParticleEffect | null = null;
    // Latest active power elements, snapshotted each frame from updateElementVisuals.
    private activeElementSnapshot: string[] = [];
    // Elemental axe-trail particle systems created per spin (one per active element).
    private barbSpinElemPs: ParticleEffect[] = [];
    // Spin-attack trail particles that already stopped and are waiting out their
    // fade window before dispose(). Tracked so dispose()/die() can flush them
    // immediately instead of leaving their setTimeout ticking against a torn-down
    // scene (or a live scene after the champion itself is gone).
    private pendingFxDisposal: ParticleEffect[] = [];
    private pendingFxDisposalTimers: ReturnType<typeof setTimeout>[] = [];

    // Cached Color instances — reused every frame to avoid per-frame allocation
    private mageOrbColor: Color = new Color(0, 0, 0);
    private barbSpinArcColor: Color = new Color(0, 0, 0);
    // Base hue the spin feet-ring fades from (blended element color, or red).
    private barbSpinArcBaseColor: Color = new Color(0.8, 0.10, 0.05);

    // Red hit-flash state — used by flashHitRed() to refresh the in-flight
    // flash instead of stacking snapshots that capture the already-red emissive.
    private flashHitRedActive: boolean = false;
    private flashHitRedRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    private flashHitRedSnapshot: { mat: EmissiveMaterial; color: Color }[] = [];

    // Pooled footstep dust particle system (barbarian only)
    private barbFootDustPs: ParticleEffect | null = null;

    // Torch light — warm point light that follows the hero with a gentle flicker.
    private torchLight: PointLight | null = null;
    private torchBaseIntensity: number = 0;
    private torchFlickerTime: number = 0;

    // Per-element weapon aura particle systems, created lazily on first activation.
    private elementAuraPs: Map<string, ParticleEffect> = new Map();
    // Started/stopped state per element aura (ParticleEffect has no isStarted()).
    private elementAuraActive: Map<string, boolean> = new Map();
    // Storm-only flickering bolt meshes + their shared (per-champion) material.
    private stormBolts: Mesh[] = [];
    private stormBoltMat: MeshPhongMaterial | null = null;
    private stormFlickerTimer: number = 0;
    // Weapon tint — ONE emissive material per champion instance, recolored in
    // place as the active element combo changes. Deliberately NOT a shared
    // cached material: flashHitRed() mutates mesh materials' emissive.
    private weaponTintMat: MeshPhongMaterial | null = null;
    private weaponOrigMat: { mesh: Mesh; mat: Mesh['material'] | null } | null = null;
    private weaponTintKey: string | null = null;

    /** Optional preloaded GLB container for whichever champion class this is (Miya for
     *  ranger, Aulus for barbarian, etc.). When present, createMesh instantiates the GLB
     *  and drives Idle / Walk / Attack / Special from its animation groups. */
    private championAsset: GlbContainer | null = null;

    /** The live GLB instance (cloned root + anim groups + mixer). Its dispose()
     *  frees the per-instance cloned materials AND the cloned skeleton's bone
     *  texture (glb_clonematerials_texture_leak + skeleton invariants) — called
     *  from both die() and dispose(). Null on the procedural path. */
    private containerInstance: ContainerInstance | null = null;

    /** Animation groups loaded from the champion GLB, categorized by detected name.
     *  When the asset ships skeletal anims we use these instead of mesh-level bob. */
    private championAnims: {
        idle: AnimGroup | null;
        walk: AnimGroup | null;
        attack: AnimGroup | null;
        special: AnimGroup | null;
        death: AnimGroup | null;
        all: AnimGroup[];
    } = { idle: null, walk: null, attack: null, special: null, death: null, all: [] };
    private championCurrentAnim: AnimGroup | null = null;
    /** True while the GLB death clip is playing/holding — the per-frame anim selector,
     *  triggerAttack and triggerSpecial all defer to it so the fallen pose isn't overridden.
     *  Cleared by clearDeath() on co-op respawn. */
    private glbDeathPlaying: boolean = false;
    /** Seconds remaining of forced-attack animation. Higher-priority than walk/idle while > 0.
     *  Distinct from the legacy this.attackTimer (auto-attack cooldown for path-walking mode). */
    private glbAttackTimer: number = 0;
    /** Seconds remaining of forced-special animation. Higher-priority than attack/walk/idle. */
    private glbSpecialTimer: number = 0;
    /** Target the champion is currently attacking — overrides facing during the attack
     *  timer so the model turns toward the enemy. */
    private glbAttackFacingTarget: Vector3 | null = null;
    /** Duration the GLB attack animation plays after each triggerAttack(). */
    private static readonly GLB_ATTACK_DURATION = 0.6;
    /** Duration the GLB special animation plays after each triggerSpecial(). */
    private static readonly GLB_SPECIAL_DURATION = 0.6;
    /** Playback speed multiplier for the GLB attack clip. Adjust per-champ if needed. */
    private static readonly GLB_ATTACK_SPEED = 5.5;
    /** Playback speed multiplier for the GLB special clip. */
    private static readonly GLB_SPECIAL_SPEED = 2.0;

    constructor(
        game: Game,
        reversedPath: Vector3[],
        enemyManager: EnemyManager | null = null,
        championType: 'barbarian' | 'ranger' | 'mage' = 'barbarian',
        championAsset?: GlbContainer,
    ) {
        // HP 800, Speed 1.5, Damage 0 (doesn't damage player), Reward 0
        const startPos = reversedPath.length > 0 ? reversedPath[0] : new Vector3(0, 0, 0);
        super(game, startPos, reversedPath, 1.5, 800, 0, 0);
        this.enemyManager = enemyManager;
        // super() already called createMesh() before championType could be set,
        // so it always built the default knight. If we need a different class,
        // dispose the placeholder mesh and rebuild correctly.
        this.championType = championType;
        this.championAsset = championAsset ?? null;
        // Rebuild if the class isn't the default knight built by super() — OR if we have
        // a GLB to swap in (barbarian's default already matches, but with Aulus GLB we
        // still need to throw away the procedural mesh and build the GLB instead).
        if (championType !== 'barbarian' || this.championAsset) {
            this.rebuildForType();
        }
    }

    private rebuildForType(): void {
        // Dispose limb references the knight builder set, so per-class
        // animation doesn't try to drive disposed meshes.
        this.swordArm = null;
        this.shieldArm = null;
        this.head = null;
        this.leftLeg = null;
        this.rightLeg = null;
        this.cape = null;
        // Dispose the knight body and all parented sub-meshes. disposeMesh's
        // default (no materials flag) mirrors Babylon dispose(false, false) —
        // shared/cached materials survive; a GLB instance never exists here.
        if (this.mesh) {
            disposeMesh(this.mesh);
            this.mesh = null;
        }
        // Build the correct class mesh.
        this.createMesh();
    }

    /**
     * Set movement velocity when in player-controlled mode.
     * Call this from HeroController each frame.
     */
    public setPlayerVelocity(velocity: Vector3): void {
        this.playerVelocity.copy(velocity);
    }

    /** Facing yaw (mesh rotation.y), 0 while the mesh is still loading. Public
     *  accessor so callers don't need to reach into the protected mesh field. */
    public getFacingY(): number {
        return this.mesh?.rotation.y ?? 0;
    }

    // getPosition() inherited from Enemy — returns this.position by REFERENCE.
    // The previous override here cloned on every call, which was the dominant
    // source of GC pressure at high enemy counts (every enemy calls
    // seekTarget.getPosition() once per update, plus HeroController, ability
    // managers, contact-damage check, etc.). Callers must NOT mutate the
    // returned Vector3 — write back to (hero as any).position instead, the
    // same way HeroController's arena clamp already does it.

    /** Triggered by HeroBasicAttack when the melee swing fires. */
    public triggerSpinAttack(): void {
        this.spinAttackTimer = Champion.SPIN_ATTACK_DURATION;
        if (this.championType === 'barbarian') {
            this.startBarbSpinFx();
        }
    }

    /** Barbarian-only: create the axe-head trail PS + arc-ring mesh for the spin attack.
     *  With active power elements the trail is one colored ribbon per element
     *  (layered → reads as a blended multi-element trail); with none it falls back
     *  to the classic red blood trail. */
    private startBarbSpinFx(): void {
        const elems = this.activeElementSnapshot as PowerElement[];
        // Works on both paths: procedural axe head, or the GLB weapon-bone anchor.
        const axeAnchor = this.getWeaponAnchor();

        // ===== Axe-head trail particles =====
        // Direction range (-1,0.2,-1)..(1,1.2,1) is a wide up-and-out spread ->
        // SPHERE shape approximation (M = magnitude of the direction range midpoint ~= 1.68).
        const SPIN_TRAIL_M = 1.64;
        if (axeAnchor && elems.length > 0 && this.barbSpinElemPs.length === 0) {
            for (const el of elems) {
                const c = ELEMENT_COLOR[el];
                if (!c) continue;
                const ps = new ParticleEffect(`barbSpinElem_${el}`, this.scene, elementBurstConfig(el), { follow: axeAnchor });
                this.barbSpinElemPs.push(ps);
            }
        } else if (axeAnchor && elems.length === 0 && !this.barbSpinBloodPs) {
            const ps = new ParticleEffect('barbSpinBlood', this.scene, {
                looping: true,
                duration: 5,
                maxParticles: 60,
                simulationSpace: SimulationSpace.WORLD,
                emission: { rateOverTime: 240 * 0.6 },
                startLifetime: { min: 0.1 / 0.6, max: 0.2 / 0.6 },
                startSpeed: { min: 1 * 0.6 * SPIN_TRAIL_M, max: 3 * 0.6 * SPIN_TRAIL_M },
                startSize: { min: fxSize(0.10), max: fxSize(0.30) },
                startColor: { min: { r: 0.45, g: 0.05, b: 0.02 }, max: { r: 0.7, g: 0.10, b: 0.05 } },
                startOpacity: 1,
                opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
                gravity: 3 * 0.6 * 0.6,
                shape: { shape: Shape.SPHERE, sphere: { radius: 0.2, radiusThickness: 1, arc: 360 } },
                renderer: fxRenderer('additive'),
            }, { follow: axeAnchor });
            this.barbSpinBloodPs = ps;
        }

        // ===== Arc ring at hero feet — tinted by the blended elements (red when none) =====
        if (!this.barbSpinArcMesh && this.mesh) {
            const ring = createTorus('barbSpinArcRing', {
                diameter: 2.5,
                thickness: 0.15,
                tessellation: 12,
            }, this.scene);
            makeFlatShaded(ring);
            const arcBase = elems.length > 0
                ? blendElements(elems)
                : new Color(0.8, 0.10, 0.05);
            this.barbSpinArcBaseColor.copy(arcBase);
            const ringMat = createEmissiveMaterial('barbSpinArcRingMat', arcBase, 0.9);
            ringMat.transparent = true; // faded out each frame in tickBarbSpinFx
            ring.material = ringMat;
            // Unique per-spin animated material — flag so disposeMesh frees it.
            ring.userData.ownedMaterial = true;
            ring.position.copy(this.position);
            ring.position.y = 0.1;
            ring.scale.set(0.3, 1.0, 0.3);
            this.barbSpinArcMesh = ring;
            this.barbSpinArcTimer = Champion.SPIN_ATTACK_DURATION;
        }
    }

    public isSpinning(): boolean {
        return this.spinAttackTimer > 0;
    }

    /**
     * Create the champion mesh — dispatches to per-class builder.
     */
    protected createMesh(): void {
        // Any champion class with a preloaded GLB uses the unified GLB pipeline.
        // Falls through to per-class procedural builder when no asset is provided.
        if (this.championAsset) {
            this.createChampionMeshFromGLB(this.championAsset);
            return;
        }
        switch (this.championType) {
            case 'ranger': this.createRangerMeshProcedural(); break;
            case 'mage':   this.createMageMesh();             break;
            case 'barbarian':
            default:       this.createBarbarianMesh();        break;
        }
    }

    // =========================================================================
    // BARBARIAN — axe-wielding rugged warrior
    // =========================================================================
    private createBarbarianMesh(): void {
        const parts = buildBarbarianMesh(this.scene, this.position);
        this.mesh = parts.rootMesh;
        this.head = parts.head;
        this.swordArm = parts.swordArm;
        this.shieldArm = parts.shieldArm;
        this.leftLeg = parts.leftLeg;
        this.rightLeg = parts.rightLeg;
        this.barbAxeHead = parts.axeHead;
        this.barbKiltFlaps = parts.kiltFlaps;
        this.barbBeltTrophy = parts.beltTrophy;
        this.barbSnarlJaw = parts.snarlJaw;
        this.barbChestPulseGroup = parts.chestPulseGroup;
        this.cape = null;
        this.originalScale = 1.0;
        // barbFootDustPs is allocated per-footstep now (see spawnFootstepDust) —
        // no pre-allocation needed.
    }

    /** Instantiate the preloaded GLB and parent it under an empty transform root.
     *  Categorizes the GLB's animation groups by name so we can play Idle / Walk /
     *  Shoot from the appropriate clip; falls back to mesh-bob for any slot that
     *  doesn't have a matching clip. */
    private createChampionMeshFromGLB(asset: GlbContainer): void {
        const host = this.scene;

        // Empty transform host that Champion's existing position/rotation pipeline drives.
        this.mesh = new Mesh();
        this.mesh.name = 'rangerRoot';
        host.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        // instantiate() does a full skinned clone (SkeletonUtils) so the geometry +
        // skeleton are independent of the source, and clones every material per
        // instance (Babylon's cloneMaterials: true equivalent).
        const inst = asset.instantiate(host, 'ranger_');
        this.containerInstance = inst;
        const RANGER_SCALE = 1.5;
        inst.root.scale.multiplyScalar(RANGER_SCALE);
        this.mesh.add(inst.root);

        // Shift the GLB so its feet sit on the ground (most rigged humanoids center on
        // torso so half the model lands below y=0 without this).
        this.mesh.updateMatrixWorld(true);
        const bbox = new Box3().setFromObject(this.mesh);
        const feetOffset = -bbox.min.y;
        inst.root.position.y += feetOffset;

        // Weapon anchor: GLB weapons are skinned into the body mesh, driven by a
        // prop bone ('Bip001 Prop1' on Miya/Framis) or the right hand ('Bip001 R
        // Hand' on Aulus, whose axe has no dedicated prop bone). Parent an
        // invisible anchor node to that bone so element decorations and the
        // barbarian spin-trail emitters ride the weapon through every animation.
        // (Bone names keep their suffixes — instantiate() only prepends 'ranger_'.)
        let weaponNode: Object3D | null = null;
        this.mesh.traverse(n => {
            if (!weaponNode && n.name.includes('Prop1')) weaponNode = n;
        });
        if (!weaponNode) {
            this.mesh.traverse(n => {
                if (!weaponNode && n.name.includes('R Hand')) weaponNode = n;
            });
        }
        if (weaponNode) {
            // A Group renders nothing itself (no geometry) — children stay visible,
            // unlike Three's visible=false which would hide the whole subtree.
            const anchor = new Group();
            anchor.name = 'glbWeaponAnchor';
            (weaponNode as Object3D).add(anchor);
            // Counter-scale so decorations parented here render at world size even
            // though rig nodes carry import scaling.
            (weaponNode as Object3D).updateWorldMatrix(true, false);
            const ws = (weaponNode as Object3D).getWorldScale(new Vector3());
            anchor.scale.set(
                ws.x !== 0 ? 1 / ws.x : 1,
                ws.y !== 0 ? 1 / ws.y : 1,
                ws.z !== 0 ? 1 / ws.z : 1,
            );
            this.glbWeaponAnchor = anchor;
        }

        // Weapon tint hook: Aulus' axe ships as its own primitive with a dedicated
        // '*_weapon' material (cloned per instance by instantiate()), so the
        // element tint can drive its emissive directly. Miya/Framis bake body +
        // weapon into one material — no entry collected; the particle aura alone
        // carries their element glow.
        this.mesh.traverse(node => {
            const m = node as Mesh;
            if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
            const matName = m.material.name?.toLowerCase() ?? '';
            if (matName.includes('weapon')) {
                const mat = m.material as EmissiveMaterial;
                this.glbWeaponMats.push({
                    mat,
                    baseEmissive: mat.emissive?.clone() ?? new Color(0, 0, 0),
                });
            }
        });

        // Categorize the GLB's animation clips by name. Accept aliases per slot since
        // different rigs/export tools use different conventions. "special" matches power-
        // slot attacks (Fire Arrow / Frost Shards / etc.) — usually a longer/more dramatic
        // clip than the basic shoot.
        this.championAnims = { idle: null, walk: null, attack: null, special: null, death: null, all: [...inst.animationGroups] };
        // Register the cloned GLB anim groups on the inherited field so the base
        // teardown also stops them. The heavy lifting (cloned materials + skeleton
        // bone texture + mixer hook) is owned by containerInstance.dispose(), called
        // from die() and dispose() below.
        this.glbAnimationGroups = [...inst.animationGroups];
        console.log(`[${this.championType}] available animation groups (${inst.animationGroups.length}):`);
        for (const ag of inst.animationGroups) {
            console.log(`  - "${ag.name}"`);
            const n = ag.name.toLowerCase();
            if (this.championAnims.death == null && (n.includes('dead') || n.includes('death') || n.includes('die'))) {
                this.championAnims.death = ag;
            } else if (this.championAnims.idle == null && (n.includes('idle') || n === 'stand' || n.includes('aim'))) {
                this.championAnims.idle = ag;
            } else if (this.championAnims.walk == null && (n.includes('walk') || n.includes('run'))) {
                this.championAnims.walk = ag;
            } else if (this.championAnims.special == null && (n.includes('special') || n.includes('skill') || n.includes('magic') || n.includes('cast') || n.includes('spell') || n.includes('ult'))) {
                this.championAnims.special = ag;
            } else if (this.championAnims.attack == null && (n.includes('attack') || n.includes('attack') || n.includes('fire') || n.includes('bow') || n.includes('arrow'))) {
                this.championAnims.attack = ag;
            }
            ag.stop(); // Stop any auto-started clips; playChampionAnim controls them.
        }
        // Per-champion explicit clip overrides — when the generic alias matcher
        // picks a clip that doesn't look right, hard-pick the one we want. The
        // substring is matched against the clip name.
        const PREFERRED: Partial<Record<string, { attack?: string; special?: string; walk?: string; idle?: string }>> = {
            // (Per-champ explicit clip overrides. Barbarian's two ultimate abilities
            //  fire through AbilityManager → Champion.playAbilityClip, not through
            //  the basic-attack/special slots here.)
        };
        const overrides = PREFERRED[this.championType];
        if (overrides) {
            for (const slot of ['attack', 'special', 'walk', 'idle'] as const) {
                const needle = overrides[slot];
                if (!needle) continue;
                // endsWith so we match "...skill3" but not "...skill3_5".
                const match = this.championAnims.all.find(ag => ag.name.endsWith(needle));
                if (match) this.championAnims[slot] = match;
            }
        }
        // Final fallbacks for clips that didn't match any alias.
        const aa = this.championAnims;
        if (aa.all.length === 1 && !aa.attack) {
            aa.attack = aa.all[0]; // Single-clip asset — assume shoot.
        } else if (aa.all.length >= 2) {
            if (!aa.idle)  aa.idle  = aa.all[0];
            if (!aa.walk)  aa.walk  = aa.all[1];
            if (!aa.attack) aa.attack = aa.all[aa.all.length - 1];
        }
        // Speed up the shoot/special clips and compute their effective durations.
        // (AnimGroup.duration is the clip length in seconds — Babylon's frames/60.)
        if (aa.attack) {
            aa.attack.speedRatio = Champion.GLB_ATTACK_SPEED;
            const estDur = Math.min(2.5, aa.attack.duration / Champion.GLB_ATTACK_SPEED);
            (this as any).glbAttackDurationActual = estDur > 0.1 ? estDur : Champion.GLB_ATTACK_DURATION;
        }
        if (aa.special) {
            aa.special.speedRatio = Champion.GLB_SPECIAL_SPEED;
            const estDur = Math.min(2.5, aa.special.duration / Champion.GLB_SPECIAL_SPEED);
            (this as any).glbSpecialDurationActual = estDur > 0.1 ? estDur : Champion.GLB_SPECIAL_DURATION;
        }
        console.log(
            `[${this.championType}] mapped: idle="${aa.idle?.name ?? '(none)'}", ` +
            `walk="${aa.walk?.name ?? '(none)'}", attack="${aa.attack?.name ?? '(none)'}", ` +
            `special="${aa.special?.name ?? '(none)'}"`,
        );

        if (aa.idle) this.playChampionAnim('idle');
    }

    /** True while a GLB-driven special animation is still playing.
     *  HeroBasicAttack checks this to suspend basic attacks for the duration. */
    public isSpecialActive(): boolean {
        return this.glbSpecialTimer > 0;
    }

    /** True while a GLB-driven basic-attack animation is still playing — used to
     *  prevent re-firing the basic attack mid-swing so long clips (like the Aulus
     *  whirlwind sweep) finish before the next attack triggers. */
    public isAttackActive(): boolean {
        return this.glbAttackTimer > 0;
    }

    /** Switch to the named animation slot (no-op if already playing it).
     *  Transitions cross-fade instead of hard-cutting: locomotion blends are
     *  soft (idle↔walk), combat clips snap in fast so the hit still reads on
     *  time — pose popping was the single biggest feel problem. */
    private playChampionAnim(slot: 'idle' | 'walk' | 'attack' | 'special'): void {
        const target = this.championAnims[slot];
        if (!target) return;
        if (this.championCurrentAnim === target) return;
        const loop = slot === 'idle' || slot === 'walk';
        const fade = slot === 'attack' ? 0.07 : slot === 'special' ? 0.1 : 0.16;
        target.crossFrom(this.championCurrentAnim, fade, loop);
        this.championCurrentAnim = target;
    }

    /** Called by HeroBasicAttack each time the champion's basic attack fires (ranger
     *  arrow, barbarian swing, etc.). Restarts the attack animation from frame 0 even
     *  if a previous one is still playing. The optional targetPos overrides facing —
     *  during the attack timer the model turns to face the target.
     *
     *  `maxDurationS` (the attack interval) compresses the clip so the swing
     *  always completes within the firing cadence: attack-speed builds read as
     *  visibly faster swings instead of clipped ones, and the animation never
     *  gates DPS via isAttackActive(). Callers that omit it (power casts —
     *  their cadence is the power cooldown) keep the clip's natural pace, which
     *  also keeps getCastReleaseDelay()'s release-point sync intact. */
    public triggerAttack(targetPos?: Vector3, maxDurationS?: number): void {
        if (!this.championAsset) return;
        if (this.glbDeathPlaying) return; // a corpse doesn't swing
        // Don't interrupt the special animation. Per-frame logic already prioritises
        // special over attack, but triggerAttack force-stops the current clip and
        // starts attack, which without this guard would cut the whirlwind short.
        if (this.glbSpecialTimer > 0) return;
        const baseDur = (this as any).glbAttackDurationActual ?? Champion.GLB_ATTACK_DURATION;
        const dur = (maxDurationS !== undefined && maxDurationS > 0.05)
            ? Math.min(baseDur, maxDurationS)
            : baseDur;
        this.glbAttackTimer = dur;
        this.glbAttackFacingTarget = targetPos ? targetPos.clone() : null;
        const attack = this.championAnims.attack;
        if (attack) {
            attack.speedRatio = attack.duration / dur;
            attack.crossFrom(this.championCurrentAnim, 0.07, false);
            this.championCurrentAnim = attack;
        }
    }

    /** Called by PowerSlotManager when a power-slot attack (Fire Arrow / Frost Shards /
     *  etc.) fires. Plays the special animation; higher priority than the basic attack. */
    public triggerSpecial(): void {
        if (!this.championAsset) return;
        if (this.glbDeathPlaying) return; // a corpse doesn't cast
        const dur = (this as any).glbSpecialDurationActual ?? Champion.GLB_SPECIAL_DURATION;
        this.glbSpecialTimer = dur;
        const special = this.championAnims.special;
        if (special) {
            special.crossFrom(this.championCurrentAnim, 0.1, false);
            this.championCurrentAnim = special;
        }
    }

    /** Per-class fraction of the special clip at which the cast visually
     *  "releases" (hand swing / staff thrust completes). Tuned by eye per rig. */
    private static readonly CAST_RELEASE_FRACTION: Record<'barbarian' | 'ranger' | 'mage', number> = {
        barbarian: 0.40,
        ranger:    0.35,
        mage:      0.45,
    };

    /** Design move speed per class (HeroController's base speeds) — the walk
     *  clip plays at 1× when travelling at this speed and time-scales with the
     *  actual velocity, so move-speed items/slows never cause foot-sliding. */
    private static readonly RUN_REFERENCE_SPEED: Record<'barbarian' | 'ranger' | 'mage', number> = {
        barbarian: 6,
        ranger:    9,
        mage:      7,
    };

    /** Exponentially ease the mesh yaw toward `targetYaw` along the shortest
     *  arc — replaces the per-frame hard snap, which made direction changes
     *  and target switches read as teleporting rotations. Rate 14/s keeps it
     *  responsive (~90% of the turn lands in 160 ms). */
    private smoothFaceYaw(targetYaw: number, deltaTime: number): void {
        if (!this.mesh) return;
        const current = this.mesh.rotation.y;
        let diff = targetYaw - current;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.mesh.rotation.y = current + diff * (1 - Math.exp(-14 * deltaTime));
    }

    /** Seconds between the power-cast animation starting and the clip's visual
     *  release point. PowerSlotManager delays the actual power cast by this much
     *  so the projectile leaves the hand exactly on the release pose. Synced to
     *  whichever clip a power cast actually plays: the special swing on the
     *  barbarian, the NORMAL attack clip on ranger/mage (their special clip is
     *  reserved for the Q/E ultimates). 0 for procedural champions. */
    public getCastReleaseDelay(): number {
        if (!this.championAsset) return 0;
        const usesSpecial = this.championType === 'barbarian';
        const clip = usesSpecial ? this.championAnims.special : this.championAnims.attack;
        if (!clip) return 0;
        const dur = usesSpecial
            ? (((this as any).glbSpecialDurationActual as number | undefined) ?? Champion.GLB_SPECIAL_DURATION)
            : (((this as any).glbAttackDurationActual as number | undefined) ?? Champion.GLB_ATTACK_DURATION);
        const frac = Champion.CAST_RELEASE_FRACTION[this.championType];
        return Math.min(0.6, Math.max(0.05, dur * frac));
    }

    /** Elements of the currently equipped powers (latest per-frame snapshot from
     *  updateElementVisuals). Used by AbilityManager to tint whirlwind FX. */
    public getActiveElements(): PowerElement[] {
        return this.activeElementSnapshot as PowerElement[];
    }

    /** True while the death clip is playing or holding its final fallen frame. */
    public isDeathPlaying(): boolean {
        return this.glbDeathPlaying;
    }

    /** Play the GLB death clip once and hold the fallen pose (co-op spectate / downed).
     *  Cancels any in-flight attack/special so the body crumples cleanly. If the asset
     *  has no death clip it still flags death + fires the golden burst so callers can
     *  rely on a consistent "downed" state. Idempotent. */
    public triggerDeath(): void {
        if (this.glbDeathPlaying) return;
        this.glbDeathPlaying = true;
        this.glbAttackTimer = 0;
        this.glbSpecialTimer = 0;
        this.createChampionDeathEffect();
        const death = this.championAnims.death;
        if (!death) return; // no clip — body just stays in its last pose; burst played above
        death.speedRatio = 1.0;
        // Short blend into the crumple; AnimGroup clamps on the final frame.
        death.crossFrom(this.championCurrentAnim, 0.14, false);
        this.championCurrentAnim = death;
    }

    /** Clear the downed state and resume normal animation (co-op wave-clear respawn). */
    public clearDeath(): void {
        if (!this.glbDeathPlaying) return;
        this.glbDeathPlaying = false;
        if (this.championAnims.death) this.championAnims.death.stop();
        this.championCurrentAnim = null;
        if (this.championAnims.idle) this.playChampionAnim('idle');
    }

    /** Play a specific GLB animation clip (looked up by suffix match) as a forced
     *  "special" channel. Used by AbilityManager when a class-specific ultimate
     *  fires (Aulus Whirlwind, Aulus Smash, etc.) — basic attacks suspend for the
     *  duration via isSpecialActive().
     *
     *  When `durationSec` is provided AND longer than the clip's natural length,
     *  the clip is looped to fill the duration (used by Whirlwind which ticks
     *  damage over 5 seconds — the slash animation needs to keep going). */
    public playAbilityClip(clipSuffix: string, durationSec?: number, speed: number = 1.0): void {
        if (!this.championAsset) return;
        const match = this.championAnims.all.find(ag => ag.name.endsWith(clipSuffix));
        if (!match) {
            console.warn(`[${this.championType}] playAbilityClip: no clip ends with "${clipSuffix}"`);
            return;
        }
        // Stop AND reset every other anim group on this rig — cloned GLB animation
        // groups can share underlying target tracks, so a previously-played clip
        // continues to drive bone state until explicitly stopped. Without this both
        // ability clips end up looking like whichever ran first. The CURRENT clip
        // is spared so the ult can cross-fade from it (its weight fades to 0,
        // contributing nothing, instead of popping to a T-pose mid-blend).
        for (const ag of this.championAnims.all) {
            if (ag !== match && ag !== this.championCurrentAnim) {
                ag.stop();
                ag.reset();
            }
        }
        match.speedRatio = speed;
        const naturalDur = match.duration / speed;
        const dur = durationSec ?? Math.min(3.0, naturalDur);
        const loop = durationSec !== undefined && durationSec > naturalDur;
        this.glbSpecialTimer = dur > 0.1 ? dur : Champion.GLB_SPECIAL_DURATION;
        match.crossFrom(this.championCurrentAnim, 0.1, loop);
        this.championCurrentAnim = match;
        console.log(
            `[${this.championType}] ability clip "${match.name}" playing for ` +
            `${this.glbSpecialTimer.toFixed(2)}s (loop=${loop})`,
        );
    }

    private createRangerMeshProcedural(): void {
        const scene = this.scene;

        // Earthy palette
        const leather      = new Color(0.55, 0.38, 0.20); // warm leather brown
        const darkLeather  = new Color(0.35, 0.24, 0.12); // dark leather
        const forestGreen  = new Color(0.22, 0.42, 0.18); // deep forest green
        const midGreen     = new Color(0.30, 0.55, 0.22); // mid green
        const bowWood      = new Color(0.48, 0.32, 0.14); // bow wood
        const arrowShaft   = new Color(0.60, 0.45, 0.22); // arrow shaft
        const arrowHead    = new Color(0.68, 0.65, 0.58); // metal arrow tip

        // --- Body: slimmer torso than knight ---
        this.mesh = createBox('rangerBody', {
            width: 0.85,
            height: 1.55,
            depth: 0.60
        }, scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 2.0;
        this.mesh.material = createLowPolyMaterial('rangerBodyMat', forestGreen);

        // Leather chest vest overlay
        const vest = createBox('rangerVest', {
            width: 0.60,
            height: 0.80,
            depth: 0.08
        });
        makeFlatShaded(vest);
        this.mesh.add(vest);
        vest.position.set(0, 0.15, 0.32);
        vest.material = createLowPolyMaterial('rangerVestMat', leather);

        // Vest buckle strap
        const strap = createBox('rangerStrap', {
            width: 0.52,
            height: 0.06,
            depth: 0.05
        });
        makeFlatShaded(strap);
        vest.add(strap);
        strap.position.set(0, -0.10, 0.05);
        strap.material = createLowPolyMaterial('rangerStrapMat', darkLeather);

        // Small shoulder pads (light leather, not full pauldrons)
        for (let side = -1; side <= 1; side += 2) {
            const pad = createBox(`rangerShoulder${side}`, {
                width: 0.22,
                height: 0.18,
                depth: 0.55
            });
            makeFlatShaded(pad);
            this.mesh.add(pad);
            pad.position.set(side * 0.54, 0.65, 0);
            pad.material = createLowPolyMaterial(`rangerShoulderMat${side}`, leather);
        }

        // --- Hooded cowl: cone + sphere base ---
        this.head = createSphere('rangerHoodBase', {
            diameter: 0.55,
            segments: 5
        });
        makeFlatShaded(this.head);
        this.mesh.add(this.head);
        this.head.position.set(0, 1.05, 0.02);
        this.head.material = createLowPolyMaterial('rangerHoodBaseMat', forestGreen);

        // Hood cone (pointed tip angling back)
        const hoodCone = createCylinder('rangerHoodCone', {
            height: 0.45,
            diameterTop: 0.0,
            diameterBottom: 0.40,
            tessellation: 5
        });
        makeFlatShaded(hoodCone);
        this.head.add(hoodCone);
        hoodCone.position.set(0, 0.25, -0.05);
        hoodCone.rotation.x = 0.18; // slight backward lean
        hoodCone.material = createLowPolyMaterial('rangerHoodConeMat', darkLeather);

        // Hood brim / shadow strip across face
        const hoodBrim = createBox('rangerHoodBrim', {
            width: 0.48,
            height: 0.10,
            depth: 0.28
        });
        makeFlatShaded(hoodBrim);
        this.head.add(hoodBrim);
        hoodBrim.position.set(0, 0.05, 0.20);
        hoodBrim.material = createLowPolyMaterial('rangerHoodBrimMat', darkLeather);

        // Eyes (small glowing amber slits beneath the hood)
        for (let side = -1; side <= 1; side += 2) {
            const eye = createBox(`rangerEye${side}`, {
                width: 0.06,
                height: 0.03,
                depth: 0.04
            });
            makeFlatShaded(eye);
            this.head.add(eye);
            eye.position.set(side * 0.08, 0.0, 0.28);
            eye.material = createEmissiveMaterial(`rangerEyeMat${side}`, new Color(0.95, 0.75, 0.15), 0.9);
        }

        // --- Arms (no gauntlets, leather bracers instead) ---
        // Right arm (bow arm — extends slightly forward)
        this.swordArm = createBox('rangerRightArm', {
            width: 0.22,
            height: 1.0,
            depth: 0.22
        });
        makeFlatShaded(this.swordArm);
        this.mesh.add(this.swordArm);
        this.swordArm.position.set(0.55, -0.05, 0.04);
        this.swordArm.material = createLowPolyMaterial('rangerRArmMat', forestGreen);

        // Right bracer (leather cuff)
        const rBracer = createBox('rangerRBracer', {
            width: 0.26,
            height: 0.16,
            depth: 0.26
        });
        makeFlatShaded(rBracer);
        this.swordArm.add(rBracer);
        rBracer.position.set(0, -0.38, 0);
        rBracer.material = createLowPolyMaterial('rangerRBracerMat', leather);

        // Left arm (draw arm — angled back slightly)
        this.shieldArm = createBox('rangerLeftArm', {
            width: 0.22,
            height: 1.0,
            depth: 0.22
        });
        makeFlatShaded(this.shieldArm);
        this.mesh.add(this.shieldArm);
        this.shieldArm.position.set(-0.55, -0.05, 0.04);
        this.shieldArm.material = createLowPolyMaterial('rangerLArmMat', forestGreen);

        // Left bracer
        const lBracer = createBox('rangerLBracer', {
            width: 0.26,
            height: 0.16,
            depth: 0.26
        });
        makeFlatShaded(lBracer);
        this.shieldArm.add(lBracer);
        lBracer.position.set(0, -0.38, 0);
        lBracer.material = createLowPolyMaterial('rangerLBracerMat', leather);

        // --- Bow: diagonal staff across the body ---
        this.rangerBow = createCylinder('rangerBowStave', {
            height: 1.40,
            diameterTop: 0.04,
            diameterBottom: 0.04,
            tessellation: 5
        });
        makeFlatShaded(this.rangerBow);
        this.mesh.add(this.rangerBow);
        // Position bow on the right side, angled diagonally
        this.rangerBow.position.set(0.30, 0.05, 0.30);
        this.rangerBow.rotation.z = 0.35;  // slight tilt
        this.rangerBow.rotation.x = -0.15;
        this.rangerBow.material = createLowPolyMaterial('rangerBowMat', bowWood);

        // Bow tips (curved ends — small tapered pieces)
        for (let side = -1; side <= 1; side += 2) {
            const bowTip = createCylinder(`rangerBowTip${side}`, {
                height: 0.14,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            });
            makeFlatShaded(bowTip);
            this.rangerBow.add(bowTip);
            bowTip.position.set(0, side * 0.75, 0);
            bowTip.rotation.z = side * 0.3;
            bowTip.material = createLowPolyMaterial(`rangerBowTipMat${side}`, darkLeather);
        }

        // Bowstring (thin line — very thin cylinder)
        const bowstring = createCylinder('rangerBowstring', {
            height: 1.30,
            diameterTop: 0.012,
            diameterBottom: 0.012,
            tessellation: 3
        });
        makeFlatShaded(bowstring);
        this.rangerBow.add(bowstring);
        bowstring.position.set(0, 0, 0.06);
        bowstring.material = createLowPolyMaterial('rangerBowstringMat', new Color(0.80, 0.78, 0.68));

        // --- Quiver on the back ---
        this.rangerQuiver = createBox('rangerQuiver', {
            width: 0.20,
            height: 0.45,
            depth: 0.20
        });
        makeFlatShaded(this.rangerQuiver);
        this.mesh.add(this.rangerQuiver);
        this.rangerQuiver.position.set(-0.28, 0.20, -0.38);
        this.rangerQuiver.rotation.z = 0.15;
        this.rangerQuiver.material = createLowPolyMaterial('rangerQuiverMat', leather);

        // Arrow stubs poking out of the quiver (3 arrows)
        const arrowOffsets = [-0.05, 0.0, 0.05];
        for (let i = 0; i < arrowOffsets.length; i++) {
            const arrow = createCylinder(`rangerArrow${i}`, {
                height: 0.38,
                diameterTop: 0.015,
                diameterBottom: 0.015,
                tessellation: 4
            });
            makeFlatShaded(arrow);
            this.rangerQuiver.add(arrow);
            arrow.position.set(arrowOffsets[i], 0.38, 0);
            arrow.material = createLowPolyMaterial(`rangerArrowMat${i}`, arrowShaft);

            // Arrow tip
            const tip = createCylinder(`rangerArrowTip${i}`, {
                height: 0.06,
                diameterTop: 0.0,
                diameterBottom: 0.04,
                tessellation: 3
            });
            makeFlatShaded(tip);
            arrow.add(tip);
            tip.position.set(0, 0.22, 0);
            tip.material = createLowPolyMaterial(`rangerArrowTipMat${i}`, arrowHead);
        }

        // --- Legs: slender, leather-booted ---
        this.rangerLeftLeg = createBox('rangerLeftLeg', {
            width: 0.26,
            height: 0.95,
            depth: 0.26
        });
        makeFlatShaded(this.rangerLeftLeg);
        this.mesh.add(this.rangerLeftLeg);
        this.rangerLeftLeg.position.set(-0.20, -1.10, 0);
        this.rangerLeftLeg.material = createLowPolyMaterial('rangerLeftLegMat', midGreen);

        this.rangerRightLeg = createBox('rangerRightLeg', {
            width: 0.26,
            height: 0.95,
            depth: 0.26
        });
        makeFlatShaded(this.rangerRightLeg);
        this.mesh.add(this.rangerRightLeg);
        this.rangerRightLeg.position.set(0.20, -1.10, 0);
        this.rangerRightLeg.material = createLowPolyMaterial('rangerRightLegMat', midGreen);

        // Boots (sleek leather, not armored sabatons)
        const bootL = createBox('rangerBootL', {
            width: 0.28,
            height: 0.18,
            depth: 0.42
        });
        makeFlatShaded(bootL);
        this.rangerLeftLeg.add(bootL);
        bootL.position.set(0, -0.52, 0.06);
        bootL.material = createLowPolyMaterial('rangerBootLMat', darkLeather);

        const bootR = createBox('rangerBootR', {
            width: 0.28,
            height: 0.18,
            depth: 0.42
        });
        makeFlatShaded(bootR);
        this.rangerRightLeg.add(bootR);
        bootR.position.set(0, -0.52, 0.06);
        bootR.material = createLowPolyMaterial('rangerBootRMat', darkLeather);

        // Alias the leg refs so the generic update() method can animate them
        this.leftLeg  = this.rangerLeftLeg;
        this.rightLeg = this.rangerRightLeg;

        this.originalScale = 1.0;
    }

    // =========================================================================
    // MAGE — robed caster with staff, pointed hat, glowing orb
    // =========================================================================
    private createMageMesh(): void {
        const scene = this.scene;

        // Mage palette
        const robeDark   = new Color(0.12, 0.10, 0.30); // deep indigo robe
        const robeMid    = new Color(0.18, 0.15, 0.45); // mid indigo
        const robeTrim   = new Color(0.70, 0.58, 0.20); // gold trim
        const staffBrown = new Color(0.40, 0.28, 0.12); // dark oak staff
        const orbColor   = new Color(0.35, 0.80, 1.0);  // bright cyan orb
        const hatColor   = new Color(0.10, 0.08, 0.28); // very dark hat
        const skinTone   = new Color(0.85, 0.72, 0.58); // mage face

        // --- Robe body: tall cone tapering downward (covers legs fully) ---
        // We use a wide box for the upper robe + cone skirt for the lower
        this.mesh = createBox('mageBody', {
            width: 1.0,
            height: 1.70,
            depth: 0.75
        }, scene);
        makeFlatShaded(this.mesh);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 2.0;
        this.mesh.material = createLowPolyMaterial('mageBodyMat', robeMid);

        // Robe lower skirt (cone narrows to ground)
        const robeSkirt = createCylinder('mageRobeSkirt', {
            height: 1.0,
            diameterTop: 0.90,
            diameterBottom: 0.30,
            tessellation: 6
        });
        makeFlatShaded(robeSkirt);
        this.mesh.add(robeSkirt);
        robeSkirt.position.set(0, -1.28, 0);
        robeSkirt.material = createLowPolyMaterial('mageSkirtMat', robeDark);

        // Gold trim at robe collar
        const collar = createTorus('mageCollar', {
            diameter: 0.70,
            thickness: 0.06,
            tessellation: 8
        });
        makeFlatShaded(collar);
        this.mesh.add(collar);
        collar.position.set(0, 0.78, 0);
        collar.material = createEmissiveMaterial('mageCollarMat', robeTrim, 0.4);

        // Gold trim at robe hem (bottom of upper robe)
        const hemTrim = createBox('mageHemTrim', {
            width: 1.05,
            height: 0.07,
            depth: 0.80
        });
        makeFlatShaded(hemTrim);
        this.mesh.add(hemTrim);
        hemTrim.position.set(0, -0.88, 0);
        hemTrim.material = createEmissiveMaterial('mageHemTrimMat', robeTrim, 0.35);

        // Rune symbols on robe front (3 small glowing boxes)
        const runeYPositions = [0.35, 0.0, -0.35];
        for (let i = 0; i < runeYPositions.length; i++) {
            const rune = createBox(`mageRune${i}`, {
                width: 0.08,
                height: 0.06,
                depth: 0.04
            });
            makeFlatShaded(rune);
            this.mesh.add(rune);
            rune.position.set(0, runeYPositions[i], 0.40);
            rune.material = createEmissiveMaterial(`mageRuneMat${i}`, orbColor, 0.7);
        }

        // --- Head: face sphere + pointed wizard hat ---
        this.head = createSphere('mageHead', {
            diameter: 0.52,
            segments: 5
        });
        makeFlatShaded(this.head);
        this.mesh.add(this.head);
        this.head.position.set(0, 1.05, 0.04);
        this.head.material = createLowPolyMaterial('mageHeadMat', skinTone);

        // Glowing eyes
        for (let side = -1; side <= 1; side += 2) {
            const eye = createBox(`mageEye${side}`, {
                width: 0.07,
                height: 0.05,
                depth: 0.04
            });
            makeFlatShaded(eye);
            this.head.add(eye);
            eye.position.set(side * 0.10, 0.05, 0.26);
            eye.material = createEmissiveMaterial(`mageEyeMat${side}`, orbColor, 1.0);
        }

        // Wizard hat brim (flat torus/disc)
        const hatBrim = createCylinder('mageHatBrim', {
            height: 0.06,
            diameterTop: 0.80,
            diameterBottom: 0.80,
            tessellation: 8
        });
        makeFlatShaded(hatBrim);
        this.head.add(hatBrim);
        hatBrim.position.set(0, 0.16, 0);
        hatBrim.material = createLowPolyMaterial('mageHatBrimMat', hatColor);

        // Brim gold trim
        const brimTrim = createTorus('mageHatBrimTrim', {
            diameter: 0.68,
            thickness: 0.04,
            tessellation: 8
        });
        makeFlatShaded(brimTrim);
        hatBrim.add(brimTrim);
        brimTrim.position.set(0, 0, 0);
        brimTrim.material = createEmissiveMaterial('mageHatBrimTrimMat', robeTrim, 0.5);

        // Wizard hat cone (tall pointed top)
        const hatCone = createCylinder('mageHatCone', {
            height: 0.75,
            diameterTop: 0.02,
            diameterBottom: 0.48,
            tessellation: 6
        });
        makeFlatShaded(hatCone);
        this.head.add(hatCone);
        hatCone.position.set(0, 0.55, -0.03);
        hatCone.rotation.x = 0.12; // slight backward tilt
        hatCone.material = createLowPolyMaterial('mageHatConeMat', hatColor);

        // Hat star ornament near tip
        const hatStar = createPolyhedron('mageHatStar', {
            type: 1, // octahedron
            size: 0.055
        });
        makeFlatShaded(hatStar);
        hatCone.add(hatStar);
        hatStar.position.set(0, 0.30, 0);
        hatStar.material = createEmissiveMaterial('mageHatStarMat', orbColor, 0.8);

        // --- Arms / sleeves (wide robe sleeves) ---
        this.swordArm = createBox('mageRightSleeve', {
            width: 0.28,
            height: 1.10,
            depth: 0.28
        });
        makeFlatShaded(this.swordArm);
        this.mesh.add(this.swordArm);
        this.swordArm.position.set(0.65, 0.0, 0.0);
        this.swordArm.material = createLowPolyMaterial('mageRSleevedMat', robeMid);

        // Sleeve trim (gold cuff)
        const rCuff = createBox('mageRCuff', {
            width: 0.34,
            height: 0.10,
            depth: 0.34
        });
        makeFlatShaded(rCuff);
        this.swordArm.add(rCuff);
        rCuff.position.set(0, -0.52, 0);
        rCuff.material = createEmissiveMaterial('mageRCuffMat', robeTrim, 0.4);

        this.shieldArm = createBox('mageLeftSleeve', {
            width: 0.28,
            height: 1.10,
            depth: 0.28
        });
        makeFlatShaded(this.shieldArm);
        this.mesh.add(this.shieldArm);
        this.shieldArm.position.set(-0.65, 0.0, 0.0);
        this.shieldArm.material = createLowPolyMaterial('mageLSleevedMat', robeMid);

        // Left sleeve trim
        const lCuff = createBox('mageLCuff', {
            width: 0.34,
            height: 0.10,
            depth: 0.34
        });
        makeFlatShaded(lCuff);
        this.shieldArm.add(lCuff);
        lCuff.position.set(0, -0.52, 0);
        lCuff.material = createEmissiveMaterial('mageLCuffMat', robeTrim, 0.4);

        // --- Staff held in right hand ---
        const staff = createCylinder('mageStaff', {
            height: 2.20,
            diameterTop: 0.055,
            diameterBottom: 0.07,
            tessellation: 6
        });
        makeFlatShaded(staff);
        this.swordArm.add(staff);
        staff.position.set(0.12, -0.45, 0.18);
        staff.rotation.z = 0.08;
        staff.material = createLowPolyMaterial('mageStaffMat', staffBrown);

        // Staff binding rings (decorative)
        const ringYPositions = [0.3, -0.3];
        for (let i = 0; i < ringYPositions.length; i++) {
            const ring = createTorus(`mageStaffRing${i}`, {
                diameter: 0.11,
                thickness: 0.025,
                tessellation: 6
            });
            makeFlatShaded(ring);
            staff.add(ring);
            ring.position.set(0, ringYPositions[i], 0);
            ring.material = createEmissiveMaterial(`mageStaffRingMat${i}`, robeTrim, 0.5);
        }

        // Staff orb cradle (4 curved prongs holding the orb)
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const prong = createCylinder(`mageStaffProng${i}`, {
                height: 0.20,
                diameterTop: 0.02,
                diameterBottom: 0.04,
                tessellation: 3
            });
            makeFlatShaded(prong);
            staff.add(prong);
            prong.position.set(
                Math.cos(angle) * 0.065,
                1.05,
                Math.sin(angle) * 0.065
            );
            prong.rotation.z = Math.cos(angle) * 0.5;
            prong.rotation.x = Math.sin(angle) * 0.5;
            prong.material = createEmissiveMaterial(`mageStaffProngMat${i}`, robeTrim, 0.5);
        }

        // Glowing orb at staff tip (emissive — this is the animated piece)
        this.mageStaffOrb = createSphere('mageStaffOrb', {
            diameter: 0.22,
            segments: 5
        });
        makeFlatShaded(this.mageStaffOrb);
        staff.add(this.mageStaffOrb);
        this.mageStaffOrb.position.set(0, 1.14, 0);

        // Create a mutable material we can animate (unique to this instance —
        // flagged ownedMaterial so disposeMesh frees it with the orb)
        this.mageOrbMat = new MeshPhongMaterial();
        this.mageOrbMat.name = 'mageOrbMat';
        this.mageOrbMat.emissive = orbColor.clone();
        this.mageOrbMat.color = orbColor.clone().multiplyScalar(0.3);
        this.mageOrbMat.specular = new Color(1, 1, 1);
        this.mageStaffOrb.material = this.mageOrbMat;
        this.mageStaffOrb.userData.ownedMaterial = true;

        // Outer orb glow ring
        const orbGlowRing = createTorus('mageOrbGlow', {
            diameter: 0.32,
            thickness: 0.04,
            tessellation: 8
        });
        makeFlatShaded(orbGlowRing);
        this.mageStaffOrb.add(orbGlowRing);
        orbGlowRing.position.set(0, 0, 0);
        orbGlowRing.material = createEmissiveMaterial('mageOrbGlowMat', orbColor, 0.6);

        // No visible legs (covered by robe skirt)
        // leftLeg / rightLeg stay null — the update() will skip them
        this.leftLeg  = null;
        this.rightLeg = null;

        this.originalScale = 1.0;
    }

    // Champion HP is shown via the HUD pill, never a floating in-world bar.
    // Override both to no-ops so no mesh is ever created.
    protected createHealthBar(): void { /* intentionally empty — player HP lives in the HUD */ }
    protected updateHealthBar(): void { /* intentionally empty — player HP lives in the HUD */ }

    /**
     * Update the champion — attack, block, and move along reversed path
     */
    public update(deltaTime: number): boolean {
        this.lastDeltaTime = deltaTime;
        if (!this.alive || !this.mesh) return false;

        // Player-controlled mode: bypass all AI, apply velocity directly
        if (this.controlMode === 'player') {
            this.position.addScaledVector(this.playerVelocity, deltaTime);
            // Self-heal a non-finite position (NaN/Infinity velocity or overflow) before
            // it propagates into the camera follow and blanks the canvas to black. Only
            // fires on already-broken state, so single-player behaviour is unchanged.
            if (!Number.isFinite(this.position.x) || !Number.isFinite(this.position.y) || !Number.isFinite(this.position.z)) {
                this.position.copy(this._lastFiniteHeroPos);
                this.playerVelocity.set(0, 0, 0);
            } else {
                this._lastFiniteHeroPos.copy(this.position);
            }
            this.mesh.position.x = this.position.x;
            this.mesh.position.z = this.position.z;
            // GLB ranger sits on its own (feetOffset applied in createChampionMeshFromGLB);
            // procedural meshes need +2.0 to keep box-bodies above the ground plane.
            // Any champion class with a preloaded GLB asset uses the GLB animation
            // pipeline; otherwise the per-class procedural mesh runs the existing logic.
            const usingChampionGLB = !!this.championAsset;
            this.mesh.position.y = this.position.y + (usingChampionGLB ? 0 : 2.0);

            // Decrement spin-attack timer
            if (this.spinAttackTimer > 0) {
                this.spinAttackTimer = Math.max(0, this.spinAttackTimer - deltaTime);
            }

            // Walking animation — advance walkTime while moving, animate limbs
            const isMoving = this.playerVelocity.lengthSq() > 0.001;
            if (isMoving) {
                this.walkTime += deltaTime * 5; // stride pace for player-controlled
            }

            // GLB ranger: prefer real GLB clips; fall back to mesh-level bob for any
            // slot the asset doesn't provide. Priority: special > shoot > walk > idle.
            if (usingChampionGLB) {
                const baseY = this.position.y;
                this.mesh.position.y = baseY;
                if (this.glbDeathPlaying) {
                    // Death clip is playing (or holding its final fallen frame). Don't let
                    // idle/walk/attack reclaim the rig — it stays down until clearDeath().
                } else if (this.glbSpecialTimer > 0) {
                    this.glbSpecialTimer = Math.max(0, this.glbSpecialTimer - deltaTime);
                    // DON'T re-call playChampionAnim('special') here — triggerSpecial /
                    // playAbilityClip already started the right clip (possibly a custom
                    // ability clip that isn't championAnims.special). Re-asserting the
                    // slot every frame would override the ability clip back to the
                    // auto-matched special, making Whirlwind/Smash look like attack1.
                } else if (this.glbAttackTimer > 0) {
                    this.glbAttackTimer = Math.max(0, this.glbAttackTimer - deltaTime);
                    this.playChampionAnim('attack');
                } else if (isMoving) {
                    if (this.championAnims.walk) {
                        this.playChampionAnim('walk');
                        // Stride matches actual travel speed (move-speed items,
                        // slows) so feet never slide.
                        const speed = Math.sqrt(this.playerVelocity.lengthSq());
                        const ref = Champion.RUN_REFERENCE_SPEED[this.championType] ?? 7;
                        this.championAnims.walk.speedRatio =
                            Math.min(1.8, Math.max(0.6, speed / ref));
                    } else {
                        if (this.championCurrentAnim) {
                            this.championCurrentAnim.stop();
                            this.championCurrentAnim = null;
                        }
                        this.mesh.position.y = baseY + Math.abs(Math.sin(this.walkTime * 2)) * 0.18;
                    }
                } else {
                    if (this.championAnims.idle) {
                        this.playChampionAnim('idle');
                    } else {
                        if (this.championCurrentAnim) {
                            this.championCurrentAnim.stop();
                            this.championCurrentAnim = null;
                        }
                        this.mesh.position.y = baseY + Math.sin(performance.now() / 700) * 0.04;
                    }
                }
            } else if (this.championType === 'mage') {
                this.animateMage(deltaTime);
            } else if (this.championType === 'ranger' || isMoving || this.spinAttackTimer > 0) {
                this.animateHumanoid();
            }

            // Facing priority: glb-aim-at-target > procedural spin (procedural
            // champs only) > movement direction > idle. (The barbarian's basic
            // attack used to force a full 360° mesh spin here — it is now a
            // forward cone chop, so he faces the aim target like the ranger.)
            if (this.glbAttackTimer > 0 && this.glbAttackFacingTarget) {
                // GLB attack mid-fire — ease toward the target (ranger aim /
                // barbarian chop direction) instead of snapping.
                const dx = this.glbAttackFacingTarget.x - this.position.x;
                const dz = this.glbAttackFacingTarget.z - this.position.z;
                if (dx * dx + dz * dz > 0.0001) {
                    this.smoothFaceYaw(headingToYaw(dx, dz), deltaTime);
                }
            } else if (this.spinAttackTimer > 0 && !usingChampionGLB) {
                // Procedural spin: full 360° rotation over SPIN_ATTACK_DURATION.
                const progress = 1 - this.spinAttackTimer / Champion.SPIN_ATTACK_DURATION;
                this.mesh.rotation.y = progress * Math.PI * 2;
            } else if (isMoving) {
                this.smoothFaceYaw(
                    headingToYaw(this.playerVelocity.x, this.playerVelocity.z), deltaTime);
            }

            // Mage orb pulse regardless of movement state
            if (this.championType === 'mage') {
                this.pulseMageOrb(deltaTime);
            }

            // Tick + cleanup barbarian spin FX
            if (this.championType === 'barbarian') {
                this.tickBarbSpinFx(deltaTime);
            }

            this._tickTorch(deltaTime);

            this.updateHealthBar();
            return false; // never "reached end of path"
        }

        // Attack nearby enemies

        // Block nearby enemies (throttled to avoid particle spam)
        this.blockTimer -= deltaTime;
        if (this.blockTimer <= 0) {
            this.blockNearbyEnemies();
            this.blockTimer = this.blockInterval;
        }

        // Move along the reversed path first (super.update sets mesh.position)
        const reachedEnd = super.update(deltaTime);

        // Animate AFTER super.update (same pattern as BasicEnemy goblin)
        if (!this.isFrozen && !this.isStunned && this.currentPathIndex < this.path.length && this.mesh) {
            this.walkTime += deltaTime * 4; // Heavy knight: slower than goblin's 6

            if (this.championType === 'mage') {
                this.animateMage(deltaTime);
            } else {
                this.animateHumanoid();
            }

            // Face direction of movement (shared by all types)
            if (this.currentPathIndex < this.path.length) {
                const targetPoint = this.path[this.currentPathIndex];
                const direction = _scratchDir.subVectors(targetPoint, this.position);
                if (direction.length() > 0.01) {
                    // Same heading as the Babylon `-atan2(z, x) + PI/2` form,
                    // routed through the single handedness conversion point.
                    this.mesh.rotation.y = headingToYaw(direction.x, direction.z);
                }
            }
        }

        // Mage orb pulse regardless of movement state
        if (this.championType === 'mage') {
            this.pulseMageOrb(deltaTime);
        }

        // Tick + cleanup barbarian spin FX
        if (this.championType === 'barbarian') {
            this.tickBarbSpinFx(deltaTime);
        }

        return reachedEnd;
    }

    /** Knight / Ranger shared humanoid walk animation */
    private animateHumanoid(): void {
        const spinning = this.spinAttackTimer > 0;

        // Body: bob up/down + slight side-to-side weight shift (more pronounced for heavy knight)
        const bobAmount = Math.abs(Math.sin(this.walkTime)) * 0.09;
        this.mesh!.position.y = this.position.y + 2.0 + bobAmount;
        const rollAmp = this.championType === 'barbarian' ? 0.12 : 0.08;
        this.mesh!.rotation.z = Math.sin(this.walkTime) * rollAmp; // Torso lean side-to-side

        // Legs: alternating stride (bigger swing for confident knight gait)
        if (this.leftLeg && this.rightLeg) {
            const stride = spinning ? 0.15 : 0.6;
            this.leftLeg.rotation.x  = Math.sin(this.walkTime) * stride;
            this.rightLeg.rotation.x = Math.sin(this.walkTime + Math.PI) * stride;
        }

        // Sword arm: hold straight out during spin attack, normal swing otherwise
        if (this.swordArm) {
            if (spinning) {
                // Extended out to the side, blade horizontal — wide arc
                this.swordArm.rotation.x = 0;
                this.swordArm.rotation.z = -Math.PI / 2;
            } else if (this.attackTimer > this.attackCooldown - 0.3) {
                this.swordArm.rotation.x = -Math.PI / 2.5;
                this.swordArm.rotation.z = -Math.PI / 8;
            } else {
                const swingAmp = this.championType === 'barbarian' ? 0.65 : 0.50;
                this.swordArm.rotation.x = Math.sin(this.walkTime) * swingAmp;
                this.swordArm.rotation.z = -0.08;
            }
        }

        // Shield arm: braced inward during spin, normal counter-sway otherwise
        if (this.shieldArm) {
            if (spinning) {
                this.shieldArm.rotation.x = -0.3;
                this.shieldArm.rotation.z = Math.PI / 6;
            } else if (this.attackTimer > this.attackCooldown - 0.3) {
                this.shieldArm.rotation.x = -0.2;
            } else {
                this.shieldArm.rotation.x = Math.sin(this.walkTime + Math.PI) * 0.25;
                this.shieldArm.rotation.z = (this.championType === 'barbarian' ? 0.15 : -0.15)
                    + Math.sin(this.walkTime * 0.7) * 0.04;
            }
        }

        // Head: slow look-around
        if (this.head) {
            this.head.rotation.y = Math.sin(this.walkTime * 0.6) * 0.12;
            this.head.rotation.x = Math.sin(this.walkTime * 0.4) * 0.04;
        }

        // Cape (knight only)
        if (this.cape) {
            this.cape.rotation.x = Math.sin(this.walkTime * 0.8) * 0.08 + 0.04;
        }

        // Ranger bow / quiver sway
        if (this.rangerBow) {
            this.rangerBow.rotation.z = 0.35 + Math.sin(this.walkTime * 0.8) * 0.04;
        }
        if (this.rangerQuiver) {
            this.rangerQuiver.rotation.z = 0.15 + Math.sin(this.walkTime * 0.8) * 0.03;
        }

        // Barbarian-specific extras layered on top of the shared humanoid pose
        if (this.championType === 'barbarian') {
            this.animateBarbarianExtras(this.lastDeltaTime);
        }
    }

    /** Mage-specific: bob the whole body, no visible legs, orb pulsing handled separately */
    private animateMage(_deltaTime: number): void {
        // Bob the robe body (gliding motion, no leg stride)
        const bobAmount = Math.abs(Math.sin(this.walkTime * 0.8)) * 0.06;
        this.mesh!.position.y = this.position.y + 2.0 + bobAmount;
        this.mesh!.rotation.z = Math.sin(this.walkTime * 0.5) * 0.02;

        // Staff arm sways slightly
        if (this.swordArm) {
            this.swordArm.rotation.x = Math.sin(this.walkTime * 0.6) * 0.12;
        }

        // Non-staff arm gentle drift
        if (this.shieldArm) {
            this.shieldArm.rotation.x = Math.sin(this.walkTime * 0.6 + Math.PI) * 0.10;
        }

        // Head turns slowly
        if (this.head) {
            this.head.rotation.y = Math.sin(this.walkTime * 0.4) * 0.15;
        }
    }

    /** Barbarian-only: breath pulse, hunched stride, kilt sway, trophy wobble, snarl twitch. */
    private animateBarbarianExtras(deltaTime: number): void {
        const spinning = this.spinAttackTimer > 0;
        const attacking = this.attackTimer > this.attackCooldown - 0.3;

        // 1. Breath pulse — always on, even during spin/attack
        if (this.barbChestPulseGroup) {
            this.barbChestPulseGroup.scale.y = 1 + Math.sin(this.walkTime * 0.4) * 0.04;
        }

        // 2. Hunched stride lean — don't fight existing pose during spin/attack
        if (!spinning && !attacking && this.mesh) {
            this.mesh.rotation.x = 0.05 + Math.sin(this.walkTime * 0.5) * 0.02;
        } else if (this.mesh) {
            this.mesh.rotation.x = 0;
        }

        // 3. Kilt flap sloshing — phase offset creates a wave around the waist
        for (let i = 0; i < this.barbKiltFlaps.length; i++) {
            this.barbKiltFlaps[i].rotation.x = Math.sin(this.walkTime + i * 0.3) * 0.15;
        }

        // 4. Belt trophy wobble — impacts with each step
        if (this.barbBeltTrophy) {
            this.barbBeltTrophy.rotation.x = Math.sin(this.walkTime * 2) * 0.20;
            this.barbBeltTrophy.rotation.z = Math.sin(this.walkTime * 1.5) * 0.10;
        }

        // 5. Snarl twitch — random fast jaw flick every 2-5s
        this.barbSnarlTimer -= deltaTime;
        if (this.barbSnarlTimer <= 0) {
            this.barbSnarlActive = 0.15;
            this.barbSnarlTimer = 2 + Math.random() * 3;
        }
        if (this.barbSnarlJaw) {
            if (this.barbSnarlActive > 0) {
                this.barbSnarlActive -= deltaTime;
                const t = Math.max(0, this.barbSnarlActive) / 0.15;
                this.barbSnarlJaw.rotation.x = -0.3 * Math.sin(t * Math.PI);
            } else {
                this.barbSnarlJaw.rotation.x = 0;
            }
        }

        // 6. Heavy footstep dust — emit when the stride phase crosses zero,
        //    using which foot is "planted" (sign of sin(walkTime)).
        const stepSign = Math.sign(Math.sin(this.walkTime));
        if (stepSign !== 0 && stepSign !== this.barbLastStepSign) {
            // Use the leg whose phase matches the new sign as the foot position.
            const foot = stepSign > 0 ? this.rightLeg : this.leftLeg;
            if (foot && this.mesh) {
                const footWorld = foot.getWorldPosition(new Vector3());
                footWorld.y = 0.05;
                this.spawnFootstepDust(footWorld);
            }
            this.barbLastStepSign = stepSign;
        }
    }

    /** Barbarian-only: fire a one-shot dust burst at worldPos.
     *  The old system pooled a single reposition-and-reset ParticleSystem; the
     *  library has no reset() equivalent, so this now spawns a short-lived
     *  autoDispose effect per footstep instead — footsteps are throttled to one
     *  per foot-plant (see barbLastStepSign), so this stays well within the
     *  transient-FX budget. barbFootDustPs is kept as the "last active" handle
     *  purely for the dispose-path invariant (always one live instance to free). */
    private spawnFootstepDust(worldPos: Vector3): void {
        if (this.barbFootDustPs) {
            this.barbFootDustPs.stop();
            this.barbFootDustPs.dispose();
            this.barbFootDustPs = null;
        }
        const ps = new ParticleEffect('barbFootDust', this.scene, {
            looping: false,
            duration: 0.5,
            maxParticles: 8,
            transform: { position: worldPos.clone(), rotation: new Vector3(-Math.PI / 2, 0, 0) },
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 8 }] },
            startLifetime: { min: 0.2 / 0.6, max: 0.4 / 0.6 },
            startSpeed: { min: 0.4 * 0.6 * 0.94, max: 1.2 * 0.6 * 0.94 },
            startSize: { min: fxSize(0.08), max: fxSize(0.18) },
            startColor: { min: { r: 0.35, g: 0.25, b: 0.15 }, max: { r: 0.50, g: 0.35, b: 0.20 } },
            startOpacity: 1,
            opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
            gravity: 0.5 * 0.6 * 0.6,
            shape: { shape: Shape.CONE, cone: { angle: 27, radius: 0.1, radiusThickness: 1, arc: 360 } },
            renderer: fxRenderer('normal'),
        }, { autoDispose: true });
        this.barbFootDustPs = ps;
    }

    /** Barbarian-only: small red splatter at a target position on basic-attack hit. */
    private spawnBloodSplatter(targetPos: Vector3): void {
        const splatPos = targetPos.clone();
        splatPos.y += 0.8;
        new ParticleEffect('barbBloodSplatter', this.scene, {
            looping: false,
            duration: 0.6,
            maxParticles: 10,
            transform: { position: splatPos },
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 10 }] },
            startLifetime: { min: 0.25 / 0.6, max: 0.5 / 0.6 },
            startSpeed: { min: 1 * 0.6 * 1.59, max: 2.5 * 0.6 * 1.59 },
            startSize: { min: fxSize(0.08), max: fxSize(0.16) },
            startColor: { min: { r: 0.45, g: 0.05, b: 0.02 }, max: { r: 0.70, g: 0.10, b: 0.05 } },
            startOpacity: 1,
            opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
            gravity: 4 * 0.6 * 0.6,
            shape: { shape: Shape.SPHERE, sphere: { radius: 0.1, radiusThickness: 1, arc: 360 } },
            renderer: fxRenderer('additive'),
        }, { autoDispose: true });
    }

    /** Barbarian-only: animate the spin arc ring (scale out + fade) and tear down FX when done. */
    private tickBarbSpinFx(deltaTime: number): void {
        // Ring scale-out + fade
        if (this.barbSpinArcMesh) {
            this.barbSpinArcTimer -= deltaTime;
            const t = 1 - Math.max(0, this.barbSpinArcTimer) / Champion.SPIN_ATTACK_DURATION;
            const scaleXZ = 0.3 + t * 1.2; // 0.3 -> 1.5
            this.barbSpinArcMesh.scale.x = scaleXZ;
            this.barbSpinArcMesh.scale.z = scaleXZ;
            // Keep the ring under the hero's current world position
            this.barbSpinArcMesh.position.x = this.position.x;
            this.barbSpinArcMesh.position.z = this.position.z;
            // Fade toward black in whatever base hue the ring was seeded with
            // (blended element color, or red when no elements). barbSpinArcColor
            // is reused (set, not allocated) to keep this per-frame path alloc-free.
            // The material is UNIQUE to this ring (ownedMaterial) — mutating it in
            // place is safe.
            const mat = this.barbSpinArcMesh.material as MeshPhongMaterial | null;
            if (mat) {
                const k = 1 - t;
                this.barbSpinArcColor.setRGB(
                    this.barbSpinArcBaseColor.r * k,
                    this.barbSpinArcBaseColor.g * k,
                    this.barbSpinArcBaseColor.b * k,
                );
                mat.emissive.copy(this.barbSpinArcColor);
                mat.opacity = 1 - t;
            }
            if (this.barbSpinArcTimer <= 0) {
                // materials: true — this arc-ring owns a UNIQUE per-spin emissive
                // material (animated each frame above), so it cannot be cached —
                // free the material with the mesh, else one material is orphaned
                // into the scene every spin.
                disposeMesh(this.barbSpinArcMesh, { materials: true });
                this.barbSpinArcMesh = null;
            }
        }

        // Stop the axe trails when the spin ends (blood + every elemental ribbon).
        if (this.barbSpinBloodPs && this.spinAttackTimer <= 0) {
            this.barbSpinBloodPs.stop();
            const ps = this.barbSpinBloodPs;
            this.barbSpinBloodPs = null;
            this._deferFxDisposal(ps);
        }
        if (this.barbSpinElemPs.length > 0 && this.spinAttackTimer <= 0) {
            const list = this.barbSpinElemPs;
            this.barbSpinElemPs = [];
            for (const ps of list) {
                ps.stop();
                this._deferFxDisposal(ps);
            }
        }
    }

    /** Schedule a stopped, fading-out particle effect for disposal after its fade
     *  window, while keeping it tracked so dispose()/die() can flush it early if
     *  the champion goes away first (see pendingFxDisposal above). */
    private _deferFxDisposal(ps: ParticleEffect): void {
        this.pendingFxDisposal.push(ps);
        const timer = setTimeout(() => {
            const idx = this.pendingFxDisposal.indexOf(ps);
            if (idx !== -1) this.pendingFxDisposal.splice(idx, 1);
            const timerIdx = this.pendingFxDisposalTimers.indexOf(timer);
            if (timerIdx !== -1) this.pendingFxDisposalTimers.splice(timerIdx, 1);
            ps.dispose();
        }, 400);
        this.pendingFxDisposalTimers.push(timer);
    }

    /** Pulse the mage staff orb emissive intensity over time */
    private pulseMageOrb(_deltaTime: number): void {
        if (!this.mageOrbMat) return;
        const pulse = 0.7 + Math.sin(this.walkTime * 2.5) * 0.3;
        this.mageOrbColor.setRGB(0.35 * pulse, 0.80 * pulse, 1.0 * pulse);
        this.mageOrbMat.emissive.copy(this.mageOrbColor);
    }

    /**
     * Find the closest enemy and deal damage on cooldown
     */
    private attackNearbyEnemies(deltaTime: number): void {
        this.attackTimer -= deltaTime;
        if (this.attackTimer > 0) return;

        if (!this.enemyManager) return;
        const target = this.enemyManager.getClosestEnemy(this.position, this.attackRange);
        if (!target || !target.isAlive()) return;

        target.takeDamage(this.attackDamage);
        this.attackTimer = this.attackCooldown;

        // Visual: sword swing flash (shared)
        this.createAttackEffect(target.getPosition());

        // Barbarian-only blood splatter on the target
        if (this.championType === 'barbarian') {
            this.spawnBloodSplatter(target.getPosition());
        }
    }

    /**
     * Apply a brief slow to all enemies within block radius
     */
    private blockNearbyEnemies(): void {
        if (!this.enemyManager) return;
        const nearbyEnemies = this.enemyManager.getEnemiesInRange(this.position, this.blockRadius);
        for (const enemy of nearbyEnemies) {
            if (enemy.isAlive()) {
                enemy.applyStatusEffect(StatusEffect.SLOWED, 0.5, 0.8);
            }
        }
    }

    /**
     * Create a visual slash effect when attacking
     */
    private createAttackEffect(targetPos: Vector3): void {
        const midpoint = new Vector3().lerpVectors(this.position, targetPos, 0.5);
        midpoint.y += 1.0;
        // Old code ran at rate (emitRate=80, T=0.6 -> 48/s) for a 100ms window
        // before stopping -> ~5 particles; ported to an equivalent one-shot burst.
        new ParticleEffect('championSlash', this.scene, {
            looping: false,
            duration: 0.5,
            maxParticles: 15,
            transform: { position: midpoint },
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 5 }] },
            startLifetime: { min: 0.1 / 0.6, max: 0.3 / 0.6 },
            startSpeed: { min: 1 * 0.6 * 1.78, max: 3 * 0.6 * 1.78 },
            startSize: { min: fxSize(0.15), max: fxSize(0.4) },
            startColor: { min: { r: 1, g: 0.7, b: 0.1 }, max: { r: 1, g: 0.85, b: 0.3 } },
            startOpacity: 1,
            opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
            shape: { shape: Shape.SPHERE, sphere: { radius: 0.3, radiusThickness: 1, arc: 360 } },
            renderer: fxRenderer('additive'),
        }, { autoDispose: true });
    }

    /**
     * Pulse the champion mesh red for 150ms to signal damage taken.
     * Walks the full child-mesh tree. If a flash is already in progress,
     * restart its timer instead of re-snapshotting (which would otherwise
     * capture the already-red emissive and "restore" to red).
     */
    public flashHitRed(): void {
        if (!this.mesh || isMeshDisposed(this.mesh)) return;

        const RED = new Color(1, 0.15, 0.15);
        const DURATION_MS = 150;

        if (!this.flashHitRedActive) {
            // Fresh flash — snapshot original emissive colors. The materials are all
            // instance-owned (procedural parts get fresh mats; GLB mats are cloned per
            // instance), so mutating emissive in place never bleeds across heroes.
            this.flashHitRedSnapshot = [];
            this.mesh.traverse(node => {
                const m = node as Mesh;
                if (!m.isMesh || !m.material || Array.isArray(m.material)) return;
                const mat = m.material as EmissiveMaterial;
                if (mat.emissive !== undefined) {
                    this.flashHitRedSnapshot.push({ mat, color: mat.emissive.clone() });
                    mat.emissive.copy(RED);
                }
            });
            this.flashHitRedActive = true;
        }
        // Reset / extend the restore timer either way.
        if (this.flashHitRedRestoreTimer !== null) {
            clearTimeout(this.flashHitRedRestoreTimer);
        }
        this.flashHitRedRestoreTimer = setTimeout(() => {
            for (const entry of this.flashHitRedSnapshot) {
                try { entry.mat.emissive.copy(entry.color); } catch (_) { /* mat disposed */ }
            }
            this.flashHitRedSnapshot = [];
            this.flashHitRedActive = false;
            this.flashHitRedRestoreTimer = null;
        }, DURATION_MS);
    }

    /**
     * Attach a warm, flickering point light to the hero — reads as a torch.
     * Parented to the mesh so it follows the hero without per-frame position
     * sync. Idempotent: a second call is a no-op.
     */
    /** @param intensity full torch = 5.0; lower values give a soft "hero
     *  presence" glow that lifts the character without washing out the key
     *  light's shadows.
     *  @param distance PointLight falloff cutoff (0 = unlimited); keep it
     *  small for the presence glow so the field stays untouched. */
    public enableTorch(intensity: number = 5.0, distance: number = 0): void {
        if (this.torchLight || !this.mesh) return;

        // Reuse the torch owned by Game (created once in Game.setupScene). Three
        // materials pick up lights dynamically, so unlike the Babylon build the
        // pre-registration is about single ownership, not shader slots — but the
        // contract is the same: never create a new light here, reparent Game's.
        const torch = this.game.getHeroTorch();
        torch.position.set(0, 1.4, 0);
        this.mesh.add(torch);
        torch.intensity = intensity;
        torch.distance = distance;

        this.torchLight          = torch;
        this.torchBaseIntensity  = torch.intensity;
        this.torchFlickerTime    = 0;
    }

    /** Two-octave noisy flicker around the base intensity. */
    private _tickTorch(deltaTime: number): void {
        if (!this.torchLight) return;
        this.torchFlickerTime += deltaTime;
        const t = this.torchFlickerTime;
        const flicker = Math.sin(t * 11.0) * 0.07 + Math.sin(t * 23.7 + 1.3) * 0.04;
        this.torchLight.intensity = this.torchBaseIntensity * (1 + flicker);
    }

    private _disposeTorch(): void {
        if (this.torchLight) {
            // Don't dispose — the torch lives on Game and is reused across runs.
            // Reparent it back to the scene root (out of the soon-to-be-disposed
            // hero subtree) and put it back to dormant.
            this.scene.scene.add(this.torchLight);
            this.torchLight.intensity = 0;
            this.torchLight = null;
        }
    }

    /** Add torch disposal on top of the base Enemy cleanup. */
    public dispose(): void {
        this._disposeTorch();
        // dispose() is the path used on state exit (SurvivorsGameplayState.exit ->
        // hero.dispose()). Without this the barbarian spin/footstep ParticleSystems
        // and spin-arc mesh — which only die() used to free — leaked one set per run
        // onto the never-disposed shared scene and kept ticking forever.
        this._releaseChampionFx();
        // GLB container instance: frees the per-instance cloned materials, the
        // cloned skeleton's bone-matrix texture, and the mixer's update hook
        // (glb_clonematerials_texture_leak invariant). No-op on the procedural path.
        this.containerInstance?.dispose();
        this.containerInstance = null;
        super.dispose();
    }

    /** Tear down the barbarian-only spin/footstep FX (procedural champion path) and
     *  any pending hit-flash restore timer. Shared by BOTH die() and dispose() so a
     *  state-exit teardown frees them too. */
    private _releaseChampionFx(): void {
        if (this.barbSpinBloodPs) {
            this.barbSpinBloodPs.stop();
            this.barbSpinBloodPs.dispose();
            this.barbSpinBloodPs = null;
        }
        for (const ps of this.barbSpinElemPs) {
            ps.stop();
            ps.dispose();
        }
        this.barbSpinElemPs = [];
        if (this.barbSpinArcMesh) {
            disposeMesh(this.barbSpinArcMesh, { materials: true });
            this.barbSpinArcMesh = null;
        }
        if (this.barbFootDustPs) {
            this.barbFootDustPs.stop();
            this.barbFootDustPs.dispose();
            this.barbFootDustPs = null;
        }
        // Flush any spin-trail FX still waiting out their fade window and cancel
        // their disposal timers, so nothing keeps ticking (or fires) after the
        // champion is gone.
        for (const timer of this.pendingFxDisposalTimers) {
            clearTimeout(timer);
        }
        this.pendingFxDisposalTimers = [];
        for (const ps of this.pendingFxDisposal) {
            ps.dispose();
        }
        this.pendingFxDisposal = [];
        // Free the per-element aura particle systems. ParticleEffect.dispose()
        // never touches config.map (the SHARED status-effect singleton survives).
        for (const ps of this.elementAuraPs.values()) {
            ps.stop();
            ps.dispose();
        }
        this.elementAuraPs.clear();
        this.elementAuraActive.clear();
        // Mythic weapon aura: ONE persistent PS — texture is the shared singleton.
        if (this.mythicAuraPs) {
            this.mythicAuraPs.stop();
            this.mythicAuraPs.dispose();
            this.mythicAuraPs = null;
        }
        this.mythicAuraKey = null;
        // GLB weapon tint: restore the resting emissive (the cloned material
        // itself is freed by the container-instance teardown).
        for (const w of this.glbWeaponMats) {
            try { w.mat.emissive.copy(w.baseEmissive); } catch (_) { /* disposed */ }
        }
        this.glbWeaponMats = [];
        // Storm bolts share ONE per-champion material — dispose meshes, then the
        // material once. (disposeMesh without the materials flag does NOT free
        // shared materials; bolts that were faded own a clone flagged
        // ownedMaterial, which disposeMesh frees per bolt.)
        for (const b of this.stormBolts) {
            try { if (!isMeshDisposed(b)) disposeMesh(b); } catch (_) { /* already disposed */ }
        }
        this.stormBolts = [];
        if (this.stormBoltMat) {
            try { this.stormBoltMat.dispose(); } catch (_) { /* already disposed */ }
            this.stormBoltMat = null;
        }
        // Weapon tint: restore the original material, then free the unique tint mat.
        if (this.weaponOrigMat && !isMeshDisposed(this.weaponOrigMat.mesh)) {
            this.weaponOrigMat.mesh.material = this.weaponOrigMat.mat as Mesh['material'];
        }
        this.weaponOrigMat = null;
        if (this.weaponTintMat) {
            try { this.weaponTintMat.dispose(); } catch (_) { /* already disposed */ }
            this.weaponTintMat = null;
        }
        this.weaponTintKey = null;
        if (this.flashHitRedRestoreTimer !== null) {
            clearTimeout(this.flashHitRedRestoreTimer);
            this.flashHitRedRestoreTimer = null;
        }
    }

    /**
     * Override die to skip gold reward and player damage events.
     * Only creates death particle burst and disposes.
     */
    protected die(): void {
        if (!this.alive) return;
        this.alive = false;

        // Death particle burst (gold/blue themed)
        this.createChampionDeathEffect();

        this._disposeTorch();

        // Tear down the GLB container instance: stops + disposes the cloned anim
        // groups (their animatables stop ticking once the mesh is gone), frees the
        // per-instance cloned materials AND the cloned skeleton's bone-matrix
        // texture — instantiate() clones materials per instance, so each run's hero
        // would otherwise leak them. Empty no-op on the procedural barbarian path,
        // whose shared/cached materials must survive.
        this.containerInstance?.dispose();
        this.containerInstance = null;
        this.glbAnimationGroups.length = 0;

        // Dispose mesh and health bars. Shared/cached materials survive (disposeMesh
        // only frees materials flagged ownedMaterial, e.g. the mage orb).
        if (this.mesh) {
            disposeMesh(this.mesh);
            this.mesh = null;
        }
        if (this.healthBarMesh) {
            disposeMesh(this.healthBarMesh);
            this.healthBarMesh = null;
        }
        if (this.healthBarBackgroundMesh) {
            disposeMesh(this.healthBarBackgroundMesh);
            this.healthBarBackgroundMesh = null;
        }
        if (this.healthBarOutlineMesh) {
            disposeMesh(this.healthBarOutlineMesh);
            this.healthBarOutlineMesh = null;
        }
        this.statusEffectParticles.forEach(ps => {
            ps.stop();
            ps.dispose();
        });
        this.statusEffectParticles.clear();

        // Barbarian spin/footstep FX cleanup (shared with dispose()).
        this._releaseChampionFx();
    }

    /**
     * Champion-specific death effect — golden burst
     */
    private createChampionDeathEffect(): void {
        const deathPos = this.position.clone();
        deathPos.y += 0.5;

        // Old rate=120 for a 200ms window (T=0.6) -> ~14 particles; ported to
        // an equivalent one-shot burst. Direction range is strictly upward
        // (y 1..3) -> upward CONE (~60deg spread).
        new ParticleEffect('championDeath', this.scene, {
            looping: false,
            duration: 1,
            maxParticles: 40,
            transform: { position: deathPos, rotation: new Vector3(-Math.PI / 2, 0, 0) },
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 15 }] },
            startLifetime: { min: 0.3 / 0.6, max: 0.8 / 0.6 },
            startSpeed: { min: 1 * 0.6 * 3.0, max: 4 * 0.6 * 3.0 },
            startSize: { min: fxSize(0.15), max: fxSize(0.45) },
            startColor: { min: { r: 0.2, g: 0.5, b: 1.0 }, max: { r: 1, g: 0.85, b: 0.3 } },
            startOpacity: 1,
            opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
            gravity: 5 * 0.6 * 0.6,
            shape: { shape: Shape.CONE, cone: { angle: 60, radius: 0.3, radiusThickness: 1, arc: 360 } },
            renderer: fxRenderer('additive'),
        }, { autoDispose: true });
    }

    // =========================================================================
    // ELEMENT VISUAL DECORATIONS
    // =========================================================================

    /**
     * Drive the elemental weapon-glow visuals: an emissive tint on the weapon
     * mesh (procedural champions) plus one particle aura per active element,
     * and flickering bolt meshes while storm is active.
     * Call once per frame with the set of active power elements.
     */
    public updateElementVisuals(activeElements: Set<string>): void {
        this.activeElementSnapshot = Array.from(activeElements);
        if (!this.mesh) return;
        const anchor = this.getWeaponAnchor();
        if (!anchor) return;

        this.updateWeaponTint(activeElements);

        const allElements: PowerElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];
        for (const element of allElements) {
            const shouldShow = activeElements.has(element);
            let ps = this.elementAuraPs.get(element);
            if (shouldShow && !ps) {
                ps = this.createElementAura(element, anchor);
                this.elementAuraPs.set(element, ps);
            }
            if (ps) {
                const active = this.elementAuraActive.get(element) ?? false;
                if (shouldShow && !active) { ps.start(); this.elementAuraActive.set(element, true); }
                else if (!shouldShow && active) { ps.stop(); this.elementAuraActive.set(element, false); }
            }
        }

        const stormActive = activeElements.has('storm');
        if (stormActive && this.stormBolts.length === 0) {
            this.createStormBolts(anchor);
        }
        if (this.stormBolts.length > 0) {
            for (const b of this.stormBolts) b.visible = stormActive;
            if (stormActive) this.flickerStormBolts(this.lastDeltaTime);
        }
    }

    /** Persistent mythic weapon aura at the weapon bone. Idempotent: rebuilds
     *  only when the config changes; null tears it down. ONE particle system;
     *  the shared status-effect texture singleton is never disposed with it. */
    public setMythicAura(cfg: MythicFxConfig | null): void {
        const key = cfg ? `${cfg.style}_${cfg.auraColor}` : null;
        if (key === this.mythicAuraKey) return;
        this.mythicAuraKey = key;
        if (this.mythicAuraPs) { this.mythicAuraPs.stop(); this.mythicAuraPs.dispose(); this.mythicAuraPs = null; }
        if (!cfg) return;
        const anchor = this.getWeaponAnchor();
        if (!anchor) return;
        const c = new Color(cfg.auraColor);

        // Per-style tuning: emitRate (real particles/s after *T), lifetime range,
        // size, shape (embers/motes are upward cones; ribbon is a wide up-and-out
        // spread -> SPHERE), and speed range scaled by the direction range's
        // magnitude M.
        let emitRate: number, minLife: number, maxLife: number;
        let minSpeed: number, maxSpeed: number, minSize: number, maxSize: number;
        let shapeConfig: { shape: Shape; cone?: { angle: number; radius: number; radiusThickness: number; arc: number }; sphere?: { radius: number; radiusThickness: number; arc: number } };
        let rotation: Vector3 | undefined;
        switch (cfg.style) {
            case 'embers':
                minLife = 0.4; maxLife = 0.9; emitRate = 50;
                minSize = 0.18; maxSize = 0.42;
                minSpeed = 0.5 * 0.6 * 1.14; maxSpeed = 1.2 * 0.6 * 1.14;
                shapeConfig = { shape: Shape.CONE, cone: { angle: 20, radius: 0.3, radiusThickness: 1, arc: 360 } };
                rotation = new Vector3(-Math.PI / 2, 0, 0);
                break;
            case 'ribbon':
                minLife = 0.15; maxLife = 0.4; emitRate = 70;
                minSize = 0.10; maxSize = 0.24;
                minSpeed = 1.2 * 0.6 * 1.6; maxSpeed = 2.4 * 0.6 * 1.6;
                shapeConfig = { shape: Shape.SPHERE, sphere: { radius: 0.3, radiusThickness: 1, arc: 360 } };
                break;
            case 'motes':
            default:
                minLife = 0.8; maxLife = 1.5; emitRate = 28;
                minSize = 0.16; maxSize = 0.34;
                minSpeed = 0.15 * 0.6 * 0.66; maxSpeed = 0.5 * 0.6 * 0.66;
                shapeConfig = { shape: Shape.CONE, cone: { angle: 55, radius: 0.3, radiusThickness: 1, arc: 360 } };
                rotation = new Vector3(-Math.PI / 2, 0, 0);
                break;
        }

        const ps = new ParticleEffect('mythicAura', this.scene, {
            looping: true,
            duration: 5,
            maxParticles: 64,
            simulationSpace: SimulationSpace.WORLD,
            map: getStatusEffectTexture(this.scene),
            emission: { rateOverTime: emitRate * 0.6 },
            startLifetime: { min: minLife / 0.6, max: maxLife / 0.6 },
            startSpeed: { min: minSpeed, max: maxSpeed },
            startSize: { min: fxSize(minSize), max: fxSize(maxSize) },
            startColor: { min: { r: c.r * 0.7, g: c.g * 0.7, b: c.b * 0.7 }, max: { r: c.r, g: c.g, b: c.b } },
            startOpacity: 1,
            opacityOverLifetime: { isActive: true, lifetimeCurve: { type: LifeTimeCurve.EASING, curveFunction: (t: number) => 1 - t } },
            gravity: 0,
            shape: shapeConfig,
            transform: rotation ? { rotation } : undefined,
            renderer: fxRenderer('additive'),
        }, { follow: anchor });
        this.mythicAuraPs = ps;
    }

    private getWeaponAnchor(): Object3D | null {
        if (this.glbWeaponAnchor && !isMeshDisposed(this.glbWeaponAnchor)) {
            return this.glbWeaponAnchor;
        }
        switch (this.championType) {
            case 'barbarian': return this.barbAxeHead ?? this.swordArm;
            case 'ranger':    return this.rangerBow ?? this.swordArm;
            case 'mage':      return this.mageStaffOrb ?? this.swordArm;
        }
        return null;
    }

    /** Tint the weapon with the blended element color ("the axe is frozen /
     *  burning"). GLB path: drives the emissive of the weapon primitive's own
     *  per-instance cloned material (Aulus' axe); champions whose GLB bakes the
     *  weapon into the body material (Miya/Framis) rely on the particle aura.
     *  Procedural path: swaps the weapon mesh's material for a unique tint mat.
     *  While tinted, the mage orb's idle pulse writes to the detached
     *  mageOrbMat (harmless); it resumes if all elements are removed. */
    private updateWeaponTint(activeElements: Set<string>): void {
        const key = Array.from(activeElements).sort().join('+');
        if (key === this.weaponTintKey) return;
        this.weaponTintKey = key;

        // GLB path — emissive write on the weapon's per-instance cloned material
        // (instance-owned, so mutating it in place never bleeds across heroes).
        if (this.glbWeaponMats.length > 0) {
            if (key === '') {
                for (const w of this.glbWeaponMats) w.mat.emissive.copy(w.baseEmissive);
            } else {
                // Kept subtle (0.35): emissive ADDS over the albedo, so a strong
                // tint flattens the axe texture — this strength colors the weapon
                // while its painted detail still reads through.
                const blend = blendElements(this.activeElementSnapshot as PowerElement[]);
                for (const w of this.glbWeaponMats) {
                    w.mat.emissive.copy(blend).multiplyScalar(0.35);
                }
            }
            return;
        }

        // Procedural path.
        let weapon: Mesh | null = null;
        switch (this.championType) {
            case 'barbarian': weapon = this.barbAxeHead; break;
            case 'ranger':    weapon = this.rangerBow; break;
            case 'mage':      weapon = this.mageStaffOrb; break;
        }
        if (!weapon || isMeshDisposed(weapon)) return;

        if (key === '') {
            if (this.weaponOrigMat && this.weaponOrigMat.mesh === weapon) {
                weapon.material = this.weaponOrigMat.mat as Mesh['material'];
            }
            return;
        }

        const blend = blendElements(this.activeElementSnapshot as PowerElement[]);
        if (!this.weaponTintMat) {
            this.weaponTintMat = new MeshPhongMaterial();
            this.weaponTintMat.name = `heroWeaponTint_${this.championType}`;
            this.weaponTintMat.specular = new Color(0, 0, 0);
        }
        this.weaponTintMat.emissive.copy(blend).multiplyScalar(0.85);
        this.weaponTintMat.color.copy(blend).multiplyScalar(0.35);
        if (weapon.material !== this.weaponTintMat) {
            if (!this.weaponOrigMat) {
                this.weaponOrigMat = { mesh: weapon, mat: weapon.material };
            }
            weapon.material = this.weaponTintMat;
        }
    }

    /** One persistent particle aura per element, anchored at the weapon.
     *  Created paused; updateElementVisuals() drives start/stop. */
    private createElementAura(element: PowerElement, anchor: Object3D): ParticleEffect {
        return new ParticleEffect(`heroAura_${element}`, this.scene, elementAuraConfig(element), {
            follow: anchor, startPaused: true,
        });
    }

    /** Three thin emissive bolts around the weapon that flicker while storm is
     *  active. One unique material per champion instance (NOT cached/shared —
     *  flashHitRed mutates emissive in place), freed in _releaseChampionFx. */
    private createStormBolts(anchor: Object3D): void {
        this.stormBoltMat = createEmissiveMaterial(
            `heroStormBoltMat_${this.championType}`,
            new Color(1.0, 0.95, 0.4), 0.95);
        for (let i = 0; i < 3; i++) {
            const bolt = createBox(`heroStormBolt_${i}`, {
                width: 0.05, height: 0.5, depth: 0.05,
            });
            bolt.material = this.stormBoltMat;
            anchor.add(bolt);
            const angle = (i / 3) * Math.PI * 2;
            bolt.position.set(Math.cos(angle) * 0.26, 0.18, Math.sin(angle) * 0.26);
            bolt.rotation.z = 0.4;
            this.stormBolts.push(bolt);
        }
    }

    /** Re-randomize bolt visibility/placement a few times per second — fades go
     *  through setMeshOpacity (clone-on-write per bolt), never by mutating the
     *  shared per-champion bolt material. */
    private flickerStormBolts(dt: number): void {
        this.stormFlickerTimer -= dt;
        if (this.stormFlickerTimer > 0) return;
        this.stormFlickerTimer = 0.05 + Math.random() * 0.12;
        for (const bolt of this.stormBolts) {
            setMeshOpacity(bolt, Math.random() < 0.65 ? 0.6 + Math.random() * 0.4 : 0);
            const angle = Math.random() * Math.PI * 2;
            const r = 0.18 + Math.random() * 0.14;
            bolt.position.x = Math.cos(angle) * r;
            bolt.position.z = Math.sin(angle) * r;
            bolt.position.y = 0.05 + Math.random() * 0.3;
            bolt.rotation.y = Math.random() * Math.PI;
            bolt.rotation.z = 0.25 + Math.random() * 0.5;
        }
    }
}
