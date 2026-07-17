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
 *   3. particle system simulation (started systems only; pause stops
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

    /** Seconds elapsed since the previous tick - Babylon's engine.getDeltaTime()/1000. */
    public deltaSeconds = 0;

    /** Gates tweens and animation mixers, NOT the update bus or particles. */
    public animationsEnabled = true;

    /** Live particle systems (registered/unregistered by ParticleSystem itself). */
    public readonly particleSystems: SceneParticleSystem[] = [];
    private _tickingParticles = false;
    private _particlesNeedCompact = false;

    public readonly onBeforeRender = new UpdateBus();

    /** Internal bus for tween/mixer updates - respects animationsEnabled. */
    public readonly onAnimUpdate = new UpdateBus();

    public tick(dtSeconds: number): void {
        this.deltaSeconds = dtSeconds;
        this.onBeforeRender.run(this);
        if (this.animationsEnabled) this.onAnimUpdate.run(this);
        // Index-based over the live array (no per-frame allocation). The
        // length is captured up front so a system registered mid-loop
        // doesn't tick until next frame; unregisterParticleSystem nulls the
        // slot in place so a system that disposes itself (or another) mid-
        // tick is skipped here, then the array is compacted after the loop.
        const list = this.particleSystems as (SceneParticleSystem | null)[];
        const len = list.length;
        this._tickingParticles = true;
        for (let i = 0; i < len; i++) {
            const ps = list[i];
            if (!ps) continue;
            ps.tick(dtSeconds);
        }
        this._tickingParticles = false;
        if (this._particlesNeedCompact) {
            this._compactParticleSystems();
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
