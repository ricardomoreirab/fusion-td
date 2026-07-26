/**
 * assets:verify — prove the optimized GLBs in assets/opt/ still animate identically.
 *
 * The failure mode this exists for is silent: THREE binds animation tracks by node
 * NAME, so any transform that renames, merges or reparents a bone leaves a model
 * that loads without error and T-poses forever (CLAUDE.md, "GLB clones must not
 * rename descendants"). A screenshot catches that only if you happen to look at
 * the right character; this catches it numerically for every rig and every clip.
 *
 * Method: parse the original and the optimized GLB with the real three.js
 * GLTFLoader, play every animation clip on both, sample bone world positions at
 * four phases of each clip, and report the largest deviation as a fraction of the
 * model's bounding-box diagonal. Quantization noise lands around 1e-4; a broken
 * binding lands at 1e-1 or higher because the bone simply never moves.
 *
 * Textures are stripped from both sides first — KTX2 needs a live WebGL context to
 * transcode, and this check is about skeletons, not pixels.
 *
 *   npm run assets:verify [-- --filter=aulus]
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder as GltfMeshoptDecoder, MeshoptEncoder as GltfMeshoptEncoder } from 'meshoptimizer';

import { AnimationMixer, Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const require = createRequire(import.meta.url);
const { discoverReferencedAssets } = require('./referenced.cjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_ROOT = join(ROOT, 'assets/opt');
const SAMPLE_PHASES = [0, 0.25, 0.5, 0.75];

/** Deviation above this fraction of the model diagonal is a real break, not quantization. */
const TOLERANCE = 0.01;

const FILTER = (process.argv.slice(2).find(a => a.startsWith('--filter=')) ?? '').slice('--filter='.length);

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': GltfMeshoptDecoder, 'meshopt.encoder': GltfMeshoptEncoder });

/** Write a texture-free copy so GLTFLoader.parse needs no image decoding. */
async function stripTextures(src, dst) {
    const doc = await io.read(src);
    for (const texture of doc.getRoot().listTextures()) texture.dispose();
    writeFileSync(dst, await io.writeBinary(doc));
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function parse(buffer) {
    return new Promise((res, rej) => loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', res, rej));
}

/** Bone world positions for every clip at every sample phase, keyed by bone name. */
function samplePoses(gltf) {
    const scene = gltf.scene;
    const bones = [];
    scene.traverse(node => { if (node.isBone || node.type === 'Bone') bones.push(node); });
    if (!bones.length) scene.traverse(node => bones.push(node));

    const box = new Box3().setFromObject(scene);
    const diagonal = box.isEmpty() ? 1 : box.getSize(new Vector3()).length() || 1;

    const poses = new Map();
    for (const clip of gltf.animations) {
        const mixer = new AnimationMixer(scene);
        const action = mixer.clipAction(clip);
        action.play();
        for (const phase of SAMPLE_PHASES) {
            mixer.setTime(0);
            mixer.update(clip.duration * phase);
            scene.updateMatrixWorld(true);
            for (const bone of bones) {
                const p = new Vector3().setFromMatrixPosition(bone.matrixWorld);
                poses.set(`${clip.name}@${phase}#${bone.name}`, p);
            }
        }
        action.stop();
        mixer.uncacheClip(clip);
    }
    return { poses, diagonal, boneCount: bones.length };
}

async function main() {
    const { files } = discoverReferencedAssets(ROOT);
    let glbs = files.filter(f => f.endsWith('.glb'));
    if (FILTER) glbs = glbs.filter(f => f.includes(FILTER));

    await Promise.all([MeshoptDecoder.ready, GltfMeshoptDecoder.ready, GltfMeshoptEncoder.ready]);

    const staging = join(tmpdir(), `ktg-verify-${process.pid}`);
    mkdirSync(staging, { recursive: true });

    let failures = 0;
    let checked = 0;
    try {
        for (const rel of glbs) {
            const optPath = join(OUT_ROOT, rel.replace(/^assets\//, ''));
            if (!existsSync(optPath)) {
                console.log(`  SKIP  ${rel} (no optimized copy)`);
                continue;
            }
            const a = join(staging, 'a.glb');
            const b = join(staging, 'b.glb');
            await stripTextures(join(ROOT, rel), a);
            await stripTextures(optPath, b);

            const src = samplePoses(await parse(require('node:fs').readFileSync(a)));
            const dst = samplePoses(await parse(require('node:fs').readFileSync(b)));
            checked++;

            const problems = [];
            if (src.boneCount !== dst.boneCount) problems.push(`bone count ${src.boneCount} → ${dst.boneCount}`);

            let worst = 0;
            let worstKey = '';
            let unmatched = 0;
            for (const [key, p] of src.poses) {
                const q = dst.poses.get(key);
                if (!q) { unmatched++; continue; }
                const d = p.distanceTo(q) / src.diagonal;
                if (d > worst) { worst = d; worstKey = key; }
            }
            if (unmatched) problems.push(`${unmatched} sample(s) had no counterpart (renamed bone or missing clip)`);
            if (worst > TOLERANCE) problems.push(`max bone drift ${(worst * 100).toFixed(2)}% of diagonal at ${worstKey}`);

            if (problems.length) {
                failures++;
                console.log(`  FAIL  ${rel}\n          ${problems.join('\n          ')}`);
            } else {
                console.log(`  ok    ${rel}  (${src.boneCount} bones, ${src.poses.size} samples, max drift ${(worst * 100).toFixed(4)}%)`);
            }
        }
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }

    console.log(`\n${checked - failures}/${checked} models preserved their skeleton binding.`);
    if (failures) process.exit(1);
}

main().catch(err => {
    console.error(`\n[assets:verify] ${err.stack ?? err.message}`);
    process.exit(1);
});
