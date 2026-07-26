import { describe, expect, it } from 'vitest';
import {
    AnimationClip, Group, NumberKeyframeTrack, Object3D, QuaternionKeyframeTrack,
    VectorKeyframeTrack,
} from 'three';
import { GlbContainer } from '../src/engine/three/assets';
import { SceneHost } from '../src/engine/three/SceneHost';

/**
 * A container whose single 10s clip drives position.x at 10 units/second, so
 * `root.position.x` reads back as "seconds of animation actually applied".
 */
function makeContainer(): GlbContainer {
    const scene = new Group();
    const child = new Object3D();
    child.name = 'walker';
    scene.add(child);
    const track = new NumberKeyframeTrack('walker.position[x]', [0, 10], [0, 100]);
    const clip = new AnimationClip('walk', 10, [track]);
    return new GlbContainer({ scene, animations: [clip] } as never);
}

/** Advance `frames` ticks of `dt` through the host's animation bus. */
function run(host: SceneHost, frames: number, dt = 1 / 60): void {
    for (let i = 0; i < frames; i++) host.tick(dt);
}

function appliedSeconds(root: Object3D): number {
    return (root.getObjectByName('walker') as Object3D).position.x / 10;
}

/**
 * A short 0.8s clip that writes a full TRS channel set on one node, so the whole
 * resumed pose can be compared rather than a single scalar. The keys are
 * non-linear on purpose: a pose that merely advanced the right AMOUNT of time
 * but sampled the wrong phase would pass a linear track.
 */
function makePoseContainer(): GlbContainer {
    const scene = new Group();
    const child = new Object3D();
    child.name = 'walker';
    scene.add(child);
    const times = [0, 0.4, 0.8];
    const clip = new AnimationClip('walk', 0.8, [
        new VectorKeyframeTrack('walker.position', times, [0, 0, 0, 0.6, 1.4, -0.3, 0, 0, 0]),
        new QuaternionKeyframeTrack('walker.quaternion', times, [
            0, 0, 0, 1,
            0.3826834, 0, 0, 0.9238795,
            0, 0, 0, 1,
        ]),
        new VectorKeyframeTrack('walker.scale', times, [1, 1, 1, 1.35, 0.8, 1.1, 1, 1, 1]),
    ]);
    return new GlbContainer({ scene, animations: [clip] } as never);
}

function pose(root: Object3D): number[] {
    const n = root.getObjectByName('walker') as Object3D;
    return [
        n.position.x, n.position.y, n.position.z,
        n.quaternion.x, n.quaternion.y, n.quaternion.z, n.quaternion.w,
        n.scale.x, n.scale.y, n.scale.z,
    ];
}

describe('ContainerInstance animation LOD', () => {
    it("'full' applies every frame", () => {
        const host = new SceneHost();
        const inst = makeContainer().instantiate(host);
        inst.animationGroups[0].start(false);

        run(host, 30);
        expect(appliedSeconds(inst.root)).toBeCloseTo(0.5, 5);
        inst.dispose();
    });

    it("'reduced' applies in ~10 Hz steps but loses no time", () => {
        const host = new SceneHost();
        const inst = makeContainer().instantiate(host);
        inst.animationGroups[0].start(false);
        inst.setAnimationLod('reduced');

        // 30ms frames: three of them is 0.09s, still under the 0.1s step.
        run(host, 3, 0.03);
        expect(appliedSeconds(inst.root)).toBe(0);

        // The fourth crosses the step and flushes the whole accumulation at once.
        run(host, 1, 0.03);
        expect(appliedSeconds(inst.root)).toBeCloseTo(0.12, 5);

        // Over a longer span the applied time still equals elapsed time at every
        // flush — a throttled skeleton must not drift out of phase.
        run(host, 16, 0.03);
        expect(appliedSeconds(inst.root)).toBeCloseTo(0.6, 5);
        inst.dispose();
    });

    it("'off' freezes the pose and resuming replays the skipped time", () => {
        const host = new SceneHost();
        const inst = makeContainer().instantiate(host);
        inst.animationGroups[0].start(false);

        run(host, 6);
        expect(appliedSeconds(inst.root)).toBeCloseTo(0.1, 5);

        inst.setAnimationLod('off');
        run(host, 60);
        expect(appliedSeconds(inst.root)).toBeCloseTo(0.1, 5); // frozen

        inst.setAnimationLod('full');
        run(host, 1);
        // 60 skipped frames + the resuming one, all folded into one step.
        expect(appliedSeconds(inst.root)).toBeCloseTo(0.1 + 61 / 60, 5);
        inst.dispose();
    });

    it("'half' applies in ~30 Hz steps and stays in phase", () => {
        const host = new SceneHost();
        const inst = makeContainer().instantiate(host);
        inst.animationGroups[0].start(false);
        inst.setAnimationLod('half');

        // At 60 fps the step lands every OTHER frame: one frame holds the pose.
        run(host, 1);
        expect(appliedSeconds(inst.root)).toBe(0);
        run(host, 1);
        expect(appliedSeconds(inst.root)).toBeCloseTo(2 / 60, 5);

        // Applied time still equals elapsed time — a half-rate skeleton must not
        // drift out of phase with a full-rate one beside it.
        run(host, 58);
        expect(appliedSeconds(inst.root)).toBeCloseTo(1.0, 5);
        inst.dispose();
    });

    it("'half' updates 2x as often as 'reduced' and 0.5x as often as 'full'", () => {
        // The tiers must actually be distinct — a 'half' that silently behaved
        // like 'full' would give back none of the CPU it exists to save.
        const counts: Record<string, number> = {};
        for (const lod of ['full', 'half', 'reduced'] as const) {
            const host = new SceneHost();
            const inst = makeContainer().instantiate(host);
            inst.animationGroups[0].start(false);
            inst.setAnimationLod(lod);
            let applied = 0, last = 0;
            for (let i = 0; i < 60; i++) {
                host.tick(1 / 60);
                const now = appliedSeconds(inst.root);
                if (now !== last) { applied++; last = now; }
            }
            counts[lod] = applied;
            inst.dispose();
        }
        expect(counts.full).toBe(60);
        expect(counts.half).toBe(30);
        // ~6 frames per 0.1s step, but 6 × (1/60) lands a hair under 0.1 in
        // floating point, so the flush interval alternates 6/7 frames. Assert the
        // rate, not an exact count that depends on that.
        expect(counts.reduced).toBeGreaterThanOrEqual(6);
        expect(counts.reduced).toBeLessThanOrEqual(10);
    });

    it("'off' is pose-preserving across a freeze that spans several clip loops", () => {
        // This is the property the enemy cull rests on: a parked enemy is
        // detached from the scene, so it is dropped to 'off' outright rather
        // than throttled - which is only legitimate if the pose it resumes on is
        // the one a never-frozen mixer would be holding. Clip time is linear in
        // wall time, so it is; a freeze spanning whole loops proves the wrap
        // arithmetic folds too.
        const host = new SceneHost();
        const reference = makePoseContainer().instantiate(host);
        const frozen = makePoseContainer().instantiate(host);
        reference.animationGroups[0].start(true);
        frozen.animationGroups[0].start(true);

        run(host, 20);
        frozen.setAnimationLod('off');
        run(host, 260); // 4.33s over a 0.8s clip - more than five wraps
        expect(pose(frozen.root)).not.toEqual(pose(reference.root));

        frozen.setAnimationLod('full');
        run(host, 1);
        const a = pose(reference.root);
        const b = pose(frozen.root);
        for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i], 9);

        reference.dispose();
        frozen.dispose();
    });

    it("'off' lands a clip that ENDED mid-freeze on its clamped final pose", () => {
        // Time-preservation has to hold for one-shot clips too: a clip whose end
        // fell inside the freeze resumes clamped on its last frame, not stranded
        // wherever the freeze caught it.
        const host = new SceneHost();
        const reference = makePoseContainer().instantiate(host);
        const frozen = makePoseContainer().instantiate(host);
        reference.animationGroups[0].start(false);
        frozen.animationGroups[0].start(false);

        run(host, 6);
        frozen.setAnimationLod('off');
        run(host, 120); // 2s: well past the 0.8s clip
        frozen.setAnimationLod('full');
        run(host, 1);

        const a = pose(reference.root);
        const b = pose(frozen.root);
        for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i], 9);
        reference.dispose();
        frozen.dispose();
    });

    it('resetAnimationClock drops banked time so a fresh one-shot clip plays out', () => {
        // The escape hatch for the one case where replaying the freeze is wrong:
        // an owner starting a one-shot clip NOW (an enemy that died off screen
        // beginning its death animation). Without it the clip would be handed a
        // multi-second first step and clamp on the frame it started.
        const host = new SceneHost();
        const inst = makeContainer().instantiate(host);
        inst.animationGroups[0].start(false);
        inst.setAnimationLod('off');
        run(host, 300); // 5s banked

        inst.resetAnimationClock();
        inst.setAnimationLod('full');
        run(host, 6);
        expect(appliedSeconds(inst.root)).toBeCloseTo(6 / 60, 5);
        inst.dispose();
    });

    it('leaves the animation bus on dispose regardless of LOD', () => {
        // The LOD gate must not become a way to leak a bus subscription: an
        // instance parked at 'reduced'/'off' still unhooks completely.
        for (const lod of ['full', 'half', 'reduced', 'off'] as const) {
            const host = new SceneHost();
            const inst = makeContainer().instantiate(host);
            inst.animationGroups[0].start(false);
            inst.setAnimationLod(lod);
            run(host, 6);
            expect(host.onAnimUpdate.size).toBe(1);

            inst.dispose();
            expect(host.onAnimUpdate.size).toBe(0);
        }
    });
});
