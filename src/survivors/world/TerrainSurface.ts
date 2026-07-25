import { Color, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import type { BiomeDef } from './Biomes';
import { TERRAIN_EXTENT } from './WorldConstants';

/**
 * The ground.
 *
 * A single flat quad that follows the hero, shaded entirely in the fragment
 * shader from WORLD-space XZ. Because the pattern is derived from world
 * coordinates, the quad can be recentred on the hero every frame and the
 * terrain still appears bolted to the world — no UV counter-scrolling, no
 * texture "swim", and no seams to hide.
 *
 * Why no curvature: the old globe ground baked a curve into its vertices to
 * fake a horizon. Orthographic projection has no vanishing point, so a curved
 * cap buys nothing and only fights the lighting (its tilted normals were the
 * source of the old "dark ellipse" bug). Flat is both cheaper and correct here.
 *
 * Why MeshStandardMaterial + onBeforeCompile rather than a raw ShaderMaterial:
 * this surface has to receive the directional shadow map and the scene fog. A
 * raw ShaderMaterial would mean reimplementing both. Injecting into the stock
 * PBR shader keeps shadows, fog, tone mapping, and light probes for free, and
 * costs only the noise ALU.
 *
 * Cost: 2 triangles, 1 draw call, no textures. All ground detail is procedural,
 * which is what lets three biomes coexist without three texture sets resident.
 */

const TERRAIN_SHADER_KEY = 'ktg-terrain-biome-v1';

/** GLSL shared by the injection. Value noise + FBM + ridged noise for fissures. */
const TERRAIN_GLSL = /* glsl */`
float ktgHash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float ktgNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = ktgHash21(i);
    float b = ktgHash21(i + vec2(1.0, 0.0));
    float c = ktgHash21(i + vec2(0.0, 1.0));
    float d = ktgHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float ktgFbm(vec2 p){
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ s += a * ktgNoise(p); p *= 2.03; a *= 0.5; }
    return s;
}
/* Ridged noise, tightened into thin fissures rather than broad valleys. */
float ktgRidge(vec2 p){
    return 1.0 - abs(ktgNoise(p) * 2.0 - 1.0);
}

/* One biome's ground colour at a world-space point.
   crackOut returns the fissure mask so the caller can drive emissive glow. */
vec3 ktgBiomeGround(
    vec3 base, vec3 patchCol, vec3 crackCol, float detailScale, float crackStrength,
    vec2 wp, out float crackOut
){
    /* Macro patches: large slow variation that breaks up flat colour.
       ~14-unit wavelength — big enough to read as terrain variation, small
       enough that several patches are always in frame. */
    float macro = ktgFbm(wp * 0.07 * detailScale);
    vec3 col = mix(base, patchCol, smoothstep(0.38, 0.78, macro));

    /* Mid grain: the scale the eye actually reads as "ground". */
    float mid = ktgFbm(wp * 0.30 * detailScale);
    col *= 0.80 + 0.36 * mid;

    /* Micro speckle: stops the surface looking like airbrushed vector art
       when a prop or the hero is next to it for scale. */
    float micro = ktgNoise(wp * 1.7 * detailScale);
    col *= 0.92 + 0.16 * micro;

    /* Fissures: ridged noise raised to a high power so only the ridge crests
       survive, producing thin cracks instead of a marbled mush.
       Frequency matters enormously here — at 0.085 the "cracks" came out as
       12-unit-wide ribbons that read as roads carved across the field. 0.55
       puts them at roughly a 2-unit wavelength, which reads as ground cracking. */
    float r = ktgRidge(wp * 0.55 * detailScale);
    r = pow(r, 8.0);
    crackOut = smoothstep(0.45, 0.92, r);

    /* Gate cracks by a large-scale mask so they appear in dry PATCHES rather
       than as one unbroken network across the whole field. An ungated ridge
       network reads as scribble, not as ground. */
    float dryness = smoothstep(0.35, 0.72, ktgFbm(wp * 0.045 * detailScale + 17.3));

    /* Fragment the ridges. Ridged noise produces CLOSED LOOPS, which at any
       real strength read as drawn spaghetti rather than as cracking. Breaking
       them with a higher-frequency mask turns continuous loops into segments,
       which is what actual cracked earth looks like. */
    float breakup = smoothstep(0.30, 0.62, ktgNoise(wp * 2.1 * detailScale + 41.7));

    crackOut *= dryness * breakup * crackStrength;

    col = mix(col, crackCol, crackOut * 0.80);
    return col;
}
`;

export class TerrainSurface {
    private readonly mesh: Mesh;
    private readonly material: MeshStandardMaterial;
    private readonly geometry: PlaneGeometry;
    /** Set once onBeforeCompile has run; uniforms are written through it. */
    private shader: { uniforms: Record<string, { value: unknown }> } | null = null;

    private readonly _cA = new Color();
    private readonly _cB = new Color();

    constructor(host: SceneHost) {
        // 1 segment: the surface is flat, so extra vertices would buy nothing.
        // All variation lives in the fragment shader.
        this.geometry = new PlaneGeometry(TERRAIN_EXTENT, TERRAIN_EXTENT, 1, 1);
        this.geometry.rotateX(-Math.PI / 2);

        this.material = new MeshStandardMaterial({
            name: 'worldTerrain',
            color: 0xffffff,
            roughness: 0.96,
            metalness: 0.0,
        });

        this.material.onBeforeCompile = (shader) => {
            shader.uniforms.uBaseA      = { value: new Color(0.13, 0.18, 0.09) };
            shader.uniforms.uPatchA     = { value: new Color(0.22, 0.24, 0.11) };
            shader.uniforms.uCrackA     = { value: new Color(0.09, 0.11, 0.07) };
            shader.uniforms.uEmisA      = { value: new Color(0, 0, 0) };
            shader.uniforms.uEmisStrA   = { value: 0 };
            shader.uniforms.uDetailA    = { value: 1 };
            shader.uniforms.uCrackStrA  = { value: 1 };
            shader.uniforms.uBaseB      = { value: new Color(0.13, 0.18, 0.09) };
            shader.uniforms.uPatchB     = { value: new Color(0.22, 0.24, 0.11) };
            shader.uniforms.uCrackB     = { value: new Color(0.09, 0.11, 0.07) };
            shader.uniforms.uEmisB      = { value: new Color(0, 0, 0) };
            shader.uniforms.uEmisStrB   = { value: 0 };
            shader.uniforms.uDetailB    = { value: 1 };
            shader.uniforms.uCrackStrB  = { value: 1 };
            shader.uniforms.uBlend      = { value: 0 };
            shader.uniforms.uTime       = { value: 0 };

            shader.vertexShader =
                'varying vec2 vTerrainWorld;\n' +
                shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>
                     vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xz;`,
                );

            shader.fragmentShader =
                `varying vec2 vTerrainWorld;
                 uniform vec3 uBaseA, uPatchA, uCrackA, uEmisA;
                 uniform vec3 uBaseB, uPatchB, uCrackB, uEmisB;
                 uniform float uEmisStrA, uEmisStrB, uDetailA, uDetailB, uBlend, uTime;
                 uniform float uCrackStrA, uCrackStrB;
                 ${TERRAIN_GLSL}\n` +
                shader.fragmentShader
                    .replace(
                        '#include <map_fragment>',
                        `#include <map_fragment>
                         float crackA, crackB;
                         vec3 gA = ktgBiomeGround(uBaseA, uPatchA, uCrackA, uDetailA, uCrackStrA, vTerrainWorld, crackA);
                         vec3 gB = ktgBiomeGround(uBaseB, uPatchB, uCrackB, uDetailB, uCrackStrB, vTerrainWorld, crackB);
                         diffuseColor.rgb *= mix(gA, gB, uBlend);`,
                    )
                    .replace(
                        '#include <emissivemap_fragment>',
                        `#include <emissivemap_fragment>
                         /* Embers / rot veins live INSIDE the fissures only, so the
                            glow reads as coming from the crack rather than as a
                            surface-wide tint. Slow breathing keeps it alive without
                            drawing the eye off the swarm. */
                         float pulse = 0.72 + 0.28 * sin(uTime * 1.7 + vTerrainWorld.x * 0.35 + vTerrainWorld.y * 0.27);
                         /* Cube the mask so only the deepest core of a fissure
                            glows. Using the raw mask lit the entire crack width
                            and turned the field into glowing noodles. */
                         float coreA = crackA * crackA * crackA;
                         float coreB = crackB * crackB * crackB;
                         vec3 emisA = uEmisA * (coreA * uEmisStrA);
                         vec3 emisB = uEmisB * (coreB * uEmisStrB);
                         totalEmissiveRadiance += mix(emisA, emisB, uBlend) * pulse;`,
                    );

            this.shader = shader as unknown as { uniforms: Record<string, { value: unknown }> };
        };
        // Without this, three can hand back a program compiled from a different
        // (un-injected) MeshStandardMaterial and silently drop the terrain shader.
        this.material.customProgramCacheKey = () => TERRAIN_SHADER_KEY;

        this.mesh = new Mesh(this.geometry, this.material);
        this.mesh.name = 'worldTerrain';
        this.mesh.receiveShadow = true;
        // Always in view by construction (it follows the hero and is far larger
        // than the frame), so culling it is pure overhead and risks a 1-frame gap.
        this.mesh.frustumCulled = false;
        // Render before everything else so scatter/props/mist composite on top.
        this.mesh.renderOrder = -10;
        this.mesh.position.y = 0;
        host.scene.add(this.mesh);
    }

    /** Push a biome pair + blend factor into the shader. */
    public setBiomes(a: BiomeDef, b: BiomeDef, blend: number, timeSeconds: number): void {
        const s = this.shader;
        if (!s) return; // not compiled yet; next frame picks it up
        const u = s.uniforms;

        (u.uBaseA.value as Color).setRGB(...(a.ground.base as unknown as [number, number, number]));
        (u.uPatchA.value as Color).setRGB(...(a.ground.patch as unknown as [number, number, number]));
        (u.uCrackA.value as Color).setRGB(...(a.ground.crack as unknown as [number, number, number]));
        (u.uEmisA.value as Color).setRGB(...(a.ground.emissive as unknown as [number, number, number]));
        u.uEmisStrA.value = a.ground.emissiveStrength;
        u.uDetailA.value = a.ground.detailScale;
        u.uCrackStrA.value = a.ground.crackStrength;

        (u.uBaseB.value as Color).setRGB(...(b.ground.base as unknown as [number, number, number]));
        (u.uPatchB.value as Color).setRGB(...(b.ground.patch as unknown as [number, number, number]));
        (u.uCrackB.value as Color).setRGB(...(b.ground.crack as unknown as [number, number, number]));
        (u.uEmisB.value as Color).setRGB(...(b.ground.emissive as unknown as [number, number, number]));
        u.uEmisStrB.value = b.ground.emissiveStrength;
        u.uDetailB.value = b.ground.detailScale;
        u.uCrackStrB.value = b.ground.crackStrength;

        u.uBlend.value = blend;
        u.uTime.value = timeSeconds;
    }

    /** Recentre on the hero. The world-space shading makes this invisible. */
    public update(heroX: number, heroZ: number): void {
        this.mesh.position.x = heroX;
        this.mesh.position.z = heroZ;
    }

    public getMesh(): Mesh { return this.mesh; }

    public dispose(): void {
        this.mesh.removeFromParent();
        this.geometry.dispose();
        this.material.dispose();
        this.shader = null;
        void this._cA; void this._cB;
    }
}
