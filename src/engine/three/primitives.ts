/**
 * primitives.ts - Babylon MeshBuilder.Create* equivalents returning
 * THREE.Mesh, plus the single disposal funnel (`disposeMesh`) that keeps
 * the project's leak invariants enforceable in one audited place.
 *
 * Geometry lifecycle matches Babylon exactly: every create call allocates
 * a fresh BufferGeometry that disposeMesh frees with the mesh. There is
 * deliberately NO implicit geometry cache - several call sites pass
 * continuous dimensions (e.g. a trail's `depth: len`), which would make an
 * unbounded cache key: THE recurring freeze-bug class. Hot paths that spawn
 * identical geometry repeatedly opt in via getCachedGeometry() with a
 * bounded literal key.
 *
 * Orientation conventions are baked into the geometry so Babylon-era call
 * sites keep working unchanged:
 *   - torus lies flat in the XZ plane (Babylon default; Three's is XY)
 *   - ground lies flat in the XZ plane facing +Y
 *   - disc/plane stand vertical in the XY plane (both engines agree)
 */

import {
    BoxGeometry,
    BufferGeometry,
    CircleGeometry,
    CylinderGeometry,
    DodecahedronGeometry,
    IcosahedronGeometry,
    Line,
    LineBasicMaterial,
    Material,
    Mesh,
    MeshBasicMaterial,
    OctahedronGeometry,
    PlaneGeometry,
    SphereGeometry,
    TetrahedronGeometry,
    TorusGeometry,
    Vector3,
} from 'three';
import type { SceneHost } from './SceneHost';

/**
 * Placeholder material shared by every fresh primitive until the call site
 * assigns a real one (Babylon meshes render with a default material too).
 * Never disposed - disposeMesh recognizes it.
 */
const DEFAULT_MATERIAL = new MeshBasicMaterial({ color: 0xffffff });
DEFAULT_MATERIAL.userData.cached = true;

function finish(name: string, geo: BufferGeometry, host?: SceneHost): Mesh {
    const mesh = new Mesh(geo, DEFAULT_MATERIAL);
    mesh.name = name;
    host?.scene.add(mesh);
    return mesh;
}

export interface BoxOptions { size?: number; width?: number; height?: number; depth?: number }

export function createBox(name: string, opts: BoxOptions, host?: SceneHost): Mesh {
    const s = opts.size ?? 1;
    return finish(name, new BoxGeometry(opts.width ?? s, opts.height ?? s, opts.depth ?? s), host);
}

export interface CylinderOptions {
    height?: number; diameter?: number; diameterTop?: number; diameterBottom?: number; tessellation?: number;
}

export function createCylinder(name: string, opts: CylinderOptions, host?: SceneHost): Mesh {
    const d = opts.diameter ?? 1;
    return finish(name, new CylinderGeometry(
        (opts.diameterTop ?? d) / 2,
        (opts.diameterBottom ?? d) / 2,
        opts.height ?? 2,
        opts.tessellation ?? 24,
    ), host);
}

export interface SphereOptions { diameter?: number; segments?: number }

export function createSphere(name: string, opts: SphereOptions, host?: SceneHost): Mesh {
    const segments = opts.segments ?? 16;
    return finish(name, new SphereGeometry((opts.diameter ?? 1) / 2, segments * 2, segments), host);
}

export interface TorusOptions { diameter?: number; thickness?: number; tessellation?: number }

export function createTorus(name: string, opts: TorusOptions, host?: SceneHost): Mesh {
    const geo = new TorusGeometry(
        (opts.diameter ?? 1) / 2,
        (opts.thickness ?? 0.5) / 2,
        12,
        opts.tessellation ?? 16,
    );
    geo.rotateX(Math.PI / 2); // Babylon torus lies flat in XZ
    return finish(name, geo, host);
}

export interface PolyhedronOptions { type?: number; size?: number }

/** Babylon polyhedron types 0..3 (tetra, octa, dodeca, icosa); others fall back to octa. */
export function createPolyhedron(name: string, opts: PolyhedronOptions, host?: SceneHost): Mesh {
    const r = opts.size ?? 1;
    let geo: BufferGeometry;
    switch (opts.type ?? 0) {
        case 0: geo = new TetrahedronGeometry(r); break;
        case 2: geo = new DodecahedronGeometry(r); break;
        case 3: geo = new IcosahedronGeometry(r); break;
        default: geo = new OctahedronGeometry(r); break;
    }
    return finish(name, geo, host);
}

export interface DiscOptions { radius?: number; tessellation?: number }

export function createDisc(name: string, opts: DiscOptions, host?: SceneHost): Mesh {
    return finish(name, new CircleGeometry(opts.radius ?? 0.5, opts.tessellation ?? 32), host);
}

export interface PlaneOptions { size?: number; width?: number; height?: number }

export function createPlane(name: string, opts: PlaneOptions, host?: SceneHost): Mesh {
    const s = opts.size ?? 1;
    return finish(name, new PlaneGeometry(opts.width ?? s, opts.height ?? s), host);
}

export interface IcoSphereOptions { radius?: number; subdivisions?: number }

export function createIcoSphere(name: string, opts: IcoSphereOptions, host?: SceneHost): Mesh {
    return finish(name, new IcosahedronGeometry(opts.radius ?? 0.5, opts.subdivisions ?? 2), host);
}

export interface GroundOptions { width?: number; height?: number; subdivisions?: number }

export function createGround(name: string, opts: GroundOptions, host?: SceneHost): Mesh {
    const sub = opts.subdivisions ?? 1;
    const geo = new PlaneGeometry(opts.width ?? 1, opts.height ?? 1, sub, sub);
    geo.rotateX(-Math.PI / 2); // lie flat in XZ facing +Y, like Babylon ground
    return finish(name, geo, host);
}

export interface LinesOptions { points: Vector3[] }

export function createLines(name: string, opts: LinesOptions, host?: SceneHost): Line {
    const geo = new BufferGeometry().setFromPoints(opts.points);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffffff }));
    line.name = name;
    line.userData.ownedMaterial = true;
    host?.scene.add(line);
    return line;
}

// ---------------------------------------------------------------------------
// Explicit bounded-key geometry cache (opt-in for hot spawn paths)
// ---------------------------------------------------------------------------

const geometryCache = new Map<string, BufferGeometry>();

/**
 * Shared geometry for repeated identical spawns (projectiles, orbs).
 * @param key MUST be a bounded literal (shape + fixed dims) - never include
 *   computed/continuous values or instance ids.
 */
export function getCachedGeometry(key: string, build: () => BufferGeometry): BufferGeometry {
    let geo = geometryCache.get(key);
    if (!geo) {
        geo = build();
        geo.userData.cached = true;
        geometryCache.set(key, geo);
    }
    return geo;
}

export function getGeometryCacheSize(): number {
    return geometryCache.size;
}

export function clearGeometryCache(): void {
    for (const geo of geometryCache.values()) geo.dispose();
    geometryCache.clear();
}

// ---------------------------------------------------------------------------
// Disposal funnel
// ---------------------------------------------------------------------------

export interface DisposeMeshOptions {
    /** Also dispose the mesh's material(s) - Babylon's dispose(false, true). */
    materials?: boolean;
}

/** Babylon's mesh.isDisposed() equivalent (set by disposeMesh). */
export function isMeshDisposed(obj: { userData: Record<string, unknown> }): boolean {
    return obj.userData.disposed === true;
}

function disposeMaterialDeep(mat: Material): void {
    if (mat.userData.cached) return; // shared cache-owned material - only its cache may dispose it
    for (const value of Object.values(mat)) {
        if (value && typeof value === 'object' && 'isTexture' in value && (value as { isTexture: boolean }).isTexture) {
            const tex = value as { userData?: Record<string, unknown>; dispose(): void };
            if (!tex.userData?.cached) tex.dispose();
        }
    }
    mat.dispose();
}

/**
 * The ONE way to free a mesh (or Line/Points) and its whole subtree.
 * Frees each node's geometry (unless cache-owned) and, when `materials`
 * is set or the node is flagged `userData.ownedMaterial`, its materials
 * plus their non-cached textures. Cache-owned resources
 * (`userData.cached`) are always skipped - their cache disposes them.
 */
export function disposeMesh(
    obj: { traverse(cb: (o: unknown) => void): void; removeFromParent(): void; userData: Record<string, unknown> },
    opts: DisposeMeshOptions = {},
): void {
    if (obj.userData.disposed) return;
    obj.removeFromParent();
    obj.traverse(node => {
        const n = node as {
            userData: Record<string, unknown>;
            geometry?: BufferGeometry;
            material?: Material | Material[];
        };
        n.userData.disposed = true;
        if (n.geometry && !n.geometry.userData.cached) n.geometry.dispose();
        if (n.material && (opts.materials || n.userData.ownedMaterial)) {
            const mats = Array.isArray(n.material) ? n.material : [n.material];
            for (const mat of mats) disposeMaterialDeep(mat);
        }
    });
}
