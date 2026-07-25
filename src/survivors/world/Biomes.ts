/**
 * Biome table and wave→biome resolution for the rebuilt world.
 *
 * Dependency-free on purpose (no 'three' import, no DOM): the blend math is the
 * part most likely to regress silently, so it stays Vitest-testable. Colours are
 * plain [r, g, b] tuples in linear-ish 0..1 space; the renderer-side modules
 * convert to THREE.Color.
 *
 * Design contract (docs/world-rebuild-design.md): the biome is a *signal* of run
 * depth, never a mechanic. Nothing here may feed damage, speed, or spawn rates.
 */

export type BiomeId = 'meadow' | 'scorched' | 'cursed';

export type Rgb = readonly [number, number, number];

export interface BiomeGround {
    /** Dominant ground colour — the value the whole frame is keyed against. */
    base: Rgb;
    /** Secondary patch colour blended in by the low-frequency noise octave. */
    patch: Rgb;
    /** Crack/fissure colour, used by the high-frequency ridged octave. */
    crack: Rgb;
    /**
     * How strongly fissures show, 0..1.
     *
     * Load-bearing per biome: ridged noise produces a CONTINUOUS ridge network,
     * which on soft ground reads as scribbled-on doodles rather than cracking.
     * Living meadow turf should barely crack at all; baked and cursed earth
     * should crack hard. Do not raise the meadow value without looking at it.
     */
    crackStrength: number;
    /** Colour emitted from inside cracks (embers, rot veins). Black = none. */
    emissive: Rgb;
    /** Emissive strength; 0 for biomes with no glow. Feeds selective bloom. */
    emissiveStrength: number;
    /** Macro-variation scale. Higher = tighter, busier ground. */
    detailScale: number;
}

export interface BiomeScatter {
    /** Ground-tuft colour (grass, stubble, ash clumps). */
    tuft: Rgb;
    /** Pebble/debris colour. */
    debris: Rgb;
    /** Tufts per scatter tile — the readability/perf dial. */
    tuftDensity: number;
    /** Debris per scatter tile. */
    debrisDensity: number;
    /** Height multiplier for tufts; scorched/cursed ground is more barren. */
    tuftHeight: number;
}

export interface BiomeLighting {
    keyColor: Rgb;
    keyIntensity: number;
    fillColor: Rgb;
    fillIntensity: number;
    hemiSky: Rgb;
    hemiGround: Rgb;
    hemiIntensity: number;
}

export interface BiomeAtmosphere {
    fogColor: Rgb;
    /**
     * Fog band, expressed as DEPTH OFFSETS from the hero's focal plane — not as
     * absolute camera distances.
     *
     * This is the orthographic gotcha. THREE.Fog is driven by view-space depth
     * (`-mvPosition.z`), and the iso camera sits ISO_CLIP_DISTANCE (220) units
     * back along the view diagonal purely for clipping. Absolute near/far values
     * tuned for the old perspective rig would put every single fragment past
     * `far`, so the screen would render as flat fog colour. Atmosphere adds
     * ISO_CLIP_DISTANCE to these offsets to get the real fog band.
     *
     * Because the ground is tilted ~35° to the view axis, ground depth spans
     * roughly ±33 around the hero plane at default zoom. So positive offsets
     * haze the far (upper) half of the screen and leave the hero crisp — which
     * is the only depth cue an orthographic frame has.
     */
    fogNearOffset: number;
    fogFarOffset: number;
    /**
     * Renderer clear colour. Under this projection the ground plane covers the
     * whole frame and no sky is ever visible (see World's note), so this only
     * shows through if the terrain ever fails to draw — it doubles as a
     * black-screen tell rather than an art surface.
     */
    clearColor: Rgb;
    /** Ground mist opacity, 0..1. Capped low by the readability promise. */
    mist: number;
    mistColor: Rgb;
}

export interface BiomeDef {
    id: BiomeId;
    /** Player-facing name, shown on the biome-change toast. */
    label: string;
    /** First wave this biome owns. */
    startWave: number;
    ground: BiomeGround;
    scatter: BiomeScatter;
    lighting: BiomeLighting;
    atmosphere: BiomeAtmosphere;
    /** Prop-kit ids eligible in this biome (see PropScatter's registry). */
    props: readonly string[];
}

/**
 * The three bands. Ordered by startWave; resolveBiome depends on that ordering.
 *
 * Ground `base` values are deliberately kept inside a narrow mid-dark luminance
 * band (~0.10-0.22 relative luminance) across all three biomes. That is the
 * readability promise: bright enemies, drops and power VFX separate from the
 * ground by luminance in every biome, so the player never has to rely on hue.
 */
export const BIOMES: readonly BiomeDef[] = [
    {
        id: 'meadow',
        label: 'Verdant Wake',
        startWave: 1,
        ground: {
            base: [0.13, 0.18, 0.09],
            patch: [0.22, 0.24, 0.11],
            crack: [0.09, 0.11, 0.07],
            crackStrength: 0.12,
            emissive: [0, 0, 0],
            emissiveStrength: 0,
            detailScale: 1.0,
        },
        scatter: {
            tuft: [0.28, 0.40, 0.15],
            debris: [0.30, 0.29, 0.26],
            tuftDensity: 1.0,
            debrisDensity: 0.35,
            tuftHeight: 1.0,
        },
        lighting: {
            keyColor: [1.0, 0.86, 0.66],
            keyIntensity: 1.35,
            fillColor: [0.55, 0.62, 0.85],
            fillIntensity: 0.85,
            hemiSky: [0.62, 0.66, 0.78],
            hemiGround: [0.30, 0.28, 0.22],
            hemiIntensity: 0.95,
        },
        atmosphere: {
            fogColor: [0.42, 0.38, 0.44],
            fogNearOffset: 26,
            fogFarOffset: 78,
            clearColor: [0.16, 0.14, 0.18],
            mist: 0.0,
            mistColor: [0.55, 0.52, 0.55],
        },
        props: ['standing_stones', 'monolith'],
    },
    {
        id: 'scorched',
        label: 'Scorched Reach',
        startWave: 10,
        ground: {
            base: [0.11, 0.08, 0.07],
            patch: [0.19, 0.13, 0.09],
            crack: [0.05, 0.04, 0.04],
            crackStrength: 0.7,
            emissive: [1.0, 0.34, 0.06],
            emissiveStrength: 0.55,
            detailScale: 1.35,
        },
        scatter: {
            tuft: [0.17, 0.13, 0.10],
            debris: [0.14, 0.12, 0.11],
            tuftDensity: 0.55,
            debrisDensity: 0.85,
            tuftHeight: 0.6,
        },
        lighting: {
            keyColor: [1.0, 0.62, 0.34],
            keyIntensity: 1.25,
            fillColor: [0.45, 0.40, 0.52],
            fillIntensity: 0.7,
            hemiSky: [0.52, 0.38, 0.32],
            hemiGround: [0.26, 0.16, 0.12],
            hemiIntensity: 0.85,
        },
        atmosphere: {
            fogColor: [0.34, 0.22, 0.19],
            fogNearOffset: 20,
            fogFarOffset: 66,
            clearColor: [0.13, 0.09, 0.09],
            mist: 0.06,
            mistColor: [0.45, 0.30, 0.24],
        },
        props: ['burnt_tree', 'ruined_arch', 'monolith'],
    },
    {
        id: 'cursed',
        label: 'Cursed Hollow',
        startWave: 20,
        ground: {
            base: [0.10, 0.10, 0.12],
            patch: [0.20, 0.19, 0.22],
            crack: [0.07, 0.06, 0.09],
            crackStrength: 0.5,
            emissive: [0.62, 0.28, 0.95],
            emissiveStrength: 0.40,
            detailScale: 1.15,
        },
        scatter: {
            tuft: [0.20, 0.19, 0.22],
            debris: [0.52, 0.50, 0.48],
            tuftDensity: 0.4,
            debrisDensity: 1.0,
            tuftHeight: 0.5,
        },
        lighting: {
            keyColor: [0.72, 0.66, 1.0],
            keyIntensity: 1.1,
            fillColor: [0.40, 0.62, 0.60],
            fillIntensity: 0.6,
            hemiSky: [0.40, 0.38, 0.52],
            hemiGround: [0.18, 0.18, 0.22],
            hemiIntensity: 0.8,
        },
        atmosphere: {
            fogColor: [0.24, 0.21, 0.30],
            fogNearOffset: 14,
            fogFarOffset: 56,
            clearColor: [0.09, 0.08, 0.12],
            mist: 0.13,
            mistColor: [0.42, 0.38, 0.50],
        },
        props: ['bone_pile', 'goblin_totem', 'monolith'],
    },
] as const;

/** Waves over which one biome cross-fades into the next. */
export const BIOME_TRANSITION_WAVES = 1.5;

export interface BiomeBlend {
    /** Outgoing biome. */
    from: BiomeDef;
    /** Incoming biome. `from` when no transition is active. */
    to: BiomeDef;
    /** 0 = fully `from`, 1 = fully `to`. */
    t: number;
}

/** Index of the biome band owning `wave`. */
export function biomeIndexForWave(wave: number): number {
    let idx = 0;
    for (let i = 0; i < BIOMES.length; i++) {
        if (wave >= BIOMES[i].startWave) idx = i;
    }
    return idx;
}

/** The biome band owning `wave`, ignoring transitions. */
export function biomeForWave(wave: number): BiomeDef {
    return BIOMES[biomeIndexForWave(wave)];
}

/**
 * Target blend for a wave. The transition opens BIOME_TRANSITION_WAVES before
 * the next band's startWave, so the change lands across a wave boundary — which
 * is where the wave-clear breathing room is (see the design doc's recovery
 * beats). Waves at or past the last band never transition.
 *
 * `wave` may be fractional; callers that only have an integer wave still get a
 * smooth result because the World eases toward this target over time.
 */
export function resolveBiomeBlend(wave: number): BiomeBlend {
    const i = biomeIndexForWave(wave);
    const from = BIOMES[i];
    const next = BIOMES[i + 1];
    if (!next) return { from, to: from, t: 0 };

    const transitionStart = next.startWave - BIOME_TRANSITION_WAVES;
    if (wave < transitionStart) return { from, to: from, t: 0 };

    const t = Math.min(1, Math.max(0, (wave - transitionStart) / BIOME_TRANSITION_WAVES));
    return { from, to: next, t };
}

// ── Interpolation helpers ────────────────────────────────────────────────────
// The renderer modules blend whole biome records every frame, so these stay
// allocation-light: colour lerps write into a caller-owned 3-tuple.

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function lerpRgb(a: Rgb, b: Rgb, t: number, out: [number, number, number]): void {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
}

/**
 * Relative luminance of a biome ground base — used by the readability assertion
 * in World, which fails loudly in dev if a future biome edit pushes the ground
 * outside the band that keeps enemies legible against it.
 */
export function luminance(c: Rgb): number {
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Bounds of the readability promise. Ground must stay dark enough that bright
 *  enemies and VFX separate by luminance alone. */
export const GROUND_LUMINANCE_MIN = 0.05;
export const GROUND_LUMINANCE_MAX = 0.30;
