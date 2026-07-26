import type { SceneHost } from '../../engine/three/SceneHost';
import {
    BIOMES, biomeIndexForWave, resolveBiomeBlendT, luminance,
    GROUND_LUMINANCE_MIN, GROUND_LUMINANCE_MAX,
    type BiomeDef,
} from './Biomes';
import { TerrainSurface } from './TerrainSurface';
import { GroundScatter } from './GroundScatter';
import { PropScatter } from './PropScatter';
import { Atmosphere } from './Atmosphere';
import { BIOME_EASE_SECONDS } from './WorldConstants';

export interface WorldOptions {
    /** Graphics preset: 'low' | 'medium' | 'high'. Drives scatter density. */
    quality: string;
    isMobile: boolean;
    shadowsEnabled: boolean;
}

export interface WorldDiagnostics {
    biome: string;
    blend: number;
    scatterInstances: number;
    activeProps: number;
}

/**
 * The rebuilt scenario: terrain, ground scatter, landmark props, and atmosphere,
 * driven by a wave-indexed biome blend.
 *
 * Owns nothing about gameplay. The world is a *signal* of run depth, never a
 * mechanic — no method here may influence damage, speed, or spawn rates (see
 * docs/world-rebuild-design.md).
 *
 * Replaced the globe scenario wholesale; it shares no code with it.
 */
export class World {
    private readonly terrain: TerrainSurface;
    private readonly scatter: GroundScatter;
    private readonly props: PropScatter;
    private readonly atmosphere: Atmosphere;

    /**
     * Continuous position along the biome axis: `bandIndex + transitionT`.
     *
     * A single scalar rather than a (from, to, t) triple because the handoff
     * between bands is then automatically continuous — the end of the
     * meadow→scorched fade (globalT 1.0) IS the start of the scorched band, so
     * there is no frame where the pair swaps and the grade jumps.
     */
    private biomeAxis: number;
    private biomeAxisTarget: number;

    private currentFrom: BiomeDef;
    private currentTo: BiomeDef;
    private currentT = 0;
    private elapsed = 0;
    /** Dev/QA biome pin; null in normal play. See debugForceBiomeAxis. */
    private debugAxisOverride: number | null = null;

    constructor(host: SceneHost, opts: WorldOptions) {
        World.assertReadability();

        this.terrain = new TerrainSurface(host);
        this.scatter = new GroundScatter(host, opts.quality);
        this.props = new PropScatter(host, opts.isMobile);
        this.atmosphere = new Atmosphere(host, opts.shadowsEnabled);

        this.biomeAxis = 0;
        this.biomeAxisTarget = 0;
        this.currentFrom = BIOMES[0];
        this.currentTo = BIOMES[0];

        // Dev-only QA handle: lets a headless pass jump straight to a biome
        // instead of playing twenty waves to photograph it. Stripped from
        // production builds along with the rest of the debug hook.
        if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
            const w = window as unknown as { __KTG__?: Record<string, unknown> };
            if (w.__KTG__) w.__KTG__.world = this;
        }
    }

    /** Dev/QA only: pin the biome axis so a screenshot can be taken of any biome
     *  on demand. Pass null to hand control back to the wave counter. */
    public debugForceBiomeAxis(axis: number | null): void {
        this.debugAxisOverride = axis;
        if (axis !== null) {
            this.biomeAxis = axis;
            this.biomeAxisTarget = axis;
            this.resolveAxis();
        }
    }

    /**
     * Fails loudly in dev if a biome edit pushes ground luminance outside the
     * band that keeps bright enemies and VFX readable against it. This is the
     * readability promise made executable — a colour tweak that breaks it is a
     * gameplay regression, not a cosmetic one, and it is otherwise very easy to
     * ship by accident.
     */
    private static assertReadability(): void {
        for (const b of BIOMES) {
            const l = luminance(b.ground.base);
            if (l < GROUND_LUMINANCE_MIN || l > GROUND_LUMINANCE_MAX) {
                console.error(
                    `[world] biome "${b.id}" ground luminance ${l.toFixed(3)} is outside ` +
                    `the readable band [${GROUND_LUMINANCE_MIN}, ${GROUND_LUMINANCE_MAX}]. ` +
                    `Enemies and power VFX may not separate from the ground.`,
                );
            }
        }
    }

    /** Decompose the continuous axis back into a biome pair + blend factor. */
    private resolveAxis(): void {
        const last = BIOMES.length - 1;
        const clamped = Math.max(0, Math.min(last, this.biomeAxis));
        const i = Math.min(last, Math.floor(clamped));
        this.currentFrom = BIOMES[i];
        this.currentTo = BIOMES[Math.min(last, i + 1)];
        this.currentT = Math.max(0, Math.min(1, clamped - i));
    }

    /**
     * @param wave current wave number (1-based). May be fractional.
     * @param halfDiag camera's visible ground half-diagonal, from IsoCameraRig.
     */
    public update(
        deltaTime: number,
        heroX: number,
        heroZ: number,
        wave: number,
        halfDiag: number,
    ): void {
        this.elapsed += deltaTime;

        this.biomeAxisTarget = this.debugAxisOverride
            ?? (biomeIndexForWave(wave) + resolveBiomeBlendT(wave));

        // Ease toward the target so an integer wave step still reads as a
        // gradual grade rather than a snap.
        const k = Math.min(1, Math.max(0, deltaTime / BIOME_EASE_SECONDS));
        this.biomeAxis += (this.biomeAxisTarget - this.biomeAxis) * k;
        // Snap once close enough, so a long run does not sit forever at 0.999.
        if (Math.abs(this.biomeAxisTarget - this.biomeAxis) < 0.001) {
            this.biomeAxis = this.biomeAxisTarget;
        }
        this.resolveAxis();

        const a = this.currentFrom;
        const b = this.currentTo;
        const t = this.currentT;

        this.terrain.update(heroX, heroZ);
        this.terrain.setBiomes(a, b, t, this.elapsed);
        this.scatter.update(heroX, heroZ, a, b, t);
        this.props.update(heroX, heroZ, halfDiag, a, b, t);
        this.atmosphere.update(heroX, heroZ, a, b, t);
    }

    /** Perf-trim hook: stretch the shadow-map refresh interval. */
    public setShadowInterval(frames: number): void {
        this.atmosphere.setShadowInterval(frames);
    }

    /** The directional light that owns the shadow map — the gameplay layer
     *  flags heavy enemies as casters against it. */
    public getShadowLight() { return this.atmosphere.key; }

    /** Player-facing name of the dominant biome, for a biome-change toast. */
    public getBiomeLabel(): string {
        return this.currentT < 0.5 ? this.currentFrom.label : this.currentTo.label;
    }

    /**
     * Ambience bed name for the dominant biome. Switches at the blend midpoint
     * so the audio crossfade lands with the visual one rather than leading or
     * trailing it.
     */
    public getAmbienceName(): string {
        const id = this.currentT < 0.5 ? this.currentFrom.id : this.currentTo.id;
        switch (id) {
            case 'scorched': return 'ambienceScorched';
            case 'cursed':   return 'ambienceCursed';
            default:         return 'ambienceMeadow';
        }
    }

    public getDiagnostics(): WorldDiagnostics {
        return {
            biome: `${this.currentFrom.id}→${this.currentTo.id}`,
            blend: this.currentT,
            scatterInstances: this.scatter.getInstanceCount(),
            activeProps: this.props.getActiveCount(),
        };
    }

    public dispose(): void {
        this.terrain.dispose();
        this.scatter.dispose();
        this.props.dispose();
        this.atmosphere.dispose();
    }
}
