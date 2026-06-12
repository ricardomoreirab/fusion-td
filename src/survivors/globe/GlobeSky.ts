import { Scene, Mesh, MeshBuilder, ShaderMaterial, Effect, AssetContainer, LoadAssetContainerAsync, Matrix, PBRMaterial, Texture, Color3 } from '@babylonjs/core';

const SHADER_KEY = 'ktgGlobeSky';
const SKY_GLB_URL = 'assets/unreal_engine_4_sky.glb';
/** Radius the GLB dome is normalised to — far outside the playfield, well
 *  inside the camera's far plane. */
const SKY_RADIUS = 420;
/** Cloud pan speed (texture U per second) — slow drift. */
const CLOUD_PAN_SPEED = 0.0015;
/** Dusk tint multiplied into the (unlit) sky texture — the raw UE4 clouds are
 *  a bright midday sky and wash out the game's torch-lit mood. */
const SKY_TINT = new Color3(0.42, 0.48, 0.74);

// Texture-free gradient sky used INSTANTLY while the GLB skydome streams in
// (and kept forever if it fails to load): warm-blue twilight band at the
// horizon fading into deep night blue at the zenith, with sparse stars.
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

/** Sky that follows the hero (the globe illusion keeps the hero at the world's
 *  visual centre, so the dome recentres with them).
 *
 *  Primary: the unreal_engine_4_sky GLB dome (unlit panning-clouds texture),
 *  loaded async, normalised to SKY_RADIUS, clouds slowly drifting.
 *  Fallback: the procedural gradient+stars dome — shown instantly while the
 *  GLB streams in and kept if the load fails (or on the no-GPU NullEngine
 *  fallback, where GLB texture uploads are unavailable anyway). */
export class GlobeSky {
    private fallbackMesh: Mesh | null;
    private fallbackMaterial: ShaderMaterial | null;
    private container: AssetContainer | null = null;
    private skyDome: Mesh | null = null;
    private cloudTexture: Texture | null = null;
    private disposed = false;

    constructor(scene: Scene, skipGlb: boolean = false) {
        if (!Effect.ShadersStore[`${SHADER_KEY}VertexShader`]) {
            Effect.ShadersStore[`${SHADER_KEY}VertexShader`] = VERT;
            Effect.ShadersStore[`${SHADER_KEY}FragmentShader`] = FRAG;
        }

        this.fallbackMesh = MeshBuilder.CreateSphere('globeSky',
            { diameter: 900, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
        this.fallbackMesh.isPickable = false;
        this.fallbackMesh.alwaysSelectAsActiveMesh = true; // never frustum-culled

        this.fallbackMaterial = new ShaderMaterial(SHADER_KEY, scene,
            { vertex: SHADER_KEY, fragment: SHADER_KEY },
            { attributes: ['position'], uniforms: ['worldViewProjection'] });
        this.fallbackMaterial.backFaceCulling = false;
        this.fallbackMaterial.disableDepthWrite = true; // pure background — never occludes
        this.fallbackMesh.material = this.fallbackMaterial;

        if (!skipGlb) void this.loadGlbDome(scene);
    }

    private async loadGlbDome(scene: Scene): Promise<void> {
        let container: AssetContainer;
        try {
            container = await LoadAssetContainerAsync(SKY_GLB_URL, scene);
        } catch (err) {
            console.warn('[globe] sky GLB failed to load — keeping the procedural gradient sky:', err);
            return;
        }
        if (this.disposed) { container.dispose(); return; }
        this.container = container;
        container.addAllToScene();

        const dome = container.meshes.find(
            (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0) ?? null;
        if (!dome) {
            console.warn('[globe] sky GLB has no mesh — keeping the procedural gradient sky');
            container.dispose();
            this.container = null;
            return;
        }

        // Bake the Sketchfab wrapper transforms, centre on the origin, and
        // normalise the dome to SKY_RADIUS so it always encloses the playfield.
        dome.setParent(null);
        dome.computeWorldMatrix(true);
        dome.bakeCurrentTransformIntoVertices();
        dome.refreshBoundingInfo();
        const bb = dome.getBoundingInfo().boundingBox;
        const c = bb.center;
        dome.bakeTransformIntoVertices(Matrix.Translation(-c.x, -c.y, -c.z));
        dome.refreshBoundingInfo();
        const extent = dome.getBoundingInfo().boundingBox.extendSize;
        const radius = Math.max(extent.x, extent.y, extent.z, 0.001);
        dome.scaling.setAll(SKY_RADIUS / radius);

        dome.isPickable = false;
        dome.alwaysSelectAsActiveMesh = true;
        const mat = dome.material;
        if (mat) {
            mat.backFaceCulling = false;     // dome must read from the inside
            mat.disableDepthWrite = true;    // pure background — never occludes
            if (mat instanceof PBRMaterial) {
                // Unlit PBR: final colour = albedoColor × texture, so a single
                // colour write darkens the whole dome toward dusk.
                mat.albedoColor = SKY_TINT.clone();
                if (mat.albedoTexture instanceof Texture) {
                    this.cloudTexture = mat.albedoTexture; // panned in update()
                }
            }
        }
        this.skyDome = dome;

        // GLB dome is live — retire the procedural fallback.
        this.fallbackMesh?.dispose();
        this.fallbackMesh = null;
        this.fallbackMaterial?.dispose();
        this.fallbackMaterial = null;
    }

    /** Per-frame: keep the dome centred on the hero + drift the clouds. */
    public update(heroX: number, heroZ: number, deltaTime: number = 0): void {
        const mesh = this.skyDome ?? this.fallbackMesh;
        if (mesh) {
            mesh.position.x = heroX;
            mesh.position.z = heroZ;
        }
        if (this.cloudTexture && deltaTime > 0) {
            this.cloudTexture.uOffset = (this.cloudTexture.uOffset + CLOUD_PAN_SPEED * deltaTime) % 1;
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.fallbackMaterial?.dispose();
        this.fallbackMaterial = null;
        this.fallbackMesh?.dispose();
        this.fallbackMesh = null;
        this.skyDome = null;        // owned by the container
        this.cloudTexture = null;   // owned by the container
        this.container?.dispose();
        this.container = null;
    }
}
