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
import { GeyserTower } from './ultimate/GeyserTower';
import { InfernoTower } from './ultimate/InfernoTower';
import { GlacierTower } from './ultimate/GlacierTower';
import { TempestTower } from './ultimate/TempestTower';
import { QuagmireTower } from './ultimate/QuagmireTower';
import { CycloneTower } from './ultimate/CycloneTower';

interface Tier2Combination {
    sourceType: string;
    resultType: string;
    name: string;
}


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
            description: 'Creates superheated steam clouds that severely burn and slow enemies in a wide area'
        },
        {
            elements: [ElementType.FIRE, ElementType.EARTH],
            resultType: 'LavaTower',
            name: 'Lava Tower',
            description: 'Erupts with molten rock, creating deadly lava pools that continually damage enemies'
        },
        {
            elements: [ElementType.WATER, ElementType.WIND],
            resultType: 'IceTower',
            name: 'Frost Tower',
            description: 'Generates freezing blizzards that slow and eventually freeze enemies solid'
        },
        {
            elements: [ElementType.WIND, ElementType.FIRE],
            resultType: 'StormTower',
            name: 'Lightning Tower',
            description: 'Summons devastating lightning strikes that chain between nearby enemies'
        },
        {
            elements: [ElementType.EARTH, ElementType.WATER],
            resultType: 'MudTower',
            name: 'Swamp Tower',
            description: 'Creates thick quicksand that traps enemies, slowing them and reducing their defenses'
        },
        {
            elements: [ElementType.EARTH, ElementType.WIND],
            resultType: 'DustTower',
            name: 'Sandstorm Tower',
            description: 'Generates raging sandstorms that blind and disorient enemies while dealing damage'
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
        // Skip if not an elemental tower
        if (newTower.getElementType() === ElementType.NONE) {
            console.log('Skipping combination check - not an elemental tower');
            return false;
        }

        // Get the position of the new tower
        const position = newTower.getPosition();
        // Convert world position to grid position
        const tileX = Math.floor(position.x);
        const tileZ = Math.floor(position.z);
        
        console.log(`Checking combinations for tower at world pos (${position.x}, ${position.z}), grid pos (${tileX}, ${tileZ}) with element ${newTower.getElementType()}`);
        
        // Get all adjacent towers
        const adjacentTowers = this.getAdjacentTowers(position.x, position.z);
        
        console.log(`Found ${adjacentTowers.length} adjacent towers`);
        
        // If there are no adjacent towers, no combinations are possible
        if (adjacentTowers.length === 0) {
            console.log('No adjacent towers found');
            return false;
        }
        
        // Check each adjacent tower for possible combinations
        for (const adjacentTower of adjacentTowers) {
            const adjPos = adjacentTower.getPosition();
            console.log(`Checking adjacent tower at (${adjPos.x}, ${adjPos.z}) with element ${adjacentTower.getElementType()}`);
            
            // Skip if not an elemental tower
            if (adjacentTower.getElementType() === ElementType.NONE) {
                console.log('Skipping - adjacent tower is not elemental');
                continue;
            }
            
            // Skip if same element type
            if (adjacentTower.getElementType() === newTower.getElementType()) {
                console.log('Skipping - same element type');
                continue;
            }
            
            // Check if these two towers can be combined
            const combination = this.findCombination(newTower.getElementType(), adjacentTower.getElementType());
            
            if (combination) {
                console.log(`Found valid combination: ${combination.name}`);
                // Create the combined tower
                this.createCombinedTower(combination, newTower, adjacentTower);
                return true;
            } else {
                console.log('No valid combination found for these elements');
            }
        }
        
        console.log('No valid combinations found with any adjacent towers');
        return false;
    }
    
    /**
     * Get all towers adjacent to the specified position
     * @param posX The x coordinate in world space
     * @param posZ The z coordinate in world space
     * @returns Array of adjacent towers
     */
    private getAdjacentTowers(posX: number, posZ: number): Tower[] {
        const adjacentTowers: Tower[] = [];
        const TOWER_SPACING = 2; // Towers are placed on a 2-unit grid
        
        console.log(`Looking for towers adjacent to world position (${posX}, ${posZ})`);
        
        // Get all towers from the tower manager
        const allTowers = this.towerManager.getTowers();
        console.log(`Total towers in game: ${allTowers.length}`);
        
        // Check each tower to see if it's adjacent
        for (const tower of allTowers) {
            const towerPos = tower.getPosition();
            
            // Calculate distance between towers in world space
            const dx = Math.abs(towerPos.x - posX);
            const dz = Math.abs(towerPos.z - posZ);
            
            // Towers are adjacent if they are exactly TOWER_SPACING units apart in one direction
            // and 0 units apart in the other direction
            const isAdjacent = (Math.abs(dx - TOWER_SPACING) < 0.1 && dz < 0.1) || 
                             (dx < 0.1 && Math.abs(dz - TOWER_SPACING) < 0.1);
            
            console.log(`Checking tower at (${towerPos.x}, ${towerPos.z}), dx=${dx}, dz=${dz}, isAdjacent=${isAdjacent}`);
            
            if (isAdjacent) {
                console.log(`Found adjacent tower at (${towerPos.x}, ${towerPos.z})`);
                adjacentTowers.push(tower);
            }
        }
        
        console.log(`Found ${adjacentTowers.length} adjacent towers`);
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
        // Place new tower at tower1's position (the newly placed tower that triggered fusion)
        const pos1 = tower1.getPosition();
        const pos2 = tower2.getPosition();
        console.log(`[FUSION] tower1 pos: (${pos1.x}, ${pos1.z}), tower2 pos: (${pos2.x}, ${pos2.z})`);

        const newPosition = new Vector3(pos1.x, 0, pos1.z);
        console.log(`[FUSION] new tower position: (${newPosition.x}, ${newPosition.z})`);

        // Free both grid cells before removing towers
        const grid1 = this.map.worldToGrid(pos1);
        const grid2 = this.map.worldToGrid(pos2);
        this.map.setTowerPlaced(grid1.x, grid1.y, false);
        this.map.setTowerPlaced(grid2.x, grid2.y, false);
        console.log(`[FUSION] freed grid cells: (${grid1.x},${grid1.y}) and (${grid2.x},${grid2.y})`);

        // Remove the original towers
        this.towerManager.removeTower(tower1);
        this.towerManager.removeTower(tower2);

        // Create the new combined tower based on the combination type
        let newTower: Tower | null = null;

        switch (combination.resultType) {
            case 'SteamTower':
                newTower = new SteamTower(this.game, newPosition);
                break;
            case 'LavaTower':
                newTower = new LavaTower(this.game, newPosition);
                break;
            case 'IceTower':
                newTower = new IceTower(this.game, newPosition);
                break;
            case 'StormTower':
                newTower = new StormTower(this.game, newPosition);
                break;
            case 'MudTower':
                newTower = new MudTower(this.game, newPosition);
                break;
            case 'DustTower':
                newTower = new DustTower(this.game, newPosition);
                break;
        }

        if (newTower) {
            // Add the new tower to the tower manager
            this.towerManager.addTower(newTower);

            // Mark the new tower's grid cell as occupied
            const newGrid = this.map.worldToGrid(newPosition);
            this.map.setTowerPlaced(newGrid.x, newGrid.y, true);
            console.log(`[FUSION] marked grid (${newGrid.x},${newGrid.y}) as occupied`);

            // Verify tower mesh position
            const meshPos = newTower.getMesh()?.position;
            console.log(`[FUSION] new tower mesh pos: (${meshPos?.x}, ${meshPos?.z}), stored pos: (${newTower.getPosition().x}, ${newTower.getPosition().z})`);
            console.log(`[FUSION] towers in manager: ${this.towerManager.getTowers().length}`);

            // Show a visual effect for the combination
            this.showCombinationEffect(newPosition, combination);

            // Play a sound effect
            this.game.getAssetManager().playSound('towerCombine');

            console.log(`Created ${combination.name}!`);
        }
    }
    
    /**
     * Show a visual effect for the tower combination
     * @param position The position for the effect
     * @param combination The tower combination
     */
    private showCombinationEffect(position: Vector3, combination: TowerCombination): void {
        console.log(`Created ${combination.name} at position ${position.x}, ${position.z}`);
    }

    // ========================================================================
    // Tier 2 Fusion — two identical max-level hybrid towers → Ultimate tower
    // ========================================================================

    private tier2Combinations: Tier2Combination[] = [
        { sourceType: 'SteamTower',  resultType: 'GeyserTower',   name: 'Geyser Tower' },
        { sourceType: 'LavaTower',   resultType: 'InfernoTower',  name: 'Inferno Tower' },
        { sourceType: 'IceTower',    resultType: 'GlacierTower',  name: 'Glacier Tower' },
        { sourceType: 'StormTower',  resultType: 'TempestTower',  name: 'Tempest Tower' },
        { sourceType: 'MudTower',    resultType: 'QuagmireTower', name: 'Quagmire Tower' },
        { sourceType: 'DustTower',   resultType: 'CycloneTower',  name: 'Cyclone Tower' },
    ];

    /**
     * Check for tier 2 combinations after a hybrid tower reaches max level
     */
    public checkTier2Combinations(tower: Tower): boolean {
        if (tower.getFusionTier() !== 1) return false;
        if (tower.getLevel() < tower.getMaxLevel()) return false;

        const towerType = tower.getType();
        const combo = this.tier2Combinations.find(c => c.sourceType === towerType);
        if (!combo) return false;

        const position = tower.getPosition();
        const adjacentTowers = this.getAdjacentTowers(position.x, position.z);

        for (const adj of adjacentTowers) {
            if (adj === tower) continue;
            if (adj.getType() !== towerType) continue;
            if (adj.getFusionTier() !== 1) continue;
            if (adj.getLevel() < adj.getMaxLevel()) continue;

            // Found a match — create tier 2 tower
            this.createTier2Tower(combo, tower, adj);
            return true;
        }

        return false;
    }

    private createTier2Tower(combo: Tier2Combination, tower1: Tower, tower2: Tower): void {
        const newPosition = tower1.getPosition().clone();
        newPosition.y = 0;

        // Free both grid cells
        const grid1 = this.map.worldToGrid(tower1.getPosition());
        const grid2 = this.map.worldToGrid(tower2.getPosition());
        this.map.setTowerPlaced(grid1.x, grid1.y, false);
        this.map.setTowerPlaced(grid2.x, grid2.y, false);

        // Remove both towers
        this.towerManager.removeTower(tower1);
        this.towerManager.removeTower(tower2);

        // Create ultimate tower
        let newTower: Tower | null = null;
        switch (combo.resultType) {
            case 'GeyserTower':   newTower = new GeyserTower(this.game, newPosition);   break;
            case 'InfernoTower':  newTower = new InfernoTower(this.game, newPosition);  break;
            case 'GlacierTower':  newTower = new GlacierTower(this.game, newPosition);  break;
            case 'TempestTower':  newTower = new TempestTower(this.game, newPosition);  break;
            case 'QuagmireTower': newTower = new QuagmireTower(this.game, newPosition); break;
            case 'CycloneTower':  newTower = new CycloneTower(this.game, newPosition);  break;
        }

        if (newTower) {
            this.towerManager.addTower(newTower);

            const newGrid = this.map.worldToGrid(newPosition);
            this.map.setTowerPlaced(newGrid.x, newGrid.y, true);

            this.game.getAssetManager().playSound('towerCombine');
            console.log(`Created ${combo.name}!`);
        }
    }
} 