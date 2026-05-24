import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import { Champion } from './Champion';

export interface BasicAttackTarget {
    position: Vector3;
    takeDamage: (amount: number) => void;
    isAlive: () => boolean;
}

export class HeroBasicAttack {
    private scene: Scene;
    private hero: Champion;
    private cooldown: number = 0;
    private fireInterval: number;
    private damage: number;
    private range: number;
    private targetProvider: () => BasicAttackTarget | null;

    constructor(
        scene: Scene,
        hero: Champion,
        opts: {
            fireRate: number;
            damage: number;
            range: number;
            targetProvider: () => BasicAttackTarget | null;
        },
    ) {
        this.scene = scene;
        this.hero = hero;
        this.fireInterval = 1 / opts.fireRate;
        this.damage = opts.damage;
        this.range = opts.range;
        this.targetProvider = opts.targetProvider;
    }

    public update(deltaTime: number): void {
        this.cooldown -= deltaTime;
        if (this.cooldown > 0) return;

        const target = this.targetProvider();
        if (!target || !target.isAlive()) return;

        const heroPos = (this.hero as any).position as Vector3;
        const dist = Vector3.Distance(heroPos, target.position);
        if (dist > this.range) return;

        this.spawnProjectile(heroPos.clone(), target);
        this.cooldown = this.fireInterval;
    }

    private spawnProjectile(from: Vector3, target: BasicAttackTarget): void {
        const proj = MeshBuilder.CreateSphere('basicProj', { diameter: 0.3 }, this.scene);
        proj.position.copyFrom(from);
        proj.position.y = 1;
        const mat = new StandardMaterial('basicProjMat', this.scene);
        mat.emissiveColor = new Color3(1, 0.9, 0.4);
        proj.material = mat;

        const speed = 22;
        const startTime = performance.now() / 1000;

        const observer = this.scene.onBeforeRenderObservable.add(() => {
            if (!observer) return;
            if (!target.isAlive()) {
                proj.dispose();
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const targetPos = target.position.clone();
            targetPos.y = 1;
            const dir = targetPos.subtract(proj.position);
            const dist = dir.length();
            if (dist < 0.4) {
                target.takeDamage(this.damage);
                proj.dispose();
                this.scene.onBeforeRenderObservable.remove(observer);
                return;
            }
            const dt = this.scene.getEngine().getDeltaTime() / 1000;
            const step = Math.min(dist, speed * dt);
            proj.position.addInPlace(dir.normalize().scale(step));

            // Safety: dispose after 3s of flight
            if (performance.now() / 1000 - startTime > 3) {
                proj.dispose();
                this.scene.onBeforeRenderObservable.remove(observer);
            }
        });
    }
}
