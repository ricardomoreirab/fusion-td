/**
 * Low-poly material factories (Three.js). MeshPhongMaterial is the closest
 * match to Babylon's StandardMaterial (diffuse + emissive + specular).
 *
 * Babylon's freeze() has no Three equivalent and none is needed - Three
 * materials don't re-validate per frame; the shader program is compiled
 * once per property-combination and shared.
 *
 * NOTE: these factories do NOT cache - every call is a fresh material.
 * Transient FX must use getCachedMaterial (bounded key) or ensure the
 * material is freed via disposeMesh (see the CLAUDE.md leak invariant).
 */

import { BufferGeometry, Color, Mesh, MeshPhongMaterial } from 'three';
import { GLOW_LAYER } from '../three/RendererHost';

const BLACK = new Color(0, 0, 0);

/** Flat-look Phong material with no specular highlight. */
export function createLowPolyMaterial(name: string, color: Color): MeshPhongMaterial {
    const mat = new MeshPhongMaterial({
        color: color.clone(),
        specular: BLACK.clone(),
        shininess: 0,
    });
    mat.name = name;
    return mat;
}

/** Emissive variant for glowing elements (orbs, crystals, FX). */
export function createEmissiveMaterial(name: string, color: Color, emissiveStrength: number): MeshPhongMaterial {
    const mat = createLowPolyMaterial(name, color);
    mat.emissive = color.clone().multiplyScalar(emissiveStrength);
    return mat;
}

/**
 * Convert a mesh's geometry to flat shading (visible polygon facets) -
 * Babylon's convertToFlatShadedMesh. Splits shared vertices so each face
 * gets its own normal; the old indexed geometry is disposed.
 */
export function makeFlatShaded(mesh: Mesh): void {
    const geo = mesh.geometry as BufferGeometry;
    if (geo.index === null) {
        geo.computeVertexNormals();
        return;
    }
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    flat.userData.cached = geo.userData.cached ?? false;
    mesh.geometry = flat;
    if (!geo.userData.cached) geo.dispose();
}

/**
 * Register a mesh with the emissive-glow pass (Babylon GlowLayer parity).
 * Call for meshes whose material has a meaningful emissive component.
 */
export function markGlowing(mesh: Mesh): void {
    mesh.layers.enable(GLOW_LAYER);
}

/**
 * Per-mesh opacity fade (Babylon's mesh.visibility). Three has no per-mesh
 * opacity, only per-material - so on first call the mesh's shared material
 * is cloned into a mesh-owned transparent copy (flagged ownedMaterial so
 * disposeMesh frees it; Three's program cache means no shader recompile).
 * THE audited helper for fading FX meshes - never mutate a shared cached
 * material's opacity directly.
 */
export function setMeshOpacity(mesh: Mesh, opacity: number): void {
    let mat = mesh.material as MeshPhongMaterial;
    if (!mesh.userData.ownedMaterial) {
        mat = mat.clone();
        mat.transparent = true;
        mesh.material = mat;
        mesh.userData.ownedMaterial = true;
    }
    mat.opacity = opacity;
}
