import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Scene } from '@babylonjs/core';
import { Game } from '../Game';

// Define grid cell types
enum CellType {
    EMPTY = 0,
    PATH = 1,
    TOWER = 2,
    START = 3,
    END = 4
}

// Define a path node for pathfinding
interface PathNode {
    x: number;
    y: number;
    f: number; // Total cost (g + h)
    g: number; // Cost from start
    h: number; // Heuristic (estimated cost to end)
    parent: PathNode | null;
}

export class Map {
    private game: Game;
    private scene: Scene;
    private gridSize: number = 20; // 20x20 grid
    private cellSize: number = 2; // 2 units per cell
    private grid: CellType[][] = [];
    private path: Vector3[] = []; // The path enemies will follow
    private startPosition: { x: number, y: number } = { x: 0, y: 0 };
    private endPosition: { x: number, y: number } = { x: 19, y: 19 };
    private groundMeshes: Mesh[] = [];

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();
        
        // Initialize grid with empty cells
        for (let x = 0; x < this.gridSize; x++) {
            this.grid[x] = [];
            for (let y = 0; y < this.gridSize; y++) {
                this.grid[x][y] = CellType.EMPTY;
            }
        }
    }

    /**
     * Initialize the map
     */
    public initialize(): void {
        // Create the ground
        this.createGround();
        
        // Set start and end positions
        this.startPosition = { x: 0, y: Math.floor(this.gridSize / 2) };
        this.endPosition = { x: this.gridSize - 1, y: Math.floor(this.gridSize / 2) };
        
        // Mark start and end on the grid
        this.grid[this.startPosition.x][this.startPosition.y] = CellType.START;
        this.grid[this.endPosition.x][this.endPosition.y] = CellType.END;
        
        // Generate a path from start to end with turns
        this.generatePathWithTurns();
        
        // Create visual representation of the path
        this.createPathVisuals();
    }

    /**
     * Create the ground mesh
     */
    private createGround(): void {
        // Create a material for the ground
        const groundMaterial = new StandardMaterial('groundMaterial', this.scene);
        groundMaterial.diffuseColor = new Color3(0.2, 0.5, 0.2); // Green color for grass
        
        // Create ground tiles
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const position = this.gridToWorld(x, y);
                const ground = MeshBuilder.CreateBox(`ground_${x}_${y}`, {
                    width: this.cellSize,
                    height: 0.1,
                    depth: this.cellSize
                }, this.scene);
                
                ground.position = position;
                ground.material = groundMaterial;
                ground.receiveShadows = true;
                
                this.groundMeshes.push(ground);
            }
        }
    }

    /**
     * Generate a path with turns
     */
    private generatePathWithTurns(): void {
        // Define waypoints for a continuous path with smooth turns
        const waypoints = [
            this.startPosition,
            { x: 3, y: Math.floor(this.gridSize / 2) },
            { x: 3, y: 18 },
            { x: 6, y: 18 },
            { x: 6, y: 2 },
            { x: 9, y: 2 },
            { x: 9, y: 18 },
            { x: 12, y: 18 },
            { x: 12, y: 2 },
            { x: 15, y: 2 },
            { x: 15, y: 18 },
            { x: 18, y: 18 },
            { x: 18, y: 2 },
            { x: 19, y: 2 },
            this.endPosition
        ];
        
        // Clear the path array
        this.path = [];
        
        // Connect waypoints to create a path
        for (let i = 0; i < waypoints.length - 1; i++) {
            const start = waypoints[i];
            const end = waypoints[i + 1];
            
            // Connect horizontally or vertically with ordered points
            if (start.x === end.x) {
                // Vertical connection
                const step = start.y < end.y ? 1 : -1;
                for (let y = start.y; step > 0 ? y <= end.y : y >= end.y; y += step) {
                    this.grid[start.x][y] = CellType.PATH;
                    // Only add to path if it's not already there
                    const worldPos = this.gridToWorld(start.x, y);
                    if (!this.path.some(p => p.x === worldPos.x && p.z === worldPos.z)) {
                        this.path.push(worldPos);
                    }
                }
            } else if (start.y === end.y) {
                // Horizontal connection
                const step = start.x < end.x ? 1 : -1;
                for (let x = start.x; step > 0 ? x <= end.x : x >= end.x; x += step) {
                    this.grid[x][start.y] = CellType.PATH;
                    // Only add to path if it's not already there
                    const worldPos = this.gridToWorld(x, start.y);
                    if (!this.path.some(p => p.x === worldPos.x && p.z === worldPos.z)) {
                        this.path.push(worldPos);
                    }
                }
            }
        }
        
        // Make sure start and end positions are properly marked
        this.grid[this.startPosition.x][this.startPosition.y] = CellType.START;
        this.grid[this.endPosition.x][this.endPosition.y] = CellType.END;
        
        console.log(`Generated path with ${this.path.length} points and ${waypoints.length} waypoints`);
    }

    /**
     * Create visual representation of the path
     */
    private createPathVisuals(): void {
        // Create a material for the path
        const pathMaterial = new StandardMaterial('pathMaterial', this.scene);
        pathMaterial.diffuseColor = new Color3(0.8, 0.8, 0.3); // Yellow-ish color for path
        
        // Create path tiles
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y] === CellType.PATH || 
                    this.grid[x][y] === CellType.START || 
                    this.grid[x][y] === CellType.END) {
                    
                    const position = this.gridToWorld(x, y);
                    position.y = 0.1; // Slightly above ground
                    
                    // Make the path wider
                    const pathTile = MeshBuilder.CreateBox(`path_${x}_${y}`, {
                        width: this.cellSize * 0.9, // Wider path
                        height: 0.1,
                        depth: this.cellSize * 0.9  // Wider path
                    }, this.scene);
                    
                    pathTile.position = position;
                    pathTile.material = pathMaterial;
                    
                    this.groundMeshes.push(pathTile);
                }
            }
        }
        
        // Create start marker (green)
        const startPosition = this.gridToWorld(this.startPosition.x, this.startPosition.y);
        startPosition.y = 0.2; // Above path
        
        const startMaterial = new StandardMaterial('startMaterial', this.scene);
        startMaterial.diffuseColor = new Color3(0, 1, 0); // Green
        
        const startMarker = MeshBuilder.CreateCylinder('startMarker', {
            height: 0.5,
            diameter: this.cellSize * 0.8 // Larger marker
        }, this.scene);
        
        startMarker.position = startPosition;
        startMarker.material = startMaterial;
        this.groundMeshes.push(startMarker);
        
        // Create end marker (red)
        const endPosition = this.gridToWorld(this.endPosition.x, this.endPosition.y);
        endPosition.y = 0.2; // Above path
        
        const endMaterial = new StandardMaterial('endMaterial', this.scene);
        endMaterial.diffuseColor = new Color3(1, 0, 0); // Red
        
        const endMarker = MeshBuilder.CreateCylinder('endMarker', {
            height: 0.5,
            diameter: this.cellSize * 0.8 // Larger marker
        }, this.scene);
        
        endMarker.position = endPosition;
        endMarker.material = endMaterial;
        this.groundMeshes.push(endMarker);
    }

    /**
     * Convert grid coordinates to world position
     * @param gridX Grid X coordinate
     * @param gridY Grid Y coordinate
     * @returns World position
     */
    public gridToWorld(gridX: number, gridY: number): Vector3 {
        const worldX = (gridX - this.gridSize / 2 + 0.5) * this.cellSize;
        const worldZ = (gridY - this.gridSize / 2 + 0.5) * this.cellSize;
        return new Vector3(worldX, 0, worldZ);
    }

    /**
     * Convert world position to grid coordinates
     * @param position World position
     * @returns Grid coordinates
     */
    public worldToGrid(position: Vector3): { x: number, y: number } {
        const gridX = Math.floor((position.x / this.cellSize) + (this.gridSize / 2));
        const gridY = Math.floor((position.z / this.cellSize) + (this.gridSize / 2));
        return { x: gridX, y: gridY };
    }

    /**
     * Check if a tower can be placed at the given grid coordinates
     * @param gridX Grid X coordinate
     * @param gridY Grid Y coordinate
     * @returns True if tower can be placed
     */
    public canPlaceTower(gridX: number, gridY: number): boolean {
        // Check if within grid bounds
        if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
            return false;
        }
        
        // Check if cell is empty (not path, start, end, or tower)
        return this.grid[gridX][gridY] === CellType.EMPTY;
    }

    /**
     * Mark a grid cell as having a tower placed on it
     * @param gridX Grid X coordinate
     * @param gridY Grid Y coordinate
     * @param placed True if tower is placed, false if removed
     */
    public setTowerPlaced(gridX: number, gridY: number, placed: boolean): void {
        if (gridX >= 0 && gridX < this.gridSize && gridY >= 0 && gridY < this.gridSize) {
            this.grid[gridX][gridY] = placed ? CellType.TOWER : CellType.EMPTY;
        }
    }

    /**
     * Get the path for enemies to follow
     * @returns Array of world positions forming the path
     */
    public getPath(): Vector3[] {
        return this.path;
    }

    /**
     * Get the world position of the start point
     * @returns Start position
     */
    public getStartPosition(): Vector3 {
        return this.gridToWorld(this.startPosition.x, this.startPosition.y);
    }

    /**
     * Get the world position of the end point
     * @returns End position
     */
    public getEndPosition(): Vector3 {
        return this.gridToWorld(this.endPosition.x, this.endPosition.y);
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        // Dispose all meshes
        for (const mesh of this.groundMeshes) {
            mesh.dispose();
        }
        this.groundMeshes = [];
        
        // Reset grid to empty state
        this.grid = [];
        for (let x = 0; x < this.gridSize; x++) {
            this.grid[x] = [];
            for (let y = 0; y < this.gridSize; y++) {
                this.grid[x][y] = CellType.EMPTY;
            }
        }
        
        // Clear path
        this.path = [];
        
        console.log('Map disposed and reset');
    }
} 