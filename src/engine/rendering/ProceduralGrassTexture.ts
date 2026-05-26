import { Scene, ProceduralTexture, Effect, Texture } from '@babylonjs/core';

/**
 * Procedural grass ground texture — Voronoi + multi-octave noise rendered
 * once at startup into a texture, then tiled across the arena ground.
 *
 * Math is ported from David Hoskins' "Rolling Hills" shader on Shadertoy
 * (https://www.shadertoy.com/view/Xsf3zX, CC BY-NC-SA 3.0). We strip the
 * raymarching and use only the top-down 2D techniques: Voronoi cells for
 * grass patches, FBM noise for medium variation, fine noise for fibre detail,
 * and the same colour palette (deep green ↔ dry yellow with white-green tips).
 *
 * Cost: one-shot render to a 1024² texture at boot. Zero per-frame cost.
 */

const SHADER_KEY = 'ktgGrassGround';

const FRAG = `
precision highp float;
varying vec2 vUV;

#define MOD2 vec2(3.07965, 7.4235)

float Hash(vec2 p) {
    p = fract(p / MOD2);
    p += dot(p.xy, p.yx + 19.19);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float Noise(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0;
    return mix(
        mix(Hash(vec2(n, 0.0)),       Hash(vec2(n + 1.0, 0.0)),  f.x),
        mix(Hash(vec2(n + 57.0, 0.0)),Hash(vec2(n + 58.0, 0.0)), f.x),
        f.y
    );
}

vec2 Voronoi(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    float res = 100.0;
    float idx = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 b = vec2(float(i), float(j));
            vec2 r = b - f + hash22(p + b);
            float d = dot(r, r);
            if (d < res) {
                res = d;
                idx = Hash(p + b);
            }
        }
    }
    return vec2(max(0.4 - sqrt(res), 0.0), idx);
}

float FractalNoise(vec2 xy) {
    float w = 0.7;
    float f = 0.0;
    for (int i = 0; i < 3; i++) {
        f += Noise(xy) * w;
        w = w * 0.6;
        xy = xy * 2.0;
    }
    return f;
}

void main(void) {
    // Sample at a high spatial frequency: ~200 Voronoi-cell space units across
    // the tile, which combined with size=2048 + tile=1 (texture covers the
    // whole arena once with no repetition) gives dense visible detail right
    // under the camera without visible seams.
    vec2 p = vUV * 200.0;

    // TWO Voronoi octaves of different scales — the first defines large
    // grass patches, the second adds smaller blade-clump detail inside them.
    vec2 vorA = Voronoi(p * 2.5);
    vec2 vorB = Voronoi(p * 7.0 + 13.7);
    float clumpShape = max(vorA.x, vorB.x * 0.7);
    float clumpID    = mix(vorA.y, vorB.y, 0.4);

    // Multi-scale FBM for patch variation (lighter/darker areas).
    float patches = FractalNoise(p * 0.30);

    // Two layers of fibre noise — coarse + fine for organic detail.
    float fibreCoarse = Noise(p * 4.0);
    float fibreFine   = Noise(p * 18.0);

    // Palette from Hoskins' TerrainColour: deep green ↔ olive ↔ yellow-dry.
    vec3 deepGreen = vec3(0.05, 0.22, 0.04);
    vec3 dryGreen  = vec3(0.22, 0.28, 0.06);
    vec3 base = mix(deepGreen, dryGreen, Noise(p * 0.025));

    // Per-clump tint — some clumps lean yellower/browner, with a small
    // fraction going quite dry for visual interest.
    vec3 clumpTint = mix(base, vec3(0.32, 0.30, 0.08), clumpID * 0.6);
    clumpTint = mix(clumpTint, vec3(0.42, 0.35, 0.10), pow(clumpID, 6.0) * 0.5);

    // Bright tips where Voronoi cells are dense — the "white-green tip" look
    // Hoskins mixes via pow(ret.y, 9.0) inside GrassBlades.
    vec3 tip = vec3(0.58, 0.65, 0.22);
    clumpTint = mix(clumpTint, tip, pow(clumpShape, 2.0) * 0.55);

    // Apply medium patch variation (lighter/darker bands across the ground).
    clumpTint *= patches * 0.7 + 0.55;

    // Two fibre noise passes for finer surface detail.
    clumpTint *= 0.80 + fibreCoarse * 0.15;
    clumpTint *= 0.92 + fibreFine * 0.08;

    // Tiny soil flecks: occasional dark spots from high-frequency noise.
    float fleck = step(0.88, Noise(p * 25.0));
    clumpTint = mix(clumpTint, vec3(0.06, 0.05, 0.02), fleck * 0.4);

    // Subtle gamma for richer greens (matches Hoskins' PostEffects gamma).
    clumpTint = pow(clumpTint, vec3(0.85));

    gl_FragColor = vec4(clumpTint, 1.0);
}
`;

export interface ProceduralGrassTextureOptions {
    /** Texture resolution. 1024 is a good balance of detail vs GPU memory. */
    size?: number;
    /** uScale/vScale on the result — how many times the texture tiles. */
    tile?: number;
}

/**
 * Builds and returns a ProceduralTexture rendered once at startup. The texture
 * sets refreshRate=0 (single render) so there's zero per-frame cost after init.
 *
 * The caller is responsible for disposing the texture when the scene exits.
 */
export function createProceduralGrassTexture(
    scene: Scene,
    opts: ProceduralGrassTextureOptions = {},
): ProceduralTexture {
    if (!Effect.ShadersStore[`${SHADER_KEY}FragmentShader`]) {
        Effect.ShadersStore[`${SHADER_KEY}FragmentShader`] = FRAG;
    }

    const size = opts.size ?? 1024;
    const tile = opts.tile ?? 4;

    const tex = new ProceduralTexture(
        'proceduralGrassGroundTex',
        size,
        SHADER_KEY,
        scene,
        null,
        true,   // generateMipMaps
    );
    tex.refreshRate = 0; // render once, never again
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.uScale = tile;
    tex.vScale = tile;
    return tex;
}
