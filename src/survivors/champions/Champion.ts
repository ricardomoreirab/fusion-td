import { Vector3, MeshBuilder, Mesh, Color3, Color4, ParticleSystem, StandardMaterial, AssetContainer, AnimationGroup, TransformNode, PointLight, Material } from '@babylonjs/core';
import { Game } from '../../engine/Game';
import { Enemy } from '../enemies/Enemy';
import { EnemyManager } from '../enemies/EnemyManager';
import { StatusEffect } from '../GameTypes';
import { PALETTE } from '../../engine/rendering/StyleConstants';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { buildBarbarianMesh } from './BarbarianBuilder';
import { ELEMENT_COLOR, blendElements } from '../ElementColors';
import { PowerElement } from '../powers/PowerDefinitions';

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
    private mageOrbMat: StandardMaterial | null = null;

    // Barbarian axe head — weapon anchor for element decorations
    private barbAxeHead: Mesh | null = null;

    // GLB path: invisible anchor mesh parented to the rig's weapon bone
    // ('Bip001 Prop1' on Miya/Framis, 'Bip001 R Hand' on Aulus). Element
    // decorations and spin-trail particle emitters attach here — the procedural
    // part refs (barbAxeHead / rangerBow / mageStaffOrb) stay null on this path.
    private glbWeaponAnchor: Mesh | null = null;

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
    private barbSpinBloodPs: ParticleSystem | null = null;
    // Latest active power elements, snapshotted each frame from updateElementVisuals.
    private activeElementSnapshot: string[] = [];
    // Elemental axe-trail particle systems created per spin (one per active element).
    private barbSpinElemPs: ParticleSystem[] = [];

    // Cached Color3 instances — reused every frame to avoid per-frame allocation
    private mageOrbColor: Color3 = new Color3(0, 0, 0);
    private barbSpinArcColor: Color3 = new Color3(0, 0, 0);
    // Base hue the spin feet-ring fades from (blended element color, or red).
    private barbSpinArcBaseColor: Color3 = new Color3(0.8, 0.10, 0.05);

    // Red hit-flash state — used by flashHitRed() to refresh the in-flight
    // flash instead of stacking snapshots that capture the already-red emissive.
    private flashHitRedActive: boolean = false;
    private flashHitRedRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    private flashHitRedSnapshot: { mat: StandardMaterial; color: Color3 }[] = [];

    // Pooled footstep dust particle system (barbarian only)
    private barbFootDustPs: ParticleSystem | null = null;

    // Torch light — warm point light that follows the hero with a gentle flicker.
    private torchLight: PointLight | null = null;
    private torchBaseIntensity: number = 0;
    private torchFlickerTime: number = 0;

    // Per-element weapon aura particle systems, created lazily on first activation.
    private elementAuraPs: Map<string, ParticleSystem> = new Map();
    // Storm-only flickering bolt meshes + their shared (per-champion) material.
    private stormBolts: Mesh[] = [];
    private stormBoltMat: StandardMaterial | null = null;
    private stormFlickerTimer: number = 0;
    // Weapon tint — ONE unfrozen emissive material per champion instance,
    // recolored in place as the active element combo changes. Deliberately NOT a
    // shared cached material: flashHitRed() mutates mesh materials' emissiveColor.
    private weaponTintMat: StandardMaterial | null = null;
    private weaponOrigMat: { mesh: Mesh; mat: Material | null } | null = null;
    private weaponTintKey: string | null = null;

    /** Optional preloaded GLB asset for whichever champion class this is (Miya for ranger,
     *  Aulus for barbarian, etc.). When present, createMesh instantiates the GLB and
     *  drives Idle / Walk / Attack / Special from its animation groups. */
    private championAsset: AssetContainer | null = null;

    /** Animation groups loaded from the champion GLB, categorized by detected name.
     *  When the asset ships skeletal anims we use these instead of mesh-level bob. */
    private championAnims: {
        idle: AnimationGroup | null;
        walk: AnimationGroup | null;
        attack: AnimationGroup | null;
        special: AnimationGroup | null;
        death: AnimationGroup | null;
        all: AnimationGroup[];
    } = { idle: null, walk: null, attack: null, special: null, death: null, all: [] };
    private championCurrentAnim: AnimationGroup | null = null;
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
        championAsset?: AssetContainer,
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
        // Dispose the knight body and all parented sub-meshes. Use the default
        // (false, false) — disposeMaterialAndTextures=true would nuke textures
        // shared with cached GLB AssetContainers (used by the next
        // instantiateModelsToScene call inside createChampionMeshFromGLB below),
        // crashing the new champion's clone in Mesh.refreshBoundingInfo.
        if (this.mesh) {
            this.mesh.dispose();
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
        this.playerVelocity.copyFrom(velocity);
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
        if (axeAnchor && elems.length > 0 && this.barbSpinElemPs.length === 0) {
            for (const el of elems) {
                const c = ELEMENT_COLOR[el];
                if (!c) continue;
                const ps = new ParticleSystem(`barbSpinElem_${el}`, 64, this.scene);
                ps.emitter = axeAnchor;
                ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
                ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
                ps.color1 = new Color4(c.r, c.g, c.b, 1);
                ps.color2 = new Color4(c.r * 0.6, c.g * 0.6, c.b * 0.6, 1);
                ps.colorDead = new Color4(c.r * 0.2, c.g * 0.2, c.b * 0.2, 0);
                ps.minSize = 0.10;
                ps.maxSize = 0.30;
                ps.minLifeTime = 0.1;
                ps.maxLifeTime = 0.22;
                ps.emitRate = 200;
                ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
                ps.direction1 = new Vector3(-1, 0.2, -1);
                ps.direction2 = new Vector3(1, 1.2, 1);
                ps.minEmitPower = 1;
                ps.maxEmitPower = 3;
                ps.gravity = new Vector3(0, -3, 0);
                ps.start();
                this.barbSpinElemPs.push(ps);
            }
        } else if (axeAnchor && elems.length === 0 && !this.barbSpinBloodPs) {
            const ps = new ParticleSystem('barbSpinBlood', 60, this.scene);
            ps.emitter = axeAnchor;
            ps.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
            ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
            ps.color1 = new Color4(0.7, 0.10, 0.05, 1);
            ps.color2 = new Color4(0.45, 0.05, 0.02, 1);
            ps.colorDead = new Color4(0.10, 0.0, 0.0, 0);
            ps.minSize = 0.10;
            ps.maxSize = 0.30;
            ps.minLifeTime = 0.1;
            ps.maxLifeTime = 0.2;
            ps.emitRate = 240;
            ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
            ps.direction1 = new Vector3(-1, 0.2, -1);
            ps.direction2 = new Vector3(1, 1.2, 1);
            ps.minEmitPower = 1;
            ps.maxEmitPower = 3;
            ps.gravity = new Vector3(0, -3, 0);
            ps.start();
            this.barbSpinBloodPs = ps;
        }

        // ===== Arc ring at hero feet — tinted by the blended elements (red when none) =====
        if (!this.barbSpinArcMesh && this.mesh) {
            const ring = MeshBuilder.CreateTorus('barbSpinArcRing', {
                diameter: 2.5,
                thickness: 0.15,
                tessellation: 12,
            }, this.scene);
            makeFlatShaded(ring);
            const arcBase = elems.length > 0
                ? blendElements(elems)
                : new Color3(0.8, 0.10, 0.05);
            this.barbSpinArcBaseColor.copyFrom(arcBase);
            ring.material = createEmissiveMaterial('barbSpinArcRingMat',
                arcBase, 0.9, this.scene);
            ring.position = this.position.clone();
            ring.position.y = 0.1;
            ring.scaling = new Vector3(0.3, 1.0, 0.3);
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

        // Allocate the pooled footstep dust PS once; reused every stride
        this.barbFootDustPs = this.createPooledFootstepDust();
    }

    /** Instantiate the preloaded GLB and parent it under an empty transform root.
     *  Categorizes the GLB's animation groups by name so we can play Idle / Walk /
     *  Shoot from the appropriate clip; falls back to mesh-bob for any slot that
     *  doesn't have a matching clip. */
    private createChampionMeshFromGLB(asset: AssetContainer): void {
        const scene = this.scene;

        // Empty transform host that Champion's existing position/rotation pipeline drives.
        this.mesh = new Mesh('rangerRoot', scene);
        this.mesh.position = this.position.clone();

        // doNotInstantiate: true does full Mesh.clone() so the geometry is independent
        // of the source — needed for rigged models so each instance gets its own skeleton.
        const inst = asset.instantiateModelsToScene(
            name => `ranger_${name}`,
            true,
            { doNotInstantiate: true },
        );
        const RANGER_SCALE = 1.5;
        for (const root of inst.rootNodes) {
            root.parent = this.mesh;
            if ('scaling' in root && root.scaling) {
                (root as TransformNode).scaling.scaleInPlace(RANGER_SCALE);
            }
        }

        // Shift the GLB so its feet sit on the ground (most rigged humanoids center on
        // torso so half the model lands below y=0 without this).
        this.mesh.computeWorldMatrix(true);
        const bbox = this.mesh.getHierarchyBoundingVectors(true);
        const feetOffset = -bbox.min.y;
        for (const root of inst.rootNodes) {
            if ('position' in root && root.position) {
                (root as TransformNode).position.y += feetOffset;
            }
        }

        // Weapon anchor: GLB weapons are skinned into the body mesh, driven by a
        // prop bone ('Bip001 Prop1' on Miya/Framis) or the right hand ('Bip001 R
        // Hand' on Aulus, whose axe has no dedicated prop bone). Parent an
        // invisible anchor mesh to that node so element decorations and the
        // barbarian spin-trail emitters ride the weapon through every animation.
        const weaponNode =
            this.mesh.getDescendants(false).find(n => n.name.includes('Prop1')) ??
            this.mesh.getDescendants(false).find(n => n.name.includes('R Hand'));
        if (weaponNode && weaponNode instanceof TransformNode) {
            const anchor = new Mesh('glbWeaponAnchor', scene);
            anchor.isVisible = false;
            anchor.parent = weaponNode;
            // Counter-scale so decorations parented here render at world size even
            // though rig nodes carry import scaling.
            weaponNode.computeWorldMatrix(true);
            const ws = weaponNode.absoluteScaling;
            anchor.scaling.set(
                ws.x !== 0 ? 1 / ws.x : 1,
                ws.y !== 0 ? 1 / ws.y : 1,
                ws.z !== 0 ? 1 / ws.z : 1,
            );
            this.glbWeaponAnchor = anchor;
        }

        // Categorize the GLB's animation clips by name. Accept aliases per slot since
        // different rigs/export tools use different conventions. "special" matches power-
        // slot attacks (Fire Arrow / Frost Shards / etc.) — usually a longer/more dramatic
        // clip than the basic shoot.
        this.championAnims = { idle: null, walk: null, attack: null, special: null, death: null, all: [...inst.animationGroups] };
        // Register the cloned GLB anim groups + skeleton on the inherited fields
        // so the base teardown (dispose() -> _releaseMeshAndAnimations) stops the
        // hero's animatables and frees its bone-matrix texture. Without this the
        // hero leaked ~one skeletal-group's worth of animatables + a texture per
        // run (championAnims.all alone is never disposed).
        this.glbAnimationGroups = [...inst.animationGroups];
        this.glbSkeletons = inst.skeletons;
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
        // substring is matched against the (prefixed) clip name.
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
        if (aa.attack) {
            aa.attack.speedRatio = Champion.GLB_ATTACK_SPEED;
            const frames = aa.attack.to - aa.attack.from;
            const estDur = Math.min(2.5, frames / 60 / Champion.GLB_ATTACK_SPEED);
            (this as any).glbAttackDurationActual = estDur > 0.1 ? estDur : Champion.GLB_ATTACK_DURATION;
        }
        if (aa.special) {
            aa.special.speedRatio = Champion.GLB_SPECIAL_SPEED;
            const frames = aa.special.to - aa.special.from;
            const estDur = Math.min(2.5, frames / 60 / Champion.GLB_SPECIAL_SPEED);
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

    /** Switch the ranger to the named animation slot (no-op if already playing it). */
    private playChampionAnim(slot: 'idle' | 'walk' | 'attack' | 'special'): void {
        const target = this.championAnims[slot];
        if (!target) return;
        if (this.championCurrentAnim === target) return;
        if (this.championCurrentAnim) this.championCurrentAnim.stop();
        const loop = slot === 'idle' || slot === 'walk';
        target.start(loop);
        this.championCurrentAnim = target;
    }

    /** Called by HeroBasicAttack each time the champion's basic attack fires (ranger
     *  arrow, barbarian swing, etc.). Restarts the attack animation from frame 0 even
     *  if a previous one is still playing. The optional targetPos overrides facing —
     *  during the attack timer the model turns to face the target. */
    public triggerAttack(targetPos?: Vector3): void {
        if (!this.championAsset) return;
        if (this.glbDeathPlaying) return; // a corpse doesn't swing
        // Don't interrupt the special animation. Per-frame logic already prioritises
        // special over attack, but triggerAttack force-stops the current clip and
        // starts attack, which without this guard would cut the whirlwind short.
        if (this.glbSpecialTimer > 0) return;
        const dur = (this as any).glbAttackDurationActual ?? Champion.GLB_ATTACK_DURATION;
        this.glbAttackTimer = dur;
        this.glbAttackFacingTarget = targetPos ? targetPos.clone() : null;
        const attack = this.championAnims.attack;
        if (attack) {
            if (this.championCurrentAnim) this.championCurrentAnim.stop();
            attack.start(false);
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
            if (this.championCurrentAnim) this.championCurrentAnim.stop();
            special.start(false);
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

    /** Seconds between triggerSpecial() starting the cast clip and the clip's
     *  visual release point. PowerSlotManager delays the actual power cast by
     *  this much so the projectile leaves the hand exactly on the release pose.
     *  0 for procedural champions (no clip to sync against). */
    public getCastReleaseDelay(): number {
        if (!this.championAsset || !this.championAnims.special) return 0;
        const dur = ((this as any).glbSpecialDurationActual as number | undefined)
            ?? Champion.GLB_SPECIAL_DURATION;
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
        if (this.championCurrentAnim) this.championCurrentAnim.stop();
        death.start(false); // play once; AnimationGroup holds the final frame when it ends
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
        // ability clips end up looking like whichever ran first.
        for (const ag of this.championAnims.all) {
            if (ag !== match) {
                ag.stop();
                ag.reset();
            }
        }
        match.stop();
        match.reset();
        match.speedRatio = speed;
        const frames = match.to - match.from;
        const naturalDur = frames / 60 / speed;
        const dur = durationSec ?? Math.min(3.0, naturalDur);
        const loop = durationSec !== undefined && durationSec > naturalDur;
        this.glbSpecialTimer = dur > 0.1 ? dur : Champion.GLB_SPECIAL_DURATION;
        match.start(loop);
        this.championCurrentAnim = match;
        console.log(
            `[${this.championType}] ability clip "${match.name}" playing for ` +
            `${this.glbSpecialTimer.toFixed(2)}s (loop=${loop})`,
        );
    }

    private createRangerMeshProcedural(): void {
        const scene = this.scene;

        // Earthy palette
        const leather      = new Color3(0.55, 0.38, 0.20); // warm leather brown
        const darkLeather  = new Color3(0.35, 0.24, 0.12); // dark leather
        const forestGreen  = new Color3(0.22, 0.42, 0.18); // deep forest green
        const midGreen     = new Color3(0.30, 0.55, 0.22); // mid green
        const bowWood      = new Color3(0.48, 0.32, 0.14); // bow wood
        const arrowShaft   = new Color3(0.60, 0.45, 0.22); // arrow shaft
        const arrowHead    = new Color3(0.68, 0.65, 0.58); // metal arrow tip

        // --- Body: slimmer torso than knight ---
        this.mesh = MeshBuilder.CreateBox('rangerBody', {
            width: 0.85,
            height: 1.55,
            depth: 0.60
        }, scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 2.0;
        this.mesh.material = createLowPolyMaterial('rangerBodyMat', forestGreen, scene);

        // Leather chest vest overlay
        const vest = MeshBuilder.CreateBox('rangerVest', {
            width: 0.60,
            height: 0.80,
            depth: 0.08
        }, scene);
        makeFlatShaded(vest);
        vest.parent = this.mesh;
        vest.position = new Vector3(0, 0.15, 0.32);
        vest.material = createLowPolyMaterial('rangerVestMat', leather, scene);

        // Vest buckle strap
        const strap = MeshBuilder.CreateBox('rangerStrap', {
            width: 0.52,
            height: 0.06,
            depth: 0.05
        }, scene);
        makeFlatShaded(strap);
        strap.parent = vest;
        strap.position = new Vector3(0, -0.10, 0.05);
        strap.material = createLowPolyMaterial('rangerStrapMat', darkLeather, scene);

        // Small shoulder pads (light leather, not full pauldrons)
        for (let side = -1; side <= 1; side += 2) {
            const pad = MeshBuilder.CreateBox(`rangerShoulder${side}`, {
                width: 0.22,
                height: 0.18,
                depth: 0.55
            }, scene);
            makeFlatShaded(pad);
            pad.parent = this.mesh;
            pad.position = new Vector3(side * 0.54, 0.65, 0);
            pad.material = createLowPolyMaterial(`rangerShoulderMat${side}`, leather, scene);
        }

        // --- Hooded cowl: cone + sphere base ---
        this.head = MeshBuilder.CreateSphere('rangerHoodBase', {
            diameter: 0.55,
            segments: 5
        }, scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 1.05, 0.02);
        this.head.material = createLowPolyMaterial('rangerHoodBaseMat', forestGreen, scene);

        // Hood cone (pointed tip angling back)
        const hoodCone = MeshBuilder.CreateCylinder('rangerHoodCone', {
            height: 0.45,
            diameterTop: 0.0,
            diameterBottom: 0.40,
            tessellation: 5
        }, scene);
        makeFlatShaded(hoodCone);
        hoodCone.parent = this.head;
        hoodCone.position = new Vector3(0, 0.25, -0.05);
        hoodCone.rotation.x = 0.18; // slight backward lean
        hoodCone.material = createLowPolyMaterial('rangerHoodConeMat', darkLeather, scene);

        // Hood brim / shadow strip across face
        const hoodBrim = MeshBuilder.CreateBox('rangerHoodBrim', {
            width: 0.48,
            height: 0.10,
            depth: 0.28
        }, scene);
        makeFlatShaded(hoodBrim);
        hoodBrim.parent = this.head;
        hoodBrim.position = new Vector3(0, 0.05, 0.20);
        hoodBrim.material = createLowPolyMaterial('rangerHoodBrimMat', darkLeather, scene);

        // Eyes (small glowing amber slits beneath the hood)
        for (let side = -1; side <= 1; side += 2) {
            const eye = MeshBuilder.CreateBox(`rangerEye${side}`, {
                width: 0.06,
                height: 0.03,
                depth: 0.04
            }, scene);
            makeFlatShaded(eye);
            eye.parent = this.head;
            eye.position = new Vector3(side * 0.08, 0.0, 0.28);
            eye.material = createEmissiveMaterial(`rangerEyeMat${side}`, new Color3(0.95, 0.75, 0.15), 0.9, scene);
        }

        // --- Arms (no gauntlets, leather bracers instead) ---
        // Right arm (bow arm — extends slightly forward)
        this.swordArm = MeshBuilder.CreateBox('rangerRightArm', {
            width: 0.22,
            height: 1.0,
            depth: 0.22
        }, scene);
        makeFlatShaded(this.swordArm);
        this.swordArm.parent = this.mesh;
        this.swordArm.position = new Vector3(0.55, -0.05, 0.04);
        this.swordArm.material = createLowPolyMaterial('rangerRArmMat', forestGreen, scene);

        // Right bracer (leather cuff)
        const rBracer = MeshBuilder.CreateBox('rangerRBracer', {
            width: 0.26,
            height: 0.16,
            depth: 0.26
        }, scene);
        makeFlatShaded(rBracer);
        rBracer.parent = this.swordArm;
        rBracer.position = new Vector3(0, -0.38, 0);
        rBracer.material = createLowPolyMaterial('rangerRBracerMat', leather, scene);

        // Left arm (draw arm — angled back slightly)
        this.shieldArm = MeshBuilder.CreateBox('rangerLeftArm', {
            width: 0.22,
            height: 1.0,
            depth: 0.22
        }, scene);
        makeFlatShaded(this.shieldArm);
        this.shieldArm.parent = this.mesh;
        this.shieldArm.position = new Vector3(-0.55, -0.05, 0.04);
        this.shieldArm.material = createLowPolyMaterial('rangerLArmMat', forestGreen, scene);

        // Left bracer
        const lBracer = MeshBuilder.CreateBox('rangerLBracer', {
            width: 0.26,
            height: 0.16,
            depth: 0.26
        }, scene);
        makeFlatShaded(lBracer);
        lBracer.parent = this.shieldArm;
        lBracer.position = new Vector3(0, -0.38, 0);
        lBracer.material = createLowPolyMaterial('rangerLBracerMat', leather, scene);

        // --- Bow: diagonal staff across the body ---
        this.rangerBow = MeshBuilder.CreateCylinder('rangerBowStave', {
            height: 1.40,
            diameterTop: 0.04,
            diameterBottom: 0.04,
            tessellation: 5
        }, scene);
        makeFlatShaded(this.rangerBow);
        this.rangerBow.parent = this.mesh;
        // Position bow on the right side, angled diagonally
        this.rangerBow.position = new Vector3(0.30, 0.05, 0.30);
        this.rangerBow.rotation.z = 0.35;  // slight tilt
        this.rangerBow.rotation.x = -0.15;
        this.rangerBow.material = createLowPolyMaterial('rangerBowMat', bowWood, scene);

        // Bow tips (curved ends — small tapered pieces)
        for (let side = -1; side <= 1; side += 2) {
            const bowTip = MeshBuilder.CreateCylinder(`rangerBowTip${side}`, {
                height: 0.14,
                diameterTop: 0.01,
                diameterBottom: 0.04,
                tessellation: 4
            }, scene);
            makeFlatShaded(bowTip);
            bowTip.parent = this.rangerBow;
            bowTip.position = new Vector3(0, side * 0.75, 0);
            bowTip.rotation.z = side * 0.3;
            bowTip.material = createLowPolyMaterial(`rangerBowTipMat${side}`, darkLeather, scene);
        }

        // Bowstring (thin line — very thin cylinder)
        const bowstring = MeshBuilder.CreateCylinder('rangerBowstring', {
            height: 1.30,
            diameterTop: 0.012,
            diameterBottom: 0.012,
            tessellation: 3
        }, scene);
        makeFlatShaded(bowstring);
        bowstring.parent = this.rangerBow;
        bowstring.position = new Vector3(0, 0, 0.06);
        bowstring.material = createLowPolyMaterial('rangerBowstringMat', new Color3(0.80, 0.78, 0.68), scene);

        // --- Quiver on the back ---
        this.rangerQuiver = MeshBuilder.CreateBox('rangerQuiver', {
            width: 0.20,
            height: 0.45,
            depth: 0.20
        }, scene);
        makeFlatShaded(this.rangerQuiver);
        this.rangerQuiver.parent = this.mesh;
        this.rangerQuiver.position = new Vector3(-0.28, 0.20, -0.38);
        this.rangerQuiver.rotation.z = 0.15;
        this.rangerQuiver.material = createLowPolyMaterial('rangerQuiverMat', leather, scene);

        // Arrow stubs poking out of the quiver (3 arrows)
        const arrowOffsets = [-0.05, 0.0, 0.05];
        for (let i = 0; i < arrowOffsets.length; i++) {
            const arrow = MeshBuilder.CreateCylinder(`rangerArrow${i}`, {
                height: 0.38,
                diameterTop: 0.015,
                diameterBottom: 0.015,
                tessellation: 4
            }, scene);
            makeFlatShaded(arrow);
            arrow.parent = this.rangerQuiver;
            arrow.position = new Vector3(arrowOffsets[i], 0.38, 0);
            arrow.material = createLowPolyMaterial(`rangerArrowMat${i}`, arrowShaft, scene);

            // Arrow tip
            const tip = MeshBuilder.CreateCylinder(`rangerArrowTip${i}`, {
                height: 0.06,
                diameterTop: 0.0,
                diameterBottom: 0.04,
                tessellation: 3
            }, scene);
            makeFlatShaded(tip);
            tip.parent = arrow;
            tip.position = new Vector3(0, 0.22, 0);
            tip.material = createLowPolyMaterial(`rangerArrowTipMat${i}`, arrowHead, scene);
        }

        // --- Legs: slender, leather-booted ---
        this.rangerLeftLeg = MeshBuilder.CreateBox('rangerLeftLeg', {
            width: 0.26,
            height: 0.95,
            depth: 0.26
        }, scene);
        makeFlatShaded(this.rangerLeftLeg);
        this.rangerLeftLeg.parent = this.mesh;
        this.rangerLeftLeg.position = new Vector3(-0.20, -1.10, 0);
        this.rangerLeftLeg.material = createLowPolyMaterial('rangerLeftLegMat', midGreen, scene);

        this.rangerRightLeg = MeshBuilder.CreateBox('rangerRightLeg', {
            width: 0.26,
            height: 0.95,
            depth: 0.26
        }, scene);
        makeFlatShaded(this.rangerRightLeg);
        this.rangerRightLeg.parent = this.mesh;
        this.rangerRightLeg.position = new Vector3(0.20, -1.10, 0);
        this.rangerRightLeg.material = createLowPolyMaterial('rangerRightLegMat', midGreen, scene);

        // Boots (sleek leather, not armored sabatons)
        const bootL = MeshBuilder.CreateBox('rangerBootL', {
            width: 0.28,
            height: 0.18,
            depth: 0.42
        }, scene);
        makeFlatShaded(bootL);
        bootL.parent = this.rangerLeftLeg;
        bootL.position = new Vector3(0, -0.52, 0.06);
        bootL.material = createLowPolyMaterial('rangerBootLMat', darkLeather, scene);

        const bootR = MeshBuilder.CreateBox('rangerBootR', {
            width: 0.28,
            height: 0.18,
            depth: 0.42
        }, scene);
        makeFlatShaded(bootR);
        bootR.parent = this.rangerRightLeg;
        bootR.position = new Vector3(0, -0.52, 0.06);
        bootR.material = createLowPolyMaterial('rangerBootRMat', darkLeather, scene);

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
        const robeDark   = new Color3(0.12, 0.10, 0.30); // deep indigo robe
        const robeMid    = new Color3(0.18, 0.15, 0.45); // mid indigo
        const robeTrim   = new Color3(0.70, 0.58, 0.20); // gold trim
        const staffBrown = new Color3(0.40, 0.28, 0.12); // dark oak staff
        const orbColor   = new Color3(0.35, 0.80, 1.0);  // bright cyan orb
        const hatColor   = new Color3(0.10, 0.08, 0.28); // very dark hat
        const skinTone   = new Color3(0.85, 0.72, 0.58); // mage face

        // --- Robe body: tall cone tapering downward (covers legs fully) ---
        // We use a wide box for the upper robe + cone skirt for the lower
        this.mesh = MeshBuilder.CreateBox('mageBody', {
            width: 1.0,
            height: 1.70,
            depth: 0.75
        }, scene);
        makeFlatShaded(this.mesh);
        this.mesh.position = this.position.clone();
        this.mesh.position.y += 2.0;
        this.mesh.material = createLowPolyMaterial('mageBodyMat', robeMid, scene);

        // Robe lower skirt (cone narrows to ground)
        const robeSkirt = MeshBuilder.CreateCylinder('mageRobeSkirt', {
            height: 1.0,
            diameterTop: 0.90,
            diameterBottom: 0.30,
            tessellation: 6
        }, scene);
        makeFlatShaded(robeSkirt);
        robeSkirt.parent = this.mesh;
        robeSkirt.position = new Vector3(0, -1.28, 0);
        robeSkirt.material = createLowPolyMaterial('mageSkirtMat', robeDark, scene);

        // Gold trim at robe collar
        const collar = MeshBuilder.CreateTorus('mageCollar', {
            diameter: 0.70,
            thickness: 0.06,
            tessellation: 8
        }, scene);
        makeFlatShaded(collar);
        collar.parent = this.mesh;
        collar.position = new Vector3(0, 0.78, 0);
        collar.material = createEmissiveMaterial('mageCollarMat', robeTrim, 0.4, scene);

        // Gold trim at robe hem (bottom of upper robe)
        const hemTrim = MeshBuilder.CreateBox('mageHemTrim', {
            width: 1.05,
            height: 0.07,
            depth: 0.80
        }, scene);
        makeFlatShaded(hemTrim);
        hemTrim.parent = this.mesh;
        hemTrim.position = new Vector3(0, -0.88, 0);
        hemTrim.material = createEmissiveMaterial('mageHemTrimMat', robeTrim, 0.35, scene);

        // Rune symbols on robe front (3 small glowing boxes)
        const runeYPositions = [0.35, 0.0, -0.35];
        for (let i = 0; i < runeYPositions.length; i++) {
            const rune = MeshBuilder.CreateBox(`mageRune${i}`, {
                width: 0.08,
                height: 0.06,
                depth: 0.04
            }, scene);
            makeFlatShaded(rune);
            rune.parent = this.mesh;
            rune.position = new Vector3(0, runeYPositions[i], 0.40);
            rune.material = createEmissiveMaterial(`mageRuneMat${i}`, orbColor, 0.7, scene);
        }

        // --- Head: face sphere + pointed wizard hat ---
        this.head = MeshBuilder.CreateSphere('mageHead', {
            diameter: 0.52,
            segments: 5
        }, scene);
        makeFlatShaded(this.head);
        this.head.parent = this.mesh;
        this.head.position = new Vector3(0, 1.05, 0.04);
        this.head.material = createLowPolyMaterial('mageHeadMat', skinTone, scene);

        // Glowing eyes
        for (let side = -1; side <= 1; side += 2) {
            const eye = MeshBuilder.CreateBox(`mageEye${side}`, {
                width: 0.07,
                height: 0.05,
                depth: 0.04
            }, scene);
            makeFlatShaded(eye);
            eye.parent = this.head;
            eye.position = new Vector3(side * 0.10, 0.05, 0.26);
            eye.material = createEmissiveMaterial(`mageEyeMat${side}`, orbColor, 1.0, scene);
        }

        // Wizard hat brim (flat torus/disc)
        const hatBrim = MeshBuilder.CreateCylinder('mageHatBrim', {
            height: 0.06,
            diameterTop: 0.80,
            diameterBottom: 0.80,
            tessellation: 8
        }, scene);
        makeFlatShaded(hatBrim);
        hatBrim.parent = this.head;
        hatBrim.position = new Vector3(0, 0.16, 0);
        hatBrim.material = createLowPolyMaterial('mageHatBrimMat', hatColor, scene);

        // Brim gold trim
        const brimTrim = MeshBuilder.CreateTorus('mageHatBrimTrim', {
            diameter: 0.68,
            thickness: 0.04,
            tessellation: 8
        }, scene);
        makeFlatShaded(brimTrim);
        brimTrim.parent = hatBrim;
        brimTrim.position = new Vector3(0, 0, 0);
        brimTrim.material = createEmissiveMaterial('mageHatBrimTrimMat', robeTrim, 0.5, scene);

        // Wizard hat cone (tall pointed top)
        const hatCone = MeshBuilder.CreateCylinder('mageHatCone', {
            height: 0.75,
            diameterTop: 0.02,
            diameterBottom: 0.48,
            tessellation: 6
        }, scene);
        makeFlatShaded(hatCone);
        hatCone.parent = this.head;
        hatCone.position = new Vector3(0, 0.55, -0.03);
        hatCone.rotation.x = 0.12; // slight backward tilt
        hatCone.material = createLowPolyMaterial('mageHatConeMat', hatColor, scene);

        // Hat star ornament near tip
        const hatStar = MeshBuilder.CreatePolyhedron('mageHatStar', {
            type: 1, // octahedron
            size: 0.055
        }, scene);
        makeFlatShaded(hatStar);
        hatStar.parent = hatCone;
        hatStar.position = new Vector3(0, 0.30, 0);
        hatStar.material = createEmissiveMaterial('mageHatStarMat', orbColor, 0.8, scene);

        // --- Arms / sleeves (wide robe sleeves) ---
        this.swordArm = MeshBuilder.CreateBox('mageRightSleeve', {
            width: 0.28,
            height: 1.10,
            depth: 0.28
        }, scene);
        makeFlatShaded(this.swordArm);
        this.swordArm.parent = this.mesh;
        this.swordArm.position = new Vector3(0.65, 0.0, 0.0);
        this.swordArm.material = createLowPolyMaterial('mageRSleevedMat', robeMid, scene);

        // Sleeve trim (gold cuff)
        const rCuff = MeshBuilder.CreateBox('mageRCuff', {
            width: 0.34,
            height: 0.10,
            depth: 0.34
        }, scene);
        makeFlatShaded(rCuff);
        rCuff.parent = this.swordArm;
        rCuff.position = new Vector3(0, -0.52, 0);
        rCuff.material = createEmissiveMaterial('mageRCuffMat', robeTrim, 0.4, scene);

        this.shieldArm = MeshBuilder.CreateBox('mageLeftSleeve', {
            width: 0.28,
            height: 1.10,
            depth: 0.28
        }, scene);
        makeFlatShaded(this.shieldArm);
        this.shieldArm.parent = this.mesh;
        this.shieldArm.position = new Vector3(-0.65, 0.0, 0.0);
        this.shieldArm.material = createLowPolyMaterial('mageLSleevedMat', robeMid, scene);

        // Left sleeve trim
        const lCuff = MeshBuilder.CreateBox('mageLCuff', {
            width: 0.34,
            height: 0.10,
            depth: 0.34
        }, scene);
        makeFlatShaded(lCuff);
        lCuff.parent = this.shieldArm;
        lCuff.position = new Vector3(0, -0.52, 0);
        lCuff.material = createEmissiveMaterial('mageLCuffMat', robeTrim, 0.4, scene);

        // --- Staff held in right hand ---
        const staff = MeshBuilder.CreateCylinder('mageStaff', {
            height: 2.20,
            diameterTop: 0.055,
            diameterBottom: 0.07,
            tessellation: 6
        }, scene);
        makeFlatShaded(staff);
        staff.parent = this.swordArm;
        staff.position = new Vector3(0.12, -0.45, 0.18);
        staff.rotation.z = 0.08;
        staff.material = createLowPolyMaterial('mageStaffMat', staffBrown, scene);

        // Staff binding rings (decorative)
        const ringYPositions = [0.3, -0.3];
        for (let i = 0; i < ringYPositions.length; i++) {
            const ring = MeshBuilder.CreateTorus(`mageStaffRing${i}`, {
                diameter: 0.11,
                thickness: 0.025,
                tessellation: 6
            }, scene);
            makeFlatShaded(ring);
            ring.parent = staff;
            ring.position = new Vector3(0, ringYPositions[i], 0);
            ring.material = createEmissiveMaterial(`mageStaffRingMat${i}`, robeTrim, 0.5, scene);
        }

        // Staff orb cradle (4 curved prongs holding the orb)
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const prong = MeshBuilder.CreateCylinder(`mageStaffProng${i}`, {
                height: 0.20,
                diameterTop: 0.02,
                diameterBottom: 0.04,
                tessellation: 3
            }, scene);
            makeFlatShaded(prong);
            prong.parent = staff;
            prong.position = new Vector3(
                Math.cos(angle) * 0.065,
                1.05,
                Math.sin(angle) * 0.065
            );
            prong.rotation.z = Math.cos(angle) * 0.5;
            prong.rotation.x = Math.sin(angle) * 0.5;
            prong.material = createEmissiveMaterial(`mageStaffProngMat${i}`, robeTrim, 0.5, scene);
        }

        // Glowing orb at staff tip (emissive — this is the animated piece)
        this.mageStaffOrb = MeshBuilder.CreateSphere('mageStaffOrb', {
            diameter: 0.22,
            segments: 5
        }, scene);
        makeFlatShaded(this.mageStaffOrb);
        this.mageStaffOrb.parent = staff;
        this.mageStaffOrb.position = new Vector3(0, 1.14, 0);

        // Create a mutable material we can animate
        this.mageOrbMat = new StandardMaterial('mageOrbMat', scene);
        this.mageOrbMat.emissiveColor = orbColor.clone();
        this.mageOrbMat.diffuseColor = orbColor.scale(0.3);
        this.mageOrbMat.specularColor = new Color3(1, 1, 1);
        this.mageStaffOrb.material = this.mageOrbMat;

        // Outer orb glow ring
        const orbGlowRing = MeshBuilder.CreateTorus('mageOrbGlow', {
            diameter: 0.32,
            thickness: 0.04,
            tessellation: 8
        }, scene);
        makeFlatShaded(orbGlowRing);
        orbGlowRing.parent = this.mageStaffOrb;
        orbGlowRing.position = new Vector3(0, 0, 0);
        orbGlowRing.material = createEmissiveMaterial('mageOrbGlowMat', orbColor, 0.6, scene);

        // No visible legs (covered by robe skirt)
        // leftLeg / rightLeg stay null — the update() will skip them
        this.leftLeg  = null;
        this.rightLeg = null;

        this.originalScale = 1.0;
    }

    // Champion HP is shown via the HUD pill (HeroHud), never a floating in-world bar.
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
            this.position.addInPlace(this.playerVelocity.scale(deltaTime));
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
            const isMoving = this.playerVelocity.lengthSquared() > 0.001;
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

            // Facing priority: barbarian whirlwind spin > glb-aim-at-target > procedural
            // spin (procedural champs only) > movement direction > idle.
            const glbBarbAttacking = usingChampionGLB
                && this.championType === 'barbarian'
                && this.glbAttackTimer > 0;
            if (glbBarbAttacking) {
                // Aulus whirlwind: spin 360° around Y over the attack-timer window so
                // the GLB swing animation reads as a full whirling sweep. Negative
                // sign = clockwise (viewed from above), matching the swing arc.
                const dur = (this as any).glbAttackDurationActual ?? Champion.GLB_ATTACK_DURATION;
                const progress = 1 - this.glbAttackTimer / dur;
                this.mesh.rotation.y = -progress * Math.PI * 2;
            } else if (this.glbAttackTimer > 0 && this.glbAttackFacingTarget) {
                // GLB attack mid-fire — turn to face the target (ranger aim).
                const dx = this.glbAttackFacingTarget.x - this.position.x;
                const dz = this.glbAttackFacingTarget.z - this.position.z;
                if (dx * dx + dz * dz > 0.0001) {
                    this.mesh.rotation.y = Math.atan2(dx, dz);
                }
            } else if (this.spinAttackTimer > 0 && !usingChampionGLB) {
                // Procedural spin: full 360° rotation over SPIN_ATTACK_DURATION.
                const progress = 1 - this.spinAttackTimer / Champion.SPIN_ATTACK_DURATION;
                this.mesh.rotation.y = progress * Math.PI * 2;
            } else if (isMoving) {
                this.mesh.rotation.y = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
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
                const direction = targetPoint.subtract(this.position);
                if (direction.length() > 0.01) {
                    const angle = Math.atan2(direction.z, direction.x);
                    this.mesh.rotation.y = -angle + Math.PI / 2;
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
            this.barbChestPulseGroup.scaling.y = 1 + Math.sin(this.walkTime * 0.4) * 0.04;
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
                const footWorld = foot.getAbsolutePosition().clone();
                footWorld.y = 0.05;
                this.spawnFootstepDust(footWorld);
            }
            this.barbLastStepSign = stepSign;
        }
    }

    /** Barbarian-only: allocate the single pooled footstep dust ParticleSystem. */
    private createPooledFootstepDust(): ParticleSystem {
        const ps = new ParticleSystem('barbFootDust', 8, this.scene);
        ps.minEmitBox = new Vector3(-0.10, 0, -0.10);
        ps.maxEmitBox = new Vector3(0.10, 0, 0.10);
        ps.color1 = new Color4(0.50, 0.35, 0.20, 1);
        ps.color2 = new Color4(0.35, 0.25, 0.15, 1);
        ps.colorDead = new Color4(0.25, 0.20, 0.15, 0);
        ps.minSize = 0.08;
        ps.maxSize = 0.18;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.4;
        ps.emitRate = 80;
        ps.manualEmitCount = 8;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.direction1 = new Vector3(-0.5, 0.4, -0.5);
        ps.direction2 = new Vector3(0.5, 0.8, 0.5);
        ps.minEmitPower = 0.4;
        ps.maxEmitPower = 1.2;
        ps.gravity = new Vector3(0, -0.5, 0);
        // emitter will be repositioned per-footstep
        return ps;
    }

    /** Barbarian-only: reposition the pooled PS to worldPos and fire a one-shot burst. */
    private spawnFootstepDust(worldPos: Vector3): void {
        if (!this.barbFootDustPs) return;
        const ps = this.barbFootDustPs;
        ps.emitter = worldPos;
        ps.stop();
        ps.reset();
        ps.manualEmitCount = 8;
        ps.start();
        // Auto-stop after the burst so the next footstep can restart cleanly
        setTimeout(() => { ps.stop(); }, 100);
    }

    /** Barbarian-only: small red splatter at a target position on basic-attack hit. */
    private spawnBloodSplatter(targetPos: Vector3): void {
        const splatPos = targetPos.clone();
        splatPos.y += 0.8;
        const ps = new ParticleSystem('barbBloodSplatter', 10, this.scene);
        ps.emitter = splatPos;
        ps.minEmitBox = new Vector3(-0.10, 0, -0.10);
        ps.maxEmitBox = new Vector3(0.10, 0, 0.10);
        ps.color1 = new Color4(0.70, 0.10, 0.05, 1);
        ps.color2 = new Color4(0.45, 0.05, 0.02, 1);
        ps.colorDead = new Color4(0.10, 0, 0, 0);
        ps.minSize = 0.08;
        ps.maxSize = 0.16;
        ps.minLifeTime = 0.25;
        ps.maxLifeTime = 0.5;
        ps.emitRate = 40;
        ps.manualEmitCount = 10; // one-shot
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1, 0.3, -1);
        ps.direction2 = new Vector3(1, 1, 1);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 2.5;
        ps.gravity = new Vector3(0, -4, 0);
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 100);
    }

    /** Barbarian-only: animate the spin arc ring (scale out + fade) and tear down FX when done. */
    private tickBarbSpinFx(deltaTime: number): void {
        // Ring scale-out + fade
        if (this.barbSpinArcMesh) {
            this.barbSpinArcTimer -= deltaTime;
            const t = 1 - Math.max(0, this.barbSpinArcTimer) / Champion.SPIN_ATTACK_DURATION;
            const scaleXZ = 0.3 + t * 1.2; // 0.3 -> 1.5
            this.barbSpinArcMesh.scaling.x = scaleXZ;
            this.barbSpinArcMesh.scaling.z = scaleXZ;
            // Keep the ring under the hero's current world position
            this.barbSpinArcMesh.position.x = this.position.x;
            this.barbSpinArcMesh.position.z = this.position.z;
            // Fade toward black in whatever base hue the ring was seeded with
            // (blended element color, or red when no elements). barbSpinArcColor
            // is reused (set, not allocated) to keep this per-frame path alloc-free.
            const mat = this.barbSpinArcMesh.material as StandardMaterial | null;
            if (mat) {
                const k = 1 - t;
                this.barbSpinArcColor.set(
                    this.barbSpinArcBaseColor.r * k,
                    this.barbSpinArcBaseColor.g * k,
                    this.barbSpinArcBaseColor.b * k,
                );
                mat.emissiveColor = this.barbSpinArcColor;
                mat.alpha = 1 - t;
            }
            if (this.barbSpinArcTimer <= 0) {
                // dispose(false, true): this arc-ring owns a UNIQUE per-spin
                // emissive material (animated each frame above), so it cannot be
                // cached — free the material + textures with the mesh, else one
                // StandardMaterial is orphaned into scene.materials every spin.
                this.barbSpinArcMesh.dispose(false, true);
                this.barbSpinArcMesh = null;
            }
        }

        // Stop the axe trails when the spin ends (blood + every elemental ribbon).
        if (this.barbSpinBloodPs && this.spinAttackTimer <= 0) {
            this.barbSpinBloodPs.stop();
            const ps = this.barbSpinBloodPs;
            this.barbSpinBloodPs = null;
            setTimeout(() => ps.dispose(), 400);
        }
        if (this.barbSpinElemPs.length > 0 && this.spinAttackTimer <= 0) {
            const list = this.barbSpinElemPs;
            this.barbSpinElemPs = [];
            for (const ps of list) {
                ps.stop();
                setTimeout(() => ps.dispose(), 400);
            }
        }
    }

    /** Pulse the mage staff orb emissive intensity over time */
    private pulseMageOrb(_deltaTime: number): void {
        if (!this.mageOrbMat) return;
        const pulse = 0.7 + Math.sin(this.walkTime * 2.5) * 0.3;
        this.mageOrbColor.set(0.35 * pulse, 0.80 * pulse, 1.0 * pulse);
        this.mageOrbMat.emissiveColor = this.mageOrbColor;
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
        const ps = new ParticleSystem('championSlash', 15, this.scene);
        const midpoint = Vector3.Lerp(this.position, targetPos, 0.5);
        midpoint.y += 1.0;
        ps.emitter = midpoint;
        ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0, 0.3);
        ps.color1 = new Color4(1, 0.85, 0.3, 1);
        ps.color2 = new Color4(1, 0.7, 0.1, 1);
        ps.colorDead = new Color4(0.5, 0.3, 0, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.4;
        ps.minLifeTime = 0.1;
        ps.maxLifeTime = 0.3;
        ps.emitRate = 80;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1, 0.5, -1);
        ps.direction2 = new Vector3(1, 1.5, 1);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 3;
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 400); }, 100);
    }

    /**
     * Pulse the champion mesh red for 150ms to signal damage taken.
     * Walks the full child-mesh tree. If a flash is already in progress,
     * restart its timer instead of re-snapshotting (which would otherwise
     * capture the already-red emissive and "restore" to red).
     */
    public flashHitRed(): void {
        if (!this.mesh || this.mesh.isDisposed()) return;

        const RED = new Color3(1, 0.15, 0.15);
        const DURATION_MS = 150;

        if (!this.flashHitRedActive) {
            // Fresh flash — snapshot original emissive colors.
            const meshes = [this.mesh, ...this.mesh.getChildMeshes(false)];
            this.flashHitRedSnapshot = [];
            for (const m of meshes) {
                const mat = m.material as StandardMaterial;
                if (mat && mat.emissiveColor !== undefined) {
                    this.flashHitRedSnapshot.push({ mat, color: mat.emissiveColor.clone() });
                    mat.emissiveColor = RED;
                }
            }
            this.flashHitRedActive = true;
        }
        // Reset / extend the restore timer either way.
        if (this.flashHitRedRestoreTimer !== null) {
            clearTimeout(this.flashHitRedRestoreTimer);
        }
        this.flashHitRedRestoreTimer = setTimeout(() => {
            for (const entry of this.flashHitRedSnapshot) {
                try { entry.mat.emissiveColor = entry.color; } catch (_) { /* mat disposed */ }
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
    public enableTorch(): void {
        if (this.torchLight || !this.mesh) return;

        // Reuse the pre-registered torch from Game.setupScene. Creating it
        // here AFTER materials compiled would never reach them (the dirty
        // mechanism is blocked for perf — see Game.ts setupScene). Pre-
        // registration is what makes the torch actually light meshes.
        const torch = this.game.getHeroTorch();
        torch.position.set(0, 1.4, 0);
        torch.parent     = this.mesh;
        torch.intensity  = 5.0;

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
            // Don't dispose — the torch lives on Game and is reused across
            // runs. Just unparent it and put it back to dormant.
            this.torchLight.parent     = null;
            this.torchLight.intensity  = 0;
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
            this.barbSpinArcMesh.dispose(false, true);
            this.barbSpinArcMesh = null;
        }
        if (this.barbFootDustPs) {
            this.barbFootDustPs.stop();
            this.barbFootDustPs.dispose();
            this.barbFootDustPs = null;
        }
        // Free the per-element aura particle systems.
        for (const ps of this.elementAuraPs.values()) {
            ps.stop();
            ps.dispose();
        }
        this.elementAuraPs.clear();
        // Storm bolts share ONE per-champion material — dispose meshes, then the
        // material once. (Default mesh.dispose() does NOT free materials; without
        // this the material leaks onto the never-disposed shared scene.)
        for (const b of this.stormBolts) {
            try { if (!b.isDisposed()) b.dispose(); } catch (_) { /* already disposed */ }
        }
        this.stormBolts = [];
        if (this.stormBoltMat) {
            try { this.stormBoltMat.dispose(); } catch (_) { /* already disposed */ }
            this.stormBoltMat = null;
        }
        // Weapon tint: restore the original material, then free the unique tint mat.
        if (this.weaponOrigMat && !this.weaponOrigMat.mesh.isDisposed()) {
            this.weaponOrigMat.mesh.material = this.weaponOrigMat.mat;
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

        // Stop + dispose the cloned GLB animation groups so their animatables
        // stop ticking once the mesh is gone (empty no-op on the procedural
        // barbarian path). Mirrors Enemy._releaseMeshAndAnimations but WITHOUT
        // disposing child-mesh materials — the procedural hero uses shared/cached
        // materials that must survive.
        for (const ag of this.glbAnimationGroups) {
            try { ag.stop(); } catch (_) { /* already stopped */ }
            try { ag.dispose(); } catch (_) { /* already disposed */ }
        }
        this.glbAnimationGroups.length = 0;

        // Dispose mesh and health bars. For the GLB hero, also free the per-instance
        // cloned material textures — instantiateModelsToScene(cloneMaterials=true)
        // clones the material's textures too, so each run's hero otherwise leaks its
        // base-color texture. Skip for the procedural hero, which shares cached
        // colour-only materials that must survive into the next run.
        if (this.mesh) {
            if (this.championAsset) {
                for (const m of [this.mesh, ...this.mesh.getChildMeshes(false)]) {
                    const mat = m.material;
                    if (mat) {
                        m.material = null;
                        try { mat.dispose(false, true); } catch (_) { /* already disposed */ }
                    }
                }
            }
            this.mesh.dispose();
            this.mesh = null;
        }

        // Dispose the cloned skeleton AFTER the mesh to free its bone-matrix
        // texture (empty no-op on the procedural path).
        for (const sk of this.glbSkeletons) {
            try { sk.dispose(); } catch (_) { /* already disposed */ }
        }
        this.glbSkeletons.length = 0;
        if (this.healthBarMesh) {
            this.healthBarMesh.dispose();
            this.healthBarMesh = null;
        }
        if (this.healthBarBackgroundMesh) {
            this.healthBarBackgroundMesh.dispose();
            this.healthBarBackgroundMesh = null;
        }
        if (this.healthBarOutlineMesh) {
            this.healthBarOutlineMesh.dispose();
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

        const ps = new ParticleSystem('championDeath', 40, this.scene);
        ps.emitter = deathPos;
        ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0, 0.3);
        ps.color1 = new Color4(1, 0.85, 0.3, 1);
        ps.color2 = new Color4(0.2, 0.5, 1.0, 1);
        ps.colorDead = new Color4(0.1, 0.2, 0.5, 0);
        ps.minSize = 0.15;
        ps.maxSize = 0.45;
        ps.minLifeTime = 0.3;
        ps.maxLifeTime = 0.8;
        ps.emitRate = 120;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.direction1 = new Vector3(-1.5, 1, -1.5);
        ps.direction2 = new Vector3(1.5, 3, 1.5);
        ps.minEmitPower = 1;
        ps.maxEmitPower = 4;
        ps.gravity = new Vector3(0, -5, 0);
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 800); }, 200);
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
                if (shouldShow && !ps.isStarted()) ps.start();
                else if (!shouldShow && ps.isStarted()) ps.stop();
            }
        }

        const stormActive = activeElements.has('storm');
        if (stormActive && this.stormBolts.length === 0) {
            this.createStormBolts(anchor);
        }
        if (this.stormBolts.length > 0) {
            for (const b of this.stormBolts) b.setEnabled(stormActive);
            if (stormActive) this.flickerStormBolts(this.lastDeltaTime);
        }
    }

    private getWeaponAnchor(): Mesh | null {
        if (this.glbWeaponAnchor && !this.glbWeaponAnchor.isDisposed()) {
            return this.glbWeaponAnchor;
        }
        switch (this.championType) {
            case 'barbarian': return this.barbAxeHead ?? this.swordArm;
            case 'ranger':    return this.rangerBow ?? this.swordArm;
            case 'mage':      return this.mageStaffOrb ?? this.swordArm;
        }
        return null;
    }

    /** Tint the procedural weapon mesh with the blended element color ("the axe
     *  is frozen / burning"). GLB champions skip this — their weapon is baked
     *  into the skinned mesh, so the particle aura alone carries the effect.
     *  While tinted, the mage orb's idle pulse writes to the detached
     *  mageOrbMat (harmless); it resumes if all elements are removed. */
    private updateWeaponTint(activeElements: Set<string>): void {
        let weapon: Mesh | null = null;
        switch (this.championType) {
            case 'barbarian': weapon = this.barbAxeHead; break;
            case 'ranger':    weapon = this.rangerBow; break;
            case 'mage':      weapon = this.mageStaffOrb; break;
        }
        if (!weapon || weapon.isDisposed()) return;

        const key = Array.from(activeElements).sort().join('+');
        if (key === this.weaponTintKey) return;
        this.weaponTintKey = key;

        if (key === '') {
            if (this.weaponOrigMat && this.weaponOrigMat.mesh === weapon) {
                weapon.material = this.weaponOrigMat.mat;
            }
            return;
        }

        const blend = blendElements(this.activeElementSnapshot as PowerElement[]);
        if (!this.weaponTintMat) {
            this.weaponTintMat = new StandardMaterial(
                `heroWeaponTint_${this.championType}`, this.scene);
            this.weaponTintMat.specularColor = Color3.Black();
        }
        this.weaponTintMat.emissiveColor.copyFrom(blend).scaleInPlace(0.85);
        this.weaponTintMat.diffuseColor.copyFrom(blend).scaleInPlace(0.35);
        if (weapon.material !== this.weaponTintMat) {
            if (!this.weaponOrigMat) {
                this.weaponOrigMat = { mesh: weapon, mat: weapon.material };
            }
            weapon.material = this.weaponTintMat;
        }
    }

    /** One small persistent additive particle aura per element, anchored at the
     *  weapon. Untextured square particles — same style as the spin trails. */
    private createElementAura(element: PowerElement, anchor: Mesh): ParticleSystem {
        const c = ELEMENT_COLOR[element];
        const ps = new ParticleSystem(`heroAura_${element}`, 32, this.scene);
        ps.emitter = anchor;
        ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        ps.color1 = new Color4(c.r, c.g, c.b, 1);
        ps.color2 = new Color4(c.r * 0.7, c.g * 0.7, c.b * 0.7, 1);
        ps.colorDead = new Color4(c.r * 0.15, c.g * 0.15, c.b * 0.15, 0);
        ps.minEmitBox = new Vector3(-0.22, -0.05, -0.22);
        ps.maxEmitBox = new Vector3(0.22, 0.35, 0.22);
        ps.gravity = Vector3.Zero();
        switch (element) {
            case 'fire': // rising embers
                ps.minSize = 0.06; ps.maxSize = 0.16;
                ps.minLifeTime = 0.35; ps.maxLifeTime = 0.7;
                ps.emitRate = 26;
                ps.direction1 = new Vector3(-0.25, 0.6, -0.25);
                ps.direction2 = new Vector3(0.25, 1.3, 0.25);
                ps.minEmitPower = 0.4; ps.maxEmitPower = 1.0;
                break;
            case 'ice': // slow falling frost mist
                ps.minSize = 0.10; ps.maxSize = 0.22;
                ps.minLifeTime = 0.6; ps.maxLifeTime = 1.1;
                ps.emitRate = 14;
                ps.direction1 = new Vector3(-0.2, -0.05, -0.2);
                ps.direction2 = new Vector3(0.2, 0.25, 0.2);
                ps.minEmitPower = 0.1; ps.maxEmitPower = 0.4;
                ps.gravity = new Vector3(0, -0.7, 0);
                break;
            case 'storm': // fast crackling sparks
                ps.minSize = 0.03; ps.maxSize = 0.08;
                ps.minLifeTime = 0.08; ps.maxLifeTime = 0.2;
                ps.emitRate = 44;
                ps.direction1 = new Vector3(-1, -0.5, -1);
                ps.direction2 = new Vector3(1, 1, 1);
                ps.minEmitPower = 1.2; ps.maxEmitPower = 2.6;
                break;
            case 'arcane': // slow swirling motes
                ps.minSize = 0.07; ps.maxSize = 0.14;
                ps.minLifeTime = 0.8; ps.maxLifeTime = 1.4;
                ps.emitRate = 12;
                ps.direction1 = new Vector3(-0.4, 0.1, -0.4);
                ps.direction2 = new Vector3(0.4, 0.5, 0.4);
                ps.minEmitPower = 0.15; ps.maxEmitPower = 0.5;
                break;
            case 'physical': // sparse white glints
                ps.minSize = 0.04; ps.maxSize = 0.10;
                ps.minLifeTime = 0.25; ps.maxLifeTime = 0.55;
                ps.emitRate = 8;
                ps.direction1 = new Vector3(-0.5, 0.2, -0.5);
                ps.direction2 = new Vector3(0.5, 0.9, 0.5);
                ps.minEmitPower = 0.3; ps.maxEmitPower = 0.9;
                break;
        }
        ps.start();
        return ps;
    }

    /** Three thin emissive bolts around the weapon that flicker while storm is
     *  active. One unique material per champion instance (NOT cached/shared —
     *  flashHitRed mutates emissive in place), freed in _releaseChampionFx. */
    private createStormBolts(anchor: Mesh): void {
        this.stormBoltMat = createEmissiveMaterial(
            `heroStormBoltMat_${this.championType}`,
            new Color3(1.0, 0.95, 0.4), 0.95, this.scene);
        for (let i = 0; i < 3; i++) {
            const bolt = MeshBuilder.CreateBox(`heroStormBolt_${i}`, {
                width: 0.025, height: 0.38, depth: 0.025,
            }, this.scene);
            bolt.material = this.stormBoltMat;
            bolt.parent = anchor;
            const angle = (i / 3) * Math.PI * 2;
            bolt.position = new Vector3(Math.cos(angle) * 0.26, 0.18, Math.sin(angle) * 0.26);
            bolt.rotation.z = 0.4;
            this.stormBolts.push(bolt);
        }
    }

    /** Re-randomize bolt visibility/placement a few times per second — fades go
     *  through mesh.visibility, never through the material (frozen + shared by
     *  the 3 bolts). */
    private flickerStormBolts(dt: number): void {
        this.stormFlickerTimer -= dt;
        if (this.stormFlickerTimer > 0) return;
        this.stormFlickerTimer = 0.05 + Math.random() * 0.12;
        for (const bolt of this.stormBolts) {
            bolt.visibility = Math.random() < 0.65 ? 0.6 + Math.random() * 0.4 : 0;
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
