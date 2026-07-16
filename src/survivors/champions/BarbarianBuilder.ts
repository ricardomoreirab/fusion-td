import { Vector3, Mesh, Color } from 'three';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../engine/rendering/LowPolyMaterial';
import { createBox, createCylinder, createSphere, createPolyhedron } from '../../engine/three/primitives';
import type { SceneHost } from '../../engine/three/SceneHost';

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

export function buildBarbarianMesh(scene: SceneHost, position: Vector3): BarbarianMeshParts {
    // ===== Palette =====
    const skinTone    = new Color(0.78, 0.55, 0.40);
    const skinDark    = new Color(0.62, 0.42, 0.30);
    const leather     = new Color(0.30, 0.18, 0.08);
    const fur         = new Color(0.28, 0.22, 0.18);
    const furLight    = new Color(0.42, 0.34, 0.26);
    const steelGrey   = new Color(0.65, 0.65, 0.70);
    const steelSharp  = new Color(0.82, 0.82, 0.86);
    const wood        = new Color(0.30, 0.18, 0.08);
    const warPaint    = new Color(0.75, 0.12, 0.10);
    const hornColor   = new Color(0.50, 0.42, 0.28);

    // Berserker palette additions
    const boneWhite   = new Color(0.92, 0.88, 0.78);
    const bloodRed    = new Color(0.55, 0.06, 0.05);
    const darkLeather = new Color(0.18, 0.10, 0.04);

    // --- Body: wide muscular bare-chested torso ---
    // rootMesh is an invisible parent so we can z-scale the visible torso (`barbBodyVis`)
    // into an oval cross-section without squishing every other child of the body.
    const rootMesh = new Mesh();
    rootMesh.name = 'barbBody';
    scene.scene.add(rootMesh);
    rootMesh.position.copy(position);
    rootMesh.position.y += 2.0;

    const torsoVisible = createCylinder('barbBodyVis', {
        height: 1.70,
        diameterTop: 1.30,     // wider at chest
        diameterBottom: 1.05,  // narrower at waist (slight V-taper)
        tessellation: 8,
    });
    makeFlatShaded(torsoVisible);
    rootMesh.add(torsoVisible);
    torsoVisible.scale.set(1.0, 1.0, 0.72); // compress front-to-back depth
    torsoVisible.material = createLowPolyMaterial('barbBodyMat', skinTone);

    // Chest-pulse parent: groups pecs + chest war-paint stripe so the breath
    // pulse animation can scale them together. Empty Mesh — no geometry.
    const chestPulseGroup = new Mesh();
    chestPulseGroup.name = 'barbChestGroup';
    rootMesh.add(chestPulseGroup);
    chestPulseGroup.position.set(0, 0, 0);

    // Pec / chest muscle definition — slightly darker plane front center
    const pecLeft = createBox('barbPecL', {
        width: 0.52,
        height: 0.45,
        depth: 0.06
    });
    makeFlatShaded(pecLeft);
    chestPulseGroup.add(pecLeft);
    pecLeft.position.set(-0.22, 0.28, 0.48);
    pecLeft.material = createLowPolyMaterial('barbPecLMat', skinDark);

    const pecRight = createBox('barbPecR', {
        width: 0.52,
        height: 0.45,
        depth: 0.06
    });
    makeFlatShaded(pecRight);
    chestPulseGroup.add(pecRight);
    pecRight.position.set(0.22, 0.28, 0.48);
    pecRight.material = createLowPolyMaterial('barbPecRMat', skinDark);

    // War paint stripe across chest — red emissive diagonal stripe
    const warpaint = createBox('barbWarpaint', {
        width: 0.80,
        height: 0.07,
        depth: 0.05
    });
    makeFlatShaded(warpaint);
    chestPulseGroup.add(warpaint);
    warpaint.position.set(0, 0.05, 0.48);
    warpaint.rotation.z = 0.35; // diagonal slash
    warpaint.material = createEmissiveMaterial('barbWarpaintMat', warPaint, 0.7);

    // Leather belt across waist
    const belt = createBox('barbBelt', {
        width: 1.30,
        height: 0.18,
        depth: 0.95
    });
    makeFlatShaded(belt);
    rootMesh.add(belt);
    belt.position.set(0, -0.55, 0);
    belt.material = createLowPolyMaterial('barbBeltMat', leather);

    // Belt metal clasp (center front)
    const clasp = createBox('barbClasp', {
        width: 0.20,
        height: 0.14,
        depth: 0.06
    });
    makeFlatShaded(clasp);
    belt.add(clasp);
    clasp.position.set(0, 0, 0.50);
    clasp.material = createEmissiveMaterial('barbClaspMat', steelGrey, 0.3);

    // ===== Belt decorations =====

    // Trophy skull — hung from belt at front-left
    const skullCord = createCylinder('barbTrophyCord', {
        height: 0.18,
        diameterTop: 0.02,
        diameterBottom: 0.02,
        tessellation: 5,
    });
    belt.add(skullCord);
    skullCord.position.set(-0.40, -0.18, 0.45);
    skullCord.material = createLowPolyMaterial('barbTrophyCordMat', darkLeather);

    const beltTrophy = createSphere('barbTrophySkull', {
        diameter: 0.18,
        segments: 4,
    });
    makeFlatShaded(beltTrophy);
    skullCord.add(beltTrophy);
    beltTrophy.position.set(0, -0.12, 0);
    beltTrophy.material = createLowPolyMaterial('barbTrophySkullMat', boneWhite);

    const skullJaw = createBox('barbTrophyJaw', {
        width: 0.12,
        height: 0.05,
        depth: 0.09,
    });
    makeFlatShaded(skullJaw);
    beltTrophy.add(skullJaw);
    skullJaw.position.set(0, -0.07, 0.02);
    skullJaw.material = createLowPolyMaterial('barbTrophyJawMat', new Color(0.85, 0.80, 0.70));

    // Two eye-socket holes — small black emissive boxes
    for (let e = -1; e <= 1; e += 2) {
        const socket = createBox(`barbTrophySocket${e}`, {
            width: 0.03,
            height: 0.03,
            depth: 0.02,
        });
        beltTrophy.add(socket);
        socket.position.set(e * 0.04, 0.01, 0.08);
        socket.material = createEmissiveMaterial(`barbTrophySocketMat${e}`,
            new Color(0.05, 0.05, 0.05), 0.0);
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
        const dangleCord = createCylinder(`barbDangleCord${d}`, {
            height: 0.06,
            diameterTop: 0.015,
            diameterBottom: 0.015,
            tessellation: 4,
        });
        belt.add(dangleCord);
        dangleCord.position.set(x, y - 0.03, z);
        dangleCord.material = createLowPolyMaterial(`barbDangleCordMat${d}`, darkLeather);

        const boneFrag = createCylinder(`barbDangleBone${d}`, {
            height: dangleLengths[d],
            diameterTop: 0.03,
            diameterBottom: 0.04,
            tessellation: 5,
        });
        makeFlatShaded(boneFrag);
        dangleCord.add(boneFrag);
        boneFrag.position.set(0, -dangleLengths[d] * 0.5 - 0.03, 0);
        boneFrag.material = createLowPolyMaterial(`barbDangleBoneMat${d}`, boneWhite);
    }

    // Iron studs — 6 small studs along the belt's front face
    for (let s = 0; s < 6; s++) {
        const stud = createBox(`barbBeltStud${s}`, {
            width: 0.06,
            height: 0.06,
            depth: 0.03,
        });
        makeFlatShaded(stud);
        belt.add(stud);
        stud.position.set(-0.50 + s * 0.20, 0, 0.49);
        stud.material = createEmissiveMaterial(`barbBeltStudMat${s}`, steelGrey, 0.3);
    }

    // Fur kilt — multiple trapezoid-ish flat boxes angled around the waist
    const kiltFlaps: Mesh[] = [];
    const kiltAngles = [-0.28, -0.14, 0, 0.14, 0.28];
    for (let i = 0; i < kiltAngles.length; i++) {
        const kiltFlap = createBox(`barbKilt${i}`, {
            width: 0.28,
            height: 0.55,
            depth: 0.08
        });
        makeFlatShaded(kiltFlap);
        rootMesh.add(kiltFlap);
        kiltFlap.position.set(kiltAngles[i] * 3.2, -0.95, 0.35 - Math.abs(kiltAngles[i]) * 0.5);
        kiltFlap.rotation.y = kiltAngles[i] * 0.6;
        kiltFlap.material = createLowPolyMaterial(`barbKiltMat${i}`,
            i % 2 === 0 ? fur : furLight);
        kiltFlaps.push(kiltFlap);
    }
    // Back fur flaps
    for (let i = 0; i < 3; i++) {
        const backFlap = createBox(`barbKiltBack${i}`, {
            width: 0.30,
            height: 0.50,
            depth: 0.07
        });
        makeFlatShaded(backFlap);
        rootMesh.add(backFlap);
        backFlap.position.set((i - 1) * 0.32, -0.92, -0.38);
        backFlap.rotation.y = (i - 1) * 0.15;
        backFlap.material = createLowPolyMaterial(`barbKiltBackMat${i}`, fur);
    }

    // Bone bead chain — 5 beads strung in a low arc across the kilt front.
    // Parented to belt so it's independent of flap sway.
    const beadCount = 5;
    for (let b = 0; b < beadCount; b++) {
        const t = b / (beadCount - 1);
        const xPos = (t - 0.5) * 0.85;
        // Slight downward arc — middle beads hang lower than ends.
        const arcSag = -Math.sin(t * Math.PI) * 0.08;
        const bead = createPolyhedron(`barbKiltBead${b}`, {
            type: 1,
            size: 0.04,
        });
        makeFlatShaded(bead);
        belt.add(bead);
        bead.position.set(xPos, -0.22 + arcSag, 0.48);
        bead.scale.set(1.0, 1.3, 1.0);
        bead.material = createLowPolyMaterial(`barbKiltBeadMat${b}`, boneWhite);
    }

    // Crossing leather strap bands on the kilt — an X across the front.
    for (let s = 0; s < 2; s++) {
        const strap = createBox(`barbKiltStrap${s}`, {
            width: 1.10,
            height: 0.05,
            depth: 0.04,
        });
        makeFlatShaded(strap);
        rootMesh.add(strap);
        strap.position.set(0, -1.00, 0.42);
        strap.rotation.z = s === 0 ? 0.5 : -0.5;
        strap.material = createLowPolyMaterial(`barbKiltStrapMat${s}`, darkLeather);
    }

    // --- Broad shoulders: large shoulder cap bumps ---
    for (let side = -1; side <= 1; side += 2) {
        const shoulder = createSphere(`barbShoulder${side}`, {
            diameter: 0.52,
            segments: 4
        });
        makeFlatShaded(shoulder);
        rootMesh.add(shoulder);
        shoulder.position.set(side * 0.86, 0.72, 0);
        shoulder.scale.set(0.85, 0.70, 0.85);
        shoulder.material = createLowPolyMaterial(`barbShoulderMat${side}`, skinTone);

        // Shoulder scar / definition mark
        const scarMark = createBox(`barbShoulderScar${side}`, {
            width: 0.12,
            height: 0.04,
            depth: 0.04
        });
        makeFlatShaded(scarMark);
        shoulder.add(scarMark);
        scarMark.position.set(0, -0.10, 0.20);
        scarMark.rotation.z = 0.3;
        scarMark.material = createEmissiveMaterial(`barbShoulderScarMat${side}`, warPaint, 0.25);

        // Two diagonal blood-red scars on the TOP of the shoulder (top-down readable)
        for (let s = 0; s < 2; s++) {
            const topScar = createBox(`barbShoulderTopScar${side}_${s}`, {
                width: 0.22,
                height: 0.025,
                depth: 0.04,
            });
            makeFlatShaded(topScar);
            shoulder.add(topScar);
            topScar.position.set(0.02 + s * 0.08, 0.24, -0.02 + s * 0.06);
            topScar.rotation.y = 0.5 + s * 0.3;
            topScar.material = createEmissiveMaterial(`barbShoulderTopScarMat${side}_${s}`,
                bloodRed, 0.5);
        }

        // Back-of-shoulder war-paint stripe — diagonal, fans outward when viewed from above
        const backPaint = createBox(`barbBackPaint${side}`, {
            width: 0.06,
            height: 0.30,
            depth: 0.45,
        });
        makeFlatShaded(backPaint);
        shoulder.add(backPaint);
        backPaint.position.set(-0.02, -0.05, -0.22);
        backPaint.rotation.x = 0.4 * side;
        backPaint.rotation.z = 0.3 * side;
        backPaint.material = createEmissiveMaterial(`barbBackPaintMat${side}`,
            bloodRed, 0.6);

        // Torn pelt scrap over the shoulder
        const pelt = createBox(`barbShoulderPelt${side}`, {
            width: 0.45,
            height: 0.30,
            depth: 0.50,
        });
        makeFlatShaded(pelt);
        shoulder.add(pelt);
        pelt.position.set(side * 0.05, 0.15, 0);
        pelt.material = createLowPolyMaterial(`barbShoulderPeltMat${side}`, fur);

        // 2 notch boxes carved into the bottom edge of the pelt (visual tears)
        for (let n = 0; n < 2; n++) {
            const notch = createBox(`barbPeltNotch${side}_${n}`, {
                width: 0.10,
                height: 0.12,
                depth: 0.08,
            });
            makeFlatShaded(notch);
            pelt.add(notch);
            notch.position.set((n - 0.5) * 0.20, -0.18, 0.20 - n * 0.10);
            notch.material = createLowPolyMaterial(`barbPeltNotchMat${side}_${n}`, furLight);
        }

        // 3 bone spikes poking through the pelt
        for (let b = 0; b < 3; b++) {
            const spike = createCylinder(`barbPeltSpike${side}_${b}`, {
                height: 0.22,
                diameterTop: 0.01,
                diameterBottom: 0.05,
                tessellation: 4,
            });
            makeFlatShaded(spike);
            pelt.add(spike);
            spike.position.set((b - 1) * 0.14, 0.13, 0.05);
            spike.rotation.z = (b - 1) * 0.25;
            spike.rotation.x = -0.2;
            spike.material = createLowPolyMaterial(`barbPeltSpikeMat${side}_${b}`, boneWhite);
        }
    }

    // Bone necklace — ring of 8 bone polyhedra at the neck base.
    // Parented to rootMesh so it stays put when the head turns during look-around.
    const neckBoneCount = 8;
    for (let i = 0; i < neckBoneCount; i++) {
        const angle = (i / neckBoneCount) * Math.PI * 2;
        const necklaceBone = createPolyhedron(`barbNeckBone${i}`, {
            type: 1,
            size: 0.045,
        });
        makeFlatShaded(necklaceBone);
        rootMesh.add(necklaceBone);
        necklaceBone.position.set(
            Math.cos(angle) * 0.36,
            0.95,
            Math.sin(angle) * 0.32,
        );
        necklaceBone.rotation.y = angle;
        necklaceBone.scale.set(1.0, 1.4, 1.0);
        necklaceBone.material = createLowPolyMaterial(`barbNeckBoneMat${i}`, boneWhite);
    }

    // Jagged battered armor plate — only on the right shoulder (asymmetric).
    const armorPlate = createBox('barbArmorPlate', {
        width: 0.42,
        height: 0.36,
        depth: 0.10,
    });
    makeFlatShaded(armorPlate);
    rootMesh.add(armorPlate);
    armorPlate.position.set(0.88, 0.70, 0.18);
    armorPlate.rotation.z = -0.35;
    armorPlate.rotation.y = 0.20;
    // Slightly darker than the steelGrey to read as battered/weathered.
    const armorDark = new Color(0.50, 0.50, 0.55);
    armorPlate.material = createLowPolyMaterial('barbArmorPlateMat', armorDark);

    // Chipped corner — small darker polyhedron cut out the bottom-front
    const armorChip = createPolyhedron('barbArmorChip', {
        type: 1,
        size: 0.06,
    });
    makeFlatShaded(armorChip);
    armorPlate.add(armorChip);
    armorChip.position.set(0.18, -0.14, 0.04);
    armorChip.material = createLowPolyMaterial('barbArmorChipMat', new Color(0.35, 0.35, 0.38));

    // --- Head: horned fur-trimmed skull cap + face ---
    // Skull cap base (flat-shaded sphere)
    const head = createSphere('barbHead', {
        diameter: 0.58,
        segments: 5
    });
    makeFlatShaded(head);
    rootMesh.add(head);
    head.position.set(0, 1.15, 0.04);
    head.material = createLowPolyMaterial('barbHeadMat', skinTone);

    // Fur-trim skull cap (sitting on top of head)
    const helmCap = createCylinder('barbHelmCap', {
        height: 0.30,
        diameterTop: 0.45,
        diameterBottom: 0.58,
        tessellation: 6
    });
    makeFlatShaded(helmCap);
    head.add(helmCap);
    helmCap.position.set(0, 0.20, 0);
    helmCap.material = createLowPolyMaterial('barbHelmCapMat', fur);

    // 3 bone fragments poking up through the helm cap (tooth-like)
    const bonePositions: Array<[number, number, number]> = [
        [-0.10, 0.15, 0.05],
        [ 0.04, 0.18, -0.06],
        [ 0.12, 0.13, 0.08],
    ];
    for (let i = 0; i < bonePositions.length; i++) {
        const [x, y, z] = bonePositions[i];
        const boneFrag = createPolyhedron(`barbHelmBone${i}`, {
            type: 1,
            size: 0.05,
        });
        makeFlatShaded(boneFrag);
        helmCap.add(boneFrag);
        boneFrag.position.set(x, y, z);
        boneFrag.scale.set(0.7, 1.6, 0.7);
        boneFrag.material = createLowPolyMaterial(`barbHelmBoneMat${i}`, boneWhite);
    }

    // War-paint slash across helmet top — front-to-back, top-down readable
    const helmPaint = createBox('barbHelmPaint', {
        width: 0.10,
        height: 0.04,
        depth: 0.45,
    });
    makeFlatShaded(helmPaint);
    helmCap.add(helmPaint);
    helmPaint.position.set(0, 0.16, 0);
    helmPaint.rotation.y = 0.15;
    helmPaint.material = createEmissiveMaterial('barbHelmPaintMat', bloodRed, 0.7);

    // Asymmetric horns: tall straight on left, chipped/broken on right.
    const hornLeft = createCylinder('barbHornLeft', {
        height: 0.60,
        diameterTop: 0.02,
        diameterBottom: 0.14,
        tessellation: 5,
    });
    makeFlatShaded(hornLeft);
    head.add(hornLeft);
    hornLeft.position.set(-0.28, 0.30, 0);
    hornLeft.rotation.z = -0.75;
    hornLeft.rotation.x = -0.15;
    hornLeft.material = createLowPolyMaterial('barbHornLeftMat', hornColor);

    const hornRight = createCylinder('barbHornRight', {
        height: 0.35,
        diameterTop: 0.10,
        diameterBottom: 0.14,
        tessellation: 5,
    });
    makeFlatShaded(hornRight);
    head.add(hornRight);
    hornRight.position.set(0.28, 0.22, 0);
    hornRight.rotation.z = 0.75;
    hornRight.rotation.x = -0.15;
    hornRight.material = createLowPolyMaterial('barbHornRightMat', hornColor);

    // Jagged break cap on the right horn — short blunt polyhedron on top
    const hornRightBreak = createPolyhedron('barbHornRightBreak', {
        type: 1,
        size: 0.05,
    });
    makeFlatShaded(hornRightBreak);
    hornRight.add(hornRightBreak);
    hornRightBreak.position.set(0, 0.20, 0);
    hornRightBreak.material = createLowPolyMaterial('barbHornRightBreakMat', boneWhite);

    // Eyes — glowing angry ember eyes
    for (let side = -1; side <= 1; side += 2) {
        const eye = createBox(`barbEye${side}`, {
            width: 0.08,
            height: 0.04,
            depth: 0.04
        });
        makeFlatShaded(eye);
        head.add(eye);
        eye.position.set(side * 0.10, -0.02, 0.29);
        eye.material = createEmissiveMaterial(`barbEyeMat${side}`, new Color(0.95, 0.40, 0.10), 0.9);
    }

    // Beard — small box below the face
    const beard = createBox('barbBeard', {
        width: 0.28,
        height: 0.18,
        depth: 0.16
    });
    makeFlatShaded(beard);
    head.add(beard);
    beard.position.set(0, -0.22, 0.20);
    beard.material = createLowPolyMaterial('barbBeardMat', fur);

    // Snarl jaw piece — small box jutting forward beneath the beard.
    // Stored on the parts struct so animation can twitch it.
    const snarlJaw = createBox('barbSnarlJaw', {
        width: 0.20,
        height: 0.10,
        depth: 0.16,
    });
    makeFlatShaded(snarlJaw);
    head.add(snarlJaw);
    snarlJaw.position.set(0, -0.34, 0.24);
    snarlJaw.material = createLowPolyMaterial('barbSnarlJawMat', skinDark);

    // Teeth row — 3 small bone-white teeth boxes inside the jaw
    for (let t = 0; t < 3; t++) {
        const tooth = createBox(`barbSnarlTooth${t}`, {
            width: 0.04,
            height: 0.05,
            depth: 0.03,
        });
        makeFlatShaded(tooth);
        snarlJaw.add(tooth);
        tooth.position.set((t - 1) * 0.05, 0.03, 0.07);
        tooth.material = createEmissiveMaterial(`barbSnarlToothMat${t}`, boneWhite, 0.2);
    }

    // --- Right arm (axe arm) — thick upper arm + bracer on forearm ---
    const swordArm = createCylinder('barbAxeArm', {
        height: 1.25,
        diameter: 0.38,
        tessellation: 6,
    });
    makeFlatShaded(swordArm);
    rootMesh.add(swordArm);
    swordArm.position.set(0.92, 0.02, 0.05);
    swordArm.material = createLowPolyMaterial('barbAxeArmMat', skinTone);

    // Bracer on axe-arm forearm (dark leather)
    const axeBracer = createCylinder('barbAxeBracer', {
        height: 0.26,
        diameter: 0.42,
        tessellation: 6,
    });
    makeFlatShaded(axeBracer);
    swordArm.add(axeBracer);
    axeBracer.position.set(0, -0.38, 0);
    axeBracer.material = createLowPolyMaterial('barbAxeBracerMat', leather);

    // Axe-hand wrap — small bandage at the gripping hand
    const axeHandWrap = createCylinder('barbAxeHandWrap', {
        height: 0.18,
        diameter: 0.34,
        tessellation: 6,
    });
    makeFlatShaded(axeHandWrap);
    swordArm.add(axeHandWrap);
    axeHandWrap.position.set(0, -0.55, 0.08);
    axeHandWrap.material = createLowPolyMaterial('barbAxeHandWrapMat', boneWhite);

    // Red blood streak on the axe hand wrap
    const axeHandBlood = createBox('barbAxeHandBlood', {
        width: 0.18,
        height: 0.03,
        depth: 0.16,
    });
    makeFlatShaded(axeHandBlood);
    axeHandWrap.add(axeHandBlood);
    axeHandBlood.position.set(0.04, 0.10, 0.08);
    axeHandBlood.material = createEmissiveMaterial('barbAxeHandBloodMat', bloodRed, 0.5);

    // ===== Greatcleaver — oversized double-bit berserker axe =====

    // Shaft — slightly longer than before
    const axeShaft = createCylinder('barbAxeShaft', {
        height: 1.55,
        diameterTop: 0.10,
        diameterBottom: 0.10,
        tessellation: 6,
    });
    makeFlatShaded(axeShaft);
    swordArm.add(axeShaft);
    axeShaft.position.set(0.05, -0.95, 0.18);
    axeShaft.rotation.z = 0.08;
    axeShaft.material = createLowPolyMaterial('barbAxeShaftMat', wood);

    // 3 bone rings wrapping the shaft above the grip
    for (let r = 0; r < 3; r++) {
        const ring = createCylinder(`barbAxeShaftRing${r}`, {
            height: 0.05,
            diameterTop: 0.13,
            diameterBottom: 0.13,
            tessellation: 6,
        });
        makeFlatShaded(ring);
        axeShaft.add(ring);
        ring.position.set(0, 0.30 + r * 0.10, 0);
        ring.material = createLowPolyMaterial(`barbAxeShaftRingMat${r}`, boneWhite);
    }

    // Leather grip wrap (unchanged in spirit)
    const gripWrap = createCylinder('barbAxeGrip', {
        height: 0.22,
        diameterTop: 0.14,
        diameterBottom: 0.14,
        tessellation: 6,
    });
    makeFlatShaded(gripWrap);
    axeShaft.add(gripWrap);
    gripWrap.position.set(0, 0.15, 0);
    gripWrap.material = createLowPolyMaterial('barbAxeGripMat', leather);

    // ===== Main axe head body — ~50% larger than before =====
    const axeHead = createBox('barbAxeHead', {
        width: 0.65,
        height: 0.75,
        depth: 0.18,
    });
    makeFlatShaded(axeHead);
    axeShaft.add(axeHead);
    axeHead.position.set(0.18, 0.72, 0);
    axeHead.rotation.z = 0.15;
    axeHead.material = createLowPolyMaterial('barbAxeHeadMat', steelGrey);

    // Jagged tooth edge — 3 stacked notched boxes of varying widths along the cutting side
    const toothWidths = [0.10, 0.06, 0.08];
    const toothHeights = [0.26, 0.22, 0.24];
    const toothYs = [-0.22, 0.00, 0.22];
    for (let t = 0; t < 3; t++) {
        const tooth = createBox(`barbAxeTooth${t}`, {
            width: toothWidths[t],
            height: toothHeights[t],
            depth: 0.20,
        });
        makeFlatShaded(tooth);
        axeHead.add(tooth);
        tooth.position.set(0.32 + (t % 2) * 0.02, toothYs[t], 0);
        tooth.material = createEmissiveMaterial(`barbAxeToothMat${t}`, steelSharp, 0.35);
    }

    // Second (back) blade — smaller mirror blade on the spike side, creates double-bit silhouette
    const backBlade = createBox('barbAxeBackBlade', {
        width: 0.45,
        height: 0.40,
        depth: 0.12,
    });
    makeFlatShaded(backBlade);
    axeHead.add(backBlade);
    backBlade.position.set(-0.40, 0.05, 0);
    backBlade.rotation.z = -0.15;
    backBlade.material = createLowPolyMaterial('barbAxeBackBladeMat', steelGrey);

    // 2 jagged teeth on the back blade
    for (let t = 0; t < 2; t++) {
        const backTooth = createBox(`barbAxeBackTooth${t}`, {
            width: 0.08,
            height: 0.18,
            depth: 0.14,
        });
        makeFlatShaded(backTooth);
        backBlade.add(backTooth);
        backTooth.position.set(-0.22, t === 0 ? -0.12 : 0.12, 0);
        backTooth.material = createEmissiveMaterial(`barbAxeBackToothMat${t}`, steelSharp, 0.3);
    }

    // 3 bone inlays along the side face of the main head
    for (let i = 0; i < 3; i++) {
        const inlay = createPolyhedron(`barbAxeInlay${i}`, {
            type: 1,
            size: 0.05,
        });
        makeFlatShaded(inlay);
        axeHead.add(inlay);
        inlay.position.set(-0.05 + i * 0.10, -0.20 + i * 0.20, 0.10);
        inlay.material = createLowPolyMaterial(`barbAxeInlayMat${i}`, boneWhite);
    }

    // 3 blood-drip emissive strips running down the side of the main blade
    for (let d = 0; d < 3; d++) {
        const drip = createBox(`barbAxeBloodDrip${d}`, {
            width: 0.025,
            height: 0.32,
            depth: 0.03,
        });
        makeFlatShaded(drip);
        axeHead.add(drip);
        drip.position.set(0.20 - d * 0.10, -0.10 - d * 0.05, 0.09);
        drip.material = createEmissiveMaterial(`barbAxeBloodDripMat${d}`, bloodRed, 0.6);
    }

    // Skull pommel — replaces the octahedron
    const pommelSkull = createSphere('barbAxePommelSkull', {
        diameter: 0.13,
        segments: 4,
    });
    makeFlatShaded(pommelSkull);
    axeShaft.add(pommelSkull);
    pommelSkull.position.set(0, -0.80, 0);
    pommelSkull.material = createLowPolyMaterial('barbAxePommelSkullMat', boneWhite);

    const pommelJaw = createBox('barbAxePommelJaw', {
        width: 0.09,
        height: 0.04,
        depth: 0.07,
    });
    makeFlatShaded(pommelJaw);
    pommelSkull.add(pommelJaw);
    pommelJaw.position.set(0, -0.06, 0.01);
    pommelJaw.material = createLowPolyMaterial('barbAxePommelJawMat',
        new Color(0.85, 0.80, 0.70));

    // 3 hanging trophy strips dangling from the junction of head and shaft
    const stripLengths = [0.18, 0.25, 0.20];
    for (let s = 0; s < 3; s++) {
        const strip = createBox(`barbAxeTrophyStrip${s}`, {
            width: 0.025,
            height: stripLengths[s],
            depth: 0.025,
        });
        makeFlatShaded(strip);
        axeShaft.add(strip);
        strip.position.set(0.08 + (s - 1) * 0.04, 0.50 - stripLengths[s] * 0.5, 0.05);
        strip.material = createLowPolyMaterial(`barbAxeTrophyStripMat${s}`, darkLeather);

        // Small bone bead at end of strip
        const stripBone = createPolyhedron(`barbAxeTrophyStripBone${s}`, {
            type: 1,
            size: 0.025,
        });
        makeFlatShaded(stripBone);
        strip.add(stripBone);
        stripBone.position.set(0, -stripLengths[s] * 0.5 - 0.02, 0);
        stripBone.material = createLowPolyMaterial(`barbAxeTrophyStripBoneMat${s}`, boneWhite);
    }

    // --- Left arm (off-hand / clenched fist) ---
    const shieldArm = createCylinder('barbOffArm', {
        height: 1.20,
        diameter: 0.38,
        tessellation: 6,
    });
    makeFlatShaded(shieldArm);
    rootMesh.add(shieldArm);
    shieldArm.position.set(-0.92, 0.02, 0.05);
    shieldArm.material = createLowPolyMaterial('barbOffArmMat', skinTone);

    // Bracer on off-arm
    const offBracer = createCylinder('barbOffBracer', {
        height: 0.26,
        diameter: 0.42,
        tessellation: 6,
    });
    makeFlatShaded(offBracer);
    shieldArm.add(offBracer);
    offBracer.position.set(0, -0.38, 0);
    offBracer.material = createLowPolyMaterial('barbOffBracerMat', leather);

    // 2 red emissive scar lines wrapping the off-arm bracer
    for (let i = 0; i < 2; i++) {
        const scar = createBox(`barbOffForearmScar${i}`, {
            width: 0.44,
            height: 0.018,
            depth: 0.10,
        });
        makeFlatShaded(scar);
        offBracer.add(scar);
        scar.position.set(0, 0.05 - i * 0.08, 0.18);
        scar.rotation.y = (i === 0 ? 0.25 : -0.20);
        scar.material = createEmissiveMaterial(`barbOffForearmScarMat${i}`, bloodRed, 0.5);
    }

    // Bloody hand wrap on the off-arm fist
    const offFistWrap = createCylinder('barbOffFistWrap', {
        height: 0.32,
        diameter: 0.38,
        tessellation: 6,
    });
    makeFlatShaded(offFistWrap);
    shieldArm.add(offFistWrap);
    offFistWrap.position.set(0, -0.60, 0.04);
    offFistWrap.material = createLowPolyMaterial('barbOffFistWrapMat', boneWhite);

    // Red blood splotch on the wrap
    const offBloodSplotch = createBox('barbOffBloodSplotch', {
        width: 0.25,
        height: 0.04,
        depth: 0.20,
    });
    makeFlatShaded(offBloodSplotch);
    offFistWrap.add(offBloodSplotch);
    offBloodSplotch.position.set(0.05, 0.16, 0.10);
    offBloodSplotch.rotation.y = 0.4;
    offBloodSplotch.material = createEmissiveMaterial('barbOffBloodSplotchMat',
        bloodRed, 0.5);

    // --- Bare legs (skin tone, knee cap detail) ---
    const leftLeg = createCylinder('barbLeftLeg', {
        height: 1.05,
        diameter: 0.40,
        tessellation: 6,
    });
    makeFlatShaded(leftLeg);
    rootMesh.add(leftLeg);
    leftLeg.position.set(-0.30, -1.22, 0);
    leftLeg.material = createLowPolyMaterial('barbLeftLegMat', skinTone);

    const rightLeg = createCylinder('barbRightLeg', {
        height: 1.05,
        diameter: 0.40,
        tessellation: 6,
    });
    makeFlatShaded(rightLeg);
    rootMesh.add(rightLeg);
    rightLeg.position.set(0.30, -1.22, 0);
    rightLeg.material = createLowPolyMaterial('barbRightLegMat', skinTone);

    // Thigh war-paint stripes — visible on the outside face as the leg lifts.
    for (const leg of [leftLeg, rightLeg]) {
        const isLeft = leg === leftLeg;
        for (let i = 0; i < 2; i++) {
            const stripe = createBox(`barbThighStripe_${leg.name}_${i}`, {
                width: 0.04,
                height: 0.35,
                depth: 0.10,
            });
            makeFlatShaded(stripe);
            leg.add(stripe);
            // Place on outside face of each leg.
            stripe.position.set((isLeft ? -1 : 1) * 0.22, 0.10 + i * 0.10, 0.05 - i * 0.08);
            stripe.rotation.z = (isLeft ? -1 : 1) * 0.15;
            stripe.material = createEmissiveMaterial(`barbThighStripeMat_${leg.name}_${i}`,
                bloodRed, 0.5);
        }
    }

    // Kneecap detail on each leg
    for (const leg of [leftLeg, rightLeg]) {
        const kneeCap = createPolyhedron(`barbKnee_${leg.name}`, {
            type: 1,
            size: 0.07
        });
        makeFlatShaded(kneeCap);
        leg.add(kneeCap);
        kneeCap.position.set(0, 0.12, 0.24);
        kneeCap.scale.set(1.3, 0.9, 0.5);
        kneeCap.material = createLowPolyMaterial(`barbKneeMat_${leg.name}`, skinDark);
    }

    // Rough leather boots (low-tess oval columns stretched forward for foot shape)
    const leftBoot = createCylinder('barbBootL', {
        height: 0.30,
        diameter: 0.44,
        tessellation: 6,
    });
    makeFlatShaded(leftBoot);
    leftLeg.add(leftBoot);
    leftBoot.position.set(0, -0.55, 0.06);
    leftBoot.scale.set(1.0, 1.0, 0.52 / 0.44); // stretch forward for foot
    leftBoot.material = createLowPolyMaterial('barbBootLMat', leather);

    const rightBoot = createCylinder('barbBootR', {
        height: 0.30,
        diameter: 0.44,
        tessellation: 6,
    });
    makeFlatShaded(rightBoot);
    rightLeg.add(rightBoot);
    rightBoot.position.set(0, -0.55, 0.06);
    rightBoot.material = createLowPolyMaterial('barbBootRMat', leather);

    // Calf bandage wraps — wide pale rings just above each boot.
    for (const leg of [leftLeg, rightLeg]) {
        const wrap = createCylinder(`barbCalfWrap_${leg.name}`, {
            height: 0.16,
            diameterTop: 0.46,
            diameterBottom: 0.50,
            tessellation: 6,
        });
        makeFlatShaded(wrap);
        leg.add(wrap);
        wrap.position.set(0, -0.32, 0.04);
        wrap.material = createLowPolyMaterial(`barbCalfWrapMat_${leg.name}`, boneWhite);
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
