import { Scene, Mesh, MeshBuilder, ShaderMaterial, Effect } from '@babylonjs/core';

const SHADER_KEY = 'ktgGlobeSky';

// Texture-free gradient sky: warm dusk glow at the horizon fading into deep
// indigo at the zenith, with a sparse procedural star field. Replaces the
// near-black env-cube skydome so the space above the globe's curved horizon
// reads as a sky instead of a void. (The env cube itself stays on
// scene.environmentTexture for hero IBL reflections — this dome is visual only.)
const VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;

void main(void) {
    vDir = position; // sphere centred on the hero — local position IS the view direction
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec3 vDir;

float hash12(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main(void) {
    vec3 d = normalize(vDir);
    float h = d.y;

    vec3 zenith  = vec3(0.08, 0.13, 0.36);  // deep night blue overhead
    vec3 horizon = vec3(0.52, 0.58, 0.86);  // pale periwinkle twilight band
    vec3 below   = vec3(0.15, 0.18, 0.34);  // blue slate haze under the world's rim
                                            // (most of the visible sky at the tilted
                                            // camera sits BELOW the dome's horizontal,
                                            // so this must never read as black)

    vec3 col = h >= 0.0
        ? mix(horizon, zenith, smoothstep(0.02, 0.55, h))
        : mix(horizon, below, smoothstep(0.0, 0.5, -h));

    // Sparse stars, only well above the horizon band so they don't fight the
    // glow. Cells on a lat/long grid; ~1.5% of cells hold a star.
    if (h > 0.12) {
        vec2 sph = vec2(atan(d.z, d.x), asin(clamp(h, -1.0, 1.0))) * 28.0;
        vec2 id = floor(sph);
        float rnd = hash12(id);
        if (rnd > 0.985) {
            vec2 c = fract(sph) - vec2(0.3 + 0.4 * hash12(id + 7.0), 0.3 + 0.4 * hash12(id + 13.0));
            float star = smoothstep(0.10, 0.02, length(c));
            col += vec3(0.9, 0.92, 1.0) * star * smoothstep(0.12, 0.35, h) * (0.4 + 0.6 * rnd);
        }
    }

    gl_FragColor = vec4(col, 1.0);
}
`;

/** Gradient + stars sky dome that follows the hero (the globe illusion keeps
 *  the hero at the world's visual centre, so the dome recentres with them). */
export class GlobeSky {
    public readonly mesh: Mesh;
    private material: ShaderMaterial;

    constructor(scene: Scene) {
        if (!Effect.ShadersStore[`${SHADER_KEY}VertexShader`]) {
            Effect.ShadersStore[`${SHADER_KEY}VertexShader`] = VERT;
            Effect.ShadersStore[`${SHADER_KEY}FragmentShader`] = FRAG;
        }

        this.mesh = MeshBuilder.CreateSphere('globeSky',
            { diameter: 900, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
        this.mesh.isPickable = false;
        this.mesh.alwaysSelectAsActiveMesh = true; // never frustum-culled

        this.material = new ShaderMaterial(SHADER_KEY, scene,
            { vertex: SHADER_KEY, fragment: SHADER_KEY },
            { attributes: ['position'], uniforms: ['worldViewProjection'] });
        this.material.backFaceCulling = false;
        this.material.disableDepthWrite = true; // pure background — never occludes
        this.mesh.material = this.material;
    }

    /** Per-frame: keep the dome centred on the hero. */
    public update(heroX: number, heroZ: number): void {
        this.mesh.position.x = heroX;
        this.mesh.position.z = heroZ;
    }

    public dispose(): void {
        this.material.dispose();
        this.mesh.dispose();
    }
}
