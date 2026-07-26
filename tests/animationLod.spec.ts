import { describe, expect, it } from 'vitest';
import { AnimationClip, Group, NumberKeyframeTrack, Object3D } from 'three';
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
