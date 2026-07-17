import {
    BufferGeometry,
    Color,
    DirectionalLight,
    DoubleSide,
    Float32BufferAttribute,
    Fog,
    InstancedMesh,
    Matrix4,
    Quaternion,
    ShaderMaterial,
    Vector2,
    Vector3,
} from 'three';
import type { SceneHost, UpdateToken } from '../three/SceneHost';
import { disposeMesh } from '../three/primitives';
import { V3_UP } from '../three/math';

/**
 * Procedural grass — N hardware-instanced multi-segment curved blades with a
 * vertex-shader sin-based wind animation, per-vertex normals for directional
 * lighting (diffuse + cheap spec + ambient occlusion), a root→tip color
 * gradient, and a per-frame point-light contribution for the hero torch.
 *
 * Blade geometry technique ported from spacejack's "Terra" demo (MIT).
 *
 * No textures (beyond the optional shadow map), no shader defines beyond the
 * two feature toggles — keeps the pipeline trivial. One draw call.
 */

// Default blade curve segments. 4 segments → 5 height levels per side, 2 edges,
// 2 faces (front + back). 5 × 2 × 2 = 20 verts, 16 triangles per blade.
const BLADE_SEGS = 4;

/** Max simultaneous character displacement sources passed to the shader.
 *  Mirrors the const MAX_INFLUENCERS in the vertex shader. */
const MAX_INFLUENCERS = 8;

/** Depth-compare bias for the manual shadow sample (replaces the Babylon
 *  ShadowGenerator's ESM depth-scale tolerance). */
const SHADOW_BIAS = 0.0015;

// ──────────────────────────────────────────────────────────────────────────────
// Shaders. Three's ShaderMaterial auto-injects the precision header, the
// position/uv attribute declarations, the projectionMatrix/viewMatrix/
// cameraPosition uniforms and (because the mesh is an InstancedMesh) the
// per-instance `instanceMatrix` mat4 attribute — none are redeclared here.
// ──────────────────────────────────────────────────────────────────────────────

const VERT = `
uniform float uTime;
uniform float uWindStrength;

// Character displacement: up to 8 "influencer" world-XZ positions (Y unused).
// Unused slots are set to a far-away point so the distance-based falloff
// naturally zeros them out without branching. Array size hardcoded to 8
// (matches MAX_INFLUENCERS const on the JS side).
uniform vec3 uInfluencers[8];
uniform float uInfluencerRadius;
uniform float uInfluencerStrength;

// Infinite-map treadmill + globe curvature (see src/survivors/globe/).
uniform vec3 uHeroPos;
uniform float uTileSize;
uniform float uCurveRadius;
// Radial height fade: blades collapse to zero height between uFadeStart and
// uFadeEnd (distance from the hero). Lets a large far-field tile clip cleanly
// inside the terrain cap instead of floating past its rim. Defaults huge = off.
uniform float uFadeStart;
uniform float uFadeEnd;

#ifdef RECEIVE_SHADOWS
// directionalLight.shadow.matrix — already includes the 0.5-bias transform,
// so vShadowCoord.xyz/w is directly in [0,1] shadow-map UV + depth space.
uniform mat4 uShadowVP;
#endif

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vHPct;
varying float vColorSeed;
#ifdef RECEIVE_SHADOWS
varying vec4 vShadowCoord;
#endif

float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
}

vec2 rotYZ(vec2 yz, float c, float s) {
    return vec2(yz.x * c - yz.y * s, yz.x * s + yz.y * c);
}

void main(void) {
    // position: x in [-0.5, 0.5], y in [0, 1], z = face sign (+1/-1)
    // uv: x = edge (0/1), y = hpct (0..1)
    mat4 finalWorld = instanceMatrix;
    vec4 world3 = instanceMatrix[3];

    float hpct = uv.y;
    float aSide = sign(position.z);

    // Local blade-space position. Taper edges toward the tip (terra trick).
    vec3 lpos = vec3(
        position.x * (1.0 - pow(hpct, 3.0)),
        position.y,
        0.0
    );
    vec3 lnorm = vec3(0.0, 0.0, aSide);

    // Per-blade lean + curve from a hash of the blade origin (world matrix
    // translation column) — gives organic variety with no per-instance attrs.
    float bladeSeed = world3.x * 12.9898 + world3.z * 78.233;
    float lean = (hash11(bladeSeed) - 0.5) * 0.4;
    float curveBase = 0.05 + hash11(bladeSeed + 1.7) * 0.35;
    float curve = curveBase + 0.125 * sin(uTime * 4.0 + bladeSeed);
    float rot = lean + curve * hpct;
    float cR = cos(rot), sR = sin(rot);
    vec2 yz = rotYZ(vec2(lpos.y, lpos.z), cR, sR);
    lpos.y = yz.x; lpos.z = yz.y;
    vec2 nyz = rotYZ(vec2(lnorm.y, lnorm.z), cR, sR);
    lnorm.y = nyz.x; lnorm.z = nyz.y;

    // To world space. Matrix carries position + Y-rotation + non-uniform
    // scale (sx, sy, 1); the Z-scale stays 1 so the flat blade normal is
    // preserved when we transform it by mat3(finalWorld).
    vec4 wp4 = finalWorld * vec4(lpos, 1.0);
    vec3 worldPos = wp4.xyz;
    vec3 worldNorm = normalize(mat3(finalWorld) * lnorm);

    // Infinite-map treadmill: wrap the whole blade (instance origin world3, not
    // the vertex — the blade must wrap as a unit) into a uTileSize² tile centred
    // on the hero, then sink it by the globe curvature. The wrap offset is a
    // multiple of uTileSize, so a blade's wrapped position is stable until it
    // crosses the tile edge (always far behind the camera).
    vec2 rel = world3.xz - uHeroPos.xz;
    vec2 wrapOffset = (mod(rel + 0.5 * uTileSize, uTileSize) - 0.5 * uTileSize) - rel;
    worldPos.xz += wrapOffset;
    vec2 rootToHero = (world3.xz + wrapOffset) - uHeroPos.xz;
    // Radial height fade (uFadeStart/uFadeEnd) — collapse blades toward the
    // ground before the curvature sink so faded blades are degenerate (no
    // pixels) instead of floating past the terrain cap's rim.
    worldPos.y *= 1.0 - smoothstep(uFadeStart, uFadeEnd, length(rootToHero));
    worldPos.y -= dot(rootToHero, rootToHero) / (2.0 * uCurveRadius);

    // Character displacement — each influencer pushes nearby blades outward
    // along the XZ vector from influencer to blade. Falloff is (1 - d/r)²,
    // so the effect dies off smoothly past the radius. Tips bend more than
    // roots via hpct². No branching — far-away unused slots just contribute 0.
    // Compiled out entirely (INFLUENCERS define) for layers whose blades
    // characters never reach — this loop dominates the vertex cost.
#ifdef INFLUENCERS
    vec2 push = vec2(0.0);
    for (int i = 0; i < 8; i++) {
        vec2 to = worldPos.xz - uInfluencers[i].xz;
        float d = length(to);
        float falloff = max(0.0, 1.0 - d / uInfluencerRadius);
        falloff = falloff * falloff;
        // Normalised direction; +1e-5 in denom guards against d=0.
        push += to / (d + 1e-5) * falloff;
    }
    // Per-blade randomness so the patch under a character doesn't bend
    // uniformly — blades push between 0.35× and 1.0× the baseline. Adds a
    // small per-blade time wobble (~10% amplitude) so pushed blades feel
    // alive instead of statically pinned over.
    float pushJitter = 0.35 + hash11(bladeSeed + 5.0) * 0.65;
    float pushWobble = 1.0 + sin(uTime * 6.0 + bladeSeed * 12.0) * 0.10;
    push *= uInfluencerStrength * pushJitter * pushWobble * hpct * hpct;
    worldPos.x += push.x;
    worldPos.z += push.y;
#endif

    // Subtle ambient sway so blades aren't completely still when no one's
    // nearby — much smaller amplitude than before since the headline motion
    // now comes from characters walking through.
    float phase = worldPos.x * 0.55 + worldPos.z * 0.45;
    float ambientSway = sin(uTime * 0.9 + phase) * uWindStrength * 0.15 * hpct * hpct;
    worldPos.x += ambientSway;

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);

    vWorldPos = worldPos;
    vWorldNormal = worldNorm;
    vHPct = hpct;
    vColorSeed = fract(sin(dot(worldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);

    #ifdef RECEIVE_SHADOWS
    vShadowCoord = uShadowVP * vec4(worldPos, 1.0);
    #endif
}
`;

const FRAG = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vHPct;
varying float vColorSeed;
#ifdef RECEIVE_SHADOWS
varying vec4 vShadowCoord;
#endif

uniform vec3 uColorRoot;
uniform vec3 uColorTip;
uniform vec3 uColorDry;

// Directional sun light (the survivorsKey directional).
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;

// Hero torch (point light). uTorchIntensity = 0 disables it cheaply.
uniform vec3  uTorchPos;
uniform vec3  uTorchColor;
uniform float uTorchIntensity;
uniform float uTorchRange;

// Horizon distance fog — mirrors the scene's linear fog so the custom-shader
// grass hazes into the same band as the MeshPhongMaterial ground/props (Three
// does not auto-inject fog into a bare ShaderMaterial). uFogEnabled = 0
// disables it. Radial camera distance (close enough to Three's view-space
// depth here; the far blades are near-zero height through the band anyway).
uniform float uFogEnabled;
uniform vec3  uFogColor;
uniform float uFogStart;
uniform float uFogEnd;

#ifdef RECEIVE_SHADOWS
// Three PCF-path shadow map: RGBA-packed depth (see <packing>). Sampled
// manually with a 4-tap PCF for softness (replaces the Babylon ESM compare).
#include <packing>
uniform sampler2D uShadowMap;
uniform float uShadowDarkness;
uniform vec2  uShadowMapSize;

float shadowDepthAt(vec2 uvs) {
    return unpackRGBAToDepth(texture2D(uShadowMap, uvs));
}

float sampleShadow() {
    // uShadowVP (light.shadow.matrix) already maps to [0,1] UV + depth — no
    // ndc*0.5+0.5 remap needed. Sample unconditionally and mix away the
    // result for out-of-frustum coords.
    vec3 coord = vShadowCoord.xyz / vShadowCoord.w;
    float ref = coord.z - ${SHADOW_BIAS.toFixed(5)};
    vec2 texel = 1.0 / uShadowMapSize;
    float lit = 0.0;
    lit += step(ref, shadowDepthAt(coord.xy + texel * vec2(-0.5, -0.5)));
    lit += step(ref, shadowDepthAt(coord.xy + texel * vec2( 0.5, -0.5)));
    lit += step(ref, shadowDepthAt(coord.xy + texel * vec2(-0.5,  0.5)));
    lit += step(ref, shadowDepthAt(coord.xy + texel * vec2( 0.5,  0.5)));
    float visibility = lit * 0.25;
    float shadowFactor = mix(uShadowDarkness, 1.0, visibility);

    float inFrustum = step(0.001, coord.x) * step(coord.x, 0.999)
                    * step(0.001, coord.y) * step(coord.y, 0.999)
                    * step(coord.z, 1.0);
    return mix(1.0, shadowFactor, inFrustum);
}
#endif

void main(void) {
    // Base blade color — root→tip gradient with ~25% of blades shifted dry.
    // Per-blade brightness jitter (±10%) breaks up the uniform look so
    // dense fields don't read as a solid green carpet.
    vec3 tip = mix(uColorTip, uColorDry, smoothstep(0.65, 1.0, vColorSeed));
    vec3 base = mix(uColorRoot, tip, vHPct);
    float bladeBrightness = 0.9 + vColorSeed * 0.2;
    base *= bladeBrightness;

    // Directional diffuse using abs(N.L) so the back of a blade is lit too
    // — grass leaves are translucent, this is terra's translucency trick.
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(-uLightDir);
    float diffuse = abs(dot(N, L));

    // Gentle AO — root subtly darker than tip but not crushed.
    float ao = 1.0 - vHPct;
    ao = 1.0 - ao * ao * 0.25;

    #ifdef RECEIVE_SHADOWS
    float shadow = sampleShadow();
    #else
    float shadow = 1.0;
    #endif

    vec3 lit = base * (uAmbient + uLightColor * diffuse * shadow) * ao;

    if (uTorchIntensity > 0.0) {
        float d = distance(vWorldPos, uTorchPos);
        float f = max(0.0, 1.0 - d / uTorchRange);
        lit += uTorchColor * (f * f) * uTorchIntensity * 0.6;
    }

    // Horizon fog: linear blend toward the sky band by camera distance.
    // cameraPosition is Three's auto-injected fragment uniform.
    if (uFogEnabled > 0.5) {
        float fogDist = distance(vWorldPos, cameraPosition);
        // Smoothstep instead of the scene fog's linear ramp: the linear ramp's
        // slope discontinuity at uFogStart reads as a visible arc across the
        // field; smoothstep is C1 at both ends so the haze has no seam.
        float fogVis = smoothstep(0.0, 1.0, clamp((uFogEnd - fogDist) / (uFogEnd - uFogStart), 0.0, 1.0));
        lit = mix(uFogColor, lit, fogVis);
    }

    gl_FragColor = vec4(lit, 1.0);
}
`;

// ──────────────────────────────────────────────────────────────────────────────
// Blade geometry — 5 height levels × 2 edges × 2 faces = 20 vertices, 16
// triangles. Face sign (+1 front / -1 back) is encoded in position.z so we
// don't need any custom vertex attributes.
// ──────────────────────────────────────────────────────────────────────────────

function buildBladeGeometry(width: number, height: number, segs: number = BLADE_SEGS): BufferGeometry {
    const divs = segs + 1;
    const vertsPerSide = divs * 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let face = 0; face < 2; face++) {
        const side = face === 0 ? 1 : -1;
        for (let i = 0; i < divs; i++) {
            const t = i / segs;
            positions.push(-0.5 * width, t * height, side);
            uvs.push(0, t);
            positions.push(0.5 * width, t * height, side);
            uvs.push(1, t);
        }
    }

    // Front face winding.
    let vc = 0;
    for (let seg = 0; seg < segs; seg++) {
        indices.push(vc + 0, vc + 1, vc + 2, vc + 2, vc + 1, vc + 3);
        vc += 2;
    }
    // Back face — reversed winding so the back triangles face the opposite way.
    vc = vertsPerSide;
    for (let seg = 0; seg < segs; seg++) {
        indices.push(vc + 2, vc + 1, vc + 0, vc + 3, vc + 1, vc + 2);
        vc += 2;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public factory
// ──────────────────────────────────────────────────────────────────────────────

export interface ProceduralGrassOptions {
    /** Edge length of the toroidal grass tile centred on the hero. Blades are
     *  placed once in this square; the vertex shader wraps them around the
     *  hero as it moves (treadmill — zero per-frame buffer updates). */
    tileSize: number;
    /** Globe curvature radius (same R the rest of the world uses). */
    curveRadius: number;
    bladeCount: number;
    rootY?: number;
    bladeWidth?: number;
    bladeHeight?: number;
    windStrength?: number;
    colorRoot?: Color;
    colorTip?: Color;
    colorDry?: Color;
    /** Directional light used for diffuse lighting. If omitted, a default
     *  sun direction + colour are used. */
    directionalLight?: DirectionalLight;
    lightDirection?: Vector3;
    ambientColor?: Color;
    /** Optional shadow-casting DirectionalLight whose PCF shadow map the
     *  fragment shader samples manually (RGBA-packed depth). If omitted, the
     *  shader is compiled without shadow receive code at all. */
    shadowLight?: DirectionalLight;
    /** Shadowed-area light factor floor (Babylon ShadowGenerator.darkness). */
    shadowDarkness?: number;
    /** Radius (world units) around each character within which blades bend. */
    influencerRadius?: number;
    /** Max tip displacement (world units) at the centre of an influencer. */
    influencerStrength?: number;
    /** Radial height fade (distance from the hero): blades shrink from full
     *  height at fadeStart to zero at fadeEnd. Use on a large far-field tile
     *  so blades never float past the terrain cap's rim. Omit = no fade. */
    fadeStart?: number;
    fadeEnd?: number;
    /** Curve segments per blade (default 4 → 20 verts). Far-field layers can
     *  drop to 2 (12 verts) — the curve detail is invisible at distance. */
    bladeSegments?: number;
    /** false compiles the shader WITHOUT the 8-influencer bend loop (the
     *  dominant vertex cost). Use for layers characters never walk through.
     *  setInfluencers becomes a no-op. Default true. */
    influencers?: boolean;
}

export interface ProceduralGrass {
    mesh: InstancedMesh;
    setTorch: (params: { position: Vector3; color: Color; intensity: number; range: number } | null) => void;
    /** Set the world-XZ positions of characters that should bend the grass
     *  as they pass through. Up to 8 positions; extras are dropped. Call
     *  every frame with current positions of hero + visible enemies. */
    setInfluencers: (positions: Vector3[]) => void;
    /** Per-frame: the hero's world position — centre of the wrap tile and
     *  origin of the curvature drop. */
    setHeroPos: (position: Vector3) => void;
    dispose: () => void;
}

export function createProceduralGrass(host: SceneHost, opts: ProceduralGrassOptions): ProceduralGrass {
    const width = opts.bladeWidth ?? 0.10;
    const height = opts.bladeHeight ?? 0.55;
    const rootY = opts.rootY ?? 0.003;
    const geo = buildBladeGeometry(width, height, opts.bladeSegments ?? BLADE_SEGS);

    const usingShadows = !!opts.shadowLight;
    const usingInfluencers = opts.influencers !== false;

    // Initialise influencer slots to a far-away point so they contribute 0.
    // The Float32Array IS the uniform value — setInfluencers mutates it in
    // place and Three re-uploads on change.
    const INFLUENCER_FAR = 1e6;
    const influencerBuf = new Float32Array(MAX_INFLUENCERS * 3);
    for (let i = 0; i < MAX_INFLUENCERS; i++) {
        influencerBuf[i * 3 + 0] = INFLUENCER_FAR;
        influencerBuf[i * 3 + 1] = 0;
        influencerBuf[i * 3 + 2] = INFLUENCER_FAR;
    }

    const initialDir = (opts.lightDirection ?? new Vector3(-0.4, -1, -0.6)).clone().normalize();
    const shadowDarkness = opts.shadowDarkness ?? 0.4;

    const defines: Record<string, string> = {};
    if (usingShadows) defines.RECEIVE_SHADOWS = '';
    if (usingInfluencers) defines.INFLUENCERS = '';

    const mat = new ShaderMaterial({
        name: 'proceduralGrassMat',
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines,
        side: DoubleSide,
        uniforms: {
            uTime: { value: 0 },
            uWindStrength: { value: opts.windStrength ?? 0.18 },
            uHeroPos: { value: new Vector3() },
            uTileSize: { value: opts.tileSize },
            uCurveRadius: { value: opts.curveRadius },
            // No fade unless requested — defaults far beyond any tile.
            uFadeStart: { value: opts.fadeStart ?? 1e6 },
            uFadeEnd: { value: opts.fadeEnd ?? (1e6 + 1) },
            uColorRoot: { value: (opts.colorRoot ?? new Color(0.10, 0.14, 0.05)).clone() },
            uColorTip: { value: (opts.colorTip ?? new Color(0.45, 0.65, 0.22)).clone() },
            uColorDry: { value: (opts.colorDry ?? new Color(0.62, 0.55, 0.22)).clone() },
            uAmbient: { value: (opts.ambientColor ?? new Color(0.25, 0.27, 0.22)).clone() },
            uLightDir: { value: initialDir },
            uLightColor: { value: opts.directionalLight?.color.clone() ?? new Color(1.0, 0.98, 0.90) },
            uTorchPos: { value: new Vector3() },
            uTorchColor: { value: new Color(1.0, 0.62, 0.28) },
            uTorchIntensity: { value: 0 },
            uTorchRange: { value: 11 },
            // Fog disabled until the per-frame observer mirrors a live scene fog.
            uFogEnabled: { value: 0 },
            uFogColor: { value: new Color(0.52, 0.58, 0.86) },
            uFogStart: { value: 1e6 },
            uFogEnd: { value: 1e6 + 1 },
            uInfluencers: { value: influencerBuf },
            uInfluencerRadius: { value: opts.influencerRadius ?? 1.6 },
            uInfluencerStrength: { value: opts.influencerStrength ?? 0.7 },
            // Shadow uniforms are harmless when RECEIVE_SHADOWS is off —
            // Three simply never uploads unused entries.
            uShadowVP: { value: opts.shadowLight?.shadow.matrix ?? new Matrix4() },
            uShadowMap: { value: null },
            // Neutral (1 = no darkening) until the light's shadow map exists.
            uShadowDarkness: { value: 1 },
            uShadowMapSize: { value: new Vector2(1, 1) },
        },
    });

    // ── Per-instance world matrices — position + Y-rotation + non-uniform scale.
    const blade = new InstancedMesh(geo, mat, opts.bladeCount);
    blade.name = 'proceduralGrassBlade';
    const tmp = new Matrix4();
    const tmpPos = new Vector3();
    const tmpQuat = new Quaternion();
    const tmpScale = new Vector3(1, 1, 1);
    for (let i = 0; i < opts.bladeCount; i++) {
        const yRot = Math.random() * Math.PI * 2;
        const widthMult = 0.85 + Math.random() * 0.5;
        const tallSkew = Math.pow(Math.random(), 3.0);
        const heightMult = 0.7 + tallSkew * 1.8;
        tmpScale.set(widthMult, heightMult, 1);
        // Uniform square tile — the vertex shader wraps blades toroidally
        // around the hero, so placement is a tile, not a disc.
        tmpPos.set(
            (Math.random() - 0.5) * opts.tileSize,
            rootY,
            (Math.random() - 0.5) * opts.tileSize,
        );
        tmpQuat.setFromAxisAngle(V3_UP as Vector3, yRot);
        tmp.compose(tmpPos, tmpQuat, tmpScale);
        blade.setMatrixAt(i, tmp);
    }
    blade.instanceMatrix.needsUpdate = true;
    blade.frustumCulled = false; // treadmill-wrapped in the vertex shader — never cull
    blade.castShadow = false;
    blade.receiveShadow = false;
    host.scene.add(blade);

    // Scratch instances reused by the per-frame observer below so the sun
    // uniform sync doesn't churn fresh Vector3s every frame (60/s). The
    // uniform .value objects are mutated in place — Three re-reads them at
    // upload time, so this is correct.
    const lightPosScratch = new Vector3();
    const lightTargetScratch = new Vector3();

    let elapsed = 0;
    const tickToken: UpdateToken = host.onBeforeRender.add(() => {
        elapsed += host.deltaSeconds;
        mat.uniforms.uTime.value = elapsed;

        // Keep the sun uniforms in sync with the live light each frame —
        // cheap and means we react to runtime intensity/colour tweaks.
        const light = opts.directionalLight;
        if (light) {
            light.getWorldPosition(lightPosScratch);
            light.target.getWorldPosition(lightTargetScratch);
            (mat.uniforms.uLightDir.value as Vector3)
                .subVectors(lightTargetScratch, lightPosScratch).normalize();
            (mat.uniforms.uLightColor.value as Color)
                .copy(light.color).multiplyScalar(light.intensity);
        }

        // Per-frame shadow map + matrix. light.shadow.matrix is updated in
        // place by the renderer's shadow pass, so the reference set at
        // construction stays live; the map texture only exists after the
        // first shadow render — until then keep uShadowDarkness neutral.
        if (usingShadows && opts.shadowLight) {
            const shadow = opts.shadowLight.shadow;
            const map = shadow.map;
            mat.uniforms.uShadowMap.value = map ? map.texture : null;
            mat.uniforms.uShadowDarkness.value = map ? shadowDarkness : 1;
            (mat.uniforms.uShadowMapSize.value as Vector2).copy(shadow.mapSize);
        }

        // Mirror the scene's distance fog so the grass hazes into the same
        // horizon band as the MeshPhongMaterial ground/props. Driven entirely
        // by scene state (the gameplay layer owns enable + the zoom
        // band-shift), so both grass layers stay automatically consistent.
        const fog = host.scene.fog as Fog | null;
        if (fog && fog.isFog) {
            mat.uniforms.uFogEnabled.value = 1;
            (mat.uniforms.uFogColor.value as Color).copy(fog.color);
            mat.uniforms.uFogStart.value = fog.near;
            mat.uniforms.uFogEnd.value = fog.far;
        } else {
            mat.uniforms.uFogEnabled.value = 0;
        }
    });

    return {
        mesh: blade,
        setTorch: (params) => {
            if (!params || params.intensity <= 0) {
                mat.uniforms.uTorchIntensity.value = 0;
                return;
            }
            (mat.uniforms.uTorchPos.value as Vector3).copy(params.position);
            (mat.uniforms.uTorchColor.value as Color).copy(params.color);
            mat.uniforms.uTorchIntensity.value = params.intensity;
            mat.uniforms.uTorchRange.value = params.range;
        },
        setInfluencers: (positions: Vector3[]) => {
            if (!usingInfluencers) return; // loop compiled out — uniforms unused
            const n = Math.min(positions.length, MAX_INFLUENCERS);
            for (let i = 0; i < n; i++) {
                const p = positions[i];
                influencerBuf[i * 3 + 0] = p.x;
                influencerBuf[i * 3 + 1] = p.y;
                influencerBuf[i * 3 + 2] = p.z;
            }
            for (let i = n; i < MAX_INFLUENCERS; i++) {
                influencerBuf[i * 3 + 0] = INFLUENCER_FAR;
                influencerBuf[i * 3 + 1] = 0;
                influencerBuf[i * 3 + 2] = INFLUENCER_FAR;
            }
        },
        setHeroPos: (position: Vector3) => {
            (mat.uniforms.uHeroPos.value as Vector3).copy(position);
        },
        dispose: () => {
            host.onBeforeRender.remove(tickToken);
            // Drop the shadow-map reference before disposal so disposeMesh's
            // material pass can never be blamed for a light-owned texture.
            mat.uniforms.uShadowMap.value = null;
            blade.dispose(); // frees the GPU-side instanceMatrix attribute
            disposeMesh(blade, { materials: true });
        },
    };
}
