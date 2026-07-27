import { describe, it, expect } from 'vitest';
import {
    AnimationClip, Bone, BufferAttribute, BufferGeometry, Group, MeshBasicMaterial,
    Skeleton, SkinnedMesh, Uint16BufferAttribute, VectorKeyframeTrack,
} from 'three';
import { measureGroundOffset } from '../src/engine/three/groundOffset';

const TIMES = [0, 1];

function constTrack(name: string, y: number): VectorKeyframeTrack {
    return new VectorKeyframeTrack(name, TIMES, [0, y, 0, 0, y, 0]);
}

/**
 * A one-bone rig whose REST pose deliberately differs from every pose its clips
 * produce — the situation pruneStaticTracks creates and the whole reason this
 * module exists.
 *
 * Geometry spans y = 0..2 and is fully weighted to `hips`, so the model's lowest
 * point is exactly wherever `hips` puts it.
 */
function rig(restY: number): { scene: Group; hips: Bone; mesh: SkinnedMesh } {
    const scene = new Group();
    scene.name = 'Scene';

    const hips = new Bone();
    hips.name = 'hips';
    scene.add(hips);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([
        0, 0, 0,
        0, 2, 0,
    ]), 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0], 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([
        1, 0, 0, 0,
        1, 0, 0, 0,
    ]), 4));

    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.name = 'body';
    scene.add(mesh);

    // Bind with `hips` at the origin, so the bind pose leaves the geometry where
    // it was authored and any later bone motion is a pure offset.
    scene.updateMatrixWorld(true);
    mesh.bind(new Skeleton([hips]));

    // Now move the rest pose off the bind pose.
    hips.position.y = restY;
    scene.updateMatrixWorld(true);
    return { scene, hips, mesh };
}

describe('measureGroundOffset', () => {
    it('measures the posed clip, not the rest transform', () => {
        // Rest pose sinks the model to -1; the idle clip holds it at 0.
        const { scene } = rig(-1);
        const idle = new AnimationClip('minion_fight_idle', 1, [constTrack('hips.position', 0)]);

        expect(measureGroundOffset(scene, [idle])).toBeCloseTo(0, 6);
    });

    it('lifts a rig whose clip genuinely hangs below its root', () => {
        const { scene } = rig(0);
        const idle = new AnimationClip('fenrir_fight_idle', 1, [constTrack('hips.position', -0.4)]);

        expect(measureGroundOffset(scene, [idle])).toBeCloseTo(0.4, 6);
    });

    it('prefers an idle clip over a death clip', () => {
        const { scene } = rig(0);
        // A corpse is authored lying on the floor; grounding on it would hoist the
        // model by its own body length every time it spawned.
        const dead = new AnimationClip('minion_dead', 1, [constTrack('hips.position', -5)]);
        const idle = new AnimationClip('minion_fight_idle', 1, [constTrack('hips.position', 0)]);

        expect(measureGroundOffset(scene, [dead, idle])).toBeCloseTo(0, 6);
    });

    it('falls back past a death clip when there is no idle or locomotion clip', () => {
        const { scene } = rig(0);
        const dead = new AnimationClip('carriage_dead', 1, [constTrack('hips.position', -5)]);
        const only = new AnimationClip('carriage_take_001', 1, [constTrack('hips.position', -0.2)]);

        expect(measureGroundOffset(scene, [dead, only])).toBeCloseTo(0.2, 6);
    });

    it('divides out root scale so one container serves owners of every size', () => {
        const { scene } = rig(0);
        scene.scale.setScalar(2);
        const idle = new AnimationClip('idle', 1, [constTrack('hips.position', -0.5)]);

        // The rig hangs 1.0 below the root in world terms at scale 2; the stored
        // value is per unit of scale, so an owner at scale 3 lifts by 1.5.
        expect(measureGroundOffset(scene, [idle])).toBeCloseTo(0.5, 6);
    });

    it('restores the rest pose it sampled through', () => {
        const { scene, hips } = rig(-1);
        const idle = new AnimationClip('idle', 1, [constTrack('hips.position', 0.75)]);

        measureGroundOffset(scene, [idle]);

        expect(hips.position.y).toBeCloseTo(-1, 6);
    });

    it('leaves no cached bounding box on the container skinned meshes', () => {
        // A cached box is pose-specific and Box3.expandByObject reuses a non-null
        // one instead of recomputing, so leaving it behind would hand every later
        // reader the pose this measurement happened to sample.
        const { scene, mesh } = rig(-1);
        const idle = new AnimationClip('idle', 1, [constTrack('hips.position', 0)]);

        measureGroundOffset(scene, [idle]);

        expect(mesh.boundingBox).toBeNull();
    });

    it('grounds on the rest pose when the rig has no clips at all', () => {
        const { scene } = rig(-0.3);

        expect(measureGroundOffset(scene, [])).toBeCloseTo(0.3, 6);
    });

    it('returns 0 for a rig with no drawable geometry', () => {
        const scene = new Group();
        scene.add(new Bone());

        expect(measureGroundOffset(scene, [])).toBe(0);
    });

    it('declines to ground a rig whose root is tilted off the Y axis', () => {
        // The owner applies its own Y pre-rotation per instance, which cannot
        // change how low the model reaches — a tilted root can, so the offset is
        // not a per-container constant any more.
        const { scene } = rig(-1);
        scene.rotation.x = Math.PI / 2;
        const idle = new AnimationClip('idle', 1, [constTrack('hips.position', 0)]);

        expect(measureGroundOffset(scene, [idle])).toBe(0);
    });
});
