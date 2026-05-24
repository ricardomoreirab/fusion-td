/**
 * Builds tower meshes from visual config recipes.
 * Uses existing LowPolyMaterial helpers for consistent low-poly aesthetic.
 */

import { Mesh, MeshBuilder, Vector3, Color3, Scene, ParticleSystem, Color4, Animation } from '@babylonjs/core';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../../rendering/LowPolyMaterial';
import { TowerVisualDefinition, TowerVisualComponent, TowerParticleConfig, TowerAnimationConfig } from './TowerDefinitions';

export class TowerVisualBuilder {
    private scene: Scene;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * Build a complete tower mesh from a visual definition.
     * Returns the root mesh with all components parented to it.
     */
    public build(definition: TowerVisualDefinition, position: Vector3, towerId: string): Mesh {
        // Create base mesh
        const baseMesh = this.createBaseMesh(definition, towerId);
        baseMesh.position = position;
        baseMesh.isPickable = true;

        // Add components
        for (let i = 0; i < definition.components.length; i++) {
            const comp = definition.components[i];
            const compMesh = this.createComponent(comp, `${towerId}_comp_${i}`);
            compMesh.parent = baseMesh;
            compMesh.isPickable = false;
        }

        // Add particles
        if (definition.particles) {
            for (let i = 0; i < definition.particles.length; i++) {
                this.createParticleSystem(definition.particles[i], baseMesh, `${towerId}_particles_${i}`);
            }
        }

        // Add animations
        if (definition.animations) {
            for (const anim of definition.animations) {
                this.applyAnimation(anim, baseMesh, definition.components);
            }
        }

        return baseMesh;
    }

    /**
     * Dispose old mesh and build a new one for tower evolution.
     */
    public rebuild(oldMesh: Mesh | null, definition: TowerVisualDefinition, position: Vector3, towerId: string): Mesh {
        if (oldMesh) {
            oldMesh.dispose();
        }
        return this.build(definition, position, towerId);
    }

    private createBaseMesh(definition: TowerVisualDefinition, name: string): Mesh {
        let mesh: Mesh;
        const d = definition.baseDimensions;

        switch (definition.baseShape) {
            case 'cylinder':
                mesh = MeshBuilder.CreateCylinder(name, {
                    diameter: d.width,
                    height: d.height,
                    tessellation: d.tessellation || 8
                }, this.scene);
                break;
            case 'box':
                mesh = MeshBuilder.CreateBox(name, {
                    width: d.width,
                    height: d.height,
                    depth: d.depth || d.width
                }, this.scene);
                break;
            case 'cone':
                mesh = MeshBuilder.CreateCylinder(name, {
                    diameterTop: 0,
                    diameterBottom: d.width,
                    height: d.height,
                    tessellation: d.tessellation || 8
                }, this.scene);
                break;
        }

        makeFlatShaded(mesh);
        const color = new Color3(definition.baseColor[0], definition.baseColor[1], definition.baseColor[2]);
        mesh.material = createLowPolyMaterial(`${name}_mat`, color, this.scene);
        mesh.position.y = d.height / 2;

        return mesh;
    }

    private createComponent(comp: TowerVisualComponent, name: string): Mesh {
        let mesh: Mesh;
        const d = comp.dimensions;

        switch (comp.shape) {
            case 'cylinder':
                mesh = MeshBuilder.CreateCylinder(name, {
                    diameter: d.diameter || d.width || 1,
                    height: d.height || 1,
                    tessellation: d.tessellation || 8
                }, this.scene);
                break;
            case 'box':
                mesh = MeshBuilder.CreateBox(name, {
                    width: d.width || 1,
                    height: d.height || 1,
                    depth: d.depth || d.width || 1
                }, this.scene);
                break;
            case 'cone':
                mesh = MeshBuilder.CreateCylinder(name, {
                    diameterTop: 0,
                    diameterBottom: d.diameter || d.width || 1,
                    height: d.height || 1,
                    tessellation: d.tessellation || 6
                }, this.scene);
                break;
            case 'sphere':
                mesh = MeshBuilder.CreateSphere(name, {
                    diameter: d.diameter || d.width || 1,
                    segments: d.tessellation || 6
                }, this.scene);
                break;
            case 'torus':
                mesh = MeshBuilder.CreateTorus(name, {
                    diameter: d.diameter || 1,
                    thickness: d.thickness || 0.1,
                    tessellation: d.tessellation || 16
                }, this.scene);
                break;
            case 'icosphere':
                mesh = MeshBuilder.CreateIcoSphere(name, {
                    radius: d.radius || 0.5,
                    subdivisions: d.subdivisions || 1
                }, this.scene);
                break;
            case 'disc':
                mesh = MeshBuilder.CreateDisc(name, {
                    radius: d.radius || 0.5,
                    tessellation: d.tessellation || 16
                }, this.scene);
                break;
            default:
                mesh = MeshBuilder.CreateBox(name, { size: 0.5 }, this.scene);
                break;
        }

        if (comp.flatShaded !== false) {
            makeFlatShaded(mesh);
        }

        const color = new Color3(comp.color[0], comp.color[1], comp.color[2]);
        if (comp.emissive && comp.emissive > 0) {
            mesh.material = createEmissiveMaterial(`${name}_mat`, color, comp.emissive, this.scene);
        } else {
            mesh.material = createLowPolyMaterial(`${name}_mat`, color, this.scene);
        }

        mesh.position = new Vector3(comp.position[0], comp.position[1], comp.position[2]);

        if (comp.rotation) {
            mesh.rotation = new Vector3(comp.rotation[0], comp.rotation[1], comp.rotation[2]);
        }

        if (comp.scale) {
            mesh.scaling = new Vector3(comp.scale[0], comp.scale[1], comp.scale[2]);
        }

        mesh.isPickable = false;

        return mesh;
    }

    private createParticleSystem(config: TowerParticleConfig, emitter: Mesh, name: string): ParticleSystem {
        const ps = new ParticleSystem(name, config.emitRate * 2, this.scene);

        const offsetY = config.offsetY || 1.5;
        const emitterNode = MeshBuilder.CreateBox(`${name}_emitter`, { size: 0.01 }, this.scene);
        emitterNode.parent = emitter;
        emitterNode.position.y = offsetY;
        emitterNode.isVisible = false;
        ps.emitter = emitterNode;

        ps.minEmitBox = new Vector3(-0.3, -0.1, -0.3);
        ps.maxEmitBox = new Vector3(0.3, 0.1, 0.3);
        ps.color1 = new Color4(config.color1[0], config.color1[1], config.color1[2], config.color1[3]);
        ps.color2 = new Color4(config.color2[0], config.color2[1], config.color2[2], config.color2[3]);
        ps.colorDead = new Color4(0, 0, 0, 0);
        ps.minSize = config.minSize;
        ps.maxSize = config.maxSize;
        ps.minLifeTime = config.minLifeTime;
        ps.maxLifeTime = config.maxLifeTime;
        ps.emitRate = config.emitRate;
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.direction1 = new Vector3(-0.3, 0.5, -0.3);
        ps.direction2 = new Vector3(0.3, 1.0, 0.3);
        ps.minEmitPower = 0.3;
        ps.maxEmitPower = 0.8;
        ps.updateSpeed = 0.01;
        ps.start();

        return ps;
    }

    private applyAnimation(config: TowerAnimationConfig, baseMesh: Mesh, components: TowerVisualComponent[]): void {
        const targetMesh = config.componentIndex !== undefined
            ? baseMesh.getChildMeshes(true)[config.componentIndex] as Mesh || baseMesh
            : baseMesh;

        switch (config.type) {
            case 'rotate': {
                const anim = new Animation(
                    'rotateAnim', 'rotation.y', 30,
                    Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE
                );
                const frames = Math.floor(30 / config.speed);
                anim.setKeys([
                    { frame: 0, value: 0 },
                    { frame: frames, value: Math.PI * 2 }
                ]);
                targetMesh.animations.push(anim);
                this.scene.beginAnimation(targetMesh, 0, frames, true);
                break;
            }
            case 'pulse': {
                const amp = config.amplitude || 0.1;
                const anim = new Animation(
                    'pulseAnim', 'scaling', 30,
                    Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE
                );
                const frames = Math.floor(30 / config.speed);
                anim.setKeys([
                    { frame: 0, value: new Vector3(1, 1, 1) },
                    { frame: frames / 2, value: new Vector3(1 + amp, 1 + amp, 1 + amp) },
                    { frame: frames, value: new Vector3(1, 1, 1) }
                ]);
                targetMesh.animations.push(anim);
                this.scene.beginAnimation(targetMesh, 0, frames, true);
                break;
            }
            case 'bob': {
                const amp = config.amplitude || 0.2;
                const baseY = targetMesh.position.y;
                const anim = new Animation(
                    'bobAnim', 'position.y', 30,
                    Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE
                );
                const frames = Math.floor(30 / config.speed);
                anim.setKeys([
                    { frame: 0, value: baseY },
                    { frame: frames / 2, value: baseY + amp },
                    { frame: frames, value: baseY }
                ]);
                targetMesh.animations.push(anim);
                this.scene.beginAnimation(targetMesh, 0, frames, true);
                break;
            }
        }
    }
}
