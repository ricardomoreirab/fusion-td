/**
 * assets:retarget — bake another rig's animation clips onto a skeleton that
 * shipped without any.
 *
 * `molten_fiend_raw.glb` is a skinned model with ZERO animations, and an enemy
 * that never moves a limb is not shippable. Its skeleton is a 3ds Max Biped, the
 * same family every other character in this project uses, so the clips can come
 * from a rig that HAS them: 26 of the fiend's 34 `Bip001*` bones exist on the
 * Thamuz rig under the same name.
 *
 * ── Why offline and not at runtime ────────────────────────────────────────────
 * The output is an ordinary GLB, so everything downstream (pruneStaticTracks,
 * hideBoneSubtrees, measureGroundOffset, the GLB container cache) sees a normal
 * animated asset and needs no special case. Retargeting at load time would cost
 * every player the work on every boot for a result that never changes.
 *
 * ── What transfers, and why that is the split ─────────────────────────────────
 * Bones are matched by NAME with Sketchfab's `_<index>` suffix stripped — the
 * only part of a name that differs between two exports of the same Biped.
 *
 * ROTATION transfers on every matched bone, ADDITIVELY over each rig's own rest:
 *
 *     target(t) = restTarget · restDonor⁻¹ · donor(t)
 *
 * i.e. "apply the rotation the donor bone made RELATIVE TO ITS OWN REST to the
 * target bone's rest". A straight copy would be wrong here — the two rest poses
 * disagree by up to 92° (a different A-pose, and a different root convention), so
 * copying absolute local rotations would force the fiend into the donor's rest
 * shape and break its silhouette before the animation even started. The additive
 * form reduces to a copy when the two rests agree, so it is never worse.
 *
 * TRANSLATION transfers on the ROOT bone only, because that is the only one
 * carrying motion rather than proportion: everywhere else a bone's translation is
 * its offset from its parent, i.e. the rig's build, and writing the donor's
 * offsets onto the fiend would rebuild the fiend with the donor's proportions.
 * The root's translation is the whole body moving — the death clip drops it 2.05
 * units as the body falls, which a rotation-only transfer would render as a
 * corpse collapsing while standing upright.
 *
 * It transfers as a DISPLACEMENT from the track's own first sample, not as an
 * absolute position and not relative to the node's rest. These exporters pin
 * bones at values their authored rest pose does not hold (the same habit
 * `pruneStaticTracks` exploits at load time), so "sample − rest" is a constant
 * body-sized offset plus the motion, and applying it would teleport the fiend a
 * unit and a half sideways. Referenced to the first sample, a pinned track
 * contributes exactly zero and every clip starts from the fiend's own rest.
 *
 * The displacement is then routed through WORLD space rather than copied between
 * local frames, because the frames do not agree: these two rigs' root bones sit
 * ~80° apart at rest, so the donor's local "down" is not the target's local
 * "down" and a copied fall would travel sideways. Finally it is scaled by the
 * ratio of the two rigs' bone lengths, so a body twice the size falls twice as
 * far and the motion stays proportional to the model.
 *
 * SCALE is dropped, and the tool proves that is lossless: `assertConstant` fails
 * the build if any scale track actually varies.
 *
 * Usage:
 *   npm run assets:retarget            # writes assets/molten-fiend/source/molten_fiend.glb
 *   npm run assets:retarget -- --force # rebuild even when the output is current
 *
 * Verify the result with tools/assets/verify-retarget.mjs, which walks the baked
 * skeleton and checks bone lengths are untouched in every pose.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FORCE = process.argv.slice(2).includes('--force');

/**
 * Every retarget job. One entry per unanimated rig; `donor` is the rig its clips
 * come from and `clips` names the ones worth carrying (the donor ships 24, most
 * of which are hero abilities this enemy has no use for).
 *
 * Clip names are REWRITTEN to the target's own prefix, because every consumer in
 * the game resolves clips by name substring — the enemy classes look for
 * `run`/`attack`/`idle`, and `measureGroundOffset` looks for `idle`. A clip that
 * kept the donor's prefix would still match, but the asset would then claim to be
 * the donor, which is the kind of lie that costs an hour later.
 */
const JOBS = [
    {
        name: 'molten_fiend',
        target: 'assets/molten-fiend/source/molten_fiend_raw.glb',
        donor: 'assets/thamuz-lord-lava-in-game/source/thamuz_lord_lava_in_game.glb',
        out: 'assets/molten-fiend/source/molten_fiend.glb',
        /** donor clip → the name it takes on the fiend. */
        clips: {
            thamuz_lord_lava_in_game_run: 'molten_fiend_run',
            thamuz_lord_lava_in_game_fight_idle: 'molten_fiend_fight_idle',
            thamuz_lord_lava_in_game_attack1: 'molten_fiend_attack1',
            thamuz_lord_lava_in_game_skill1: 'molten_fiend_skill1',
            thamuz_lord_lava_in_game_dead: 'molten_fiend_dead',
        },
        /** The one bone whose translation is motion rather than build. */
        rootBone: 'Bip001',
        /** Bone whose rest offset sets the ratio root motion transfers at. A limb
         *  segment, so it measures the rigs' relative BUILD rather than whatever
         *  offset the root happens to sit at. */
        scaleFromBone: 'Bip001 L Calf',
    },
];

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Sketchfab appends `_<node index>` to every node name on export, and the index
 *  is a property of the FILE rather than of the rig. Two exports of one Biped
 *  therefore agree on every name once it is gone. */
const stripIndex = name => name.replace(/_\d+$/, '');

// ── quaternion helpers (x, y, z, w) ─────────────────────────────────────────
const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = q => [-q[0], -q[1], -q[2], q[3]];
/** Rotate a vector by a quaternion (q · v · q⁻¹, expanded). */
const qRotate = (q, v) => {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
    const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
    const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [
        v[0] + q[3] * tx + q[1] * tz - q[2] * ty,
        v[1] + q[3] * ty + q[2] * tx - q[0] * tz,
        v[2] + q[3] * tz + q[0] * ty - q[1] * tx,
    ];
};

function boneMap(doc) {
    const map = new Map();
    for (const node of doc.getRoot().listNodes()) {
        const key = stripIndex(node.getName());
        if (key.startsWith('Bip001') && !map.has(key)) map.set(key, node);
    }
    return map;
}

/**
 * Rest-pose world rotation of a node's PARENT chain.
 *
 * Only rotation is accumulated: it is the only part of the chain that can turn a
 * local displacement into a different world direction. Translation moves the
 * frame's origin, which a displacement does not care about, and every shipped rig
 * loads with unit scale throughout.
 */
function parentWorldRotation(doc, node) {
    const parentOf = new Map();
    const walk = parent => {
        for (const child of parent.listChildren()) {
            parentOf.set(child, parent);
            walk(child);
        }
    };
    for (const sceneRoot of doc.getRoot().listScenes()[0].listChildren()) walk(sceneRoot);

    let q = [0, 0, 0, 1];
    for (let p = parentOf.get(node); p; p = parentOf.get(p)) q = qMul(p.getRotation(), q);
    return q;
}

/** Throw unless every sample in a track is the same value. The safety argument
 *  for dropping scale outright — a scale track that varies is real motion, and
 *  discarding it silently would ship an animation missing part of itself. */
function assertConstant(accessor, label, stride) {
    const array = accessor.getArray();
    for (let i = stride; i < array.length; i += stride) {
        for (let k = 0; k < stride; k++) {
            if (Math.abs(array[i + k] - array[k]) > 1e-4) {
                throw new Error(`[retarget] ${label} is animated, not a constant pin — `
                    + `dropping it would lose motion.`);
            }
        }
    }
}

/** Rebuild a donor accessor against the target document's own buffer, rewriting
 *  the samples on the way through. Accessors belong to a document, so a donor one
 *  can never simply be referenced. */
function copyAccessor(targetDoc, buffer, source, rewrite) {
    const array = source.getArray().slice();
    if (rewrite) rewrite(array);
    return targetDoc.createAccessor()
        .setType(source.getType())
        .setArray(array)
        .setBuffer(buffer);
}

/** True when the output is newer than both inputs, so there is nothing to do. */
function isUpToDate(job) {
    const out = join(ROOT, job.out);
    if (FORCE || !existsSync(out)) return false;
    const outAt = statSync(out).mtimeMs;
    return outAt > statSync(join(ROOT, job.target)).mtimeMs
        && outAt > statSync(join(ROOT, job.donor)).mtimeMs;
}

function retarget(job, targetDoc, donorDoc) {
    const targetBones = boneMap(targetDoc);
    const donorBones = boneMap(donorDoc);

    // A rig that already has animation is not a retarget candidate, and leaving
    // old clips in place would collide with the names about to be added.
    for (const anim of targetDoc.getRoot().listAnimations()) anim.dispose();

    const restLength = (bones, which) => {
        const bone = bones.get(job.scaleFromBone);
        if (!bone) throw new Error(`[retarget] ${job.scaleFromBone} is missing from the ${which} rig`);
        return Math.hypot(...bone.getTranslation()) || 1;
    };
    const sizeRatio = restLength(targetBones, 'target') / restLength(donorBones, 'donor');

    // Basis that carries root motion between the two rigs' frames. Built once —
    // the rest poses do not change, and only one bone carries translation.
    const rootTarget = targetBones.get(job.rootBone);
    const rootDonor = donorBones.get(job.rootBone);
    if (!rootTarget || !rootDonor) throw new Error(`[retarget] ${job.rootBone} is missing from a rig`);
    const donorToWorld = parentWorldRotation(donorDoc, rootDonor);
    const worldToTarget = qConj(parentWorldRotation(targetDoc, rootTarget));
    const rootRest = rootTarget.getTranslation();

    const buffer = targetDoc.getRoot().listBuffers()[0] ?? targetDoc.createBuffer();
    let rotations = 0;
    let unmatched = 0;
    /** Largest limb translation amplitude discarded, so the loss is reported
     *  rather than assumed negligible. */
    let widestDropped = { amount: 0, what: '—' };

    for (const donorAnim of donorDoc.getRoot().listAnimations()) {
        const outName = job.clips[donorAnim.getName()];
        if (!outName) continue;

        const anim = targetDoc.createAnimation(outName);
        // One target sampler per donor sampler — a donor rig shares samplers
        // between channels, and rebuilding one per channel would multiply the
        // keyframe data by the number of channels referencing it.
        const samplerCache = new Map();

        for (const donorChannel of donorAnim.listChannels()) {
            const donorNode = donorChannel.getTargetNode();
            const path = donorChannel.getTargetPath();
            const donorName = stripIndex(donorNode?.getName() ?? '');
            const bone = targetBones.get(donorName);
            const donorSampler = donorChannel.getSampler();
            if (!bone) { unmatched++; continue; }

            if (path === 'scale') {
                assertConstant(donorSampler.getOutput(), `${outName} ${donorName}.scale`, 3);
                continue;
            }
            if (path === 'translation' && donorName !== job.rootBone) {
                // Secondary limb offset — see the header. Measure what is lost.
                const array = donorSampler.getOutput().getArray();
                for (let i = 3; i < array.length; i += 3) {
                    const d = Math.hypot(array[i] - array[0], array[i + 1] - array[1], array[i + 2] - array[2]);
                    if (d > widestDropped.amount) widestDropped = { amount: d, what: `${donorName} in ${outName}` };
                }
                continue;
            }

            const cacheKey = `${path}:${donorName}`;
            let sampler = samplerCache.get(cacheKey);
            if (!sampler) {
                // The fixed part of the rotation transfer, built once per bone
                // rather than once per keyframe.
                const basis = qMul(bone.getRotation(), qConj(donorNode.getRotation()));

                const output = copyAccessor(targetDoc, buffer, donorSampler.getOutput(), array => {
                    if (path === 'rotation') {
                        for (let i = 0; i < array.length; i += 4) {
                            const q = qMul(basis, [array[i], array[i + 1], array[i + 2], array[i + 3]]);
                            array[i] = q[0]; array[i + 1] = q[1];
                            array[i + 2] = q[2]; array[i + 3] = q[3];
                        }
                        return;
                    }
                    // Root motion, referenced to the clip's own first sample.
                    const from = [array[0], array[1], array[2]];
                    for (let i = 0; i < array.length; i += 3) {
                        const local = [array[i] - from[0], array[i + 1] - from[1], array[i + 2] - from[2]];
                        const mine = qRotate(worldToTarget, qRotate(donorToWorld, local));
                        for (let k = 0; k < 3; k++) array[i + k] = rootRest[k] + mine[k] * sizeRatio;
                    }
                });

                sampler = targetDoc.createAnimationSampler()
                    .setInterpolation(donorSampler.getInterpolation())
                    .setInput(copyAccessor(targetDoc, buffer, donorSampler.getInput()))
                    .setOutput(output);
                anim.addSampler(sampler);
                samplerCache.set(cacheKey, sampler);
            }

            anim.addChannel(
                targetDoc.createAnimationChannel()
                    .setTargetNode(bone)
                    .setTargetPath(path)
                    .setSampler(sampler),
            );
            if (path === 'rotation') rotations++;
        }
        console.log(`  ${donorAnim.getName()} → ${outName}: ${anim.listChannels().length} channels`);
    }

    return { rotations, unmatched, widestDropped, sizeRatio };
}

async function main() {
    for (const job of JOBS) {
        if (isUpToDate(job)) {
            console.log(`[retarget] ${job.name}: up to date (--force to rebuild)`);
            continue;
        }
        console.log(`[retarget] ${job.name} ← ${job.donor}`);
        const [targetDoc, donorDoc] = await Promise.all([
            io.read(join(ROOT, job.target)),
            io.read(join(ROOT, job.donor)),
        ]);
        const r = retarget(job, targetDoc, donorDoc);
        await io.write(join(ROOT, job.out), targetDoc);
        console.log(`  wrote ${job.out}`);
        console.log(`  ${r.rotations} rotation channels + root motion (×${r.sizeRatio.toFixed(2)}), `
            + `${r.unmatched} donor-only bones skipped`);
        console.log(`  widest discarded limb offset: ${r.widestDropped.amount.toFixed(3)} `
            + `(${r.widestDropped.what})`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
