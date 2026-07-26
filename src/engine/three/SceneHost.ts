/**
 * SceneHost - owns the THREE.Scene plus the per-frame plumbing Three does
 * not provide: an update bus (Babylon's scene.onBeforeRenderObservable
 * replacement), the animation-update bus (gated by `animationsEnabled`,
 * matching Babylon's animatable pause semantics), and the live particle
 * system registry.
 *
 * Headless-safe by design: constructing and ticking a SceneHost needs no
 * renderer, canvas, or WebGL - Vitest specs drive it with `tick(dt)`.
 *
 * Frame order inside tick() mirrors Babylon's scene.render():
 *   1. onBeforeRender callbacks (ALWAYS run - Babylon fires these even
 *      while the game is "paused"; pausing is the caller's business)
 *   2. animation callbacks (tweens, AnimationMixers) - skipped when
 *      animationsEnabled is false
 *   3. the ONE world-matrix pass for the frame (see _installSceneMatrixGuard)
 *   4. particle system simulation (started systems only; pause stops
 *      systems explicitly, same as Game.pause() did with Babylon)
 */

import { Scene } from 'three';

export interface UpdateToken {
    readonly cb: (host: SceneHost) => void;
}

/** Tickable surface the particle module registers against. */
export interface SceneParticleSystem {
    tick(dtSeconds: number): void;
}

class UpdateBus {
    private entries: (UpdateToken | null)[] = [];
    private running = false;
    private needsCompact = false;

    public add(cb: (host: SceneHost) => void): UpdateToken {
        const token: UpdateToken = { cb };
        this.entries.push(token);
        return token;
    }

    /** Synchronous removal - safe to call from inside a callback. */
    public remove(token: UpdateToken | null | undefined): void {
        if (!token) return;
        const i = this.entries.indexOf(token);
        if (i < 0) return;
        if (this.running) {
            // Null the slot in place so run()'s in-progress loop skips it
            // without shifting indices out from under the live iteration;
            // the array is compacted once the loop finishes.
            this.entries[i] = null;
            this.needsCompact = true;
        } else {
            this.entries.splice(i, 1);
        }
    }

    public get size(): number {
        let count = 0;
        for (const e of this.entries) if (e) count++;
        return count;
    }

    public run(host: SceneHost): void {
        // Iterate the live array by index (no per-frame allocation). The
        // length is captured up front so callbacks that add() mid-run don't
        // get executed until the next run() - matching the old slice()
        // semantics. Entries removed mid-run are nulled by remove() above
        // and skipped here, then compacted after the loop.
        const len = this.entries.length;
        const wasRunning = this.running;
        this.running = true;
        for (let i = 0; i < len; i++) {
            const token = this.entries[i];
            if (!token) continue;
            token.cb(host);
        }
        this.running = wasRunning;
        if (!this.running && this.needsCompact) {
            this.entries = this.entries.filter((e): e is UpdateToken => e !== null);
            this.needsCompact = false;
        }
    }

    public clear(): void {
        this.entries.length = 0;
        this.needsCompact = false;
    }
}

export class SceneHost {
    public readonly scene = new Scene();

    /** Diagnostic counter: full-graph world-matrix passes actually executed.
     *  tick() drives exactly one; anything the particle loop asks for on top is
     *  suppressed (see _installSceneMatrixGuard), so this must advance by 1 per
     *  tick no matter how many live particle systems there are. */
    public matrixWorldPasses = 0;

    constructor() {
        // THREE refreshes world matrices at the top of EVERY renderer.render()
        // call. The post-processing chain issues several per displayed frame, so
        // the whole graph (thousands of nodes once a horde is on the field) was
        // being walked and re-multiplied that many times for one image. Own the
        // pass instead: tick() runs it exactly once, at the same point in the
        // frame THREE would have.
        this.scene.matrixWorldAutoUpdate = false;
        this._installSceneMatrixGuard();
    }

    /**
     * Make `scene.updateMatrixWorld()` a no-op for the duration of the particle
     * loop, so the pass can only run once per tick.
     *
     * @newkrok/three-particles calls `particleSystem.parent.updateMatrixWorld()`
     * once per WORLD-space system per update (plus once per sub-emitter spawn).
     * Our WORLD-space systems - status auras, trails, bursts - are parented at
     * the scene ROOT, so that `parent` IS the scene and every one of those calls
     * is a full-graph walk: three r185 recurses into every child unconditionally
     * (`matrixWorldAutoUpdate = false` only skips the multiply, never the
     * recursion) and `force` cascades down from the root, so every node is
     * re-multiplied. Measured at a 241-enemy fight: 118 live systems produced
     * ~155 scene walks per frame over ~1800 nodes each - 30-80ms of pure
     * repetition, dwarfing the rest of the frame (anim bus 2.1ms, state 0.9ms).
     *
     * tick() runs the authoritative pass IMMEDIATELY BEFORE the loop, so every
     * matrix the library reads is already current and a repeat walk could only
     * recompute the identical values.
     *
     * Only the SCENE INSTANCE method is overridden, never the prototype: a
     * system parented to a mesh (a trail riding a projectile) still gets its
     * real - and cheap - subtree walk, and the prototype's recursion into
     * children is untouched.
     */
    private _installSceneMatrixGuard(): void {
        const scene = this.scene;
        // Resolved through the prototype chain so a future Scene override is
        // still what we delegate to.
        const base = scene.updateMatrixWorld;
        scene.updateMatrixWorld = (force?: boolean): void => {
            if (this._tickingParticles) return;
            this.matrixWorldPasses++;
            base.call(scene, force);
        };
    }

    /** Seconds elapsed since the previous tick - Babylon's engine.getDeltaTime()/1000. */
    public deltaSeconds = 0;

    /** Gates tweens and animation mixers, NOT the update bus or particles. */
    public animationsEnabled = true;

    /** Live particle systems (registered/unregistered by ParticleSystem itself). */
    public readonly particleSystems: SceneParticleSystem[] = [];
    /** Inside the particle loop. Does double duty: it keeps the registry stable
     *  against mid-loop mutation AND suppresses redundant scene matrix passes
     *  (see _installSceneMatrixGuard). Always cleared in a `finally`. */
    private _tickingParticles = false;
    private _particlesNeedCompact = false;

    public readonly onBeforeRender = new UpdateBus();

    /** Internal bus for tween/mixer updates - respects animationsEnabled. */
    public readonly onAnimUpdate = new UpdateBus();

    public tick(dtSeconds: number): void {
        this.deltaSeconds = dtSeconds;
        this.onBeforeRender.run(this);
        if (this.animationsEnabled) this.onAnimUpdate.run(this);

        // THE world-matrix pass for this frame (see the constructor), placed
        // between the buses and the particle loop. Everything that MOVES a
        // gameplay object has already run by here - the caller's state update,
        // the onBeforeRender bus, and the mixers/tweens on onAnimUpdate - and the
        // particle library reads parent world matrices during its own update, so
        // this is the single point that serves both.
        //
        // Nothing after it moves anything the renderer needs fresh:
        //  - WORLD-space systems carry matrixWorldAutoUpdate = false and the
        //    library resets their matrixWorld to identity itself (their particle
        //    positions are baked in world space), so this pass neither has to
        //    reach them nor may clobber them;
        //  - LOCAL-space systems call their OWN updateMatrixWorld inside the
        //    library update, off the parent matrices this pass just refreshed -
        //    which is strictly fresher than when the pass trailed the loop;
        //  - ParticleEffect.syncFollow reads its target through
        //    getWorldPosition -> updateWorldMatrix(parents), an O(depth) walk up
        //    that never depends on this pass at all.
        this.scene.updateMatrixWorld();

        // Index-based over the live array (no per-frame allocation). The
        // length is captured up front so a system registered mid-loop
        // doesn't tick until next frame; unregisterParticleSystem nulls the
        // slot in place so a system that disposes itself (or another) mid-
        // tick is skipped here, then the array is compacted after the loop.
        const list = this.particleSystems as (SceneParticleSystem | null)[];
        const len = list.length;
        this._tickingParticles = true;
        try {
            for (let i = 0; i < len; i++) {
                const ps = list[i];
                if (!ps) continue;
                ps.tick(dtSeconds);
            }
        } finally {
            // MUST be `finally`. _tickingParticles is also what suppresses the
            // scene matrix pass, so a system that throws mid-loop would otherwise
            // leave every world matrix in the game frozen forever - a silent
            // black-screen-class failure, not a crash.
            this._tickingParticles = false;
            if (this._particlesNeedCompact) {
                this._compactParticleSystems();
            }
        }
    }

    public registerParticleSystem(ps: SceneParticleSystem): void {
        if (!this.particleSystems.includes(ps)) this.particleSystems.push(ps);
    }

    public unregisterParticleSystem(ps: SceneParticleSystem): void {
        const list = this.particleSystems as (SceneParticleSystem | null)[];
        const i = list.indexOf(ps);
        if (i < 0) return;
        if (this._tickingParticles) {
            list[i] = null;
            this._particlesNeedCompact = true;
        } else {
            list.splice(i, 1);
        }
    }

    private _compactParticleSystems(): void {
        const list = this.particleSystems as (SceneParticleSystem | null)[];
        const compacted = list.filter((ps): ps is SceneParticleSystem => ps !== null);
        list.length = 0;
        list.push(...compacted);
        this._particlesNeedCompact = false;
    }
}
