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

    // Berserker palette additions
    const boneWhite   = new Color3(0.92, 0.88, 0.78);
    const bloodRed    = new Color3(0.55, 0.06, 0.05);
    const darkLeather = new Color3(0.18, 0.10, 0.04);

    // --- Body: wide muscular bare-chested torso ---
    const rootMesh = MeshBuilder.CreateBox('barbBody', {
        width: 1.45,
        height: 1.70,
        depth: 0.90
    }, scene);
    makeFlatShaded(rootMesh);
    rootMesh.position = position.clone();
    rootMesh.position.y += 2.0;
    rootMesh.material = createLowPolyMaterial('barbBodyMat', skinTone, scene);

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
    const swordArm = MeshBuilder.CreateBox('barbAxeArm', {
        width: 0.38,
        height: 1.25,
        depth: 0.38
    }, scene);
    makeFlatShaded(swordArm);
    swordArm.parent = rootMesh;
    swordArm.position = new Vector3(0.92, 0.02, 0.05);
    swordArm.material = createLowPolyMaterial('barbAxeArmMat', skinTone, scene);

    // Bracer on axe-arm forearm (dark leather)
    const axeBracer = MeshBuilder.CreateBox('barbAxeBracer', {
        width: 0.42,
        height: 0.26,
        depth: 0.42
    }, scene);
    makeFlatShaded(axeBracer);
    axeBracer.parent = swordArm;
    axeBracer.position = new Vector3(0, -0.38, 0);
    axeBracer.material = createLowPolyMaterial('barbAxeBracerMat', leather, scene);

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

    // --- Battle axe held in the dominant hand ---
    // Shaft: long dark wood cylinder
    const axeShaft = MeshBuilder.CreateCylinder('barbAxeShaft', {
        height: 1.40,
        diameterTop: 0.10,
        diameterBottom: 0.10,
        tessellation: 6
    }, scene);
    makeFlatShaded(axeShaft);
    axeShaft.parent = swordArm;
    axeShaft.position = new Vector3(0.05, -0.85, 0.18);
    axeShaft.rotation.z = 0.08;
    axeShaft.material = createLowPolyMaterial('barbAxeShaftMat', wood, scene);

    // Leather grip wrap (short dark ring at the grip point)
    const gripWrap = MeshBuilder.CreateCylinder('barbAxeGrip', {
        height: 0.22,
        diameterTop: 0.14,
        diameterBottom: 0.14,
        tessellation: 6
    }, scene);
    makeFlatShaded(gripWrap);
    gripWrap.parent = axeShaft;
    gripWrap.position = new Vector3(0, 0.15, 0);
    gripWrap.material = createLowPolyMaterial('barbAxeGripMat', leather, scene);

    // Axe head body (flattened steel box — the main blade mass)
    const axeHead = MeshBuilder.CreateBox('barbAxeHead', {
        width: 0.42,
        height: 0.52,
        depth: 0.12
    }, scene);
    makeFlatShaded(axeHead);
    axeHead.parent = axeShaft;
    axeHead.position = new Vector3(0.14, 0.64, 0);
    axeHead.rotation.z = 0.15; // slight forward lean
    axeHead.material = createLowPolyMaterial('barbAxeHeadMat', steelGrey, scene);

    // Leading edge of axe blade (bright thin strip — the sharpened edge)
    const axeEdge = MeshBuilder.CreateBox('barbAxeEdge', {
        width: 0.06,
        height: 0.52,
        depth: 0.14
    }, scene);
    makeFlatShaded(axeEdge);
    axeEdge.parent = axeHead;
    axeEdge.position = new Vector3(0.22, 0, 0);
    axeEdge.material = createEmissiveMaterial('barbAxeEdgeMat', steelSharp, 0.35, scene);

    // Back spike of axe head (small spike on the non-blade side)
    const axeBackSpike = MeshBuilder.CreateCylinder('barbAxeBackSpike', {
        height: 0.20,
        diameterTop: 0.02,
        diameterBottom: 0.08,
        tessellation: 4
    }, scene);
    makeFlatShaded(axeBackSpike);
    axeBackSpike.parent = axeHead;
    axeBackSpike.position = new Vector3(-0.22, 0.10, 0);
    axeBackSpike.rotation.z = Math.PI / 2;
    axeBackSpike.material = createLowPolyMaterial('barbAxeBackSpikeMat', steelGrey, scene);

    // Pommel cap at bottom of shaft (small polyhedron)
    const pommel = MeshBuilder.CreatePolyhedron('barbAxePommel', {
        type: 1, // octahedron
        size: 0.07
    }, scene);
    makeFlatShaded(pommel);
    pommel.parent = axeShaft;
    pommel.position = new Vector3(0, -0.72, 0);
    pommel.material = createLowPolyMaterial('barbAxePommelMat', steelGrey, scene);

    // --- Left arm (off-hand / clenched fist) ---
    const shieldArm = MeshBuilder.CreateBox('barbOffArm', {
        width: 0.38,
        height: 1.20,
        depth: 0.38
    }, scene);
    makeFlatShaded(shieldArm);
    shieldArm.parent = rootMesh;
    shieldArm.position = new Vector3(-0.92, 0.02, 0.05);
    shieldArm.material = createLowPolyMaterial('barbOffArmMat', skinTone, scene);

    // Bracer on off-arm
    const offBracer = MeshBuilder.CreateBox('barbOffBracer', {
        width: 0.42,
        height: 0.26,
        depth: 0.42
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

    // --- Bare legs (skin tone, knee cap detail) ---
    const leftLeg = MeshBuilder.CreateBox('barbLeftLeg', {
        width: 0.40,
        height: 1.05,
        depth: 0.40
    }, scene);
    makeFlatShaded(leftLeg);
    leftLeg.parent = rootMesh;
    leftLeg.position = new Vector3(-0.30, -1.22, 0);
    leftLeg.material = createLowPolyMaterial('barbLeftLegMat', skinTone, scene);

    const rightLeg = MeshBuilder.CreateBox('barbRightLeg', {
        width: 0.40,
        height: 1.05,
        depth: 0.40
    }, scene);
    makeFlatShaded(rightLeg);
    rightLeg.parent = rootMesh;
    rightLeg.position = new Vector3(0.30, -1.22, 0);
    rightLeg.material = createLowPolyMaterial('barbRightLegMat', skinTone, scene);

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

    // Rough leather boots (taller than standard, dark leather)
    const leftBoot = MeshBuilder.CreateBox('barbBootL', {
        width: 0.44,
        height: 0.30,
        depth: 0.52
    }, scene);
    makeFlatShaded(leftBoot);
    leftBoot.parent = leftLeg;
    leftBoot.position = new Vector3(0, -0.55, 0.06);
    leftBoot.material = createLowPolyMaterial('barbBootLMat', leather, scene);

    const rightBoot = MeshBuilder.CreateBox('barbBootR', {
        width: 0.44,
        height: 0.30,
        depth: 0.52
    }, scene);
    makeFlatShaded(rightBoot);
    rightBoot.parent = rightLeg;
    rightBoot.position = new Vector3(0, -0.55, 0.06);
    rightBoot.material = createLowPolyMaterial('barbBootRMat', leather, scene);

    return {
        rootMesh,
        head,
        swordArm,
        shieldArm,
        leftLeg,
        rightLeg,
        axeHead,
        kiltFlaps: [],
        beltTrophy,
        snarlJaw,
        chestPulseGroup,
    };
}
