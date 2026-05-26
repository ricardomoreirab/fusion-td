import { Vector3, MeshBuilder, Mesh, Color3, Scene } from '@babylonjs/core';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';

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

    // Berserker palette additions
    const boneWhite   = new Color3(0.92, 0.88, 0.78);
    const bloodRed    = new Color3(0.55, 0.06, 0.05);
    const darkLeather = new Color3(0.18, 0.10, 0.04);

    // --- Body: wide muscular bare-chested torso ---
    // rootMesh is an invisible parent so we can z-scale the visible torso (`barbBodyVis`)
    // into an oval cross-section without squishing every other child of the body.
    const rootMesh = new Mesh('barbBody', scene);
    rootMesh.position = position.clone();
    rootMesh.position.y += 2.0;

    const torsoVisible = MeshBuilder.CreateCylinder('barbBodyVis', {
        height: 1.70,
        diameterTop: 1.30,     // wider at chest
        diameterBottom: 1.05,  // narrower at waist (slight V-taper)
        tessellation: 8,
    }, scene);
    makeFlatShaded(torsoVisible);
    torsoVisible.parent = rootMesh;
    torsoVisible.scaling = new Vector3(1.0, 1.0, 0.72); // compress front-to-back depth
    torsoVisible.material = createLowPolyMaterial('barbBodyMat', skinTone, scene);

    // Chest-pulse parent: groups pecs + chest war-paint stripe so the breath
    // pulse animation can scale them together. Empty Mesh — no geometry.
    const chestPulseGroup = new Mesh('barbChestGroup', scene);
    chestPulseGroup.parent = rootMesh;
    chestPulseGroup.position = Vector3.Zero();

    // Pec / chest muscle definition — slightly darker plane front center
    const pecLeft = MeshBuilder.CreateBox('barbPecL', {
        width: 0.52,
        height: 0.45,
        depth: 0.06
    }, scene);
    makeFlatShaded(pecLeft);
    pecLeft.parent = chestPulseGroup;
    pecLeft.position = new Vector3(-0.22, 0.28, 0.48);
    pecLeft.material = createLowPolyMaterial('barbPecLMat', skinDark, scene);

    const pecRight = MeshBuilder.CreateBox('barbPecR', {
        width: 0.52,
        height: 0.45,
        depth: 0.06
    }, scene);
    makeFlatShaded(pecRight);
    pecRight.parent = chestPulseGroup;
    pecRight.position = new Vector3(0.22, 0.28, 0.48);
    pecRight.material = createLowPolyMaterial('barbPecRMat', skinDark, scene);

    // War paint stripe across chest — red emissive diagonal stripe
    const warpaint = MeshBuilder.CreateBox('barbWarpaint', {
        width: 0.80,
        height: 0.07,
        depth: 0.05
    }, scene);
    makeFlatShaded(warpaint);
    warpaint.parent = chestPulseGroup;
    warpaint.position = new Vector3(0, 0.05, 0.48);
    warpaint.rotation.z = 0.35; // diagonal slash
    warpaint.material = createEmissiveMaterial('barbWarpaintMat', warPaint, 0.7, scene);

    // Leather belt across waist
    const belt = MeshBuilder.CreateBox('barbBelt', {
        width: 1.30,
        height: 0.18,
        depth: 0.95
    }, scene);
    makeFlatShaded(belt);
    belt.parent = rootMesh;
    belt.position = new Vector3(0, -0.55, 0);
    belt.material = createLowPolyMaterial('barbBeltMat', leather, scene);

    // Belt metal clasp (center front)
    const clasp = MeshBuilder.CreateBox('barbClasp', {
        width: 0.20,
        height: 0.14,
        depth: 0.06
    }, scene);
    makeFlatShaded(clasp);
    clasp.parent = belt;
    clasp.position = new Vector3(0, 0, 0.50);
    clasp.material = createEmissiveMaterial('barbClaspMat', steelGrey, 0.3, scene);

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

    // Fur kilt — multiple trapezoid-ish flat boxes angled around the waist
    const kiltFlaps: Mesh[] = [];
    const kiltAngles = [-0.28, -0.14, 0, 0.14, 0.28];
    for (let i = 0; i < kiltAngles.length; i++) {
        const kiltFlap = MeshBuilder.CreateBox(`barbKilt${i}`, {
            width: 0.28,
            height: 0.55,
            depth: 0.08
        }, scene);
        makeFlatShaded(kiltFlap);
        kiltFlap.parent = rootMesh;
        kiltFlap.position = new Vector3(kiltAngles[i] * 3.2, -0.95, 0.35 - Math.abs(kiltAngles[i]) * 0.5);
        kiltFlap.rotation.y = kiltAngles[i] * 0.6;
        kiltFlap.material = createLowPolyMaterial(`barbKiltMat${i}`,
            i % 2 === 0 ? fur : furLight, scene);
        kiltFlaps.push(kiltFlap);
    }
    // Back fur flaps
    for (let i = 0; i < 3; i++) {
        const backFlap = MeshBuilder.CreateBox(`barbKiltBack${i}`, {
            width: 0.30,
            height: 0.50,
            depth: 0.07
        }, scene);
        makeFlatShaded(backFlap);
        backFlap.parent = rootMesh;
        backFlap.position = new Vector3((i - 1) * 0.32, -0.92, -0.38);
        backFlap.rotation.y = (i - 1) * 0.15;
        backFlap.material = createLowPolyMaterial(`barbKiltBackMat${i}`, fur, scene);
    }

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

    // --- Broad shoulders: large shoulder cap bumps ---
    for (let side = -1; side <= 1; side += 2) {
        const shoulder = MeshBuilder.CreateSphere(`barbShoulder${side}`, {
            diameter: 0.52,
            segments: 4
        }, scene);
        makeFlatShaded(shoulder);
        shoulder.parent = rootMesh;
        shoulder.position = new Vector3(side * 0.86, 0.72, 0);
        shoulder.scaling = new Vector3(0.85, 0.70, 0.85);
        shoulder.material = createLowPolyMaterial(`barbShoulderMat${side}`, skinTone, scene);

        // Shoulder scar / definition mark
        const scarMark = MeshBuilder.CreateBox(`barbShoulderScar${side}`, {
            width: 0.12,
            height: 0.04,
            depth: 0.04
        }, scene);
        makeFlatShaded(scarMark);
        scarMark.parent = shoulder;
        scarMark.position = new Vector3(0, -0.10, 0.20);
        scarMark.rotation.z = 0.3;
        scarMark.material = createEmissiveMaterial(`barbShoulderScarMat${side}`, warPaint, 0.25, scene);

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
    }

    // Bone necklace — ring of 8 bone polyhedra at the neck base.
    // Parented to rootMesh so it stays put when the head turns during look-around.
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

    // --- Head: horned fur-trimmed skull cap + face ---
    // Skull cap base (flat-shaded sphere)
    const head = MeshBuilder.CreateSphere('barbHead', {
        diameter: 0.58,
        segments: 5
    }, scene);
    makeFlatShaded(head);
    head.parent = rootMesh;
    head.position = new Vector3(0, 1.15, 0.04);
    head.material = createLowPolyMaterial('barbHeadMat', skinTone, scene);

    // Fur-trim skull cap (sitting on top of head)
    const helmCap = MeshBuilder.CreateCylinder('barbHelmCap', {
        height: 0.30,
        diameterTop: 0.45,
        diameterBottom: 0.58,
        tessellation: 6
    }, scene);
    makeFlatShaded(helmCap);
    helmCap.parent = head;
    helmCap.position = new Vector3(0, 0.20, 0);
    helmCap.material = createLowPolyMaterial('barbHelmCapMat', fur, scene);

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

    // Eyes — glowing angry ember eyes
    for (let side = -1; side <= 1; side += 2) {
        const eye = MeshBuilder.CreateBox(`barbEye${side}`, {
            width: 0.08,
            height: 0.04,
            depth: 0.04
        }, scene);
        makeFlatShaded(eye);
        eye.parent = head;
        eye.position = new Vector3(side * 0.10, -0.02, 0.29);
        eye.material = createEmissiveMaterial(`barbEyeMat${side}`, new Color3(0.95, 0.40, 0.10), 0.9, scene);
    }

    // Beard — small box below the face
    const beard = MeshBuilder.CreateBox('barbBeard', {
        width: 0.28,
        height: 0.18,
        depth: 0.16
    }, scene);
    makeFlatShaded(beard);
    beard.parent = head;
    beard.position = new Vector3(0, -0.22, 0.20);
    beard.material = createLowPolyMaterial('barbBeardMat', fur, scene);

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

    // --- Right arm (axe arm) — thick upper arm + bracer on forearm ---
    const swordArm = MeshBuilder.CreateCylinder('barbAxeArm', {
        height: 1.25,
        diameter: 0.38,
        tessellation: 6,
    }, scene);
    makeFlatShaded(swordArm);
    swordArm.parent = rootMesh;
    swordArm.position = new Vector3(0.92, 0.02, 0.05);
    swordArm.material = createLowPolyMaterial('barbAxeArmMat', skinTone, scene);

    // Bracer on axe-arm forearm (dark leather)
    const axeBracer = MeshBuilder.CreateCylinder('barbAxeBracer', {
        height: 0.26,
        diameter: 0.42,
        tessellation: 6,
    }, scene);
    makeFlatShaded(axeBracer);
    axeBracer.parent = swordArm;
    axeBracer.position = new Vector3(0, -0.38, 0);
    axeBracer.material = createLowPolyMaterial('barbAxeBracerMat', leather, scene);

    // Axe-hand wrap — small bandage at the gripping hand
    const axeHandWrap = MeshBuilder.CreateCylinder('barbAxeHandWrap', {
        height: 0.18,
        diameter: 0.34,
        tessellation: 6,
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

    // --- Left arm (off-hand / clenched fist) ---
    const shieldArm = MeshBuilder.CreateCylinder('barbOffArm', {
        height: 1.20,
        diameter: 0.38,
        tessellation: 6,
    }, scene);
    makeFlatShaded(shieldArm);
    shieldArm.parent = rootMesh;
    shieldArm.position = new Vector3(-0.92, 0.02, 0.05);
    shieldArm.material = createLowPolyMaterial('barbOffArmMat', skinTone, scene);

    // Bracer on off-arm
    const offBracer = MeshBuilder.CreateCylinder('barbOffBracer', {
        height: 0.26,
        diameter: 0.42,
        tessellation: 6,
    }, scene);
    makeFlatShaded(offBracer);
    offBracer.parent = shieldArm;
    offBracer.position = new Vector3(0, -0.38, 0);
    offBracer.material = createLowPolyMaterial('barbOffBracerMat', leather, scene);

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

    // Bloody hand wrap on the off-arm fist
    const offFistWrap = MeshBuilder.CreateCylinder('barbOffFistWrap', {
        height: 0.32,
        diameter: 0.38,
        tessellation: 6,
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

    // --- Bare legs (skin tone, knee cap detail) ---
    const leftLeg = MeshBuilder.CreateCylinder('barbLeftLeg', {
        height: 1.05,
        diameter: 0.40,
        tessellation: 6,
    }, scene);
    makeFlatShaded(leftLeg);
    leftLeg.parent = rootMesh;
    leftLeg.position = new Vector3(-0.30, -1.22, 0);
    leftLeg.material = createLowPolyMaterial('barbLeftLegMat', skinTone, scene);

    const rightLeg = MeshBuilder.CreateCylinder('barbRightLeg', {
        height: 1.05,
        diameter: 0.40,
        tessellation: 6,
    }, scene);
    makeFlatShaded(rightLeg);
    rightLeg.parent = rootMesh;
    rightLeg.position = new Vector3(0.30, -1.22, 0);
    rightLeg.material = createLowPolyMaterial('barbRightLegMat', skinTone, scene);

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

    // Kneecap detail on each leg
    for (const leg of [leftLeg, rightLeg]) {
        const kneeCap = MeshBuilder.CreatePolyhedron(`barbKnee_${leg.name}`, {
            type: 1,
            size: 0.07
        }, scene);
        makeFlatShaded(kneeCap);
        kneeCap.parent = leg;
        kneeCap.position = new Vector3(0, 0.12, 0.24);
        kneeCap.scaling = new Vector3(1.3, 0.9, 0.5);
        kneeCap.material = createLowPolyMaterial(`barbKneeMat_${leg.name}`, skinDark, scene);
    }

    // Rough leather boots (low-tess oval columns stretched forward for foot shape)
    const leftBoot = MeshBuilder.CreateCylinder('barbBootL', {
        height: 0.30,
        diameter: 0.44,
        tessellation: 6,
    }, scene);
    makeFlatShaded(leftBoot);
    leftBoot.parent = leftLeg;
    leftBoot.position = new Vector3(0, -0.55, 0.06);
    leftBoot.scaling = new Vector3(1.0, 1.0, 0.52 / 0.44); // stretch forward for foot
    leftBoot.material = createLowPolyMaterial('barbBootLMat', leather, scene);

    const rightBoot = MeshBuilder.CreateCylinder('barbBootR', {
        height: 0.30,
        diameter: 0.44,
        tessellation: 6,
    }, scene);
    makeFlatShaded(rightBoot);
    rightBoot.parent = rightLeg;
    rightBoot.position = new Vector3(0, -0.55, 0.06);
    rightBoot.material = createLowPolyMaterial('barbBootRMat', leather, scene);

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

    return {
        rootMesh,
        head,
        swordArm,
        shieldArm,
        leftLeg,
        rightLeg,
        axeHead,
        kiltFlaps,
        beltTrophy,
        snarlJaw,
        chestPulseGroup,
    };
}
