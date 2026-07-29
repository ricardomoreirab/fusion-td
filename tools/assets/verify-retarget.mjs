/**
 * Sanity-check a retargeted rig WITHOUT a renderer.
 *
 * A retarget can fail in ways a channel count cannot see: a wrong quaternion
 * order explodes the skeleton, and a mis-framed root translation sends the body
 * sideways instead of down. Either would ship as an enemy that looks broken.
 * This walks the skeleton itself — sampling every animation channel across each
 * clip and composing world matrices by hand — and reports the numbers that move
 * if any of that is wrong:
 *
 *   • BONE LENGTHS, which a rotation-only transfer cannot change. Every bone
 *     except the root must sit exactly its rest distance from its parent in every
 *     pose; anything above float noise means translation leaked onto a limb, and
 *     the rig is being rebuilt with the donor's proportions. This is the check
 *     that fails the run.
 *   • ROOT DISPLACEMENT, which SHOULD move (that is the body travelling) — shown
 *     per axis so a fall reads as vertical rather than as a sideways slide.
 *   • The skeleton's world extent and lowest bone, as a plausibility read against
 *     the rest pose.
 *
 * Usage: node tools/assets/verify-retarget.mjs <file.glb> [rootBoneName]
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const SAMPLES = 13;
/** A rotation-only transfer is exact, so the tolerance only has to cover the
 *  float noise of composing matrices down a chain. */
const LENGTH_TOLERANCE = 1e-3;

const stripIndex = name => name.replace(/_\d+$/, '');

function compose(t, r, s) {
    const [x, y, z, w] = r;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return [
        (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
        (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
        (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
        t[0], t[1], t[2], 1,
    ];
}
function mul(a, b) {
    const o = new Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += a[i + k * 4] * b[k + j * 4];
            o[i + j * 4] = sum;
        }
    }
    return o;
}
const originOf = m => [m[12], m[13], m[14]];

/** Linear sample of a keyframe track at `time` (first/last key outside the range). */
function sampleAt(track, time, stride) {
    const { input, output, interp } = track;
    const n = input.length;
    if (time <= input[0]) return Array.from(output.slice(0, stride));
    if (time >= input[n - 1]) return Array.from(output.slice((n - 1) * stride, n * stride));
    let i = 1;
    while (i < n && input[i] < time) i++;
    const a = Array.from(output.slice((i - 1) * stride, i * stride));
    if (interp === 'STEP') return a;
    const b = Array.from(output.slice(i * stride, (i + 1) * stride));
    const f = (time - input[i - 1]) / (input[i] - input[i - 1] || 1);
    if (stride === 4) {
        // Shortest-arc lerp + normalize: close enough for a plausibility check,
        // and it avoids reimplementing slerp here.
        const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
        const out = a.map((v, k) => v + (b[k] * sign - v) * f);
        const len = Math.hypot(...out) || 1;
        return out.map(v => v / len);
    }
    return a.map((v, k) => v + (b[k] - v) * f);
}

/** World-space bone origins for one pose. `tracks` empty = the rest pose. */
function pose(sceneRoots, tracks, time) {
    const bones = new Map();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    const visit = (node, parentMatrix) => {
        const track = tracks.get(node);
        const m = mul(parentMatrix, compose(
            track?.translation ? sampleAt(track.translation, time, 3) : node.getTranslation(),
            track?.rotation ? sampleAt(track.rotation, time, 4) : node.getRotation(),
            track?.scale ? sampleAt(track.scale, time, 3) : node.getScale(),
        ));
        const name = stripIndex(node.getName());
        if (name.startsWith('Bip001')) {
            const p = originOf(m);
            bones.set(name, { p, parent: originOf(parentMatrix) });
            for (let k = 0; k < 3; k++) {
                if (p[k] < min[k]) min[k] = p[k];
                if (p[k] > max[k]) max[k] = p[k];
            }
        }
        for (const child of node.listChildren()) visit(child, m);
    };
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const root of sceneRoots) visit(root, I);

    return { bones, extent: max.map((v, k) => v - min[k]), lowest: min[1] };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const file = process.argv[2];
const rootBone = process.argv[3] ?? 'Bip001';
if (!file) {
    console.error('usage: node tools/assets/verify-retarget.mjs <file.glb> [rootBoneName]');
    process.exit(1);
}

const doc = await io.read(resolve(ROOT, file));
const sceneRoots = doc.getRoot().listScenes()[0].listChildren();
const rest = pose(sceneRoots, new Map(), 0);
const restLength = new Map([...rest.bones].map(([name, b]) => [name, dist(b.p, b.parent)]));

console.log(`rest pose  ${rest.bones.size} bones  extent `
    + `${rest.extent.map(v => v.toFixed(2)).join(' × ')}  lowest ${rest.lowest.toFixed(2)}\n`);

let worstBone = { drift: 0, name: '—', clip: '—' };

for (const anim of doc.getRoot().listAnimations()) {
    const tracks = new Map();
    let duration = 0;
    for (const channel of anim.listChannels()) {
        const node = channel.getTargetNode();
        const sampler = channel.getSampler();
        const input = sampler.getInput().getArray();
        duration = Math.max(duration, input[input.length - 1]);
        if (!tracks.has(node)) tracks.set(node, {});
        tracks.get(node)[channel.getTargetPath()] = {
            input, output: sampler.getOutput().getArray(), interp: sampler.getInterpolation(),
        };
    }

    let drift = 0;
    let driftName = '—';
    const rootTravel = [0, 0, 0];
    let lowest = Infinity;
    let extent = [0, 0, 0];

    for (let i = 0; i < SAMPLES; i++) {
        const p = pose(sceneRoots, tracks, (i / (SAMPLES - 1)) * duration);
        lowest = Math.min(lowest, p.lowest);
        extent = extent.map((v, k) => Math.max(v, p.extent[k]));
        for (const [name, bone] of p.bones) {
            if (name === rootBone) {
                const restRoot = rest.bones.get(name).p;
                for (let k = 0; k < 3; k++) {
                    rootTravel[k] = Math.max(rootTravel[k], Math.abs(bone.p[k] - restRoot[k]));
                }
                continue;
            }
            const d = Math.abs(dist(bone.p, bone.parent) - restLength.get(name));
            if (d > drift) { drift = d; driftName = name; }
        }
    }
    if (drift > worstBone.drift) worstBone = { drift, name: driftName, clip: anim.getName() };

    console.log(`${anim.getName().padEnd(24)} extent ${extent.map(v => v.toFixed(2)).join(' × ')}`
        + `  lowest ${lowest.toFixed(2)}`
        + `  root travel ${rootTravel.map(v => v.toFixed(2)).join('/')}`
        + `  bone drift ${drift.toExponential(1)}`);
}

const ok = worstBone.drift < LENGTH_TOLERANCE;
console.log(ok
    ? `\nOK — every non-root bone holds its rest length in every pose `
      + `(worst ${worstBone.drift.toExponential(1)} on ${worstBone.name})`
    : `\nFAIL — ${worstBone.name} changed length by ${worstBone.drift.toFixed(4)} in `
      + `${worstBone.clip}; a limb is carrying translation`);
process.exit(ok ? 0 : 1);
