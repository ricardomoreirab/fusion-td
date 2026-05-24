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

    // Pec / chest muscle definition — slightly darker plane front center
    const pecLeft = MeshBuilder.CreateBox('barbPecL', {
        width: 0.52,
        height: 0.45,
        depth: 0.06
    }, scene);
    makeFlatShaded(pecLeft);
    pecLeft.parent = rootMesh;
    pecLeft.position = new Vector3(-0.22, 0.28, 0.48);
    pecLeft.material = createLowPolyMaterial('barbPecLMat', skinDark, scene);

    const pecRight = MeshBuilder.CreateBox('barbPecR', {
        width: 0.52,
        height: 0.45,
        depth: 0.06
    }, scene);
    makeFlatShaded(pecRight);
    pecRight.parent = rootMesh;
    pecRight.position = new Vector3(0.22, 0.28, 0.48);
    pecRight.material = createLowPolyMaterial('barbPecRMat', skinDark, scene);

    // War paint stripe across chest — red emissive diagonal stripe
    const warpaint = MeshBuilder.CreateBox('barbWarpaint', {
        width: 0.80,
        height: 0.07,
        depth: 0.05
    }, scene);
    makeFlatShaded(warpaint);
    warpaint.parent = rootMesh;
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
    }

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

    // Two curved horns out the sides (made from cones)
    for (let side = -1; side <= 1; side += 2) {
        const horn = MeshBuilder.CreateCylinder(`barbHorn${side}`, {
            height: 0.45,
            diameterTop: 0.02,
            diameterBottom: 0.14,
            tessellation: 5
        }, scene);
        makeFlatShaded(horn);
        horn.parent = head;
        horn.position = new Vector3(side * 0.28, 0.26, 0);
        horn.rotation.z = side * 0.75; // angle outward
        horn.rotation.x = -0.15;       // slight forward tilt
        horn.material = createLowPolyMaterial(`barbHornMat${side}`, hornColor, scene);
    }

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

    // Clenched fist (small box at end of arm)
    const fist = MeshBuilder.CreateBox('barbFist', {
        width: 0.34,
        height: 0.28,
        depth: 0.34
    }, scene);
    makeFlatShaded(fist);
    fist.parent = shieldArm;
    fist.position = new Vector3(0, -0.60, 0.04);
    fist.material = createLowPolyMaterial('barbFistMat', skinDark, scene);

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
        beltTrophy: null,
        snarlJaw: null,
        chestPulseGroup: null,
    };
}
