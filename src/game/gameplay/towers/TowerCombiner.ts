import { Vector3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Tower, ElementType, TowerCombination } from './Tower';
import { FireTower } from './FireTower';
import { WaterTower } from './WaterTower';
import { WindTower } from './WindTower';
import { EarthTower } from './EarthTower';
import { SteamTower } from './hybrid/SteamTower';
import { LavaTower } from './hybrid/LavaTower';
import { IceTower } from './hybrid/IceTower';
import { StormTower } from './hybrid/StormTower';
import { MudTower } from './hybrid/MudTower';
import { DustTower } from './hybrid/DustTower';

/**
 * Class responsible for detecting and creating tower combinations
 */
export class TowerCombiner {
    private game: Game;
    private towerManager: any; // TowerManager
    private map: any; // Map
    
    // Define all possible tower combinations
    private combinations: TowerCombination[] = [
        {
            elements: [ElementType.FIRE, ElementType.WATER],
            resultType: 'SteamTower',
            name: 'Steam Tower',
            description: 'Creates steam clouds that damage and slow enemies'
        },
        {
            elements: [ElementType.FIRE, ElementType.EARTH],
            resultType: 'LavaTower',
            name: 'Lava Tower',
            description: 'Creates lava pools that damage enemies over time'
        },
        {
            elements: [ElementType.WATER, ElementType.WIND],
            resultType: 'IceTower',
            name: 'Ice Tower',
            description: 'Freezes enemies and deals bonus damage to frozen targets'
        },
        {
            elements: [ElementType.WIND, ElementType.FIRE],
            resultType: 'StormTower',
            name: 'Storm Tower',
            description: 'Creates lightning strikes that chain between enemies'
        },
        {
            elements: [ElementType.EARTH, ElementType.WATER],
            resultType: 'MudTower',
            name: 'Mud Tower',
            description: 'Creates mud that slows enemies and reduces their armor'
        },
        {
            elements: [ElementType.EARTH, ElementType.WIND],
            resultType: 'DustTower',
            name: 'Dust Tower',
            description: 'Creates dust clouds that confuse and damage enemies'
        }
    ];
    
    /**
     * Constructor for the TowerCombiner
     * @param game The game instance
     * @param towerManager The tower manager
     * @param map The map
     */
    constructor(game: Game, towerManager: any, map: any) {
        this.game = game;
        this.towerManager = towerManager;
        this.map = map;
    }
    
    /**
     * Check for possible tower combinations after a new tower is placed
     * @param newTower The newly placed tower
     * @returns True if a combination was created
     */
    public checkForCombinations(newTower: Tower): boolean {
        // Get the position of the new tower
        const position = newTower.getPosition();
        const tileX = Math.round(position.x);
        const tileZ = Math.round(position.z);
        
        // Get all adjacent towers
        const adjacentTowers = this.getAdjacentTowers(tileX, tileZ);
        
        // If there are no adjacent towers, no combinations are possible
        if (adjacentTowers.length === 0) {
            return false;
        }
        
        // Check each adjacent tower for possible combinations
        for (const adjacentTower of adjacentTowers) {
            // Skip if the adjacent tower is not an elemental tower
            if (adjacentTower.getElementType() === ElementType.NONE) {
                continue;
            }
            
            // Check if these two towers can be combined
            const combination = this.findCombination(newTower.getElementType(), adjacentTower.getElementType());
            
            if (combination) {
                // Create the combined tower
                this.createCombinedTower(combination, newTower, adjacentTower);
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Get all towers adjacent to the specified tile
     * @param tileX The x coordinate of the tile
     * @param tileZ The z coordinate of the tile
     * @returns Array of adjacent towers
     */
    private getAdjacentTowers(tileX: number, tileZ: number): Tower[] {
        const adjacentTowers: Tower[] = [];
        
        // Check all 4 adjacent tiles
        const adjacentPositions = [
            { x: tileX + 1, z: tileZ },
            { x: tileX - 1, z: tileZ },
            { x: tileX, z: tileZ + 1 },
            { x: tileX, z: tileZ - 1 }
        ];
        
        // Get all towers from the tower manager
        const allTowers = this.towerManager.getTowers();
        
        // Check each tower to see if it's in an adjacent position
        for (const tower of allTowers) {
            const towerPosition = tower.getPosition();
            const towerTileX = Math.round(towerPosition.x);
            const towerTileZ = Math.round(towerPosition.z);
            
            // Check if this tower is in one of the adjacent positions
            for (const pos of adjacentPositions) {
                if (towerTileX === pos.x && towerTileZ === pos.z) {
                    adjacentTowers.push(tower);
                    break;
                }
            }
        }
        
        return adjacentTowers;
    }
    
    /**
     * Find a combination that matches the given element types
     * @param element1 The first element type
     * @param element2 The second element type
     * @returns The matching combination or null if none found
     */
    private findCombination(element1: ElementType, element2: ElementType): TowerCombination | null {
        for (const combination of this.combinations) {
            // Check if the combination matches the given elements (in any order)
            if ((combination.elements[0] === element1 && combination.elements[1] === element2) ||
                (combination.elements[0] === element2 && combination.elements[1] === element1)) {
                return combination;
            }
        }
        
        return null;
    }
    
    /**
     * Create a combined tower from two existing towers
     * @param combination The tower combination to create
     * @param tower1 The first tower
     * @param tower2 The second tower
     */
    private createCombinedTower(combination: TowerCombination, tower1: Tower, tower2: Tower): void {
        // Calculate the position for the new tower (midpoint between the two towers)
        const position1 = tower1.getPosition();
        const position2 = tower2.getPosition();
        
        const midpoint = new Vector3(
            (position1.x + position2.x) / 2,
            0, // Y position is always 0 for towers
            (position1.z + position2.z) / 2
        );
        
        // Remove the original towers
        this.towerManager.removeTower(tower1);
        this.towerManager.removeTower(tower2);
        
        // Create the new combined tower based on the combination type
        let newTower: Tower | null = null;
        
        switch (combination.resultType) {
            case 'SteamTower':
                newTower = new SteamTower(this.game, midpoint);
                break;
            case 'LavaTower':
                newTower = new LavaTower(this.game, midpoint);
                break;
            case 'IceTower':
                newTower = new IceTower(this.game, midpoint);
                break;
            case 'StormTower':
                newTower = new StormTower(this.game, midpoint);
                break;
            case 'MudTower':
                newTower = new MudTower(this.game, midpoint);
                break;
            case 'DustTower':
                newTower = new DustTower(this.game, midpoint);
                break;
        }
        
        if (newTower) {
            // Add the new tower to the tower manager
            this.towerManager.addTower(newTower);
            
            // Show a visual effect for the combination
            this.showCombinationEffect(midpoint, combination);
            
            // Play a sound effect
            this.game.getAssetManager().playSound('towerCombine');
            
            // Show a notification in the console instead
            console.log(`Created ${combination.name}!`);
        }
    }
    
    /**
     * Show a visual effect for the tower combination
     * @param position The position for the effect
     * @param combination The tower combination
     */
    private showCombinationEffect(position: Vector3, combination: TowerCombination): void {
        // This would create a particle effect or other visual to show the combination
        // For now, we'll just log it
        console.log(`Created ${combination.name} at position ${position.x}, ${position.z}`);
    }
} 