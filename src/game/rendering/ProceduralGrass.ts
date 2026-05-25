import {
    Scene,
    Mesh,
    VertexData,
    ShaderMaterial,
    Effect,
    Matrix,
    Vector3,
    Quaternion,
    Color3,
    Observer,
} from '@babylonjs/core';

/**
 * Lite procedural grass — N hardware-instanced curved blades with a vertex-
 * shader wind animation and a root→tip color gradient. Unlit (avoids Babylon's
 * lighting pipeline so the shader stays trivial and runs on both WebGL and
 * WebGPU identically). One draw call.
 *
 * Inspired by penev.tech/labs/grass but stripped of the trail-texture
 * displacement, SSS, fresnel, and fiber-noise passes — those would add
 * significant GPU cost on top of an already-busy survivors scene.
 */

const SHADER_KEY = 'ktgGrass';

// ──────────────────────────────────────────────────────────────────────────────
// Shaders
// ──────────────────────────────────────────────────────────────────────────────

const VERT = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

// world is the per-instance matrix (thinInstance sets it). viewProjection is
// Babylon's built-in combined camera matrix.
uniform mat4 world;
uniform mat4 viewProjection;
uniform float uTime;
uniform float uWindStrength;

varying vec2 vUv;
varying float vColorSeed;

void main(void) {
    vec4 worldPos = world * vec4(position, 1.0);

    // Cheap multi-frequency sin wind in world space — each blade picks up a
    // phase from its world XZ position, so neighbours sway together but
    // distant blades sway out of phase, producing the rolling-wave look.
    float phase = worldPos.x * 0.55 + worldPos.z * 0.45;
    float wind1 = sin(uTime * 1.6 + phase);
    float wind2 = sin(uTime * 0.9 + phase * 1.7) * 0.4;
    float wind = (wind1 + wind2) * uWindStrength;

    // Bend weight = uv.y² → root stays anchored at uv.y=0, tip bends most.
    float bend = wind * uv.y * uv.y;
    worldPos.x += bend;
    worldPos.z += bend * 0.4;

    gl_Position = viewProjection * worldPos;

    vUv = uv;
    // Pseudo-random per-blade seed from world position — used in the fragment
    // shader for color variation without needing a per-instance attribute.
    vColorSeed = fract(sin(dot(worldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

const FRAG = `
precision highp float;

varying vec2 vUv;
varying float vColorSeed;

uniform vec3 uColorRoot;
uniform vec3 uColorTip;
uniform vec3 uColorDry;

void main(void) {
    // Per-blade variation: most blades fresh green, ~25% leaning toward dry.
    vec3 tip = mix(uColorTip, uColorDry, smoothstep(0.65, 1.0, vColorSeed));
    vec3 color = mix(uColorRoot, tip, vUv.y);
    gl_FragColor = vec4(color, 1.0);
}
`;

// ──────────────────────────────────────────────────────────────────────────────
// Build one blade mesh (5 vertices, 3 triangles) — the source for thin instancing.
// ──────────────────────────────────────────────────────────────────────────────

function buildBladeMesh(scene: Scene, width: number, height: number): Mesh {
    const segments = 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const halfWidth = width * 0.5 * (1.0 - t);
        if (i === segments) {
            // Tip: single vertex
            positions.push(0, height * t, 0);
            uvs.push(0.5, t);
        } else {
            positions.push(-halfWidth, height * t, 0);
            uvs.push(0, t);
            positions.push(halfWidth, height * t, 0);
            uvs.push(1, t);
        }
    }

    // Vertex layout (segments=2): [0]=base-L, [1]=base-R, [2]=mid-L, [3]=mid-R, [4]=tip
    // Two quads (4 tris) — but tip section is a single triangle (mid → tip).
    indices.push(0, 2, 1, 1, 2, 3); // base→mid quad
    indices.push(2, 4, 3);           // mid→tip triangle

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
    /** Arena radius (blades are scattered inside a disc of this radius). */
    arenaRadius: number;
    /** Number of blade instances. ~8000 is a good lite default. */
    bladeCount: number;
    /** Y position of the blade roots. Slightly above ground to avoid z-fighting. */
    rootY?: number;
    /** Per-blade dimensions. */
    bladeWidth?: number;
    bladeHeight?: number;
    /** Wind animation strength in world units of tip displacement. */
    windStrength?: number;
    /** Root color (dark) and tip color (bright). */
    colorRoot?: Color3;
    colorTip?: Color3;
    /** Color blades shift toward for ~25% of instances (dry/yellowed). */
    colorDry?: Color3;
}

export interface ProceduralGrass {
    mesh: Mesh;
    dispose: () => void;
}

export function createProceduralGrass(scene: Scene, opts: ProceduralGrassOptions): ProceduralGrass {
    // Register shaders into Babylon's shader store (once per page lifetime).
    if (!Effect.ShadersStore[`${SHADER_KEY}VertexShader`]) {
        Effect.ShadersStore[`${SHADER_KEY}VertexShader`] = VERT;
        Effect.ShadersStore[`${SHADER_KEY}FragmentShader`] = FRAG;
    }

    const width = opts.bladeWidth ?? 0.10;
    const height = opts.bladeHeight ?? 0.55;
    const rootY = opts.rootY ?? 0.003;
    const blade = buildBladeMesh(scene, width, height);

    // ── Per-instance world matrices ───────────────────────────────────────────
    // Scatter inside the arena disc. sqrt(rand) gives uniform area distribution.
    const matrices = new Float32Array(opts.bladeCount * 16);
    const tmp = Matrix.Identity();
    const tmpPos = new Vector3();
    const tmpScale = new Vector3();
    for (let i = 0; i < opts.bladeCount; i++) {
        const r = Math.sqrt(Math.random()) * opts.arenaRadius * 0.96;
        const theta = Math.random() * Math.PI * 2;
        const yRot = Math.random() * Math.PI * 2;
        const s = 0.75 + Math.random() * 0.55; // size variation
        tmpScale.set(s, s, s);
        tmpPos.set(Math.cos(theta) * r, rootY, Math.sin(theta) * r);
        Matrix.ComposeToRef(tmpScale, Quaternion.RotationAxis(Vector3.UpReadOnly, yRot), tmpPos, tmp);
        tmp.copyToArray(matrices, i * 16);
    }
    blade.thinInstanceSetBuffer('matrix', matrices, 16, true);

    // ── Material ──────────────────────────────────────────────────────────────
    const mat = new ShaderMaterial(
        'proceduralGrassMat',
        scene,
        { vertex: SHADER_KEY, fragment: SHADER_KEY },
        {
            attributes: ['position', 'uv'],
            uniforms: ['world', 'viewProjection', 'uTime', 'uWindStrength', 'uColorRoot', 'uColorTip', 'uColorDry'],
        },
    );
    // Grass is visible from both sides — blades are flat planes and the camera
    // looks down-and-out, so half the blades face away from the camera.
    mat.backFaceCulling = false;
    mat.setFloat('uWindStrength', opts.windStrength ?? 0.12);
    mat.setColor3('uColorRoot', opts.colorRoot ?? new Color3(0.10, 0.14, 0.05));
    mat.setColor3('uColorTip', opts.colorTip ?? new Color3(0.42, 0.62, 0.20));
    mat.setColor3('uColorDry', opts.colorDry ?? new Color3(0.62, 0.55, 0.22));

    blade.material = mat;
    // Frustum culling on a tiny source mesh would skip the whole instance set
    // if the source-mesh bounding box (around the origin) is offscreen.
    blade.alwaysSelectAsActiveMesh = true;

    // ── Animate uTime ─────────────────────────────────────────────────────────
    let elapsed = 0;
    const tickObserver: Observer<Scene> | null = scene.onBeforeRenderObservable.add(() => {
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        mat.setFloat('uTime', elapsed);
    });

    return {
        mesh: blade,
        dispose: () => {
            if (tickObserver) scene.onBeforeRenderObservable.remove(tickObserver);
            mat.dispose();
            blade.dispose();
        },
    };
}
