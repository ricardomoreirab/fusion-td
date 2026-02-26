import { StandardMaterial, Color3, Scene, Mesh } from '@babylonjs/core';

/**
 * Create a flat-shaded StandardMaterial with no specular (low-poly look).
 */
export function createLowPolyMaterial(name: string, color: Color3, scene: Scene): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    mat.specularPower = 0;
    return mat;
}

/**
 * Create a flat-shaded emissive material (for glowing elements like portals, crystals).
 */
export function createEmissiveMaterial(name: string, color: Color3, emissiveStrength: number, scene: Scene): StandardMaterial {
    const mat = createLowPolyMaterial(name, color, scene);
    mat.emissiveColor = color.scale(emissiveStrength);
    return mat;
}

/**
 * Convert a mesh to flat-shaded (visible polygon facets).
 * Must be called AFTER the mesh is created and before parenting if needed.
 */
export function makeFlatShaded(mesh: Mesh): void {
    mesh.convertToFlatShadedMesh();
}
