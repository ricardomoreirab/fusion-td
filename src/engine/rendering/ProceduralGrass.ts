import {
    Scene,
    Mesh,
    VertexData,
    ShaderMaterial,
    Effect,
    Matrix,
    Vector2,
    Vector3,
    Quaternion,
    Color3,
    Observer,
    DirectionalLight,
    ShadowGenerator,
} from '@babylonjs/core';

/**
 * Procedural grass — N hardware-instanced multi-segment curved blades with a
 * vertex-shader sin-based wind animation, per-vertex normals for directional
 * lighting (diffuse + cheap spec + ambient occlusion), a root→tip color
 * gradient, and a per-frame point-light contribution for the hero torch.
 *
 * Blade geometry technique ported from spacejack's "Terra" demo (MIT).
 *
 * No textures, no samplers, no shader defines — keeps the pipeline trivial
 * and identical across WebGL and WebGPU. One draw call.
 */

const SHADER_KEY = 'ktgGrass';

// Default blade curve segments. 4 segments → 5 height levels per side, 2 edges,
// 2 faces (front + back). 5 × 2 × 2 = 20 verts, 16 triangles per blade.
const BLADE_SEGS = 4;

/** Max simultaneous character displacement sources passed to the shader.
 *  Mirrors the const MAX_INFLUENCERS in the vertex shader. */
const MAX_INFLUENCERS = 16;

// ──────────────────────────────────────────────────────────────────────────────
// Shaders — kept deliberately texture-free and define-free so the pipeline
// state is the same on WebGL and WebGPU.
// ──────────────────────────────────────────────────────────────────────────────

// Per-instance world matrix attributes (world0..world3) are referenced by the
// shader source but NOT listed in the material's `attributes` array — Babylon
// parses the source and auto-assigns locations. Listing them explicitly
// causes pipeline-rebuild collisions on WebGPU post-process passes.
const VERT = `
precision highp float;

attribute vec3 position;     // x in [-0.5, 0.5], y in [0, 1], z = face sign (+1/-1)
attribute vec2 uv;           // x = edge (0/1), y = hpct (0..1)
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;

uniform mat4 viewProjection;
uniform float uTime;
uniform float uWindStrength;

// Character displacement: up to 16 "influencer" world-XZ positions (Y unused).
// Unused slots are set to a far-away point so the distance-based falloff
// naturally zeros them out without branching. Array size hardcoded to 16
// (matches MAX_INFLUENCERS const on the JS side) — WGSL's array-size
// constexpr handling differs from GLSL, hardcoding is safest.
uniform vec3 uInfluencers[16];
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
    mat4 finalWorld = mat4(world0, world1, world2, world3);

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
    for (int i = 0; i < 16; i++) {
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

    gl_Position = viewProjection * vec4(worldPos, 1.0);

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
precision highp float;

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

#ifdef RECEIVE_SHADOWS
// ESM shadow map: stores exp(depthScale * normalisedDepth) in the red channel.
uniform sampler2D uShadowMap;
uniform float uShadowDarkness;
uniform float uShadowDepthScale;
uniform vec2  uShadowDepthValues;

float sampleShadow() {
    // Sample unconditionally — WGSL requires texture sampling in uniform
    // control flow. Mix away the result for out-of-frustum coords.
    vec3 ndc = vShadowCoord.xyz / vShadowCoord.w;
    vec2 uvs = ndc.xy * 0.5 + 0.5;
    // WebGPU render-target Y is flipped relative to texture sampling Y.
    vec2 sampleUv = clamp(vec2(uvs.x, 1.0 - uvs.y), vec2(0.001), vec2(0.999));
    float storedExp = texture2D(uShadowMap, sampleUv).r;
    float depth = (ndc.z + uShadowDepthValues.x) / uShadowDepthValues.y;
    float visibility = clamp(storedExp * exp(-uShadowDepthScale * depth), 0.0, 1.0);
    float shadowFactor = mix(uShadowDarkness, 1.0, visibility);

    float inFrustum = step(0.001, uvs.x) * step(uvs.x, 0.999)
                    * step(0.001, uvs.y) * step(uvs.y, 0.999);
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

    gl_FragColor = vec4(lit, 1.0);
}
`;

// ──────────────────────────────────────────────────────────────────────────────
// Blade mesh — 5 height levels × 2 edges × 2 faces = 20 vertices, 16 triangles.
// Face sign (+1 front / -1 back) is encoded in position.z so we don't need
// any custom vertex attributes.
// ──────────────────────────────────────────────────────────────────────────────

function buildBladeMesh(scene: Scene, width: number, height: number, segs: number = BLADE_SEGS): Mesh {
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

    const blade = new Mesh('proceduralGrassBlade', scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(blade);
    return blade;
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
    colorRoot?: Color3;
    colorTip?: Color3;
    colorDry?: Color3;
    /** Directional light used for diffuse lighting. If omitted, a default
     *  sun direction + colour are used. */
    directionalLight?: DirectionalLight;
    lightDirection?: Vector3;
    ambientColor?: Color3;
    /** Optional ShadowGenerator (MUST be in ExponentialShadowMap mode — we
     *  sample the map manually as sampler2D). If omitted, the shader is
     *  compiled without shadow receive code at all. */
    shadowGenerator?: ShadowGenerator;
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
    /** false compiles the shader WITHOUT the 16-influencer bend loop (the
     *  dominant vertex cost). Use for layers characters never walk through.
     *  setInfluencers becomes a no-op. Default true. */
    influencers?: boolean;
}

export interface ProceduralGrass {
    mesh: Mesh;
    setTorch: (params: { position: Vector3; color: Color3; intensity: number; range: number } | null) => void;
    /** Set the world-XZ positions of characters that should bend the grass
     *  as they pass through. Up to 16 positions; extras are dropped. Call
     *  every frame with current positions of hero + visible enemies. */
    setInfluencers: (positions: Vector3[]) => void;
    /** Per-frame: the hero's world position — centre of the wrap tile and
     *  origin of the curvature drop. */
    setHeroPos: (position: Vector3) => void;
    dispose: () => void;
}

export function createProceduralGrass(scene: Scene, opts: ProceduralGrassOptions): ProceduralGrass {
    if (!Effect.ShadersStore[`${SHADER_KEY}VertexShader`]) {
        Effect.ShadersStore[`${SHADER_KEY}VertexShader`] = VERT;
        Effect.ShadersStore[`${SHADER_KEY}FragmentShader`] = FRAG;
    }

    const width = opts.bladeWidth ?? 0.10;
    const height = opts.bladeHeight ?? 0.55;
    const rootY = opts.rootY ?? 0.003;
    const blade = buildBladeMesh(scene, width, height, opts.bladeSegments ?? BLADE_SEGS);

    // Per-instance world matrices — position + Y-rotation + non-uniform scale.
    const matrices = new Float32Array(opts.bladeCount * 16);
    const tmp = Matrix.Identity();
    const tmpPos = new Vector3();
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
        Matrix.ComposeToRef(tmpScale, Quaternion.RotationAxis(Vector3.UpReadOnly, yRot), tmpPos, tmp);
        tmp.copyToArray(matrices, i * 16);
    }
    blade.thinInstanceSetBuffer('matrix', matrices, 16, true);

    // ── Material ──────────────────────────────────────────────────────────────
    // Note: world0..world3 are referenced by the shader source but NOT listed
    // in `attributes`. Babylon analyses the source and auto-assigns locations
    // for per-instance attributes — listing them explicitly causes location
    // collisions in WebGPU post-process / shadow re-render pipelines.
    const usingShadows = !!opts.shadowGenerator;
    const uniformsList = [
        'viewProjection',
        'uTime', 'uWindStrength',
        'uColorRoot', 'uColorTip', 'uColorDry',
        'uLightDir', 'uLightColor', 'uAmbient',
        'uTorchPos', 'uTorchColor', 'uTorchIntensity', 'uTorchRange',
        'uInfluencers', 'uInfluencerRadius', 'uInfluencerStrength',
        'uHeroPos', 'uTileSize', 'uCurveRadius',
        'uFadeStart', 'uFadeEnd',
    ];
    const samplersList: string[] = [];
    const defines: string[] = [];
    if (usingShadows) {
        uniformsList.push('uShadowVP', 'uShadowDarkness', 'uShadowDepthScale', 'uShadowDepthValues');
        samplersList.push('uShadowMap');
        defines.push('#define RECEIVE_SHADOWS');
    }
    const usingInfluencers = opts.influencers !== false;
    if (usingInfluencers) defines.push('#define INFLUENCERS');

    const mat = new ShaderMaterial(
        'proceduralGrassMat',
        scene,
        { vertex: SHADER_KEY, fragment: SHADER_KEY },
        {
            attributes: ['position', 'uv'],
            uniforms: uniformsList,
            samplers: samplersList,
            defines,
        },
    );
    mat.backFaceCulling = false;

    mat.setFloat('uWindStrength', opts.windStrength ?? 0.18);
    mat.setVector3('uHeroPos', Vector3.Zero());
    mat.setFloat('uTileSize', opts.tileSize);
    mat.setFloat('uCurveRadius', opts.curveRadius);
    // No fade unless requested — defaults far beyond any tile.
    mat.setFloat('uFadeStart', opts.fadeStart ?? 1e6);
    mat.setFloat('uFadeEnd', opts.fadeEnd ?? (1e6 + 1));
    mat.setColor3('uColorRoot', opts.colorRoot ?? new Color3(0.10, 0.14, 0.05));
    mat.setColor3('uColorTip', opts.colorTip ?? new Color3(0.45, 0.65, 0.22));
    mat.setColor3('uColorDry', opts.colorDry ?? new Color3(0.62, 0.55, 0.22));
    mat.setColor3('uAmbient', opts.ambientColor ?? new Color3(0.25, 0.27, 0.22));

    const dir = (opts.lightDirection ?? opts.directionalLight?.direction ?? new Vector3(-0.4, -1, -0.6)).clone().normalize();
    const sunColor = opts.directionalLight?.diffuse?.clone() ?? new Color3(1.0, 0.98, 0.90);
    mat.setVector3('uLightDir', dir);
    mat.setColor3('uLightColor', sunColor);

    mat.setVector3('uTorchPos', Vector3.Zero());
    mat.setColor3('uTorchColor', new Color3(1.0, 0.62, 0.28));
    mat.setFloat('uTorchIntensity', 0);
    mat.setFloat('uTorchRange', 11);

    // Initialise influencer slots to a far-away point so they contribute 0.
    // Updated per frame from outside via the returned setInfluencers() helper.
    const INFLUENCER_FAR = 1e6;
    const initialInfluencers = new Float32Array(MAX_INFLUENCERS * 3);
    for (let i = 0; i < MAX_INFLUENCERS; i++) {
        initialInfluencers[i * 3 + 0] = INFLUENCER_FAR;
        initialInfluencers[i * 3 + 1] = 0;
        initialInfluencers[i * 3 + 2] = INFLUENCER_FAR;
    }
    mat.setArray3('uInfluencers', Array.from(initialInfluencers));
    mat.setFloat('uInfluencerRadius', opts.influencerRadius ?? 1.6);
    mat.setFloat('uInfluencerStrength', opts.influencerStrength ?? 0.7);

    if (usingShadows && opts.shadowGenerator) {
        const gen = opts.shadowGenerator;
        const shadowMap = gen.getShadowMap();
        if (shadowMap) mat.setTexture('uShadowMap', shadowMap);
        mat.setFloat('uShadowDarkness', gen.darkness);
        mat.setFloat('uShadowDepthScale', (gen as unknown as { depthScale: number }).depthScale ?? 50);
        mat.setVector2('uShadowDepthValues', new Vector2(1, 2));
        mat.setMatrix('uShadowVP', Matrix.Identity());
    }

    blade.material = mat;
    blade.alwaysSelectAsActiveMesh = true;

    // Scratch instances reused by the per-frame observer below so the sun/shadow
    // uniform sync doesn't churn a fresh Vector3 + Color3 + Vector2 every frame
    // (60/s). ShaderMaterial re-reads these by reference at bind time, so mutating
    // the same instance in place each frame is correct.
    const lightDirScratch = new Vector3();
    const lightColorScratch = new Color3();
    const shadowDepthScratch = new Vector2();

    let elapsed = 0;
    const tickObserver: Observer<Scene> | null = scene.onBeforeRenderObservable.add(() => {
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        mat.setFloat('uTime', elapsed);

        // Keep the sun uniforms in sync with the live light each frame —
        // cheap and means we react to runtime intensity/colour tweaks.
        if (opts.directionalLight) {
            lightDirScratch.copyFrom(opts.directionalLight.direction).normalize();
            mat.setVector3('uLightDir', lightDirScratch);
            opts.directionalLight.diffuse.scaleToRef(opts.directionalLight.intensity, lightColorScratch);
            mat.setColor3('uLightColor', lightColorScratch);
        }

        // Per-frame shadow VP + depth values. The depth values depend on the
        // backend (WebGL non-reverse: (1, 2); WebGPU: (0, 1)) — read from the
        // light so we don't hardcode.
        if (usingShadows && opts.shadowGenerator && opts.directionalLight) {
            const vp = opts.shadowGenerator.getTransformMatrix();
            if (vp) mat.setMatrix('uShadowVP', vp);
            const cam = scene.activeCamera;
            if (cam) {
                const minZ = opts.directionalLight.getDepthMinZ(cam);
                const maxZ = opts.directionalLight.getDepthMaxZ(cam);
                shadowDepthScratch.copyFromFloats(minZ, minZ + maxZ);
                mat.setVector2('uShadowDepthValues', shadowDepthScratch);
            }
        }
    });

    // Re-used scratch buffer for per-frame influencer uploads.
    const influencerBuf = new Float32Array(MAX_INFLUENCERS * 3);
    const influencerArr = new Array<number>(MAX_INFLUENCERS * 3);

    return {
        mesh: blade,
        setTorch: (params) => {
            if (!params || params.intensity <= 0) {
                mat.setFloat('uTorchIntensity', 0);
                return;
            }
            mat.setVector3('uTorchPos', params.position);
            mat.setColor3('uTorchColor', params.color);
            mat.setFloat('uTorchIntensity', params.intensity);
            mat.setFloat('uTorchRange', params.range);
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
                influencerBuf[i * 3 + 0] = 1e6;
                influencerBuf[i * 3 + 1] = 0;
                influencerBuf[i * 3 + 2] = 1e6;
            }
            // ShaderMaterial.setArray3 takes a plain number[] — copy via for
            // loop instead of Array.from for less per-frame GC pressure.
            for (let i = 0; i < influencerBuf.length; i++) influencerArr[i] = influencerBuf[i];
            mat.setArray3('uInfluencers', influencerArr);
        },
        setHeroPos: (position: Vector3) => {
            mat.setVector3('uHeroPos', position);
        },
        dispose: () => {
            if (tickObserver) scene.onBeforeRenderObservable.remove(tickObserver);
            mat.dispose();
            blade.dispose();
        },
    };
}
