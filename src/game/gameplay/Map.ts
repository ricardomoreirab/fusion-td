import { Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, Scene, Texture, Color4, ParticleSystem, ShadowGenerator, DirectionalLight } from '@babylonjs/core';
import { Game } from '../Game';

// Define grid cell types
enum CellType {
    EMPTY = 0,
    PATH = 1,
    TOWER = 2,
    START = 3,
    END = 4,
    DECORATION = 5
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

interface TerrainType {
    material: StandardMaterial;
    heightOffset: number;
    scale: { width: number, height: number, depth: number };
}

export class Map {
    private game: Game;
    private scene: Scene;
    private gridSize: number = 20; // 20x20 grid
    private cellSize: number = 2; // 2 units per cell
    private grid: CellType[][] = [];
    private path: Vector3[] = []; // The path enemies will follow
    private startPosition: { x: number, y: number } = { x: 0, y: 0 };
    private endPosition: { x: number, y: number } = { x: 19, y: 10 };
    private groundMeshes: Mesh[] = [];
    private decorationMeshes: Mesh[] = [];
    private shadowGenerator: ShadowGenerator | null = null;
    private pathParticles: ParticleSystem[] = [];

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
        // Add directional light for shadows
        this.setupLighting();
        
        // Create the ground
        this.createGround();
        
        // Set start and end positions
        this.startPosition = { x: 0, y: Math.floor(this.gridSize / 2) };
        this.endPosition = { x: 19, y: 10 };
        
        // Mark start and end on the grid
        this.grid[this.startPosition.x][this.startPosition.y] = CellType.START;
        this.grid[this.endPosition.x][this.endPosition.y] = CellType.END;
        
        // Generate a path from start to end with turns
        this.generatePathWithTurns();
        
        // Create visual representation of the path
        this.createPathVisuals();
        
        // Add decorations around the map
        this.addDecorations();
        
        // Add particles for start/end
        this.addParticleEffects();
    }

    /**
     * Setup lighting for the map
     */
    private setupLighting(): void {
        // Add a directional light for shadows
        const light = new DirectionalLight("mapLight", new Vector3(-0.5, -1, -0.5), this.scene);
        light.intensity = 0.7;
        light.position = new Vector3(10, 30, 10);
        
        // Create shadow generator
        this.shadowGenerator = new ShadowGenerator(1024, light);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 8;
    }

    /**
     * Create the ground mesh
     */
    private createGround(): void {
        // Create a material for the ground
        const groundMaterial = new StandardMaterial('groundMaterial', this.scene);
        groundMaterial.diffuseColor = new Color3(0.3, 0.5, 0.2); // Green color for grass
        groundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
        
        // Add grass texture
        const grassTexture = new Texture("assets/textures/grass.jpg", this.scene);
        grassTexture.uScale = 2;
        grassTexture.vScale = 2;
        groundMaterial.diffuseTexture = grassTexture;
        groundMaterial.bumpTexture = grassTexture;
        groundMaterial.bumpTexture.level = 0.1;
        
        // Create a material for the buildable area
        const buildableMaterial = new StandardMaterial('buildableMaterial', this.scene);
        buildableMaterial.diffuseColor = new Color3(0.4, 0.6, 0.3); // Slightly different green
        buildableMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
        
        // Create a single large ground mesh
        const ground = MeshBuilder.CreateGround('mainGround', {
            width: this.gridSize * this.cellSize,
            height: this.gridSize * this.cellSize,
            subdivisions: 2
        }, this.scene);
        ground.position = new Vector3(0, -0.1, 0);
        ground.material = groundMaterial;
        ground.receiveShadows = true;
        this.groundMeshes.push(ground);
        
        // Create grid cells for buildable areas
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const position = this.gridToWorld(x, y);
                
                // Create slightly elevated tiles for buildable areas
                const tile = MeshBuilder.CreateBox(`ground_${x}_${y}`, {
                    width: this.cellSize * 0.9,
                    height: 0.15,
                    depth: this.cellSize * 0.9
                }, this.scene);
                
                tile.position = new Vector3(position.x, 0.05, position.z);
                tile.material = buildableMaterial;
                tile.receiveShadows = true;
                
                // Mark tile as a child of a specific area
                tile.metadata = { gridX: x, gridY: y };
                
                this.groundMeshes.push(tile);
            }
        }
    }

    /**
     * Generate a path with turns that makes more sense for a tower defense game
     */
    private generatePathWithTurns(): void {
        // Define waypoints for a strategic path with various twists and open areas for tower placement
        const waypoints = [
            this.startPosition,                   // Start at the left edge
            { x: 2, y: Math.floor(this.gridSize / 2) },   // First horizontal segment
            { x: 2, y: 5 },                       // Turn up
            { x: 6, y: 5 },                       // Turn right
            { x: 6, y: 15 },                      // Go up
            { x: 10, y: 15 },                     // Turn right
            { x: 10, y: 2 },                      // Go down (large area to target)
            { x: 14, y: 2 },                      // Turn right
            { x: 14, y: 10 },                     // Go up to middle
            { x: 15, y: 10 },                     // Small horizontal segment
            { x: 19, y: 10 },                     // Final segment to the right edge
            this.endPosition                      // End position
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
        pathMaterial.diffuseColor = new Color3(0.6, 0.6, 0.6); // Stone gray color
        
        // Add stone texture
        const stoneTexture = new Texture("assets/textures/stone.jpg", this.scene);
        stoneTexture.uScale = 5;
        stoneTexture.vScale = 0.5;
        pathMaterial.diffuseTexture = stoneTexture;
        pathMaterial.bumpTexture = stoneTexture;
        pathMaterial.bumpTexture.level = 0.4;
        pathMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
        
        // Create path tiles
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y] === CellType.PATH || 
                    this.grid[x][y] === CellType.START || 
                    this.grid[x][y] === CellType.END) {
                    
                    // Remove any existing ground tiles at this position
                    const groundTile = this.groundMeshes.find(m => 
                        m.metadata && m.metadata.gridX === x && m.metadata.gridY === y
                    );
                    if (groundTile) {
                        const index = this.groundMeshes.indexOf(groundTile);
                        if (index !== -1) {
                            this.groundMeshes.splice(index, 1);
                        }
                        groundTile.dispose();
                    }
                    
                    const position = this.gridToWorld(x, y);
                    position.y = 0.05; // Slightly above ground
                    
                    // Make the path visually interesting with beveled edges
                    const pathTile = MeshBuilder.CreateBox(`path_${x}_${y}`, {
                        width: this.cellSize * 0.95,
                        height: 0.12,
                        depth: this.cellSize * 0.95
                    }, this.scene);
                    
                    pathTile.position = position;
                    pathTile.material = pathMaterial;
                    pathTile.receiveShadows = true;
                    
                    // Add beveled edges by adding smaller boxes on top
                    const innerTile = MeshBuilder.CreateBox(`pathInner_${x}_${y}`, {
                        width: this.cellSize * 0.85,
                        height: 0.13,
                        depth: this.cellSize * 0.85
                    }, this.scene);
                    
                    innerTile.position = new Vector3(position.x, position.y + 0.01, position.z);
                    innerTile.material = pathMaterial;
                    innerTile.receiveShadows = true;
                    
                    this.groundMeshes.push(pathTile);
                    this.groundMeshes.push(innerTile);
                    
                    // Add path border decorations
                    this.addPathBorder(x, y);
                }
            }
        }
        
        // Create start marker (green portal)
        const startPosition = this.gridToWorld(this.startPosition.x, this.startPosition.y);
        startPosition.y = 0.2; // Above path
        
        const startMaterial = new StandardMaterial('startMaterial', this.scene);
        startMaterial.diffuseColor = new Color3(0, 0.8, 0.2); // Green
        startMaterial.emissiveColor = new Color3(0, 0.5, 0.1); // Glow effect
        startMaterial.alpha = 0.9;
        
        const startMarker = MeshBuilder.CreateTorus('startMarker', {
            diameter: this.cellSize * 0.8,
            thickness: this.cellSize * 0.15,
            tessellation: 32
        }, this.scene);
        
        startMarker.position = startPosition;
        startMarker.material = startMaterial;
        if (this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(startMarker);
        }
        this.groundMeshes.push(startMarker);
        
        // Add rotating animation to start marker
        this.scene.registerBeforeRender(() => {
            startMarker.rotation.y += 0.01;
        });
        
        // Create end marker (red portal)
        const endPosition = this.gridToWorld(this.endPosition.x, this.endPosition.y);
        endPosition.y = 0.2; // Above path
        
        const endMaterial = new StandardMaterial('endMaterial', this.scene);
        endMaterial.diffuseColor = new Color3(0.8, 0, 0); // Red
        endMaterial.emissiveColor = new Color3(0.5, 0, 0); // Glow effect
        endMaterial.alpha = 0.9;
        
        const endMarker = MeshBuilder.CreateTorus('endMarker', {
            diameter: this.cellSize * 0.8,
            thickness: this.cellSize * 0.15,
            tessellation: 32
        }, this.scene);
        
        endMarker.position = endPosition;
        endMarker.material = endMaterial;
        if (this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(endMarker);
        }
        this.groundMeshes.push(endMarker);
        
        // Add rotating animation to end marker
        this.scene.registerBeforeRender(() => {
            endMarker.rotation.y -= 0.01;
        });
    }
    
    /**
     * Add borders and details along the path edges
     */
    private addPathBorder(x: number, y: number): void {
        // Check adjacent cells to see if they're not part of the path
        const adjacentCells = [
            { dx: -1, dy: 0 }, // Left
            { dx: 1, dy: 0 },  // Right
            { dx: 0, dy: -1 }, // Top
            { dx: 0, dy: 1 }   // Bottom
        ];
        
        for (const adj of adjacentCells) {
            const nx = x + adj.dx;
            const ny = y + adj.dy;
            
            // Skip if out of bounds
            if (nx < 0 || nx >= this.gridSize || ny < 0 || ny >= this.gridSize) {
                continue;
            }
            
            // If the adjacent cell is not a path, add a border
            if (this.grid[nx][ny] !== CellType.PATH && 
                this.grid[nx][ny] !== CellType.START && 
                this.grid[nx][ny] !== CellType.END) {
                
                // Position at the edge between cells
                const position = this.gridToWorld(x, y);
                const edgePosition = new Vector3(
                    position.x + adj.dx * this.cellSize * 0.475,
                    0.1,
                    position.z + adj.dy * this.cellSize * 0.475
                );
                
                // Determine orientation
                const isHorizontal = adj.dy === 0;
                const width = isHorizontal ? 0.1 : this.cellSize * 0.95;
                const depth = isHorizontal ? this.cellSize * 0.95 : 0.1;
                
                // Create a small border wall
                const border = MeshBuilder.CreateBox(
                    `border_${x}_${y}_${adj.dx}_${adj.dy}`,
                    { width, height: 0.2, depth },
                    this.scene
                );
                
                border.position = edgePosition;
                
                // Create a stone material for the border
                const borderMaterial = new StandardMaterial(`borderMat_${x}_${y}`, this.scene);
                borderMaterial.diffuseColor = new Color3(0.4, 0.4, 0.4);
                borderMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
                border.material = borderMaterial;
                
                if (this.shadowGenerator) {
                    this.shadowGenerator.addShadowCaster(border);
                }
                
                this.groundMeshes.push(border);
            }
        }
    }
    
    /**
     * Add decorative elements around the map
     */
    private addDecorations(): void {
        // Create different types of decorations
        const decorations = [
            // Trees
            { 
                mesh: (position: Vector3) => {
                    const tree = MeshBuilder.CreateCylinder('treeTrunk', { 
                        height: 0.8, 
                        diameter: 0.3 
                    }, this.scene);
                    tree.position = new Vector3(position.x, 0.4, position.z);
                    
                    const trunkMat = new StandardMaterial('trunkMat', this.scene);
                    trunkMat.diffuseColor = new Color3(0.5, 0.3, 0.1);
                    trunkMat.specularColor = new Color3(0.1, 0.1, 0.1);
                    tree.material = trunkMat;
                    
                    const leaves = MeshBuilder.CreateSphere('treeLeaves', { 
                        segments: 8, 
                        diameter: 1.2 
                    }, this.scene);
                    leaves.position = new Vector3(position.x, 1.0, position.z);
                    
                    const leavesMat = new StandardMaterial('leavesMat', this.scene);
                    leavesMat.diffuseColor = new Color3(0.1, 0.5, 0.1);
                    leavesMat.specularColor = new Color3(0.1, 0.1, 0.1);
                    leaves.material = leavesMat;
                    
                    if (this.shadowGenerator) {
                        this.shadowGenerator.addShadowCaster(tree);
                        this.shadowGenerator.addShadowCaster(leaves);
                    }
                    
                    return [tree, leaves];
                },
                probability: 0.15  // Higher probability for trees
            },
            // Rocks
            {
                mesh: (position: Vector3) => {
                    const rock = MeshBuilder.CreateSphere('rock', { 
                        segments: 4, 
                        diameter: 0.7 
                    }, this.scene);
                    
                    rock.scaling.y = 0.5;
                    rock.position = new Vector3(position.x, 0.18, position.z);
                    rock.rotation.y = Math.random() * Math.PI * 2;
                    
                    const rockMat = new StandardMaterial('rockMat', this.scene);
                    rockMat.diffuseColor = new Color3(0.5, 0.5, 0.5);
                    rockMat.specularColor = new Color3(0.2, 0.2, 0.2);
                    rock.material = rockMat;
                    
                    if (this.shadowGenerator) {
                        this.shadowGenerator.addShadowCaster(rock);
                    }
                    
                    return [rock];
                },
                probability: 0.08
            },
            // Bushes
            {
                mesh: (position: Vector3) => {
                    const bush = MeshBuilder.CreateSphere('bush', { 
                        segments: 8, 
                        diameter: 0.6 
                    }, this.scene);
                    
                    bush.position = new Vector3(position.x, 0.3, position.z);
                    
                    const bushMat = new StandardMaterial('bushMat', this.scene);
                    bushMat.diffuseColor = new Color3(0.2, 0.6, 0.2);
                    bushMat.specularColor = new Color3(0.1, 0.1, 0.1);
                    bush.material = bushMat;
                    
                    if (this.shadowGenerator) {
                        this.shadowGenerator.addShadowCaster(bush);
                    }
                    
                    return [bush];
                },
                probability: 0.12
            }
        ];
        
        // Add decorations to empty areas
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                // Only add decoration to empty cells
                if (this.grid[x][y] === CellType.EMPTY) {
                    // Choose decoration based on probability
                    for (const decType of decorations) {
                        if (Math.random() < decType.probability) {
                            const position = this.gridToWorld(x, y);
                            
                            // Create the decoration at this position
                            const decorMeshes = decType.mesh(position);
                            this.decorationMeshes.push(...decorMeshes);
                            
                            // Mark the cell as decoration
                            this.grid[x][y] = CellType.DECORATION;
                            break; // Only place one decoration per cell
                        }
                    }
                }
            }
        }
    }
    
    /**
     * Add particle effects to start and end positions
     */
    private addParticleEffects(): void {
        // Create start position particles (green portal)
        const startPos = this.gridToWorld(this.startPosition.x, this.startPosition.y);
        const startParticles = new ParticleSystem("startParticles", 500, this.scene);
        startParticles.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        startParticles.emitter = new Vector3(startPos.x, 0.5, startPos.z);
        startParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
        startParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);
        startParticles.color1 = new Color4(0.1, 1.0, 0.1, 1.0);
        startParticles.color2 = new Color4(0.1, 0.5, 0.1, 1.0);
        startParticles.colorDead = new Color4(0, 0.3, 0, 0.0);
        startParticles.minSize = 0.1;
        startParticles.maxSize = 0.3;
        startParticles.minLifeTime = 0.5;
        startParticles.maxLifeTime = 1.5;
        startParticles.emitRate = 50;
        startParticles.direction1 = new Vector3(-0.5, 1, -0.5);
        startParticles.direction2 = new Vector3(0.5, 1, 0.5);
        startParticles.gravity = new Vector3(0, -0.5, 0);
        startParticles.start();
        this.pathParticles.push(startParticles);
        
        // Create end position particles (red portal)
        const endPos = this.gridToWorld(this.endPosition.x, this.endPosition.y);
        const endParticles = new ParticleSystem("endParticles", 500, this.scene);
        endParticles.particleTexture = new Texture("assets/textures/particle.png", this.scene);
        endParticles.emitter = new Vector3(endPos.x, 0.5, endPos.z);
        endParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
        endParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);
        endParticles.color1 = new Color4(1.0, 0.1, 0.1, 1.0);
        endParticles.color2 = new Color4(0.5, 0.1, 0.1, 1.0);
        endParticles.colorDead = new Color4(0.3, 0, 0, 0.0);
        endParticles.minSize = 0.1;
        endParticles.maxSize = 0.3;
        endParticles.minLifeTime = 0.5;
        endParticles.maxLifeTime = 1.5;
        endParticles.emitRate = 50;
        endParticles.direction1 = new Vector3(-0.5, 1, -0.5);
        endParticles.direction2 = new Vector3(0.5, 1, 0.5);
        endParticles.gravity = new Vector3(0, -0.5, 0);
        endParticles.start();
        this.pathParticles.push(endParticles);
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
     * @returns Whether a tower can be placed
     */
    public canPlaceTower(gridX: number, gridY: number): boolean {
        // Out of bounds check
        if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
            return false;
        }
        
        // Check if the cell is empty (not path, tower, start, end, or decoration)
        return this.grid[gridX][gridY] === CellType.EMPTY;
    }

    /**
     * Set a tower as placed or removed from a grid position
     * @param gridX Grid X coordinate
     * @param gridY Grid Y coordinate
     * @param placed Whether a tower is placed or removed
     */
    public setTowerPlaced(gridX: number, gridY: number, placed: boolean): void {
        if (gridX >= 0 && gridX < this.gridSize && gridY >= 0 && gridY < this.gridSize) {
            this.grid[gridX][gridY] = placed ? CellType.TOWER : CellType.EMPTY;
        }
    }

    /**
     * Get the path that enemies will follow
     * @returns The path as world positions
     */
    public getPath(): Vector3[] {
        return this.path;
    }

    /**
     * Get the start position in world coordinates
     * @returns Start position
     */
    public getStartPosition(): Vector3 {
        return this.gridToWorld(this.startPosition.x, this.startPosition.y);
    }

    /**
     * Get the end position in world coordinates
     * @returns End position
     */
    public getEndPosition(): Vector3 {
        return this.gridToWorld(this.endPosition.x, this.endPosition.y);
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        // Dispose of all meshes
        for (const mesh of this.groundMeshes) {
            mesh.dispose();
        }
        
        for (const mesh of this.decorationMeshes) {
            mesh.dispose();
        }
        
        // Dispose of particle systems
        for (const particles of this.pathParticles) {
            particles.dispose();
        }
        
        this.groundMeshes = [];
        this.decorationMeshes = [];
        this.pathParticles = [];
    }
} 