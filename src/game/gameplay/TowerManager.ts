import { Vector3, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, Texture, Scene } from '@babylonjs/core';
import { Game } from '../Game';
import { Map } from './Map';
import { Tower, TargetingMode } from './towers/Tower';
import { EnemyManager } from './EnemyManager';
import { LevelManager } from './LevelManager';
import { TowerDefinition, getTowerDefinition, registerTowerDefinitions, getUpgradeOptions } from './towers/TowerDefinitions';
import { TowerAbilitySystem } from './towers/abilities/TowerAbilitySystem';
import { MEDIEVAL_TOWER_DEFS } from './towers/MedievalTowerDefs';
import { ELEMENTAL_TOWER_DEFS } from './towers/ElementalTowerDefs';

export class TowerManager {
    private game: Game;
    private scene: Scene;
    private map: Map;
    private towers: Tower[] = [];
    private enemyManager: EnemyManager | null = null;
    private levelManager: LevelManager | null = null;
    private definitionsRegistered: boolean = false;

    constructor(game: Game, map: Map) {
        this.game = game;
        this.scene = game.getScene();
        this.map = map;

        // Register all tower definitions once
        if (!this.definitionsRegistered) {
            registerTowerDefinitions(MEDIEVAL_TOWER_DEFS);
            registerTowerDefinitions(ELEMENTAL_TOWER_DEFS);
            this.definitionsRegistered = true;
        }
    }

    public setLevelManager(levelManager: LevelManager): void {
        this.levelManager = levelManager;
    }

    public setEnemyManager(enemyManager: EnemyManager): void {
        this.enemyManager = enemyManager;
    }

    /**
     * Update all towers — targeting, firing, aura buffs, auto abilities.
     */
    public update(deltaTime: number): void {
        const hasEnemies = this.enemyManager && this.enemyManager.getEnemyCount() > 0;

        // First pass: compute aura buffs from support towers
        this.computeAuraBuffs();

        // Second pass: target + update each tower
        for (const tower of this.towers) {
            if (hasEnemies) {
                const position = tower.getPosition();
                const range = tower.getRange();

                let target = null;
                switch (tower.getTargetingMode()) {
                    case TargetingMode.FIRST:
                        target = this.enemyManager!.getFirstEnemy(position, range);
                        break;
                    case TargetingMode.STRONGEST:
                        target = this.enemyManager!.getStrongestEnemy(position, range);
                        break;
                    case TargetingMode.CLOSEST:
                    default:
                        target = this.enemyManager!.getClosestEnemy(position, range);
                        break;
                }
                tower.setTarget(target);
            } else {
                tower.setTarget(null);
            }

            tower.update(deltaTime);

            // Process auto abilities with full enemy list
            if (hasEnemies && this.enemyManager) {
                const allEnemies = this.enemyManager.getEnemies();
                tower.processAutoAbilities(allEnemies);
            }
        }
    }

    /**
     * Compute and apply aura buffs from support towers to nearby towers.
     */
    private computeAuraBuffs(): void {
        // Reset all aura buffs first
        for (const tower of this.towers) {
            tower.setAuraBuffs(0, 0, 0);
        }

        // For each tower with an auraBuff ability, apply to nearby towers
        for (const tower of this.towers) {
            const abilityState = tower.getAbilityState();
            if (!abilityState) continue;

            const system = Tower.getAbilitySystem();
            if (!system) continue;

            const aura = system.getAuraBuffValues(abilityState);
            if (!aura) continue;

            const pos = tower.getPosition();
            for (const other of this.towers) {
                if (other === tower) continue;
                const dist = Vector3.Distance(pos, other.getPosition());
                if (dist <= aura.radius) {
                    // Stack aura buffs from multiple sources
                    const currentDmg = (other as any).auraDamageBonus || 0;
                    const currentRate = (other as any).auraFireRateBonus || 0;
                    const currentRange = (other as any).auraRangeBonus || 0;
                    other.setAuraBuffs(
                        currentDmg + aura.bonusDamage,
                        currentRate + aura.bonusFireRate,
                        currentRange + aura.bonusRange
                    );
                }
            }
        }
    }

    /**
     * Create a new tower from a definition ID at a world position.
     */
    public createTower(definitionId: string, position: Vector3): Tower | null {
        const def = getTowerDefinition(definitionId);
        if (!def) {
            console.error(`Unknown tower definition: ${definitionId}`);
            return null;
        }

        try {
            const tower = new Tower(this.game, position, definitionId);
            this.towers.push(tower);
            this.createPlacementEffect(position);
            return tower;
        } catch (e) {
            console.error(`Failed to create tower ${definitionId}:`, e);
            return null;
        }
    }

    /**
     * Evolve an existing tower to a new definition (upgrade path).
     */
    public evolveTower(tower: Tower, targetId: string): boolean {
        if (!tower) return false;
        return tower.evolve(targetId);
    }

    /**
     * Legacy upgrade method — now unused in the evolution system.
     */
    public upgradeTower(tower: Tower | null): boolean {
        if (!tower) return false;
        // In the new system, call evolveTower with the desired upgrade path ID
        const options = tower.getUpgradeOptions();
        if (options.length === 0) return false;
        // Auto-pick the first option (caller should pick explicitly via UI)
        return this.evolveTower(tower, options[0].id);
    }

    private createPlacementEffect(position: Vector3): void {
        const particleSystem = new ParticleSystem('towerPlacementParticles', 50, this.scene);
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        particleSystem.emitter = new Vector3(position.x, position.y + 1, position.z);
        particleSystem.minEmitBox = new Vector3(-0.5, 0, -0.5);
        particleSystem.maxEmitBox = new Vector3(0.5, 0, 0.5);
        particleSystem.color1 = new Color4(0.7, 0.8, 1.0, 1.0);
        particleSystem.color2 = new Color4(0.2, 0.5, 1.0, 1.0);
        particleSystem.colorDead = new Color4(0, 0, 0.2, 0.0);
        particleSystem.minSize = 0.1;
        particleSystem.maxSize = 0.5;
        particleSystem.minLifeTime = 0.3;
        particleSystem.maxLifeTime = 1.0;
        particleSystem.emitRate = 100;
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        particleSystem.gravity = new Vector3(0, 9.81, 0);
        particleSystem.direction1 = new Vector3(-1, 8, -1);
        particleSystem.direction2 = new Vector3(1, 8, 1);
        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;
        particleSystem.start();
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => particleSystem.dispose(), 1000);
        }, 1000);
    }

    public getTowers(): Tower[] {
        return this.towers;
    }

    public getTowerById(id: string): Tower | null {
        return this.towers.find(tower => tower.getId() === id) || null;
    }

    public getClosestTower(position: Vector3, maxRange: number): Tower | null {
        let closestTower: Tower | null = null;
        let closestDistance = maxRange;
        for (const tower of this.towers) {
            const distance = Vector3.Distance(position, tower.getPosition());
            if (distance < closestDistance) {
                closestDistance = distance;
                closestTower = tower;
            }
        }
        return closestTower;
    }

    public hasTower(tower: Tower): boolean {
        return this.towers.includes(tower);
    }

    public addTower(tower: Tower): void {
        this.towers.push(tower);
    }

    public removeTower(tower: Tower): void {
        const index = this.towers.indexOf(tower);
        if (index !== -1) {
            this.towers.splice(index, 1);
            tower.dispose();
        }
    }

    public sellTower(tower: Tower): number {
        const sellValue = tower.getSellValue();

        const towerMap = this.levelManager
            ? (this.levelManager.getMapForWorldPosition(tower.getPosition()) || this.map)
            : this.map;

        const gridPosition = towerMap.worldToGrid(tower.getPosition());
        tower.dispose();

        const index = this.towers.indexOf(tower);
        if (index !== -1) {
            this.towers.splice(index, 1);
        }

        towerMap.setTowerPlaced(gridPosition.x, gridPosition.y, false);
        return sellValue;
    }

    public dispose(): void {
        for (const tower of this.towers) {
            tower.dispose();
        }
        this.towers = [];
    }
}
