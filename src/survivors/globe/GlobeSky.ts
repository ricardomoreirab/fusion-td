import {
    BackSide,
    Color,
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    RepeatWrapping,
    ShaderMaterial,
    Texture,
    Vector3,
} from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { createSphere, disposeMesh } from '../../engine/three/primitives';
import { loadContainer, ContainerInstance } from '../../engine/three/assets';

const SKY_GLB_URL = 'assets/unreal_engine_4_sky.glb';
/** Radius the GLB dome is normalised to — far outside the playfield, well
 *  inside the camera's far plane. */
const SKY_RADIUS = 420;
/** Cloud pan speed (texture U per second) — slow drift. */
const CLOUD_PAN_SPEED = 0.0015;
/** Dusk tint multiplied into the (unlit) sky texture — the raw UE4 clouds are
 *  a bright midday sky and wash out the game's torch-lit mood. */
const SKY_TINT = new Color(0.42, 0.48, 0.74);

// Texture-free gradient sky used INSTANTLY while the GLB skydome streams in
// (and kept forever if it fails to load): warm-blue twilight band at the
// horizon fading into deep night blue at the zenith, with sparse stars.
// Three's ShaderMaterial auto-injects the precision header, the position
// attribute and the projection/modelView matrices — not redeclared here.
const VERT = `
varying vec3 vDir;

void main(void) {
    vDir = position; // sphere centred on the hero — local position IS the view direction
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
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
 *  GLB streams in and kept if the load fails (or on the no-GPU fallback,
 *  where GLB texture uploads are unavailable anyway). */
export class GlobeSky {
    private fallbackMesh: Mesh | null;
    private fallbackMaterial: ShaderMaterial | null;
    private instance: ContainerInstance | null = null;
    private skyDome: Mesh | null = null;
    private skyMaterial: MeshBasicMaterial | null = null;
    private cloudTexture: Texture | null = null;
    private disposed = false;

    constructor(host: SceneHost, skipGlb: boolean = false) {
        this.fallbackMesh = createSphere('globeSky', { diameter: 900, segments: 16 }, host);
        this.fallbackMesh.frustumCulled = false; // never frustum-culled

        this.fallbackMaterial = new ShaderMaterial({
            name: 'globeSky',
            vertexShader: VERT,
            fragmentShader: FRAG,
            side: BackSide,       // dome reads from the inside
            depthWrite: false,    // pure background — never occludes
        });
        this.fallbackMesh.material = this.fallbackMaterial;

        if (!skipGlb) void this.loadGlbDome(host);
    }

    private async loadGlbDome(host: SceneHost): Promise<void> {
        let instance: ContainerInstance;
        try {
            const container = await loadContainer(SKY_GLB_URL);
            instance = container.instantiate(host);
        } catch (err) {
            console.warn('[globe] sky GLB failed to load — keeping the procedural gradient sky:', err);
            return;
        }
        if (this.disposed) { instance.dispose(); return; }
        this.instance = instance;

        instance.root.updateMatrixWorld(true);
        const candidates: Mesh[] = [];
        instance.root.traverse(node => {
            const m = node as Mesh;
            if (m.isMesh && (m.geometry.getAttribute('position')?.count ?? 0) > 0) candidates.push(m);
        });
        const dome = candidates[0] ?? null;
        if (!dome) {
            console.warn('[globe] sky GLB has no mesh — keeping the procedural gradient sky');
            instance.dispose();
            this.instance = null;
            return;
        }

        // Bake the Sketchfab wrapper transforms into a PRIVATE geometry clone
        // (the source geometry is shared with the module-level container
        // cache — baking in place would double-apply on the next run), centre
        // on the origin, and normalise the dome to SKY_RADIUS so it always
        // encloses the playfield.
        const geo = dome.geometry.clone();
        geo.applyMatrix4(dome.matrixWorld);
        dome.geometry = geo;
        host.scene.add(dome); // reparent out of the GLB wrapper chain
        dome.position.set(0, 0, 0);
        dome.quaternion.identity();
        dome.scale.set(1, 1, 1);

        geo.computeBoundingBox();
        const centre = geo.boundingBox!.getCenter(new Vector3());
        geo.translate(-centre.x, -centre.y, -centre.z);
        geo.computeBoundingBox();
        const extent = geo.boundingBox!.max;
        const radius = Math.max(extent.x, extent.y, extent.z, 0.001);
        dome.scale.setScalar(SKY_RADIUS / radius);
        dome.frustumCulled = false;

        // Unlit tinted clouds — Babylon relied on the GLB's unlit PBR where
        // final colour = albedoColor × texture; MeshBasicMaterial(color, map)
        // is the exact Three equivalent. The source material clone from
        // instantiate() is retired (instance.dispose() frees it later).
        const srcMat = Array.isArray(dome.material) ? dome.material[0] : dome.material;
        const cloudMap = (srcMat as { map?: Texture | null }).map ?? null;
        const skyMat = new MeshBasicMaterial({
            color: SKY_TINT.clone(),
            map: cloudMap,
            side: DoubleSide,     // dome must read from the inside
            depthWrite: false,    // pure background — never occludes
            fog: false,           // horizon fog must not swallow the sky itself
        });
        dome.material = skyMat;
        this.skyMaterial = skyMat;
        if (cloudMap) {
            cloudMap.wrapS = RepeatWrapping; // panned in update()
            this.cloudTexture = cloudMap;
        }
        this.skyDome = dome;

        // GLB dome is live — retire the procedural fallback.
        if (this.fallbackMesh) disposeMesh(this.fallbackMesh);
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
            this.cloudTexture.offset.x = (this.cloudTexture.offset.x + CLOUD_PAN_SPEED * deltaTime) % 1;
        }
    }

    public dispose(): void {
        this.disposed = true;
        this.fallbackMaterial?.dispose();
        this.fallbackMaterial = null;
        if (this.fallbackMesh) disposeMesh(this.fallbackMesh);
        this.fallbackMesh = null;
        if (this.skyDome) disposeMesh(this.skyDome); // frees the baked geometry clone
        this.skyDome = null;
        this.skyMaterial?.dispose(); // texture stays — owned by the container cache
        this.skyMaterial = null;
        this.cloudTexture = null;    // owned by the container cache
        this.instance?.dispose();
        this.instance = null;
    }
}
