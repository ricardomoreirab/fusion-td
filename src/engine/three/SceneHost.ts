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
    private entries: UpdateToken[] = [];

    public add(cb: (host: SceneHost) => void): UpdateToken {
        const token: UpdateToken = { cb };
        this.entries.push(token);
        return token;
    }

    /** Synchronous removal - safe to call from inside a callback. */
    public remove(token: UpdateToken | null | undefined): void {
        if (!token) return;
        const i = this.entries.indexOf(token);
        if (i >= 0) this.entries.splice(i, 1);
    }

    public get size(): number {
        return this.entries.length;
    }

    public run(host: SceneHost): void {
        // Snapshot so callbacks may add/remove entries mid-iteration;
        // removed entries are re-checked so a callback that unregisters
        // another callback prevents its stale execution this frame.
        const snapshot = this.entries.slice();
        for (const token of snapshot) {
            if (this.entries.indexOf(token) < 0) continue;
            token.cb(host);
        }
    }

    public clear(): void {
        this.entries.length = 0;
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

    public readonly onBeforeRender = new UpdateBus();

    /** Internal bus for tween/mixer updates - respects animationsEnabled. */
    public readonly onAnimUpdate = new UpdateBus();

    public tick(dtSeconds: number): void {
        this.deltaSeconds = dtSeconds;
        this.onBeforeRender.run(this);
        if (this.animationsEnabled) this.onAnimUpdate.run(this);
        // Snapshot: a system may dispose (unregister) during its own tick.
        for (const ps of this.particleSystems.slice()) {
            ps.tick(dtSeconds);
        }
    }

    public registerParticleSystem(ps: SceneParticleSystem): void {
        if (!this.particleSystems.includes(ps)) this.particleSystems.push(ps);
    }

    public unregisterParticleSystem(ps: SceneParticleSystem): void {
        const i = this.particleSystems.indexOf(ps);
        if (i >= 0) this.particleSystems.splice(i, 1);
    }
}
