# Barbarian Berserker Refinement — Design

**Date:** 2026-05-24
**Scope:** Visual + animation + combat-FX upgrade of the player's barbarian champion. Top-down camera readability is the primary design constraint.

## Goal

Refine the barbarian champion into a maxed-out "bloodthirsty berserker" — wild trophy-hunter feel, jagged scars, blood splatter, larger weapon, heavier animation, dramatic spin-attack FX. The shape and silhouette must be readable from a near-top-down camera angle.

## Non-goals

- No rewiring of input, attack, or spin-attack triggers — those hooks (`HeroController`, `HeroBasicAttack`, `triggerSpinAttack`) stay as they are.
- No changes to the ranger or mage builders.
- No new gameplay stats or balance changes.
- No new element decoration logic — the element-decoration system continues to anchor on `barbAxeHead` (now exposed as `axeHead` on the builder result).

---

## 1. Code structure

### New file: `src/game/gameplay/champions/BarbarianBuilder.ts`

Pure builder module — no Champion class dependency. Exports:

```ts
export interface BarbarianMeshParts {
    rootMesh: Mesh;            // torso, parent of everything
    head: Mesh;                // animated for look-around + snarl twitch
    swordArm: Mesh;            // axe arm — animation hook
    shieldArm: Mesh;           // off-hand arm — animation hook
    leftLeg: Mesh;             // animation hook
    rightLeg: Mesh;            // animation hook
    axeHead: Mesh;             // element-decoration anchor
    kiltFlaps: Mesh[];         // sway animation
    beltTrophy: Mesh;          // skull trophy — wobble animation
    snarlJaw: Mesh;            // jaw piece — snarl twitch
    chestPulseGroup: Mesh;     // parent of pecs + chest war-paint stripe — breath pulse scales this on Y
}

export function buildBarbarianMesh(scene: Scene, position: Vector3): BarbarianMeshParts;
```

### `Champion.ts` changes

- `createBarbarianMesh()` becomes a ~20-line shim:
  - Calls `buildBarbarianMesh(scene, this.position)`
  - Stores returned refs onto `this.mesh`, `this.head`, `this.swordArm`, `this.shieldArm`, `this.leftLeg`, `this.rightLeg`, `this.barbAxeHead`
  - Stores berserker-only refs (`kiltFlaps`, `beltTrophy`, `snarlJaw`, `chestPulseGroup`) onto new private fields
  - Sets `this.cape = null`, `this.originalScale = 1.0`
- `animateHumanoid()` ends with `if (this.championType === 'barbarian') this.animateBarbarianExtras();`
- New `animateBarbarianExtras()` and FX helpers (see §4, §5) added to Champion.ts.

### File line targets

- `BarbarianBuilder.ts`: ~450 lines
- `Champion.ts`: 1529 → ~1275 (net reduction after extraction)

---

## 2. Body / silhouette — berserker layers

The existing barbarian skeleton (torso, pecs, war-paint stripe, belt, kilt flaps, shoulder caps, horned skull cap, beard, ember eyes, axe arm, off arm, legs, boots, bracers, kneecaps) is preserved. The following are **added on top**, prioritized for top-down visibility.

### Palette additions

- `boneWhite` = `Color3(0.92, 0.88, 0.78)` — skulls, bone fragments, necklaces, axe inlays
- `bloodRed` = `Color3(0.55, 0.06, 0.05)` — drips, hand wrap splotches, axe edge
- `bloodEmissive` intensity 0.6 on blood accents

### Head — visible from straight overhead

- **Asymmetric horns** — replace the two symmetric small horns with:
  - Left: tall straight horn (height 0.60, narrowing to a point)
  - Right: chipped/broken horn (height 0.35, blunt tip — uses a low cylinder with widened top)
  - Both `hornColor`, both flat-shaded.
- **Bone fragments through the fur helm cap** — 3 small tooth-shaped polyhedra poking up out of the cap, `boneWhite`.
- **War-paint slash across the helmet top** — flat box across the cap, red emissive, oriented front-to-back so it reads from above.
- **Snarl jaw piece** — small box (width 0.20, height 0.10, depth 0.16) under the existing beard, jutting forward, with 2-3 tiny tooth boxes inside (`boneWhite` emissive 0.2). Stored as `snarlJaw` for animation.

### Torso / shoulders — top-down readable

- **Chest-pulse parent group** — empty `Mesh` named `barbChestGroup`, parented to `rootMesh`, positioned at the torso center. The existing `pecLeft`, `pecRight`, and chest `warpaint` stripe are reparented to this group (instead of directly to `rootMesh`) so the breath-pulse animation can scale them together without affecting the rest of the body.
- **Tribal shoulder-top scars** — 2 thin emissive boxes on the top face of each shoulder sphere, rotated diagonally. `bloodRed` emissive 0.5.
- **Back-of-shoulder war-paint stripes** — 2 diagonal stripes (one per side) fanning outward from the back of each shoulder. Red emissive, intended to be the loudest top-down read.
- **Bone necklace** — ring of ~8 small `boneWhite` polyhedra around the neck base, each rotated outward.
- **Torn pelt scraps over each shoulder** — irregular box (width 0.45, height 0.30, depth 0.50) hanging slightly off the side of each shoulder, dark `fur` color, with two notch boxes carved out the bottom edge to suggest tears.
- **Bone spikes through the pelts** — 2-3 angled `boneWhite` cylinders per shoulder, jutting through.
- **Jagged armor plate on axe-arm shoulder** — single battered metal plate (steelGrey, slightly darker), with a chipped corner. Asymmetric — only on the right shoulder.

### Belt area

- **Trophy skull** — child of belt:
  - Sphere head (`boneWhite`, diameter 0.18, segments 4, flat-shaded)
  - Jaw box (`boneWhite`, slightly darker)
  - Two eye-socket holes (small black emissive boxes)
  - Hung from a small leather cord (thin dark cylinder above)
  - Positioned hanging at front-left of belt
- **Dangling bone fragments** — 2-3 small `boneWhite` cylinders chained on the front-right of the belt, varying lengths
- **Iron studs** — 5-6 small box bumps along the front face of the belt, emissive `steelGrey` 0.3

### Arms / hands

- **Bloody hand wraps** — replace the simple fist on the off-arm with:
  - Bandage wrap (box, `boneWhite`, slightly larger than fist)
  - Red splotch (emissive `bloodRed` 0.5, small thin box on top)
- **Axe-hand wrap** — same treatment on the axe-arm grip end
- **Forearm scar lines** on the off-arm — 2 thin emissive red boxes wrapping the bracer area

### Kilt

- Existing 5 front flaps + 3 back flaps kept.
- **Bone bead chains** — 5 small `boneWhite` polyhedra strung as a single low chain across the kilt front, parented to the belt (independent of flap sway so they don't flicker between flap motions)
- **Crossing leather strap bands** — 2 diagonal `darkLeather` ribbons crossing the kilt front in an X
- All flaps stored in `kiltFlaps[]` for sway animation

### Legs

- **Thigh war-paint stripes** — 1-2 vertical red emissive stripes on the outside face of each thigh, visible when leg lifts during stride
- **Calf bandage wraps** — wide `boneWhite` ring (cylinder, low height, slightly larger diameter than the leg) just above each boot

---

## 3. Weapon — "Greatcleaver"

The axe is the silhouette anchor when viewed from above. It must read as oversized and brutal.

### Dimensions

- Head: 0.42×0.52×0.12 → **0.65×0.75×0.18** (~50% larger)
- Shaft height: 1.40 → 1.55 (slightly longer for visual weight)

### Structure (replaces current axe parts)

- **Shaft** — dark wood cylinder, height 1.55, diameter 0.10, slight forward tilt
- **Bone shaft rings** — 2-3 `boneWhite` rings (low cylinders) wrapped around the shaft above the grip
- **Leather grip wrap** — kept as-is
- **Head body** — flattened steel box, 0.65×0.75×0.18, attached at top of shaft
- **Jagged tooth edge** — 3 stacked notched boxes along the cutting side, varying widths (0.06–0.10), creating a saw-tooth silhouette. Each `steelSharp` emissive 0.35.
- **Second (back) blade** — smaller mirror blade on the spike side, head 0.45×0.40×0.12 with 2 jagged teeth — gives a top-down "<==>" double-bit profile
- **Bone inlays** — 3 small `boneWhite` polyhedra embedded along the side face of the main head
- **Blood-drip accents** — 3 thin emissive `bloodRed` strips, intensity 0.6, running down the side of the main blade from the edge toward the shaft. Read as "still wet."
- **Skull pommel** — tiny skull (sphere + jaw, both `boneWhite`) replaces the octahedron pommel
- **Hanging trophy strips** — 2-3 thin strips of dark leather + small bones dangling from the junction of head and shaft

### Element-decoration anchor

`axeHead` (the main head box) continues to be the element-decoration anchor — no change to `Champion.getWeaponAnchor()` or `createElementDecoration()`.

---

## 4. Animation extras (`animateBarbarianExtras`)

Called from end of `animateHumanoid` when `championType === 'barbarian'`. Layered on top of existing animation. Must gracefully no-op when `spinning` or `attackTimer > cooldown - 0.3` (don't override attack pose targets).

```ts
private animateBarbarianExtras(deltaTime: number): void {
    const spinning = this.spinAttackTimer > 0;
    const attacking = this.attackTimer > this.attackCooldown - 0.3;

    // 1. Breath pulse (always on, even when spinning)
    if (this.chestPulseGroup) {
        this.chestPulseGroup.scaling.y = 1 + Math.sin(this.walkTime * 0.4) * 0.04;
    }

    // 2. Hunched stride lean (don't override during spin/attack)
    if (!spinning && !attacking) {
        this.mesh!.rotation.x = 0.05 + Math.sin(this.walkTime * 0.5) * 0.02;
    }

    // 3. Kilt flap sloshing (always)
    for (let i = 0; i < this.kiltFlaps.length; i++) {
        this.kiltFlaps[i].rotation.x = Math.sin(this.walkTime + i * 0.3) * 0.15;
    }

    // 4. Belt trophy wobble (always)
    if (this.beltTrophy) {
        this.beltTrophy.rotation.x = Math.sin(this.walkTime * 2) * 0.20;
        this.beltTrophy.rotation.z = Math.sin(this.walkTime * 1.5) * 0.10;
    }

    // 5. Snarl twitch (random flick — accumulate timer)
    this.snarlTimer -= deltaTime;
    if (this.snarlTimer <= 0) {
        this.snarlActive = 0.15; // flick duration
        this.snarlTimer = 2 + Math.random() * 3; // 2-5s
    }
    if (this.snarlActive > 0 && this.snarlJaw) {
        this.snarlActive -= deltaTime;
        const t = this.snarlActive / 0.15;
        this.snarlJaw.rotation.x = -0.3 * Math.sin(t * Math.PI); // open-then-close
    } else if (this.snarlJaw) {
        this.snarlJaw.rotation.x = 0;
    }
}
```

### Modifications to shared `animateHumanoid` for barbarian

- **Heavier shoulder roll** — when `championType === 'barbarian'`, the existing `mesh.rotation.z = sin(walkTime) * 0.08` multiplier becomes `0.12`.
- **Heavier axe-arm bob** — when not spinning/attacking, multiply the existing `swordArm.rotation.x = sin(walkTime) * 0.50` by 1.3 for barbarian so the axe head visibly dips with each step.

### New Champion.ts fields

```ts
private kiltFlaps: Mesh[] = [];
private beltTrophy: Mesh | null = null;
private snarlJaw: Mesh | null = null;
private chestPulseGroup: Mesh | null = null;
private snarlTimer: number = 2;
private snarlActive: number = 0;
```

---

## 5. Combat FX

### Spin attack: red blood trail

In addition to the existing gold `createAttackEffect`, add a parallel `createSpinBloodTrail()` that runs while `spinAttackTimer > 0`. ParticleSystem attached to the axe head's world position, red `(0.7, 0.1, 0.05)` emissive, 60 particles, 0.2s lifetime. Lazily instantiated and started on `triggerSpinAttack()`, stopped when `spinAttackTimer <= 0`.

### Spin attack: red arc ring

Temporary thin torus mesh (BabylonJS `MeshBuilder.CreateTorus`):
- Diameter 2.5, thickness 0.15, 12 tessellation, flat-shaded
- Red emissive `(0.8, 0.1, 0.05)`, intensity 0.9
- Position: hero feet, slightly above ground
- Over the 0.4s spin duration: scale from 0.3 → 1.5, alpha from 1 → 0
- Disposed after fade

Instantiated in `triggerSpinAttack()` alongside existing logic, animated each frame inside `update()` while `spinAttackTimer > 0`.

### Heavy footstep dust

Inside `animateBarbarianExtras`, detect stride peaks (when the planted foot is at ground contact — `sin(walkTime)` crosses a threshold). Emit a small one-shot brown particle burst (`Color4(0.5, 0.35, 0.2, 1)`, 8 particles, 0.4s lifetime) at the foot's world position. Throttled to once per stride cycle per foot.

### Blood splatter on basic attack

In `attackNearbyEnemies`, after `target.takeDamage(this.attackDamage)`, also call `createBloodSplatterFx(target.getPosition())`:
- 10 particles, red `(0.7, 0.1, 0.05)`
- Spawn at target waist height, gravity 4 down
- 0.5s lifetime, fade to dark

This runs **in addition to** the existing gold `createAttackEffect`.

---

## Open implementation notes

- Use existing `createLowPolyMaterial` / `createEmissiveMaterial` / `makeFlatShaded` helpers from `LowPolyMaterial.ts`.
- Keep all new meshes parented under `rootMesh` so disposal in `die()` continues to clean them up via `mesh.dispose(false, true)`.
- The element-decoration anchor contract is unchanged — `Champion.getWeaponAnchor()` returns `this.barbAxeHead` exactly as today.
- The `rebuildForType` flow continues to work for ranger/mage. Only barbarian benefits from the new builder.

## Risks

- **Particle count budget** — the new spin trail + ring + footstep dust + blood splatter all overlap in worst case. Each is short-lived (<0.5s) and small (<60 particles), so peak concurrent particles remain modest. No quantitative budget enforced; monitor at runtime.
- **Z-fighting on layered emissive accents** — back-of-shoulder war paint and tribal scars are very thin boxes parented to spheres. Offset by ≥0.02 from parent surface to avoid flicker.
- **Top-down readability of asymmetric horns** — the right horn being broken/short might make the silhouette look damaged in a way that reads as "low HP." Acceptable risk for the berserker theme; can flip to symmetric tall horns if it tests poorly.

## Validation

- Manual playtest in `npm start`: spawn barbarian via champion select, walk around, trigger basic attack on goblins, trigger spin attack, verify all animations, verify no z-fighting at common camera angles, verify FX intensity is readable but not overwhelming.
- `npx tsc --noEmit` clean.
- `npm run build` produces a working bundle.
