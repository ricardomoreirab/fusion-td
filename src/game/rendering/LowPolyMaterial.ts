import { StandardMaterial, Color3, Scene, Mesh, DirectionalLight, ShadowGenerator, Vector3, HemisphericLight } from '@babylonjs/core';

/**
 * Create a flat-shaded StandardMaterial with no specular (low-poly look).
 * Enhanced with subtle ambient occlusion via emissive tinting.
 */
export function createLowPolyMaterial(name: string, color: Color3, scene: Scene): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = color;
    mat.specularColor = Color3.Black();
    mat.specularPower = 0;
    // Subtle ambient color for richer flat-shaded look
    mat.ambientColor = color.scale(0.15);
    return mat;
}

/**
 * Create a flat-shaded emissive material (for glowing elements like portals, crystals).
 * Uses additive emissive for glow-layer compatibility.
 */
export function createEmissiveMaterial(name: string, color: Color3, emissiveStrength: number, scene: Scene): StandardMaterial {
    const mat = createLowPolyMaterial(name, color, scene);
    mat.emissiveColor = color.scale(emissiveStrength);
    return mat;
}

/**
 * Create a metallic-looking material for towers and structures.
 * Adds subtle specular highlights for a polished look.
 */
export function createMetallicMaterial(name: string, color: Color3, scene: Scene): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = color;
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    mat.specularPower = 32;
    mat.ambientColor = color.scale(0.1);
    return mat;
}

/**
 * Create a translucent material for effects like shields, auras, water surfaces.
 */
export function createTranslucentMaterial(name: string, color: Color3, alpha: number, scene: Scene): StandardMaterial {
    const mat = createLowPolyMaterial(name, color, scene);
    mat.alpha = alpha;
    mat.emissiveColor = color.scale(0.3);
    mat.backFaceCulling = false;
    return mat;
}

/**
 * Convert a mesh to flat-shaded (visible polygon facets).
 * Must be called AFTER the mesh is created and before parenting if needed.
 */
export function makeFlatShaded(mesh: Mesh): void {
    mesh.convertToFlatShadedMesh();
}

/**
 * Set up enhanced directional light with shadow generator for the scene.
 * Returns the shadow generator for attaching meshes.
 */
export function createSunLight(scene: Scene): { light: DirectionalLight; shadows: ShadowGenerator } {
    const light = new DirectionalLight('sunLight', new Vector3(-0.5, -1, -0.3).normalize(), scene);
    light.intensity = 0.45;
    light.diffuse = new Color3(1.0, 0.95, 0.85);
    light.specular = new Color3(0.3, 0.3, 0.3);

    const shadows = new ShadowGenerator(1024, light);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 16;
    shadows.depthScale = 50;
    shadows.setDarkness(0.35);

    return { light, shadows };
}
