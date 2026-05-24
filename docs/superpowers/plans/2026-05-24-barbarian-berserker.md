# Barbarian Berserker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the barbarian champion into a maxed-out "bloodthirsty berserker" optimized for top-down readability — extract its mesh-build code into its own file, layer in trophy/scar/pelt/bone detail, overhaul the axe, add berserker animations, and add red-blood combat FX.

**Architecture:** Extract the existing `createBarbarianMesh` body into a new `BarbarianBuilder.ts` module that returns a typed parts struct. `Champion.ts` keeps the animation hooks, attack triggers, and element-decoration anchor exactly as today — only the mesh construction moves. New berserker layers are added inside the builder; new animation extras (`animateBarbarianExtras`) and combat FX helpers are added to `Champion.ts` where they can access the limb refs.

**Tech Stack:** BabylonJS, TypeScript. No test runner — verification per task is `npx tsc --noEmit` clean + manual visual playtest via `npm start`.

**Reference spec:** `docs/superpowers/specs/2026-05-24-barbarian-berserker-design.md`

---

## File map

- **Create:** `src/game/gameplay/champions/BarbarianBuilder.ts` — pure builder, returns `BarbarianMeshParts`.
- **Modify:** `src/game/gameplay/Champion.ts` — replace `createBarbarianMesh` body with a builder call; add new fields, `animateBarbarianExtras`, FX helpers.

No other files are touched.

---

## Task 1: Extract barbarian to BarbarianBuilder.ts (pure refactor)

Move the existing barbarian mesh construction into its own module. No visual or behavioral change — only file structure changes. Subsequent tasks add berserker detail on top of this foundation.

**Files:**
- Create: `src/game/gameplay/champions/BarbarianBuilder.ts`
- Modify: `src/game/gameplay/Champion.ts:139-524` (the entire current `createBarbarianMesh` body)

- [ ] **Step 1: Create the builder module skeleton**

Create `src/game/gameplay/champions/BarbarianBuilder.ts`:

```ts
import { Vector3, MeshBuilder, Mesh, Color3, Scene } from '@babylonjs/core';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';

export interface BarbarianMeshParts {
    rootMesh: Mesh;            // torso — parent of everything
    head: Mesh;                // animation hook (look-around)
    swordArm: Mesh;            // axe arm — animation hook
    shieldArm: Mesh;           // off-hand arm — animation hook
    leftLeg: Mesh;             // animation hook
    rightLeg: Mesh;            // animation hook
    axeHead: Mesh;             // element-decoration anchor (existing `barbAxeHead`)
    // Berserker-specific (populated empty in this task; filled by later tasks):
    kiltFlaps: Mesh[];
    beltTrophy: Mesh | null;
    snarlJaw: Mesh | null;
    chestPulseGroup: Mesh | null;
}

export function buildBarbarianMesh(scene: Scene, position: Vector3): BarbarianMeshParts {
    // ===== Palette =====
    const skinTone    = new Color3(0.78, 0.55, 0.40);
    const skinDark    = new Color3(0.62, 0.42, 0.30);
    const leather     = new Color3(0.30, 0.18, 0.08);
    const fur         = new Color3(0.28, 0.22, 0.18);
    const furLight    = new Color3(0.42, 0.34, 0.26);
    const steelGrey   = new Color3(0.65, 0.65, 0.70);
    const steelSharp  = new Color3(0.82, 0.82, 0.86);
    const wood        = new Color3(0.30, 0.18, 0.08);
    const warPaint    = new Color3(0.75, 0.12, 0.10);
    const hornColor   = new Color3(0.50, 0.42, 0.28);

    // The body of buildBarbarianMesh — fill in Step 2.
    throw new Error('not implemented');
}
```

- [ ] **Step 2: Move existing barbarian construction into the builder**

Copy the body of `createBarbarianMesh` (lines 139-524 in `Champion.ts`) into `buildBarbarianMesh`, with these mechanical changes:

1. Replace `this.scene` with the `scene` parameter.
2. Replace `this.position` with the `position` parameter.
3. Replace `this.mesh = ...` with `const rootMesh = ...` (and reference `rootMesh` instead of `this.mesh` from that point on).
4. Replace `this.head = ...` with `const head = ...`.
5. Replace `this.swordArm = ...` with `const swordArm = ...`.
6. Replace `this.shieldArm = ...` with `const shieldArm = ...`.
7. Replace `this.leftLeg = ...` with `const leftLeg = ...`.
8. Replace `this.rightLeg = ...` with `const rightLeg = ...`.
9. Replace `this.barbAxeHead = axeHead;` with `// axeHead exposed via return`.
10. Remove `this.cape = null;` (caller handles it).
11. Remove `this.originalScale = 1.0;` (caller handles it).
12. Replace the `throw new Error('not implemented');` from Step 1 with:

```ts
    return {
        rootMesh,
        head,
        swordArm,
        shieldArm,
        leftLeg,
        rightLeg,
        axeHead,
        kiltFlaps: [],
        beltTrophy: null,
        snarlJaw: null,
        chestPulseGroup: null,
    };
```

The kilt flap loop currently creates 5 named meshes. Leave them as local `kiltFlap` consts (they parent to `rootMesh`); we'll populate the `kiltFlaps` array in a later task. For now `kiltFlaps: []` is correct — animation hasn't been added yet.

- [ ] **Step 3: Replace `createBarbarianMesh` body in Champion.ts with a shim**

In `Champion.ts`, add at the top:

```ts
import { buildBarbarianMesh, BarbarianMeshParts } from './champions/BarbarianBuilder';
```

Replace the entire body of `createBarbarianMesh` (lines 139-524) with:

```ts
    private createBarbarianMesh(): void {
        const parts = buildBarbarianMesh(this.scene, this.position);
        this.mesh = parts.rootMesh;
        this.head = parts.head;
        this.swordArm = parts.swordArm;
        this.shieldArm = parts.shieldArm;
        this.leftLeg = parts.leftLeg;
        this.rightLeg = parts.rightLeg;
        this.barbAxeHead = parts.axeHead;
        this.cape = null;
        this.originalScale = 1.0;
    }
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 5: Visual smoke test**

Run: `npm start`, open `http://localhost:9000`, click Play, pick the barbarian (axe icon) on the champion-select screen.
Expected: barbarian appears identical to before this task — same body, axe, animation, attack. No regressions.

- [ ] **Step 6: Commit**

```bash
git add src/game/gameplay/champions/BarbarianBuilder.ts src/game/gameplay/Champion.ts
git commit -m "refactor(champion): extract barbarian mesh build into BarbarianBuilder.ts

Pure refactor: existing createBarbarianMesh body moved verbatim into a
new builder module that returns a typed BarbarianMeshParts struct.
Champion.ts becomes a thin shim. No visual or behavioral change. Sets
up follow-up tasks to layer berserker detail in isolation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add berserker palette + chest pulse group

Introduce the new palette colors used across all berserker layers, and create the empty parent group that breath-pulse animation will scale.

**Files:**
- Modify: `src/game/gameplay/champions/BarbarianBuilder.ts`

- [ ] **Step 1: Add palette colors**

In `buildBarbarianMesh`, immediately after the existing palette block (after `const hornColor = ...`), add:

```ts
    // Berserker palette additions
    const boneWhite   = new Color3(0.92, 0.88, 0.78);
    const bloodRed    = new Color3(0.55, 0.06, 0.05);
    const darkLeather = new Color3(0.18, 0.10, 0.04);
```

- [ ] **Step 2: Create chest-pulse parent group and reparent pec/warpaint meshes**

Find the existing `pecLeft`, `pecRight`, and `warpaint` mesh creation block. Just before `pecLeft` is created, insert:

```ts
    // Chest-pulse parent: groups pecs + chest war-paint stripe so the breath
    // pulse animation can scale them together. Empty Mesh — no geometry.
    const chestPulseGroup = new Mesh('barbChestGroup', scene);
    chestPulseGroup.parent = rootMesh;
    chestPulseGroup.position = Vector3.Zero();
```

Change `pecLeft.parent = this.mesh;` (now `pecLeft.parent = rootMesh;`) to `pecLeft.parent = chestPulseGroup;`.
Change `pecRight.parent = this.mesh;` → `pecRight.parent = chestPulseGroup;`.
Change `warpaint.parent = this.mesh;` → `warpaint.parent = chestPulseGroup;`.

The pec/warpaint local positions stay unchanged because `chestPulseGroup` is at the origin of `rootMesh`.

- [ ] **Step 3: Return chestPulseGroup in the parts struct**

Change the return statement's `chestPulseGroup: null,` to `chestPulseGroup,`.

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Visual smoke test**

Run: `npm start`, play barbarian. Verify pecs and chest war-paint stripe still appear in the same positions. No visual change.

- [ ] **Step 6: Commit**

```bash
git add src/game/gameplay/champions/BarbarianBuilder.ts
git commit -m "feat(barbarian): add berserker palette and chestPulseGroup parent

Introduces boneWhite, bloodRed, and darkLeather palette colors used by
follow-up berserker detail tasks. Creates an empty chestPulseGroup mesh
parented to the torso; reparents the existing pecs and chest war-paint
stripe under it so a later breath-pulse animation can scale them as a
single unit. No visual change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Head upgrades — asymmetric horns, bone fragments, helmet war paint, snarl jaw

Replace symmetric horns with one tall + one chipped horn. Add bone fragments poking through the fur helm cap, a war-paint slash across the helmet top (top-down readable), and a snarl jaw piece under the beard.

**Files:**
- Modify: `src/game/gameplay/champions/BarbarianBuilder.ts`

- [ ] **Step 1: Replace the symmetric horn loop with asymmetric horns**

Find the existing horn loop:

```ts
        // Two curved horns out the sides (made from cones)
        for (let side = -1; side <= 1; side += 2) {
            const horn = MeshBuilder.CreateCylinder(`barbHorn${side}`, { ... });
            ...
        }
```

Replace the entire `for` block with:

```ts
    // Asymmetric horns: tall straight on left, chipped/broken on right.
    const hornLeft = MeshBuilder.CreateCylinder('barbHornLeft', {
        height: 0.60,
        diameterTop: 0.02,
        diameterBottom: 0.14,
        tessellation: 5,
    }, scene);
    makeFlatShaded(hornLeft);
    hornLeft.parent = head;
    hornLeft.position = new Vector3(-0.28, 0.30, 0);
    hornLeft.rotation.z = -0.75;
    hornLeft.rotation.x = -0.15;
    hornLeft.material = createLowPolyMaterial('barbHornLeftMat', hornColor, scene);

    const hornRight = MeshBuilder.CreateCylinder('barbHornRight', {
        height: 0.35,
        diameterTop: 0.10,
        diameterBottom: 0.14,
        tessellation: 5,
    }, scene);
    makeFlatShaded(hornRight);
    hornRight.parent = head;
    hornRight.position = new Vector3(0.28, 0.22, 0);
    hornRight.rotation.z = 0.75;
    hornRight.rotation.x = -0.15;
    hornRight.material = createLowPolyMaterial('barbHornRightMat', hornColor, scene);

    // Jagged break cap on the right horn — short blunt polyhedron on top
    const hornRightBreak = MeshBuilder.CreatePolyhedron('barbHornRightBreak', {
        type: 1,
        size: 0.05,
    }, scene);
    makeFlatShaded(hornRightBreak);
    hornRightBreak.parent = hornRight;
    hornRightBreak.position = new Vector3(0, 0.20, 0);
    hornRightBreak.material = createLowPolyMaterial('barbHornRightBreakMat', boneWhite, scene);
```

- [ ] **Step 2: Add bone fragments through the fur helm cap**

Find the `helmCap` creation block. Immediately after it, add:

```ts
    // 3 bone fragments poking up through the helm cap (tooth-like)
    const bonePositions: Array<[number, number, number]> = [
        [-0.10, 0.15, 0.05],
        [ 0.04, 0.18, -0.06],
        [ 0.12, 0.13, 0.08],
    ];
    for (let i = 0; i < bonePositions.length; i++) {
        const [x, y, z] = bonePositions[i];
        const boneFrag = MeshBuilder.CreatePolyhedron(`barbHelmBone${i}`, {
            type: 1,
            size: 0.05,
        }, scene);
        makeFlatShaded(boneFrag);
        boneFrag.parent = helmCap;
        boneFrag.position = new Vector3(x, y, z);
        boneFrag.scaling = new Vector3(0.7, 1.6, 0.7);
        boneFrag.material = createLowPolyMaterial(`barbHelmBoneMat${i}`, boneWhite, scene);
    }
```

- [ ] **Step 3: Add war-paint slash across the helmet top**

Immediately after the bone-fragment block, add:

```ts
    // War-paint slash across helmet top — front-to-back, top-down readable
    const helmPaint = MeshBuilder.CreateBox('barbHelmPaint', {
        width: 0.10,
        height: 0.04,
        depth: 0.45,
    }, scene);
    makeFlatShaded(helmPaint);
    helmPaint.parent = helmCap;
    helmPaint.position = new Vector3(0, 0.16, 0);
    helmPaint.rotation.y = 0.15;
    helmPaint.material = createEmissiveMaterial('barbHelmPaintMat', bloodRed, 0.7, scene);
```

- [ ] **Step 4: Add snarl jaw piece**

Find the `beard` mesh creation block. Immediately after it, add:

```ts
    // Snarl jaw piece — small box jutting forward beneath the beard.
    // Stored on the parts struct so animation can twitch it.
    const snarlJaw = MeshBuilder.CreateBox('barbSnarlJaw', {
        width: 0.20,
        height: 0.10,
        depth: 0.16,
    }, scene);
    makeFlatShaded(snarlJaw);
    snarlJaw.parent = head;
    snarlJaw.position = new Vector3(0, -0.34, 0.24);
    snarlJaw.material = createLowPolyMaterial('barbSnarlJawMat', skinDark, scene);

    // Teeth row — 3 small bone-white teeth boxes inside the jaw
    for (let t = 0; t < 3; t++) {
        const tooth = MeshBuilder.CreateBox(`barbSnarlTooth${t}`, {
            width: 0.04,
            height: 0.05,
            depth: 0.03,
        }, scene);
        makeFlatShaded(tooth);
        tooth.parent = snarlJaw;
        tooth.position = new Vector3((t - 1) * 0.05, 0.03, 0.07);
        tooth.material = createEmissiveMaterial(`barbSnarlToothMat${t}`, boneWhite, 0.2, scene);
    }
```

- [ ] **Step 5: Return snarlJaw in the parts struct**

Change `snarlJaw: null,` in the return statement to `snarlJaw,`.

- [ ] **Step 6: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Visual playtest**

Run: `npm start`, play barbarian. Verify from above the camera:
- One tall horn on the left, one shorter blunt horn on the right with a pale break cap.
- 3 bone fragments visible on top of the fur helm cap.
- A red emissive stripe running front-to-back across the helmet top.
- A small forward jutting jaw with 3 visible teeth under the beard when the camera tilts.

- [ ] **Step 8: Commit**

```bash
git add src/game/gameplay/champions/BarbarianBuilder.ts
git commit -m "feat(barbarian): asymmetric horns, helmet bones, war-paint stripe, snarl jaw

Replaces the two symmetric horns with a tall left horn and a shorter
chipped right horn (with a bone break cap), adds 3 bone fragments
poking through the fur helm, paints a red emissive stripe along the
helmet top for top-down readability, and adds a small forward-jutting
jaw with teeth. snarlJaw is now wired through BarbarianMeshParts for
follow-up animation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Torso upgrades — shoulder scars, back war paint, bone necklace, pelts + spikes, asymmetric armor plate

Add the biggest top-down readability wins to the torso: scars and war paint on shoulder tops and backs, a bone necklace, torn pelt scraps with bone spikes through them, and an asymmetric armor plate.

**Files:**
- Modify: `src/game/gameplay/champions/BarbarianBuilder.ts`

- [ ] **Step 1: Add shoulder-top scars to the shoulder loop**

Find the shoulder-cap loop (`for (let side = -1; side <= 1; side += 2) { const shoulder = ...`). Inside that loop, after the `scarMark` block, add:

```ts
        // Two diagonal blood-red scars on the TOP of the shoulder (top-down readable)
        for (let s = 0; s < 2; s++) {
            const topScar = MeshBuilder.CreateBox(`barbShoulderTopScar${side}_${s}`, {
                width: 0.22,
                height: 0.025,
                depth: 0.04,
            }, scene);
            makeFlatShaded(topScar);
            topScar.parent = shoulder;
            topScar.position = new Vector3(0.02 + s * 0.08, 0.24, -0.02 + s * 0.06);
            topScar.rotation.y = 0.5 + s * 0.3;
            topScar.material = createEmissiveMaterial(`barbShoulderTopScarMat${side}_${s}`,
                bloodRed, 0.5, scene);
        }

        // Back-of-shoulder war-paint stripe — diagonal, fans outward when viewed from above
        const backPaint = MeshBuilder.CreateBox(`barbBackPaint${side}`, {
            width: 0.06,
            height: 0.30,
            depth: 0.45,
        }, scene);
        makeFlatShaded(backPaint);
        backPaint.parent = shoulder;
        backPaint.position = new Vector3(-0.02, -0.05, -0.22);
        backPaint.rotation.x = 0.4 * side;
        backPaint.rotation.z = 0.3 * side;
        backPaint.material = createEmissiveMaterial(`barbBackPaintMat${side}`,
            bloodRed, 0.6, scene);

        // Torn pelt scrap over the shoulder
        const pelt = MeshBuilder.CreateBox(`barbShoulderPelt${side}`, {
            width: 0.45,
            height: 0.30,
            depth: 0.50,
        }, scene);
        makeFlatShaded(pelt);
        pelt.parent = shoulder;
        pelt.position = new Vector3(side * 0.05, 0.15, 0);
        pelt.scaling = new Vector3(1.0, 1.0, 1.0);
        pelt.material = createLowPolyMaterial(`barbShoulderPeltMat${side}`, fur, scene);

        // 2 notch boxes carved into the bottom edge of the pelt (visual tears)
        for (let n = 0; n < 2; n++) {
            const notch = MeshBuilder.CreateBox(`barbPeltNotch${side}_${n}`, {
                width: 0.10,
                height: 0.12,
                depth: 0.08,
            }, scene);
            makeFlatShaded(notch);
            notch.parent = pelt;
            notch.position = new Vector3((n - 0.5) * 0.20, -0.18, 0.20 - n * 0.10);
            notch.material = createLowPolyMaterial(`barbPeltNotchMat${side}_${n}`, furLight, scene);
        }

        // 3 bone spikes poking through the pelt
        for (let b = 0; b < 3; b++) {
            const spike = MeshBuilder.CreateCylinder(`barbPeltSpike${side}_${b}`, {
                height: 0.22,
                diameterTop: 0.01,
                diameterBottom: 0.05,
                tessellation: 4,
            }, scene);
            makeFlatShaded(spike);
            spike.parent = pelt;
            spike.position = new Vector3((b - 1) * 0.14, 0.13, 0.05);
            spike.rotation.z = (b - 1) * 0.25;
            spike.rotation.x = -0.2;
            spike.material = createLowPolyMaterial(`barbPeltSpikeMat${side}_${b}`, boneWhite, scene);
        }
```

- [ ] **Step 2: Add bone necklace around the neck base**

After the shoulder-cap loop closes, add:

```ts
    // Bone necklace — ring of 8 small bone polyhedra around the neck base.
    // Parented to head so it follows head rotation slightly; positioned low on the head.
    const neckBoneCount = 8;
    for (let i = 0; i < neckBoneCount; i++) {
        const angle = (i / neckBoneCount) * Math.PI * 2;
        const necklaceBone = MeshBuilder.CreatePolyhedron(`barbNeckBone${i}`, {
            type: 1,
            size: 0.045,
        }, scene);
        makeFlatShaded(necklaceBone);
        necklaceBone.parent = rootMesh;
        necklaceBone.position = new Vector3(
            Math.cos(angle) * 0.36,
            0.95,
            Math.sin(angle) * 0.32,
        );
        necklaceBone.rotation.y = angle;
        necklaceBone.scaling = new Vector3(1.0, 1.4, 1.0);
        necklaceBone.material = createLowPolyMaterial(`barbNeckBoneMat${i}`, boneWhite, scene);
    }
```

- [ ] **Step 3: Add asymmetric armor plate on the axe-arm (right) shoulder**

After the bone necklace block, add:

```ts
    // Jagged battered armor plate — only on the right shoulder (asymmetric).
    const armorPlate = MeshBuilder.CreateBox('barbArmorPlate', {
        width: 0.42,
        height: 0.36,
        depth: 0.10,
    }, scene);
    makeFlatShaded(armorPlate);
    armorPlate.parent = rootMesh;
    armorPlate.position = new Vector3(0.88, 0.70, 0.18);
    armorPlate.rotation.z = -0.35;
    armorPlate.rotation.y = 0.20;
    // Slightly darker than the steelGrey to read as battered/weathered.
    const armorDark = new Color3(0.50, 0.50, 0.55);
    armorPlate.material = createLowPolyMaterial('barbArmorPlateMat', armorDark, scene);

    // Chipped corner — small darker polyhedron cut out the bottom-front
    const armorChip = MeshBuilder.CreatePolyhedron('barbArmorChip', {
        type: 1,
        size: 0.06,
    }, scene);
    makeFlatShaded(armorChip);
    armorChip.parent = armorPlate;
    armorChip.position = new Vector3(0.18, -0.14, 0.04);
    armorChip.material = createLowPolyMaterial('barbArmorChipMat', new Color3(0.35, 0.35, 0.38), scene);
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Visual playtest**

Run: `npm start`, play barbarian. Verify from above:
- Two diagonal red scars on the top face of each shoulder.
- Red war-paint stripes fanning backward off each shoulder.
- A ring of 8 small pale bone shapes around the neck.
- A torn fur pelt over each shoulder with bone spikes poking through.
- A single dark battered armor plate only on the right shoulder.

- [ ] **Step 6: Commit**

```bash
git add src/game/gameplay/champions/BarbarianBuilder.ts
git commit -m "feat(barbarian): shoulder scars, back war paint, bone necklace, pelts, armor

Major top-down silhouette upgrade. Each shoulder cap now has two
diagonal blood-red scars on its top face, a red war-paint stripe
fanning backward off the back, a torn fur pelt with bone spikes, and
notched tears in the pelt edge. A bone necklace of 8 polyhedra rings
the neck base. A single battered armor plate on the right shoulder
gives the silhouette deliberate asymmetry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Belt + arms — trophy skull, dangling bones, iron studs, bloody hand wraps, forearm scars

Add belt decorations (skull trophy, bone fragments, studs) and replace the simple fists with bloody hand wraps. Add scar lines around the off-arm bracer.

**Files:**
- Modify: `src/game/gameplay/champions/BarbarianBuilder.ts`

- [ ] **Step 1: Add trophy skull, dangling bones, and iron studs to the belt**

Find the `belt` creation block (the leather belt across the waist). Immediately after the `clasp` block (the belt buckle), add:

```ts
    // ===== Belt decorations =====

    // Trophy skull — hung from belt at front-left
    const skullCord = MeshBuilder.CreateCylinder('barbTrophyCord', {
        height: 0.18,
        diameterTop: 0.02,
        diameterBottom: 0.02,
        tessellation: 5,
    }, scene);
    skullCord.parent = belt;
    skullCord.position = new Vector3(-0.40, -0.18, 0.45);
    skullCord.material = createLowPolyMaterial('barbTrophyCordMat', darkLeather, scene);

    const beltTrophy = MeshBuilder.CreateSphere('barbTrophySkull', {
        diameter: 0.18,
        segments: 4,
    }, scene);
    makeFlatShaded(beltTrophy);
    beltTrophy.parent = skullCord;
    beltTrophy.position = new Vector3(0, -0.12, 0);
    beltTrophy.material = createLowPolyMaterial('barbTrophySkullMat', boneWhite, scene);

    const skullJaw = MeshBuilder.CreateBox('barbTrophyJaw', {
        width: 0.12,
        height: 0.05,
        depth: 0.09,
    }, scene);
    makeFlatShaded(skullJaw);
    skullJaw.parent = beltTrophy;
    skullJaw.position = new Vector3(0, -0.07, 0.02);
    skullJaw.material = createLowPolyMaterial('barbTrophyJawMat', new Color3(0.85, 0.80, 0.70), scene);

    // Two eye-socket holes — small black emissive boxes
    for (let e = -1; e <= 1; e += 2) {
        const socket = MeshBuilder.CreateBox(`barbTrophySocket${e}`, {
            width: 0.03,
            height: 0.03,
            depth: 0.02,
        }, scene);
        socket.parent = beltTrophy;
        socket.position = new Vector3(e * 0.04, 0.01, 0.08);
        socket.material = createEmissiveMaterial(`barbTrophySocketMat${e}`,
            new Color3(0.05, 0.05, 0.05), 0.0, scene);
    }

    // Dangling bone fragments — 3 bones on the front-right of the belt
    const danglePositions: Array<[number, number, number]> = [
        [0.30, -0.20, 0.45],
        [0.42, -0.24, 0.43],
        [0.36, -0.28, 0.42],
    ];
    const dangleLengths = [0.20, 0.16, 0.24];
    for (let d = 0; d < danglePositions.length; d++) {
        const [x, y, z] = danglePositions[d];
        const dangleCord = MeshBuilder.CreateCylinder(`barbDangleCord${d}`, {
            height: 0.06,
            diameterTop: 0.015,
            diameterBottom: 0.015,
            tessellation: 4,
        }, scene);
        dangleCord.parent = belt;
        dangleCord.position = new Vector3(x, y - 0.03, z);
        dangleCord.material = createLowPolyMaterial(`barbDangleCordMat${d}`, darkLeather, scene);

        const boneFrag = MeshBuilder.CreateCylinder(`barbDangleBone${d}`, {
            height: dangleLengths[d],
            diameterTop: 0.03,
            diameterBottom: 0.04,
            tessellation: 5,
        }, scene);
        makeFlatShaded(boneFrag);
        boneFrag.parent = dangleCord;
        boneFrag.position = new Vector3(0, -dangleLengths[d] * 0.5 - 0.03, 0);
        boneFrag.material = createLowPolyMaterial(`barbDangleBoneMat${d}`, boneWhite, scene);
    }

    // Iron studs — 6 small studs along the belt's front face
    for (let s = 0; s < 6; s++) {
        const stud = MeshBuilder.CreateBox(`barbBeltStud${s}`, {
            width: 0.06,
            height: 0.06,
            depth: 0.03,
        }, scene);
        makeFlatShaded(stud);
        stud.parent = belt;
        stud.position = new Vector3(-0.50 + s * 0.20, 0, 0.49);
        stud.material = createEmissiveMaterial(`barbBeltStudMat${s}`, steelGrey, 0.3, scene);
    }
```

- [ ] **Step 2: Replace the off-arm fist with a bloody hand wrap**

Find the `fist` block (parented to `this.shieldArm`, now `shieldArm`):

```ts
        const fist = MeshBuilder.CreateBox('barbFist', { ... });
        ...
        fist.material = createLowPolyMaterial('barbFistMat', skinDark, scene);
```

Replace that whole block with:

```ts
    // Bloody hand wrap on the off-arm fist
    const offFistWrap = MeshBuilder.CreateBox('barbOffFistWrap', {
        width: 0.38,
        height: 0.32,
        depth: 0.38,
    }, scene);
    makeFlatShaded(offFistWrap);
    offFistWrap.parent = shieldArm;
    offFistWrap.position = new Vector3(0, -0.60, 0.04);
    offFistWrap.material = createLowPolyMaterial('barbOffFistWrapMat', boneWhite, scene);

    // Red blood splotch on the wrap
    const offBloodSplotch = MeshBuilder.CreateBox('barbOffBloodSplotch', {
        width: 0.25,
        height: 0.04,
        depth: 0.20,
    }, scene);
    makeFlatShaded(offBloodSplotch);
    offBloodSplotch.parent = offFistWrap;
    offBloodSplotch.position = new Vector3(0.05, 0.16, 0.10);
    offBloodSplotch.rotation.y = 0.4;
    offBloodSplotch.material = createEmissiveMaterial('barbOffBloodSplotchMat',
        bloodRed, 0.5, scene);
```

- [ ] **Step 3: Add a hand wrap on the axe-arm grip end (the bottom of the axe arm)**

Find the `axeBracer` block on the axe arm. Immediately after that block, add:

```ts
    // Axe-hand wrap — small bandage box at the gripping hand
    const axeHandWrap = MeshBuilder.CreateBox('barbAxeHandWrap', {
        width: 0.34,
        height: 0.18,
        depth: 0.34,
    }, scene);
    makeFlatShaded(axeHandWrap);
    axeHandWrap.parent = swordArm;
    axeHandWrap.position = new Vector3(0, -0.55, 0.08);
    axeHandWrap.material = createLowPolyMaterial('barbAxeHandWrapMat', boneWhite, scene);

    // Red blood streak on the axe hand wrap
    const axeHandBlood = MeshBuilder.CreateBox('barbAxeHandBlood', {
        width: 0.18,
        height: 0.03,
        depth: 0.16,
    }, scene);
    makeFlatShaded(axeHandBlood);
    axeHandBlood.parent = axeHandWrap;
    axeHandBlood.position = new Vector3(0.04, 0.10, 0.08);
    axeHandBlood.material = createEmissiveMaterial('barbAxeHandBloodMat', bloodRed, 0.5, scene);
```

- [ ] **Step 4: Add forearm scar lines on the off-arm bracer**

Find the `offBracer` block. Immediately after it, add:

```ts
    // 2 red emissive scar lines wrapping the off-arm bracer
    for (let i = 0; i < 2; i++) {
        const scar = MeshBuilder.CreateBox(`barbOffForearmScar${i}`, {
            width: 0.44,
            height: 0.018,
            depth: 0.10,
        }, scene);
        makeFlatShaded(scar);
        scar.parent = offBracer;
        scar.position = new Vector3(0, 0.05 - i * 0.08, 0.18);
        scar.rotation.y = (i === 0 ? 0.25 : -0.20);
        scar.material = createEmissiveMaterial(`barbOffForearmScarMat${i}`, bloodRed, 0.5, scene);
    }
```

- [ ] **Step 5: Return beltTrophy in the parts struct**

Change `beltTrophy: null,` to `beltTrophy,`.

- [ ] **Step 6: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Visual playtest**

Run: `npm start`, play barbarian. Verify:
- A skull trophy hangs from the front-left of the belt with a small jaw and dark eye sockets.
- 3 bone fragments dangle from the front-right of the belt.
- 6 small metal studs along the belt's front face.
- Both fists are pale bandage-wrapped with red blood splotches.
- 2 red scar lines wrap around the off-arm bracer.

- [ ] **Step 8: Commit**

```bash
git add src/game/gameplay/champions/BarbarianBuilder.ts
git commit -m "feat(barbarian): belt trophy skull, dangling bones, studs, bloody hand wraps

Adds the trophy skull hanging from the belt's front-left (with jaw and
hollow eye sockets), three dangling bone fragments on the right, and
six metal studs along the belt face. Replaces both fists with pale
bandage wraps stained with bloodRed emissive splotches, and wraps the
off-arm bracer with two diagonal red scar lines. beltTrophy is now
wired through BarbarianMeshParts for the wobble animation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Kilt + legs — bone bead chain, crossing straps, thigh war paint, calf bandages

Add a hanging bone chain across the kilt front, two crossing leather strap bands, war-paint stripes on the outside of each thigh, and bandage wraps around the calves above the boots. Also populate the `kiltFlaps` array.

**Files:**
- Modify: `src/game/gameplay/champions/BarbarianBuilder.ts`

- [ ] **Step 1: Collect kilt flap meshes into a local array**

Find the existing front kilt flap loop:

```ts
        const kiltAngles = [-0.28, -0.14, 0, 0.14, 0.28];
        for (let i = 0; i < kiltAngles.length; i++) {
            const kiltFlap = MeshBuilder.CreateBox(...);
            ...
        }
```

Just before that loop, declare:

```ts
    const kiltFlaps: Mesh[] = [];
```

Inside the loop, immediately after `kiltFlap.material = ...`, add:

```ts
        kiltFlaps.push(kiltFlap);
```

(The 3 back flaps are not animated — they stay out of `kiltFlaps`.)

- [ ] **Step 2: Add bone bead chain across the kilt front (parented to belt)**

After the back-flap loop closes, add:

```ts
    // Bone bead chain — 5 beads strung in a low arc across the kilt front.
    // Parented to belt so it's independent of flap sway.
    const beadCount = 5;
    for (let b = 0; b < beadCount; b++) {
        const t = b / (beadCount - 1);
        const xPos = (t - 0.5) * 0.85;
        // Slight downward arc — middle beads hang lower than ends.
        const arcSag = -Math.sin(t * Math.PI) * 0.08;
        const bead = MeshBuilder.CreatePolyhedron(`barbKiltBead${b}`, {
            type: 1,
            size: 0.04,
        }, scene);
        makeFlatShaded(bead);
        bead.parent = belt;
        bead.position = new Vector3(xPos, -0.22 + arcSag, 0.48);
        bead.scaling = new Vector3(1.0, 1.3, 1.0);
        bead.material = createLowPolyMaterial(`barbKiltBeadMat${b}`, boneWhite, scene);
    }
```

- [ ] **Step 3: Add two crossing leather strap bands on the kilt front**

After the bead-chain block, add:

```ts
    // Crossing leather strap bands on the kilt — an X across the front.
    for (let s = 0; s < 2; s++) {
        const strap = MeshBuilder.CreateBox(`barbKiltStrap${s}`, {
            width: 1.10,
            height: 0.05,
            depth: 0.04,
        }, scene);
        makeFlatShaded(strap);
        strap.parent = rootMesh;
        strap.position = new Vector3(0, -1.00, 0.42);
        strap.rotation.z = s === 0 ? 0.5 : -0.5;
        strap.material = createLowPolyMaterial(`barbKiltStrapMat${s}`, darkLeather, scene);
    }
```

- [ ] **Step 4: Add war-paint stripes on the outside of each thigh**

Find the two leg-creation blocks (`leftLeg`, `rightLeg`). After both are created (and before the kneecap loop), add:

```ts
    // Thigh war-paint stripes — visible on the outside face as the leg lifts.
    for (const leg of [leftLeg, rightLeg]) {
        const isLeft = leg === leftLeg;
        for (let i = 0; i < 2; i++) {
            const stripe = MeshBuilder.CreateBox(`barbThighStripe_${leg.name}_${i}`, {
                width: 0.04,
                height: 0.35,
                depth: 0.10,
            }, scene);
            makeFlatShaded(stripe);
            stripe.parent = leg;
            // Place on outside face of each leg.
            stripe.position = new Vector3((isLeft ? -1 : 1) * 0.22, 0.10 + i * 0.10, 0.05 - i * 0.08);
            stripe.rotation.z = (isLeft ? -1 : 1) * 0.15;
            stripe.material = createEmissiveMaterial(`barbThighStripeMat_${leg.name}_${i}`,
                bloodRed, 0.5, scene);
        }
    }
```

- [ ] **Step 5: Add calf bandage wraps above each boot**

Find the boot blocks (`leftBoot`, `rightBoot`). After both are created, add:

```ts
    // Calf bandage wraps — wide pale rings just above each boot.
    for (const leg of [leftLeg, rightLeg]) {
        const wrap = MeshBuilder.CreateCylinder(`barbCalfWrap_${leg.name}`, {
            height: 0.16,
            diameterTop: 0.46,
            diameterBottom: 0.50,
            tessellation: 6,
        }, scene);
        makeFlatShaded(wrap);
        wrap.parent = leg;
        wrap.position = new Vector3(0, -0.32, 0.04);
        wrap.material = createLowPolyMaterial(`barbCalfWrapMat_${leg.name}`, boneWhite, scene);
    }
```

- [ ] **Step 6: Return kiltFlaps in the parts struct**

Change `kiltFlaps: [],` to `kiltFlaps,`.

- [ ] **Step 7: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Visual playtest**

Run: `npm start`, play barbarian. Verify:
- A pale bone-bead chain hangs in a low arc across the kilt front.
- Two dark leather straps cross the kilt front in an X.
- 2 red emissive stripes on the outside of each thigh.
- A pale bandage wrap ring sits just above each boot.

- [ ] **Step 9: Commit**

```bash
git add src/game/gameplay/champions/BarbarianBuilder.ts
git commit -m "feat(barbarian): bone bead kilt chain, crossing straps, thigh paint, calf wraps

Strings 5 bone beads in a low arc across the kilt front (parented to
the belt so the chain doesn't flicker with flap motion), adds two
crossing leather straps in an X, paints two red emissive stripes on
the outside of each thigh, and wraps pale bandages around each calf
above the boot. Collects the 5 front kilt flaps into the kiltFlaps
array on BarbarianMeshParts so a later task can sway them in waves.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Greatcleaver weapon overhaul

Replace the entire battle-axe construction with the larger, jagged, double-bit "Greatcleaver." The element-decoration anchor (`axeHead`) must remain the main blade body.

**Files:**
- Modify: `src/game/gameplay/champions/BarbarianBuilder.ts`

- [ ] **Step 1: Replace the axe construction block wholesale**

Find the comment `// --- Battle axe held in the dominant hand ---` and the entire axe construction following it (shaft, grip, head, edge, back spike, pommel) — through the existing `pommel` block. Replace that entire block with:

```ts
    // ===== Greatcleaver — oversized double-bit berserker axe =====

    // Shaft — slightly longer than before
    const axeShaft = MeshBuilder.CreateCylinder('barbAxeShaft', {
        height: 1.55,
        diameterTop: 0.10,
        diameterBottom: 0.10,
        tessellation: 6,
    }, scene);
    makeFlatShaded(axeShaft);
    axeShaft.parent = swordArm;
    axeShaft.position = new Vector3(0.05, -0.95, 0.18);
    axeShaft.rotation.z = 0.08;
    axeShaft.material = createLowPolyMaterial('barbAxeShaftMat', wood, scene);

    // 3 bone rings wrapping the shaft above the grip
    for (let r = 0; r < 3; r++) {
        const ring = MeshBuilder.CreateCylinder(`barbAxeShaftRing${r}`, {
            height: 0.05,
            diameterTop: 0.13,
            diameterBottom: 0.13,
            tessellation: 6,
        }, scene);
        makeFlatShaded(ring);
        ring.parent = axeShaft;
        ring.position = new Vector3(0, 0.30 + r * 0.10, 0);
        ring.material = createLowPolyMaterial(`barbAxeShaftRingMat${r}`, boneWhite, scene);
    }

    // Leather grip wrap (unchanged in spirit)
    const gripWrap = MeshBuilder.CreateCylinder('barbAxeGrip', {
        height: 0.22,
        diameterTop: 0.14,
        diameterBottom: 0.14,
        tessellation: 6,
    }, scene);
    makeFlatShaded(gripWrap);
    gripWrap.parent = axeShaft;
    gripWrap.position = new Vector3(0, 0.15, 0);
    gripWrap.material = createLowPolyMaterial('barbAxeGripMat', leather, scene);

    // ===== Main axe head body — ~50% larger than before =====
    const axeHead = MeshBuilder.CreateBox('barbAxeHead', {
        width: 0.65,
        height: 0.75,
        depth: 0.18,
    }, scene);
    makeFlatShaded(axeHead);
    axeHead.parent = axeShaft;
    axeHead.position = new Vector3(0.18, 0.72, 0);
    axeHead.rotation.z = 0.15;
    axeHead.material = createLowPolyMaterial('barbAxeHeadMat', steelGrey, scene);

    // Jagged tooth edge — 3 stacked notched boxes of varying widths along the cutting side
    const toothWidths = [0.10, 0.06, 0.08];
    const toothHeights = [0.26, 0.22, 0.24];
    const toothYs = [-0.22, 0.00, 0.22];
    for (let t = 0; t < 3; t++) {
        const tooth = MeshBuilder.CreateBox(`barbAxeTooth${t}`, {
            width: toothWidths[t],
            height: toothHeights[t],
            depth: 0.20,
        }, scene);
        makeFlatShaded(tooth);
        tooth.parent = axeHead;
        tooth.position = new Vector3(0.32 + (t % 2) * 0.02, toothYs[t], 0);
        tooth.material = createEmissiveMaterial(`barbAxeToothMat${t}`, steelSharp, 0.35, scene);
    }

    // Second (back) blade — smaller mirror blade on the spike side, creates double-bit silhouette
    const backBlade = MeshBuilder.CreateBox('barbAxeBackBlade', {
        width: 0.45,
        height: 0.40,
        depth: 0.12,
    }, scene);
    makeFlatShaded(backBlade);
    backBlade.parent = axeHead;
    backBlade.position = new Vector3(-0.40, 0.05, 0);
    backBlade.rotation.z = -0.15;
    backBlade.material = createLowPolyMaterial('barbAxeBackBladeMat', steelGrey, scene);

    // 2 jagged teeth on the back blade
    for (let t = 0; t < 2; t++) {
        const backTooth = MeshBuilder.CreateBox(`barbAxeBackTooth${t}`, {
            width: 0.08,
            height: 0.18,
            depth: 0.14,
        }, scene);
        makeFlatShaded(backTooth);
        backTooth.parent = backBlade;
        backTooth.position = new Vector3(-0.22, t === 0 ? -0.12 : 0.12, 0);
        backTooth.material = createEmissiveMaterial(`barbAxeBackToothMat${t}`, steelSharp, 0.3, scene);
    }

    // 3 bone inlays along the side face of the main head
    for (let i = 0; i < 3; i++) {
        const inlay = MeshBuilder.CreatePolyhedron(`barbAxeInlay${i}`, {
            type: 1,
            size: 0.05,
        }, scene);
        makeFlatShaded(inlay);
        inlay.parent = axeHead;
        inlay.position = new Vector3(-0.05 + i * 0.10, -0.20 + i * 0.20, 0.10);
        inlay.material = createLowPolyMaterial(`barbAxeInlayMat${i}`, boneWhite, scene);
    }

    // 3 blood-drip emissive strips running down the side of the main blade
    for (let d = 0; d < 3; d++) {
        const drip = MeshBuilder.CreateBox(`barbAxeBloodDrip${d}`, {
            width: 0.025,
            height: 0.32,
            depth: 0.03,
        }, scene);
        makeFlatShaded(drip);
        drip.parent = axeHead;
        drip.position = new Vector3(0.20 - d * 0.10, -0.10 - d * 0.05, 0.09);
        drip.material = createEmissiveMaterial(`barbAxeBloodDripMat${d}`, bloodRed, 0.6, scene);
    }

    // Skull pommel — replaces the octahedron
    const pommelSkull = MeshBuilder.CreateSphere('barbAxePommelSkull', {
        diameter: 0.13,
        segments: 4,
    }, scene);
    makeFlatShaded(pommelSkull);
    pommelSkull.parent = axeShaft;
    pommelSkull.position = new Vector3(0, -0.80, 0);
    pommelSkull.material = createLowPolyMaterial('barbAxePommelSkullMat', boneWhite, scene);

    const pommelJaw = MeshBuilder.CreateBox('barbAxePommelJaw', {
        width: 0.09,
        height: 0.04,
        depth: 0.07,
    }, scene);
    makeFlatShaded(pommelJaw);
    pommelJaw.parent = pommelSkull;
    pommelJaw.position = new Vector3(0, -0.06, 0.01);
    pommelJaw.material = createLowPolyMaterial('barbAxePommelJawMat',
        new Color3(0.85, 0.80, 0.70), scene);

    // 3 hanging trophy strips dangling from the junction of head and shaft
    const stripLengths = [0.18, 0.25, 0.20];
    for (let s = 0; s < 3; s++) {
        const strip = MeshBuilder.CreateBox(`barbAxeTrophyStrip${s}`, {
            width: 0.025,
            height: stripLengths[s],
            depth: 0.025,
        }, scene);
        makeFlatShaded(strip);
        strip.parent = axeShaft;
        strip.position = new Vector3(0.08 + (s - 1) * 0.04, 0.50 - stripLengths[s] * 0.5, 0.05);
        strip.material = createLowPolyMaterial(`barbAxeTrophyStripMat${s}`, darkLeather, scene);

        // Small bone bead at end of strip
        const stripBone = MeshBuilder.CreatePolyhedron(`barbAxeTrophyStripBone${s}`, {
            type: 1,
            size: 0.025,
        }, scene);
        makeFlatShaded(stripBone);
        stripBone.parent = strip;
        stripBone.position = new Vector3(0, -stripLengths[s] * 0.5 - 0.02, 0);
        stripBone.material = createLowPolyMaterial(`barbAxeTrophyStripBoneMat${s}`, boneWhite, scene);
    }
```

Note: `axeHead` is still the variable returned in the parts struct — no change to the return statement.

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Visual playtest**

Run: `npm start`, play barbarian. Verify:
- The axe is visibly larger and more menacing.
- The cutting edge has jagged teeth (3 stacked notched boxes), not a smooth strip.
- A second smaller blade extends on the opposite side (double-bit profile).
- 3 small pale bone shapes embedded in the steel head, 3 red drip stripes running down the side.
- A small skull replaces the octahedron pommel.
- 3 short dark leather strips with bone beads hang from the head-shaft junction.
- Element decorations (fire/ice/etc. from picking up power orbs) still attach to the axe head correctly — try picking up a fireball orb to confirm.

- [ ] **Step 4: Commit**

```bash
git add src/game/gameplay/champions/BarbarianBuilder.ts
git commit -m "feat(barbarian): Greatcleaver — oversized double-bit jagged berserker axe

Replaces the simple battle axe with a ~50% larger head, a jagged
three-tooth cutting edge, a smaller mirror back blade for a double-bit
top-down profile, 3 bone inlays in the steel, 3 red blood-drip
emissive strips, a tiny skull pommel, 3 trophy strips with bone beads
hanging from the head-shaft junction, and 3 bone rings on the shaft.
The axeHead variable still maps to the element-decoration anchor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire new refs and add berserker fields to Champion.ts

Update the shim in `Champion.ts` to store the new builder outputs, and add the private fields used by upcoming animation and FX.

**Files:**
- Modify: `src/game/gameplay/Champion.ts`

- [ ] **Step 1: Add new private fields to the Champion class**

Find the existing barbarian field declaration:

```ts
    // Barbarian axe head — weapon anchor for element decorations
    private barbAxeHead: Mesh | null = null;
```

Replace that line and the lines around it with:

```ts
    // Barbarian axe head — weapon anchor for element decorations
    private barbAxeHead: Mesh | null = null;

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
```

- [ ] **Step 2: Update the shim to store new refs**

Find the current `createBarbarianMesh` shim (added in Task 1):

```ts
    private createBarbarianMesh(): void {
        const parts = buildBarbarianMesh(this.scene, this.position);
        this.mesh = parts.rootMesh;
        this.head = parts.head;
        this.swordArm = parts.swordArm;
        this.shieldArm = parts.shieldArm;
        this.leftLeg = parts.leftLeg;
        this.rightLeg = parts.rightLeg;
        this.barbAxeHead = parts.axeHead;
        this.cape = null;
        this.originalScale = 1.0;
    }
```

Replace it with:

```ts
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
    }
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/game/gameplay/Champion.ts
git commit -m "feat(barbarian): wire builder refs into Champion + add berserker fields

Stores the new BarbarianMeshParts entries (kiltFlaps, beltTrophy,
snarlJaw, chestPulseGroup) onto Champion fields. Declares the
private fields used by upcoming animation and FX (snarl timer/active,
footstep step-sign tracking, spin arc mesh/timer, blood-trail PS).
No behavior change yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: animateBarbarianExtras — breath, hunched lean, kilt sway, trophy wobble, snarl twitch

Add the new animation helper and call it from `animateHumanoid`. Layered on top of existing animation, gracefully no-ops when spinning or attacking.

**Files:**
- Modify: `src/game/gameplay/Champion.ts`

- [ ] **Step 1: Add `animateBarbarianExtras` method**

Add this method to `Champion.ts` immediately after the existing `animateMage` method:

```ts
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
    }
```

- [ ] **Step 2: Call it from `animateHumanoid`**

Find the end of `animateHumanoid` (just before its closing brace). Locate the ranger-bow / quiver sway block at the very end of `animateHumanoid`:

```ts
        // Ranger bow / quiver sway
        if (this.rangerBow) { ... }
        if (this.rangerQuiver) { ... }
    }
```

Immediately before the method's closing brace, but after the ranger block, add:

```ts
        // Barbarian-specific extras layered on top of the shared humanoid pose
        if (this.championType === 'barbarian') {
            // Note: animateHumanoid is called once per frame from update() — we need deltaTime.
            // The caller already passes deltaTime through `update`; we read it from the captured
            // value below. See Step 3.
            this.animateBarbarianExtras(this.lastDeltaTime);
        }
    }
```

- [ ] **Step 3: Capture deltaTime so animateBarbarianExtras can use it**

`animateHumanoid` currently takes no parameters. Rather than changing its signature (which the mage path also calls into via a sibling helper), capture the latest deltaTime on the Champion instance.

Find the existing class field block near `private walkTime` (around line 36-58). Add a new field:

```ts
    private lastDeltaTime: number = 0;
```

Then find the `update()` method (around line 1140-1188). At the very top of `update`, before any other logic, add:

```ts
        this.lastDeltaTime = deltaTime;
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Visual playtest**

Run: `npm start`, play barbarian. Verify:
- Chest visibly rises and falls slowly (breath pulse, ~0.4 Hz).
- A subtle forward hunch baked into the standing/walking pose.
- Kilt flaps slosh in a wave pattern around the waist.
- The skull trophy on the belt wobbles with each step.
- Every few seconds the snarl jaw flicks open briefly.

- [ ] **Step 6: Commit**

```bash
git add src/game/gameplay/Champion.ts
git commit -m "feat(barbarian): animateBarbarianExtras — breath, hunch, sway, wobble, snarl

Adds the layered barbarian animation extras called from the tail of
animateHumanoid. Breath pulse scales chestPulseGroup.y; hunched stride
adds a subtle forward lean; kilt flaps slosh in a phase-offset wave;
the belt trophy wobbles on a faster cycle; a random 2-5s snarl jaw
flick adds berserker rage. lastDeltaTime is captured at the top of
update() so the helper can read it without changing the shared
animateHumanoid signature.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Heavier shoulder roll + axe-arm bob (barbarian-only amplification)

Increase the existing shared-humanoid shoulder roll and axe-arm swing amplitude when the champion is a barbarian.

**Files:**
- Modify: `src/game/gameplay/Champion.ts`

- [ ] **Step 1: Branch shoulder roll amplitude in `animateHumanoid`**

Find this line in `animateHumanoid` (currently near line 1197):

```ts
        this.mesh!.rotation.z = Math.sin(this.walkTime) * 0.08; // Torso lean side-to-side
```

Replace it with:

```ts
        const rollAmp = this.championType === 'barbarian' ? 0.12 : 0.08;
        this.mesh!.rotation.z = Math.sin(this.walkTime) * rollAmp; // Torso lean side-to-side
```

- [ ] **Step 2: Branch the axe-arm swing amplitude**

Find the sword-arm swing else branch in `animateHumanoid` (currently near line 1216):

```ts
            } else {
                this.swordArm.rotation.x = Math.sin(this.walkTime) * 0.50;
                this.swordArm.rotation.z = -0.08;
            }
```

Replace the inner `Math.sin(this.walkTime) * 0.50` line so the block becomes:

```ts
            } else {
                const swingAmp = this.championType === 'barbarian' ? 0.65 : 0.50;
                this.swordArm.rotation.x = Math.sin(this.walkTime) * swingAmp;
                this.swordArm.rotation.z = -0.08;
            }
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Visual playtest**

Run: `npm start`. Confirm:
- Barbarian's torso visibly rolls more side-to-side while walking than the ranger or mage.
- The axe arm visibly dips and rises with a heavier weight per stride.
- Ranger and mage animations are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/game/gameplay/Champion.ts
git commit -m "feat(barbarian): heavier shoulder roll and axe-arm bob

Increases the shared-humanoid shoulder-roll amplitude from 0.08 to
0.12 and the axe-arm stride swing from 0.50 to 0.65 when the champion
is a barbarian. Ranger and mage retain their original values. Sells
the weight of the Greatcleaver in motion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Spin-attack red blood trail + red arc ring

Add two visual layers on top of the existing spin-attack pose: a red particle blood trail emitted from the axe head, and a red emissive torus ring that scales outward and fades at hero feet.

**Files:**
- Modify: `src/game/gameplay/Champion.ts`

- [ ] **Step 1: Spawn the spin blood-trail PS in `triggerSpinAttack`**

Find the existing method:

```ts
    public triggerSpinAttack(): void {
        this.spinAttackTimer = Champion.SPIN_ATTACK_DURATION;
    }
```

Replace it with:

```ts
    public triggerSpinAttack(): void {
        this.spinAttackTimer = Champion.SPIN_ATTACK_DURATION;
        if (this.championType === 'barbarian') {
            this.startBarbSpinFx();
        }
    }
```

- [ ] **Step 2: Add `startBarbSpinFx` helper**

Add this method to `Champion.ts` (right after `triggerSpinAttack`):

```ts
    /** Barbarian-only: create the red blood trail PS + arc-ring mesh for the spin attack. */
    private startBarbSpinFx(): void {
        // ===== Red blood-trail particle system attached to the axe head =====
        if (this.barbAxeHead && !this.barbSpinBloodPs) {
            const ps = new ParticleSystem('barbSpinBlood', 60, this.scene);
            ps.emitter = this.barbAxeHead;
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

        // ===== Red arc ring at hero feet =====
        if (!this.barbSpinArcMesh && this.mesh) {
            const ring = MeshBuilder.CreateTorus('barbSpinArcRing', {
                diameter: 2.5,
                thickness: 0.15,
                tessellation: 12,
            }, this.scene);
            makeFlatShaded(ring);
            ring.material = createEmissiveMaterial('barbSpinArcRingMat',
                new Color3(0.8, 0.10, 0.05), 0.9, this.scene);
            ring.position = this.position.clone();
            ring.position.y = 0.1;
            ring.scaling = new Vector3(0.3, 1.0, 0.3);
            this.barbSpinArcMesh = ring;
            this.barbSpinArcTimer = Champion.SPIN_ATTACK_DURATION;
        }
    }
```

- [ ] **Step 3: Tick the arc ring and clean up FX in `update`**

Find the `update` method. Just before `return reachedEnd;` at the end, add:

```ts
        // Tick + cleanup barbarian spin FX
        if (this.championType === 'barbarian') {
            this.tickBarbSpinFx(deltaTime);
        }
```

Add this new helper to the class:

```ts
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
            // Fade by lowering emissive intensity over time
            const mat = this.barbSpinArcMesh.material as StandardMaterial | null;
            if (mat) {
                const intensity = 0.9 * (1 - t);
                mat.emissiveColor = new Color3(0.8 * (1 - t * 0.5), 0.10, 0.05).scale(intensity);
                mat.alpha = 1 - t;
            }
            if (this.barbSpinArcTimer <= 0) {
                this.barbSpinArcMesh.dispose();
                this.barbSpinArcMesh = null;
            }
        }

        // Stop the blood trail when the spin ends
        if (this.barbSpinBloodPs && this.spinAttackTimer <= 0) {
            this.barbSpinBloodPs.stop();
            const ps = this.barbSpinBloodPs;
            this.barbSpinBloodPs = null;
            setTimeout(() => ps.dispose(), 400);
        }
    }
```

For the StandardMaterial typing to compile cleanly, ensure the existing top-of-file import already includes `StandardMaterial`. It does (`import { ..., StandardMaterial } from '@babylonjs/core'` on line 1) — no import change needed.

- [ ] **Step 4: Also dispose FX in `die()`**

Find the `die()` method. After the `this.statusEffectParticles.forEach(...)` cleanup block, but before the method's closing brace, add:

```ts
        // Barbarian spin FX cleanup
        if (this.barbSpinBloodPs) {
            this.barbSpinBloodPs.stop();
            this.barbSpinBloodPs.dispose();
            this.barbSpinBloodPs = null;
        }
        if (this.barbSpinArcMesh) {
            this.barbSpinArcMesh.dispose();
            this.barbSpinArcMesh = null;
        }
```

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Visual playtest**

Run: `npm start`, play barbarian. Move into an enemy so the basic-attack/spin triggers. Verify:
- A red blood-particle trail bursts from the axe head during the spin.
- A red emissive ring appears at the hero's feet, scales outward, fades, and disposes.
- After the spin ends, both FX cleanly stop.
- Killing the hero (let enemies attack until HP=0) does not leave a stuck ring or particle system.

- [ ] **Step 7: Commit**

```bash
git add src/game/gameplay/Champion.ts
git commit -m "feat(barbarian): spin-attack red blood trail + red arc ring

triggerSpinAttack now spawns two barbarian-only FX layers: a 60-particle
red blood ParticleSystem attached to the axe head, and a torus ring
emissive red at hero feet that scales 0.3->1.5 and fades over the 0.4s
spin duration. The ring follows the hero's XZ position each frame. Both
FX are cleaned up when the spin ends or the champion dies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Heavy footstep dust + blood splatter on basic attack

Add the last two combat-FX layers: dust bursts on each barbarian footstep, and red blood splatter at the target on basic-attack hits.

**Files:**
- Modify: `src/game/gameplay/Champion.ts`

- [ ] **Step 1: Add footstep dust to `animateBarbarianExtras`**

Find the end of `animateBarbarianExtras` (just before its closing brace). Add:

```ts
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
```

- [ ] **Step 2: Add `spawnFootstepDust` helper**

Add this method to `Champion.ts` (right after `animateBarbarianExtras`):

```ts
    /** Barbarian-only: small brown dust burst at a foot's world position. */
    private spawnFootstepDust(worldPos: Vector3): void {
        const ps = new ParticleSystem('barbFootDust', 8, this.scene);
        ps.emitter = worldPos;
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
        ps.manualEmitCount = 8; // one-shot
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.direction1 = new Vector3(-0.5, 0.4, -0.5);
        ps.direction2 = new Vector3(0.5, 0.8, 0.5);
        ps.minEmitPower = 0.4;
        ps.maxEmitPower = 1.2;
        ps.gravity = new Vector3(0, -0.5, 0);
        ps.start();
        setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 100);
    }
```

- [ ] **Step 3: Add blood splatter to `attackNearbyEnemies`**

Find the method `attackNearbyEnemies`:

```ts
    private attackNearbyEnemies(deltaTime: number): void {
        this.attackTimer -= deltaTime;
        if (this.attackTimer > 0) return;

        if (!this.enemyManager) return;
        const target = this.enemyManager.getClosestEnemy(this.position, this.attackRange);
        if (!target || !target.isAlive()) return;

        target.takeDamage(this.attackDamage);
        this.attackTimer = this.attackCooldown;

        // Visual: sword swing flash
        this.createAttackEffect(target.getPosition());
    }
```

Replace the final two lines (`this.createAttackEffect(target.getPosition());` and the closing brace) with:

```ts
        // Visual: sword swing flash (shared)
        this.createAttackEffect(target.getPosition());

        // Barbarian-only blood splatter on the target
        if (this.championType === 'barbarian') {
            this.spawnBloodSplatter(target.getPosition());
        }
    }
```

- [ ] **Step 4: Add `spawnBloodSplatter` helper**

Add this method to `Champion.ts` (right after `spawnFootstepDust`):

```ts
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
```

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Visual playtest**

Run: `npm start`, play barbarian:
- Walk around — small brown dust puffs visible at the planted foot on each stride.
- Hit an enemy with the basic attack — small red blood spray bursts at the target.
- Switch to ranger or mage in a fresh run — neither effect appears. (No regressions for other champions.)

- [ ] **Step 7: Commit**

```bash
git add src/game/gameplay/Champion.ts
git commit -m "feat(barbarian): heavy footstep dust + blood splatter on basic attack

Adds a one-shot brown dust ParticleSystem at the planted foot's world
position each time the stride phase changes sign (one burst per step
per foot). Adds a one-shot 10-particle red splatter at the target on
each basic-attack hit, layered on top of the existing gold slash
effect. Both effects are barbarian-only — ranger/mage are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Final integration playtest

End-to-end verification of the full berserker upgrade with all elements stacking together.

**Files:** none modified.

- [ ] **Step 1: Run full build to catch any production-only issues**

Run: `npm run build`
Expected: build succeeds, `dist/` produced, no errors. (Warnings about bundle size are acceptable.)

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Full playtest checklist**

Run: `npm start`. Pick the barbarian. Verify each of the following from a top-down-ish camera angle:

**Silhouette (head/shoulders):**
- One tall left horn, one chipped right horn with a pale break cap.
- Bone fragments and a red stripe on top of the fur helm cap.
- Snarl jaw with teeth occasionally flicks open (~2-5s interval).
- Two diagonal blood-red scars on each shoulder top.
- Red war-paint stripes fanning back off each shoulder.
- Bone necklace ring of 8 pieces around the neck.
- Torn fur pelts on each shoulder with bone spikes.
- Single battered armor plate on the right shoulder only.

**Body / belt / arms:**
- Pec/war-paint stripe pulse slowly with breathing.
- Trophy skull hanging from belt front-left, wobbles with steps.
- 3 dangling bone fragments on belt front-right.
- 6 metal studs along the belt.
- Both fists wrapped in pale bandages with red blood splotches.
- 2 red scar lines on the off-arm bracer.

**Kilt + legs:**
- 5 front kilt flaps sloshing in a wave during walk.
- Bone bead chain in a low arc across the kilt front.
- Two crossing leather straps forming an X on the kilt.
- Red emissive stripes on the outside of each thigh.
- Pale bandage wraps above each boot.

**Greatcleaver:**
- Visibly larger axe head with jagged 3-tooth cutting edge.
- Second smaller back blade (double-bit profile from above).
- 3 bone inlays in the steel head, 3 red blood-drip stripes.
- Tiny skull pommel at the bottom of the shaft.
- 3 dark trophy strips with bone beads dangling from head-shaft junction.
- 3 bone rings on the shaft.

**Animation:**
- Torso visibly rolls side-to-side more than ranger/mage.
- Axe arm bobs heavily with each stride.
- Subtle forward hunch in standing/walking pose.

**Combat FX:**
- Walking around: brown dust puff at planted foot each stride.
- Basic attack on enemy: red blood splatter at target (in addition to gold flash).
- Spin attack: red blood-trail particles from axe + red arc ring at feet that scales and fades.
- After spin completes: all FX disposed cleanly.
- Death: champion-death gold burst still plays; no orphaned FX.

**Other champions:**
- Switch to ranger and mage (new run from menu). Confirm both look identical to before this PR — no regressions.

**Element decorations:**
- During barbarian run, pick up power orbs to acquire fire, ice, arcane, physical, storm powers. Confirm the element decorations still attach to the axe head correctly.

- [ ] **Step 4: Update CLAUDE.md note about BarbarianBuilder**

Find the `## Architecture` block in `CLAUDE.md`. Inside the `### Hero systems` subsection, after the `src/game/gameplay/Champion.ts` line, add:

```markdown
- `src/game/gameplay/champions/BarbarianBuilder.ts` — barbarian mesh construction (extracted from Champion.ts for the berserker refinement).
```

- [ ] **Step 5: Commit the doc update**

```bash
git add CLAUDE.md
git commit -m "docs: note BarbarianBuilder.ts in architecture map

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done

All five spec sections are implemented:

| Spec section | Tasks |
| --- | --- |
| §1 Code structure | Task 1, Task 8 |
| §2 Body / silhouette | Task 2 (chest group), Task 3 (head), Task 4 (torso), Task 5 (belt + arms), Task 6 (kilt + legs) |
| §3 Greatcleaver | Task 7 |
| §4 Animation extras | Task 9, Task 10 |
| §5 Combat FX | Task 11 (spin trail + ring), Task 12 (dust + splatter) |
| Validation | Task 13 |
