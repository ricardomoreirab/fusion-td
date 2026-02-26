import { Vector3, MeshBuilder, Mesh, Scene, Color3, Color4, ParticleSystem, ShadowGenerator, DirectionalLight } from '@babylonjs/core';
import { Game } from '../Game';
import { PALETTE } from '../rendering/StyleConstants';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../rendering/LowPolyMaterial';
import { LevelConfig, LEVEL_1 } from './LevelConfig';

// Define grid cell types
enum CellType {
    EMPTY = 0,
    PATH = 1,
    TOWER = 2,
    START = 3,
    END = 4,
    DECORATION = 5,
    WATER = 6
}

// Define a path node for pathfinding
interface PathNode {
    x: number;
    y: number;
    f: number;
    g: number;
    h: number;
    parent: PathNode | null;
}

interface TerrainType {
    heightOffset: number;
    scale: { width: number, height: number, depth: number };
}

// Terrain zone definitions for varied ground
enum TerrainZone {
    MEADOW = 0,
    ROCKY_HIGHLANDS = 1,
    FOREST = 2,
    RIVERSIDE = 3,
    CRYSTAL_GROVE = 4
}

export class Map {
    private game: Game;
    private scene: Scene;
    private gridSize: number = 20;
    private cellSize: number = 2;
    private grid: CellType[][] = [];
    private path: Vector3[] = [];
    private startPosition: { x: number, y: number } = { x: 0, y: 0 };
    private endPosition: { x: number, y: number } = { x: 19, y: 10 };
    private groundMeshes: Mesh[] = [];
    private decorationMeshes: Mesh[] = [];
    private shadowGenerator: ShadowGenerator | null = null;
    private pathParticles: ParticleSystem[] = [];
    private terrainZones: TerrainZone[][] = [];
    private heightMap: number[][] = [];
    private config: LevelConfig;
    private zOffset: number;

    constructor(game: Game, config?: LevelConfig, zOffset?: number) {
        this.game = game;
        this.scene = game.getScene();
        this.config = config || LEVEL_1;
        this.zOffset = zOffset || 0;

        for (let x = 0; x < this.gridSize; x++) {
            this.grid[x] = [];
            this.terrainZones[x] = [];
            this.heightMap[x] = [];
            for (let y = 0; y < this.gridSize; y++) {
                this.grid[x][y] = CellType.EMPTY;
                this.terrainZones[x][y] = TerrainZone.MEADOW;
                this.heightMap[x][y] = 0;
            }
        }
    }

    public initialize(): void {
        this.setupLighting();
        this.defineTerrainZones();
        this.generateHeightMap();
        this.createGround();

        this.startPosition = { ...this.config.startPosition };
        this.endPosition = { ...this.config.endPosition };

        this.grid[this.startPosition.x][this.startPosition.y] = CellType.START;
        this.grid[this.endPosition.x][this.endPosition.y] = CellType.END;

        this.generatePathWithTurns();
        this.createRiver();
        this.createPathVisuals();
        this.createBridges();
        this.addDecorations();
        this.addMapBorder();
        this.addCellIndicators();
        this.addPathBorders();
        this.createPortals();
        this.addAtmosphericEffects();
        this.addParticleEffects();
    }

    private setupLighting(): void {
        const light = new DirectionalLight("mapLight", new Vector3(-0.4, -1, -0.6), this.scene);
        light.intensity = 0.75;
        light.position = new Vector3(20, 40, 20 + this.zOffset);

        this.shadowGenerator = new ShadowGenerator(1024, light);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 10;
    }

    /**
     * Define terrain zones that create visually distinct areas across the map.
     * - Top-left: Dense forest (enemies enter through the woods)
     * - Center: Open meadow (main tower placement area)
     * - Right side: Rocky highlands with elevation
     * - River running diagonally through the map
     * - Bottom-right: Crystal grove near the exit portal
     */
    private defineTerrainZones(): void {
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                let assigned = false;
                for (const rule of this.config.terrainZoneRules) {
                    if (rule.condition(x, y)) {
                        this.terrainZones[x][y] = rule.zone as TerrainZone;
                        assigned = true;
                        break;
                    }
                }
                if (!assigned) {
                    if (this.isNearRiver(x, y)) {
                        this.terrainZones[x][y] = TerrainZone.RIVERSIDE;
                    } else {
                        this.terrainZones[x][y] = TerrainZone.MEADOW;
                    }
                }
            }
        }
    }

    /**
     * Check if a cell is near the river diagonal
     */
    private isNearRiver(x: number, y: number): boolean {
        if (!this.config.river) return false;

        const points = this.config.river.points;
        if (points.length < 2) return false;

        // Use first and last river points to define the line
        const riverStartX = points[0].x;
        const riverStartY = points[0].y;
        const riverEndX = points[points.length - 1].x;
        const riverEndY = points[points.length - 1].y;

        const dx = riverEndX - riverStartX;
        const dy = riverEndY - riverStartY;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return false;
        const dist = Math.abs(dy * x - dx * y + riverEndX * riverStartY - riverEndY * riverStartX) / len;

        return dist < 2.5;
    }

    /**
     * Generate a height map with meaningful elevation changes.
     * Rocky highlands are elevated, river valley is lower, meadows are gently rolling.
     */
    private generateHeightMap(): void {
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                let height = 0;
                const zone = this.terrainZones[x][y];

                switch (zone) {
                    case TerrainZone.ROCKY_HIGHLANDS:
                        // Elevated rocky area
                        height = 0.3 + Math.sin(x * 0.7) * 0.15 + Math.cos(y * 0.9) * 0.1;
                        break;
                    case TerrainZone.FOREST:
                        // Slightly elevated forest floor with gentle undulation
                        height = 0.05 + Math.sin(x * 1.2 + y * 0.8) * 0.08;
                        break;
                    case TerrainZone.RIVERSIDE:
                        // Lower near the river
                        height = -0.08 + Math.sin(x * 0.5) * 0.03;
                        break;
                    case TerrainZone.CRYSTAL_GROVE:
                        // Slightly elevated with crystalline formations
                        height = 0.15 + Math.sin(x * 1.5 + y * 1.5) * 0.1;
                        break;
                    case TerrainZone.MEADOW:
                    default:
                        // Gentle rolling hills
                        height = Math.sin(x * 0.4 + 1.0) * 0.08 + Math.cos(y * 0.5 + 0.5) * 0.06;
                        break;
                }

                this.heightMap[x][y] = height;
            }
        }
    }

    /**
     * Create ground with multiple terrain zone materials and vertex displacement
     */
    private createGround(): void {
        const mapWidth = this.gridSize * this.cellSize;
        const mapHeight = this.gridSize * this.cellSize;
        const centerX = mapWidth / 2 - this.cellSize;
        const centerZ = mapHeight / 2 - this.cellSize;

        // Base ground plane
        const ground = MeshBuilder.CreateGround('ground_main', {
            width: mapWidth + 10,
            height: mapHeight + 10,
            subdivisions: 40
        }, this.scene);
        ground.position = new Vector3(centerX, -0.15, centerZ + this.zOffset);

        // Apply terrain vertex displacement
        const positions = ground.getVerticesData('position');
        if (positions) {
            const halfW = (mapWidth + 10) / 2;
            const halfH = (mapHeight + 10) / 2;
            for (let i = 0; i < positions.length; i += 3) {
                const wx = positions[i] + centerX;
                const wz = positions[i + 2] + centerZ;
                const gx = Math.floor(wx / this.cellSize);
                const gy = Math.floor(wz / this.cellSize);

                let heightVal = 0;
                if (gx >= 0 && gx < this.gridSize && gy >= 0 && gy < this.gridSize) {
                    heightVal = this.heightMap[gx][gy];
                }
                positions[i + 1] += heightVal + (Math.random() - 0.5) * 0.12;
            }
            ground.updateVerticesData('position', positions);
        }

        makeFlatShaded(ground);
        const groundMat = createLowPolyMaterial('groundMat', PALETTE.GROUND, this.scene);
        ground.material = groundMat;
        ground.receiveShadows = true;
        this.groundMeshes.push(ground);

        // Terrain zone overlays for visual variety
        this.createTerrainOverlays();
    }

    /**
     * Create colored overlays for different terrain zones
     */
    private createTerrainOverlays(): void {
        // Forest floor patches - darker, richer green
        const forestMat = createLowPolyMaterial('forestFloorMat', new Color3(0.25, 0.45, 0.18), this.scene);
        forestMat.alpha = 0.35;

        // Rocky highland patches - grey-brown tones
        const rockMat = createLowPolyMaterial('highlandMat', new Color3(0.52, 0.48, 0.42), this.scene);
        rockMat.alpha = 0.3;

        // Crystal grove patches - subtle purple-tinted ground
        const crystalGroundMat = createLowPolyMaterial('crystalGroundMat', new Color3(0.45, 0.35, 0.55), this.scene);
        crystalGroundMat.alpha = 0.2;

        // Riverside patches - lush darker green
        const riversideMat = createLowPolyMaterial('riversideMat', new Color3(0.30, 0.55, 0.28), this.scene);
        riversideMat.alpha = 0.25;

        // Scatter zone-specific patches
        for (let x = 0; x < this.gridSize; x += 2) {
            for (let y = 0; y < this.gridSize; y += 2) {
                const zone = this.terrainZones[x][y];
                let mat = null;

                switch (zone) {
                    case TerrainZone.FOREST:
                        if (Math.random() < 0.6) mat = forestMat;
                        break;
                    case TerrainZone.ROCKY_HIGHLANDS:
                        if (Math.random() < 0.5) mat = rockMat;
                        break;
                    case TerrainZone.CRYSTAL_GROVE:
                        if (Math.random() < 0.5) mat = crystalGroundMat;
                        break;
                    case TerrainZone.RIVERSIDE:
                        if (Math.random() < 0.4) mat = riversideMat;
                        break;
                }

                if (mat) {
                    const radius = 1.2 + Math.random() * 1.5;
                    const patch = MeshBuilder.CreateDisc(`zonePatch_${x}_${y}`, {
                        radius: radius,
                        tessellation: 5 + Math.floor(Math.random() * 3)
                    }, this.scene);
                    const pos = this.gridToWorld(x, y);
                    patch.position = new Vector3(
                        pos.x + (Math.random() - 0.5) * 1.5,
                        0.02 + this.heightMap[x][y],
                        pos.z + (Math.random() - 0.5) * 1.5
                    );
                    patch.rotation.x = Math.PI / 2;
                    patch.material = mat;
                    this.groundMeshes.push(patch);
                }
            }
        }

        // Add scattered grass tufts across meadow areas
        const grassMat = createLowPolyMaterial('grassPatchMat', PALETTE.GROUND.scale(0.85), this.scene);
        grassMat.alpha = 0.2;
        const numPatches = 12;
        for (let i = 0; i < numPatches; i++) {
            const gx = Math.floor(Math.random() * this.gridSize);
            const gy = Math.floor(Math.random() * this.gridSize);
            if (this.terrainZones[gx][gy] === TerrainZone.MEADOW) {
                const radius = 1.0 + Math.random() * 2.0;
                const patch = MeshBuilder.CreateDisc(`grassPatch_${i}`, {
                    radius: radius,
                    tessellation: 6
                }, this.scene);
                const pos = this.gridToWorld(gx, gy);
                patch.position = new Vector3(pos.x, 0.02, pos.z);
                patch.rotation.x = Math.PI / 2;
                patch.material = grassMat;
                this.groundMeshes.push(patch);
            }
        }
    }

    /**
     * New path design: a winding journey that tells a visual story.
     *
     * The path enters from the forest (top-left), curves through the meadow,
     * crosses the river via bridges, winds through the rocky highlands,
     * and descends into the crystal grove toward the exit portal.
     *
     * Features multiple strategic areas:
     * - Forest entrance (tight, flanked by trees)
     * - Open meadow crossing (wide area for tower clusters)
     * - River bridge chokepoint (narrow crossing)
     * - Highland switchback (elevation advantage for towers)
     * - Crystal grove approach (final defense zone)
     */
    private generatePathWithTurns(): void {
        const waypoints = this.config.waypoints;

        this.path = [];

        for (let i = 0; i < waypoints.length - 1; i++) {
            const start = waypoints[i];
            const end = waypoints[i + 1];

            if (start.x === end.x) {
                const step = start.y < end.y ? 1 : -1;
                for (let y = start.y; step > 0 ? y <= end.y : y >= end.y; y += step) {
                    this.grid[start.x][y] = CellType.PATH;
                    const worldPos = this.gridToWorld(start.x, y);
                    if (!this.path.some(p => p.x === worldPos.x && p.z === worldPos.z)) {
                        this.path.push(worldPos);
                    }
                }
            } else if (start.y === end.y) {
                const step = start.x < end.x ? 1 : -1;
                for (let x = start.x; step > 0 ? x <= end.x : x >= end.x; x += step) {
                    this.grid[x][start.y] = CellType.PATH;
                    const worldPos = this.gridToWorld(x, start.y);
                    if (!this.path.some(p => p.x === worldPos.x && p.z === worldPos.z)) {
                        this.path.push(worldPos);
                    }
                }
            }
        }

        this.grid[this.startPosition.x][this.startPosition.y] = CellType.START;
        this.grid[this.endPosition.x][this.endPosition.y] = CellType.END;

        console.log(`Generated path with ${this.path.length} points`);
    }

    /**
     * Create flat-shaded path tiles with height variation matching terrain
     */
    private createPathVisuals(): void {
        const pathMat = createLowPolyMaterial('pathMat', PALETTE.PATH, this.scene);
        const pathDarkMat = createLowPolyMaterial('pathDarkMat', PALETTE.PATH.scale(0.88), this.scene);

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y] === CellType.PATH ||
                    this.grid[x][y] === CellType.START ||
                    this.grid[x][y] === CellType.END) {

                    const position = this.gridToWorld(x, y);
                    const terrainH = this.heightMap[x][y] * 0.5; // Path follows terrain but flatter
                    const heightVar = Math.random() * 0.03;
                    position.y = 0.06 + heightVar + Math.max(terrainH, 0);

                    const sizeVar = 0.92 + Math.random() * 0.06;

                    const pathTile = MeshBuilder.CreateBox(`path_${x}_${y}`, {
                        width: this.cellSize * sizeVar,
                        height: 0.14,
                        depth: this.cellSize * sizeVar
                    }, this.scene);

                    pathTile.position = position;
                    // Alternate materials for a cobblestone pattern
                    pathTile.material = (x + y) % 3 === 0 ? pathDarkMat : pathMat;
                    pathTile.receiveShadows = true;
                    makeFlatShaded(pathTile);

                    this.groundMeshes.push(pathTile);

                    // Add occasional path stones for detail
                    if (Math.random() < 0.15) {
                        const stone = MeshBuilder.CreatePolyhedron(`pathStone_${x}_${y}`, {
                            type: 1,
                            size: 0.08 + Math.random() * 0.06
                        }, this.scene);
                        stone.position = new Vector3(
                            position.x + (Math.random() - 0.5) * 1.2,
                            position.y + 0.08,
                            position.z + (Math.random() - 0.5) * 1.2
                        );
                        stone.rotation.y = Math.random() * Math.PI * 2;
                        stone.scaling.y = 0.4;
                        stone.material = createLowPolyMaterial(`pStone_${x}_${y}`, PALETTE.PATH_BORDER, this.scene);
                        makeFlatShaded(stone);
                        this.groundMeshes.push(stone);
                    }
                }
            }
        }
    }

    /**
     * Create a river that runs diagonally across the map.
     * The river flows from upper-right to lower-left, creating a natural obstacle
     * that the path must cross via bridges.
     */
    private createRiver(): void {
        if (!this.config.river) return;

        const riverCells: { x: number, y: number }[] = [];
        const riverPoints = this.config.river.points;
        const widenDir = this.config.river.widenDirection;

        // Mark river cells and their width (1-2 cells wide)
        for (const rp of riverPoints) {
            if (rp.x >= 0 && rp.x < this.gridSize && rp.y >= 0 && rp.y < this.gridSize) {
                if (this.grid[rp.x][rp.y] === CellType.EMPTY || this.grid[rp.x][rp.y] === CellType.DECORATION) {
                    this.grid[rp.x][rp.y] = CellType.WATER;
                    riverCells.push({ x: rp.x, y: rp.y });
                }
                // Widen the river: for diagonal rivers widen on x, for horizontal on y
                const isHorizontal = riverPoints.length > 1 &&
                    riverPoints[0].y === riverPoints[riverPoints.length - 1].y;
                let sideX = rp.x, sideY = rp.y;
                if (isHorizontal) {
                    sideY = rp.y + widenDir;
                } else {
                    sideX = rp.x + widenDir;
                }
                if (sideX >= 0 && sideX < this.gridSize && sideY >= 0 && sideY < this.gridSize) {
                    if (this.grid[sideX][sideY] === CellType.EMPTY || this.grid[sideX][sideY] === CellType.DECORATION) {
                        this.grid[sideX][sideY] = CellType.WATER;
                        riverCells.push({ x: sideX, y: sideY });
                    }
                }
            }
        }

        // Create water surface meshes
        const waterColor = new Color3(0.25, 0.55, 0.85);
        const waterMat = createLowPolyMaterial('riverWaterMat', waterColor, this.scene);
        waterMat.alpha = 0.6;

        const waterDeepMat = createLowPolyMaterial('riverDeepMat', new Color3(0.15, 0.40, 0.70), this.scene);
        waterDeepMat.alpha = 0.5;

        for (const cell of riverCells) {
            const pos = this.gridToWorld(cell.x, cell.y);
            const waterTile = MeshBuilder.CreateGround(`water_${cell.x}_${cell.y}`, {
                width: this.cellSize * 1.05,
                height: this.cellSize * 1.05,
                subdivisions: 3
            }, this.scene);

            // Vertex displacement for ripple effect
            const positions = waterTile.getVerticesData('position');
            if (positions) {
                for (let i = 1; i < positions.length; i += 3) {
                    positions[i] += (Math.random() - 0.5) * 0.06;
                }
                waterTile.updateVerticesData('position', positions);
            }
            makeFlatShaded(waterTile);

            waterTile.position = new Vector3(pos.x, -0.05, pos.z);
            waterTile.material = Math.random() > 0.4 ? waterMat : waterDeepMat;
            this.groundMeshes.push(waterTile);
        }

        // Riverbank rocks along the edges
        for (const cell of riverCells) {
            const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dx, dy] of neighbors) {
                const nx = cell.x + dx;
                const ny = cell.y + dy;
                if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
                    if (this.grid[nx][ny] !== CellType.WATER && Math.random() < 0.25) {
                        const pos = this.gridToWorld(cell.x, cell.y);
                        const rock = MeshBuilder.CreatePolyhedron(`riverRock_${cell.x}_${cell.y}_${dx}_${dy}`, {
                            type: Math.floor(Math.random() * 3),
                            size: 0.12 + Math.random() * 0.10
                        }, this.scene);
                        rock.position = new Vector3(
                            pos.x + dx * 0.9 + (Math.random() - 0.5) * 0.3,
                            0.05,
                            pos.z + dy * 0.9 + (Math.random() - 0.5) * 0.3
                        );
                        rock.rotation.y = Math.random() * Math.PI * 2;
                        rock.scaling.y = 0.5 + Math.random() * 0.3;
                        rock.material = createLowPolyMaterial(`rrMat_${cell.x}_${cell.y}_${dx}_${dy}`,
                            Math.random() > 0.5 ? PALETTE.ROCK : PALETTE.ROCK_DARK, this.scene);
                        makeFlatShaded(rock);
                        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(rock);
                        this.decorationMeshes.push(rock);
                    }
                }
            }
        }
    }

    /**
     * Create bridges where the path crosses the river.
     * Bridges are wooden plank structures with railings.
     */
    private createBridges(): void {
        const bridgeMat = createLowPolyMaterial('bridgeMat', new Color3(0.55, 0.38, 0.20), this.scene);
        const railMat = createLowPolyMaterial('railMat', new Color3(0.48, 0.32, 0.16), this.scene);

        // Find path cells that are adjacent to or on water cells
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const cell = this.grid[x][y];
                if (cell === CellType.PATH || cell === CellType.START || cell === CellType.END) {
                    // Check if any neighbor is water
                    const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                    let nearWater = false;
                    for (const [dx, dy] of neighbors) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
                            if (this.grid[nx][ny] === CellType.WATER) {
                                nearWater = true;
                                break;
                            }
                        }
                    }

                    if (nearWater) {
                        const pos = this.gridToWorld(x, y);

                        // Bridge planks - raised wooden platform
                        const plank = MeshBuilder.CreateBox(`bridge_${x}_${y}`, {
                            width: this.cellSize * 1.1,
                            height: 0.18,
                            depth: this.cellSize * 1.1
                        }, this.scene);
                        plank.position = new Vector3(pos.x, 0.15, pos.z);
                        plank.material = bridgeMat;
                        makeFlatShaded(plank);
                        this.groundMeshes.push(plank);

                        // Plank texture lines
                        for (let p = 0; p < 3; p++) {
                            const line = MeshBuilder.CreateBox(`bridgeLine_${x}_${y}_${p}`, {
                                width: this.cellSize * 1.05,
                                height: 0.02,
                                depth: 0.06
                            }, this.scene);
                            line.position = new Vector3(
                                pos.x,
                                0.25,
                                pos.z - 0.6 + p * 0.6
                            );
                            line.material = railMat;
                            this.groundMeshes.push(line);
                        }

                        // Railing posts on sides
                        for (let side = -1; side <= 1; side += 2) {
                            const post = MeshBuilder.CreateCylinder(`bridgePost_${x}_${y}_${side}`, {
                                height: 0.6,
                                diameter: 0.12,
                                tessellation: 5
                            }, this.scene);
                            post.position = new Vector3(
                                pos.x + side * 0.9,
                                0.45,
                                pos.z
                            );
                            post.material = railMat;
                            makeFlatShaded(post);
                            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(post);
                            this.groundMeshes.push(post);
                        }
                    }
                }
            }
        }
    }

    /**
     * Create dramatic dimensional rift portals at start and end positions.
     * Start portal: emerald rift emerging from the forest floor
     * End portal: crimson vortex in the crystal grove
     */
    private createPortals(): void {
        this.createStartPortal();
        this.createEndPortal();
    }

    /**
     * Start portal: A towering emerald rift with multiple rotating rings,
     * energy tendrils, and a glowing ground sigil.
     */
    private createStartPortal(): void {
        const startPos = this.gridToWorld(this.startPosition.x, this.startPosition.y);
        const portalColor = PALETTE.PORTAL_START;

        // Ground sigil - large glowing hexagonal disc
        const sigil = MeshBuilder.CreateDisc('startSigil', {
            radius: this.cellSize * 0.9,
            tessellation: 6
        }, this.scene);
        sigil.position = new Vector3(startPos.x, 0.03, startPos.z);
        sigil.rotation.x = Math.PI / 2;
        const sigilMat = createEmissiveMaterial('startSigilMat', portalColor, 0.9, this.scene);
        sigilMat.alpha = 0.5;
        sigil.material = sigilMat;
        this.groundMeshes.push(sigil);

        // Inner sigil ring
        const innerSigil = MeshBuilder.CreateDisc('startInnerSigil', {
            radius: this.cellSize * 0.5,
            tessellation: 6
        }, this.scene);
        innerSigil.position = new Vector3(startPos.x, 0.04, startPos.z);
        innerSigil.rotation.x = Math.PI / 2;
        const innerSigilMat = createEmissiveMaterial('startInnerSigilMat', portalColor, 1.0, this.scene);
        innerSigilMat.alpha = 0.7;
        innerSigil.material = innerSigilMat;
        this.groundMeshes.push(innerSigil);

        // Primary rotating torus - large outer ring
        const ring1 = MeshBuilder.CreateTorus('startRing1', {
            diameter: this.cellSize * 1.2,
            thickness: this.cellSize * 0.08,
            tessellation: 10
        }, this.scene);
        ring1.position = new Vector3(startPos.x, 1.5, startPos.z);
        const ring1Mat = createEmissiveMaterial('startRing1Mat', portalColor, 0.7, this.scene);
        ring1Mat.alpha = 0.85;
        ring1.material = ring1Mat;
        makeFlatShaded(ring1);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(ring1);
        this.groundMeshes.push(ring1);

        // Secondary rotating torus - smaller, tilted
        const ring2 = MeshBuilder.CreateTorus('startRing2', {
            diameter: this.cellSize * 0.8,
            thickness: this.cellSize * 0.06,
            tessellation: 8
        }, this.scene);
        ring2.position = new Vector3(startPos.x, 1.5, startPos.z);
        ring2.rotation.x = Math.PI / 4;
        const ring2Mat = createEmissiveMaterial('startRing2Mat', portalColor.scale(1.2), 0.8, this.scene);
        ring2Mat.alpha = 0.7;
        ring2.material = ring2Mat;
        makeFlatShaded(ring2);
        this.groundMeshes.push(ring2);

        // Third ring - perpendicular
        const ring3 = MeshBuilder.CreateTorus('startRing3', {
            diameter: this.cellSize * 0.6,
            thickness: this.cellSize * 0.05,
            tessellation: 7
        }, this.scene);
        ring3.position = new Vector3(startPos.x, 1.5, startPos.z);
        ring3.rotation.z = Math.PI / 3;
        const ring3Mat = createEmissiveMaterial('startRing3Mat', portalColor.scale(0.8), 0.6, this.scene);
        ring3Mat.alpha = 0.6;
        ring3.material = ring3Mat;
        makeFlatShaded(ring3);
        this.groundMeshes.push(ring3);

        // Energy pillars flanking the portal
        for (let side = -1; side <= 1; side += 2) {
            const pillar = MeshBuilder.CreateCylinder(`startPillar_${side}`, {
                height: 3.5,
                diameterTop: 0.15,
                diameterBottom: 0.35,
                tessellation: 6
            }, this.scene);
            pillar.position = new Vector3(startPos.x + side * 1.2, 1.75, startPos.z);
            const pillarMat = createEmissiveMaterial(`startPillarMat_${side}`, portalColor, 0.5, this.scene);
            pillarMat.alpha = 0.75;
            pillar.material = pillarMat;
            makeFlatShaded(pillar);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(pillar);
            this.groundMeshes.push(pillar);

            // Crystal cap on each pillar
            const cap = MeshBuilder.CreatePolyhedron(`startCap_${side}`, {
                type: 1,
                size: 0.2
            }, this.scene);
            cap.position = new Vector3(startPos.x + side * 1.2, 3.6, startPos.z);
            cap.material = createEmissiveMaterial(`startCapMat_${side}`, portalColor.scale(1.3), 0.9, this.scene);
            makeFlatShaded(cap);
            this.groundMeshes.push(cap);
        }

        // Animate rings
        this.scene.registerBeforeRender(() => {
            ring1.rotation.y += 0.012;
            ring2.rotation.y -= 0.018;
            ring2.rotation.x += 0.008;
            ring3.rotation.y += 0.025;
            ring3.rotation.z -= 0.01;
            // Pulse the sigil
            if (sigilMat.alpha !== undefined) {
                sigilMat.alpha = 0.4 + Math.sin(Date.now() * 0.003) * 0.15;
            }
        });
    }

    /**
     * End portal: A crimson vortex with swirling energy,
     * jagged crystal spires, and an ominous ground crater.
     */
    private createEndPortal(): void {
        const endPos = this.gridToWorld(this.endPosition.x, this.endPosition.y);
        const portalColor = PALETTE.PORTAL_END;

        // Crater ring on the ground
        const crater = MeshBuilder.CreateTorus('endCrater', {
            diameter: this.cellSize * 1.6,
            thickness: 0.3,
            tessellation: 8
        }, this.scene);
        crater.position = new Vector3(endPos.x, 0.05, endPos.z);
        crater.rotation.x = Math.PI / 2;
        const craterMat = createEmissiveMaterial('endCraterMat', portalColor, 0.6, this.scene);
        craterMat.alpha = 0.6;
        crater.material = craterMat;
        makeFlatShaded(crater);
        this.groundMeshes.push(crater);

        // Ground sigil
        const sigil = MeshBuilder.CreateDisc('endSigil', {
            radius: this.cellSize * 0.8,
            tessellation: 8
        }, this.scene);
        sigil.position = new Vector3(endPos.x, 0.04, endPos.z);
        sigil.rotation.x = Math.PI / 2;
        const sigilMat = createEmissiveMaterial('endSigilMat', portalColor, 0.8, this.scene);
        sigilMat.alpha = 0.5;
        sigil.material = sigilMat;
        this.groundMeshes.push(sigil);

        // Main vortex ring
        const vortex = MeshBuilder.CreateTorus('endVortex', {
            diameter: this.cellSize * 1.0,
            thickness: this.cellSize * 0.10,
            tessellation: 10
        }, this.scene);
        vortex.position = new Vector3(endPos.x, 1.8, endPos.z);
        const vortexMat = createEmissiveMaterial('endVortexMat', portalColor, 0.8, this.scene);
        vortexMat.alpha = 0.9;
        vortex.material = vortexMat;
        makeFlatShaded(vortex);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(vortex);
        this.groundMeshes.push(vortex);

        // Inner vortex ring
        const innerVortex = MeshBuilder.CreateTorus('endInnerVortex', {
            diameter: this.cellSize * 0.6,
            thickness: this.cellSize * 0.07,
            tessellation: 8
        }, this.scene);
        innerVortex.position = new Vector3(endPos.x, 1.8, endPos.z);
        innerVortex.rotation.x = Math.PI / 3;
        const innerVortexMat = createEmissiveMaterial('endInnerVortexMat', portalColor.scale(1.2), 0.9, this.scene);
        innerVortexMat.alpha = 0.7;
        innerVortex.material = innerVortexMat;
        makeFlatShaded(innerVortex);
        this.groundMeshes.push(innerVortex);

        // Jagged crystal spires around the portal
        const spireCount = 5;
        for (let i = 0; i < spireCount; i++) {
            const angle = (i / spireCount) * Math.PI * 2;
            const dist = 1.3 + Math.random() * 0.4;
            const spireHeight = 1.5 + Math.random() * 2.0;

            const spire = MeshBuilder.CreateCylinder(`endSpire_${i}`, {
                height: spireHeight,
                diameterTop: 0.05,
                diameterBottom: 0.25 + Math.random() * 0.15,
                tessellation: 4 + Math.floor(Math.random() * 3)
            }, this.scene);
            spire.position = new Vector3(
                endPos.x + Math.cos(angle) * dist,
                spireHeight / 2,
                endPos.z + Math.sin(angle) * dist
            );
            // Tilt spires slightly outward
            spire.rotation.x = (Math.random() - 0.5) * 0.3;
            spire.rotation.z = (Math.random() - 0.5) * 0.3;

            const spireColor = i % 2 === 0 ? portalColor : portalColor.scale(0.7);
            const spireMat = createEmissiveMaterial(`endSpireMat_${i}`, spireColor, 0.5, this.scene);
            spireMat.alpha = 0.8;
            spire.material = spireMat;
            makeFlatShaded(spire);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(spire);
            this.groundMeshes.push(spire);
        }

        // Floating crystal core in the center
        const core = MeshBuilder.CreatePolyhedron('endCore', {
            type: 1,
            size: 0.3
        }, this.scene);
        core.position = new Vector3(endPos.x, 1.8, endPos.z);
        const coreMat = createEmissiveMaterial('endCoreMat', portalColor.scale(1.5), 1.0, this.scene);
        coreMat.alpha = 0.9;
        core.material = coreMat;
        makeFlatShaded(core);
        this.groundMeshes.push(core);

        // Animate end portal
        this.scene.registerBeforeRender(() => {
            vortex.rotation.y -= 0.015;
            innerVortex.rotation.y += 0.022;
            innerVortex.rotation.x += 0.01;
            core.rotation.y += 0.03;
            core.rotation.x += 0.02;
            // Bobbing core
            core.position.y = 1.8 + Math.sin(Date.now() * 0.002) * 0.15;
            // Pulse the crater
            if (sigilMat.alpha !== undefined) {
                sigilMat.alpha = 0.4 + Math.sin(Date.now() * 0.004) * 0.2;
            }
        });
    }

    /**
     * Rich decoration system with zone-aware placement.
     * Each terrain zone gets appropriate decorations:
     * - Forest: dense trees, mushrooms, fallen logs
     * - Meadow: flowers, bushes, scattered rocks
     * - Rocky highlands: boulders, rock clusters, scrub
     * - Crystal grove: crystal formations, glowing mushrooms
     * - Riverside: reeds, lily pads, smooth stones
     */
    private addDecorations(): void {
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y] === CellType.EMPTY) {
                    const zone = this.terrainZones[x][y];
                    const position = this.gridToWorld(x, y);
                    position.y = Math.max(this.heightMap[x][y], 0);
                    let placed = false;

                    switch (zone) {
                        case TerrainZone.FOREST:
                            placed = this.placeForestDecoration(x, y, position);
                            break;
                        case TerrainZone.ROCKY_HIGHLANDS:
                            placed = this.placeHighlandDecoration(x, y, position);
                            break;
                        case TerrainZone.CRYSTAL_GROVE:
                            placed = this.placeCrystalDecoration(x, y, position);
                            break;
                        case TerrainZone.RIVERSIDE:
                            placed = this.placeRiversideDecoration(x, y, position);
                            break;
                        case TerrainZone.MEADOW:
                        default:
                            placed = this.placeMeadowDecoration(x, y, position);
                            break;
                    }

                    if (placed) {
                        this.grid[x][y] = CellType.DECORATION;
                    }
                }
            }
        }
    }

    /**
     * Forest zone: dense trees with thick trunks, mushroom clusters, fallen logs
     */
    private placeForestDecoration(x: number, y: number, position: Vector3): boolean {
        const roll = Math.random();

        // Dense tree placement (40% chance)
        if (roll < 0.40) {
            this.createTree(position, true);
            return true;
        }
        // Mushroom cluster (12% chance)
        else if (roll < 0.52) {
            this.createMushroomCluster(position);
            return true;
        }
        // Fallen log (8% chance)
        else if (roll < 0.60) {
            this.createFallenLog(position);
            return true;
        }
        // Fern bush (10% chance)
        else if (roll < 0.70) {
            this.createBush(position, PALETTE.TREE_FOLIAGE_DARK);
            return true;
        }

        return false;
    }

    /**
     * Meadow zone: scattered trees, flowers, bushes, occasional rocks
     */
    private placeMeadowDecoration(x: number, y: number, position: Vector3): boolean {
        const roll = Math.random();

        // Scattered tree (10% chance)
        if (roll < 0.10) {
            this.createTree(position, false);
            return true;
        }
        // Flower patch (12% chance)
        else if (roll < 0.22) {
            this.createFlowerPatch(position);
            return true;
        }
        // Bush (8% chance)
        else if (roll < 0.30) {
            this.createBush(position, PALETTE.BUSH);
            return true;
        }
        // Small rock (5% chance)
        else if (roll < 0.35) {
            this.createRock(position, 0.15 + Math.random() * 0.15);
            return true;
        }

        return false;
    }

    /**
     * Rocky highlands: large boulders, rock clusters, scrubby vegetation
     */
    private placeHighlandDecoration(x: number, y: number, position: Vector3): boolean {
        const roll = Math.random();

        // Large boulder (20% chance)
        if (roll < 0.20) {
            this.createBoulder(position);
            return true;
        }
        // Rock cluster (15% chance)
        else if (roll < 0.35) {
            this.createRockCluster(position);
            return true;
        }
        // Scrub bush (10% chance)
        else if (roll < 0.45) {
            this.createBush(position, new Color3(0.35, 0.50, 0.25));
            return true;
        }
        // Small rock (8% chance)
        else if (roll < 0.53) {
            this.createRock(position, 0.2 + Math.random() * 0.2);
            return true;
        }

        return false;
    }

    /**
     * Crystal grove: crystal formations, glowing mushrooms, ethereal vegetation
     */
    private placeCrystalDecoration(x: number, y: number, position: Vector3): boolean {
        const roll = Math.random();

        // Crystal formation (18% chance)
        if (roll < 0.18) {
            this.createCrystalFormation(position);
            return true;
        }
        // Glowing mushroom (12% chance)
        else if (roll < 0.30) {
            this.createGlowingMushroom(position);
            return true;
        }
        // Small crystal shard (10% chance)
        else if (roll < 0.40) {
            this.createCrystalShard(position);
            return true;
        }
        // Dark bush (8% chance)
        else if (roll < 0.48) {
            this.createBush(position, new Color3(0.28, 0.40, 0.45));
            return true;
        }

        return false;
    }

    /**
     * Riverside: reeds, smooth stones, small vegetation
     */
    private placeRiversideDecoration(x: number, y: number, position: Vector3): boolean {
        const roll = Math.random();

        // Reed cluster (15% chance)
        if (roll < 0.15) {
            this.createReeds(position);
            return true;
        }
        // Smooth river stone (12% chance)
        else if (roll < 0.27) {
            this.createRock(position, 0.12 + Math.random() * 0.1);
            return true;
        }
        // Small bush (8% chance)
        else if (roll < 0.35) {
            this.createBush(position, new Color3(0.32, 0.58, 0.30));
            return true;
        }

        return false;
    }

    // ==================== DECORATION CREATION METHODS ====================

    /**
     * Create a low-poly tree with triangular foliage cones
     */
    private createTree(position: Vector3, isForest: boolean): void {
        const meshes: Mesh[] = [];

        // Trunk
        const trunkHeight = isForest ? 1.2 + Math.random() * 0.5 : 0.8 + Math.random() * 0.4;
        const trunk = MeshBuilder.CreateCylinder('treeTrunk', {
            height: trunkHeight,
            diameterTop: 0.12 + (isForest ? 0.05 : 0),
            diameterBottom: 0.25 + (isForest ? 0.1 : 0),
            tessellation: 6
        }, this.scene);
        trunk.position = new Vector3(position.x, position.y + trunkHeight / 2, position.z);
        trunk.material = createLowPolyMaterial('trunkMat', PALETTE.TREE_TRUNK, this.scene);
        makeFlatShaded(trunk);
        meshes.push(trunk);

        // Stacked foliage cones
        const numCones = isForest ? 3 : 2 + Math.floor(Math.random() * 2);
        const baseScale = isForest ? 1.3 : 1.0;
        for (let i = 0; i < numCones; i++) {
            const coneHeight = (1.0 - i * 0.15) * baseScale;
            const coneDiam = (1.4 - i * 0.35) * baseScale;
            const cone = MeshBuilder.CreateCylinder(`treeLeaves_${i}`, {
                height: coneHeight,
                diameterTop: 0,
                diameterBottom: coneDiam,
                tessellation: 5 + Math.floor(Math.random() * 3)
            }, this.scene);
            cone.position = new Vector3(
                position.x + (Math.random() - 0.5) * 0.1,
                position.y + trunkHeight + i * 0.55,
                position.z + (Math.random() - 0.5) * 0.1
            );
            const foliageColor = i === 0 ? PALETTE.TREE_FOLIAGE_DARK : PALETTE.TREE_FOLIAGE;
            cone.material = createLowPolyMaterial(`leavesMat_${i}`, foliageColor, this.scene);
            makeFlatShaded(cone);
            meshes.push(cone);
        }

        if (this.shadowGenerator) {
            for (const m of meshes) this.shadowGenerator.addShadowCaster(m);
        }
        this.decorationMeshes.push(...meshes);
    }

    /**
     * Create a cluster of low-poly mushrooms
     */
    private createMushroomCluster(position: Vector3): void {
        const count = 2 + Math.floor(Math.random() * 3);
        const mushroomColors = [
            new Color3(0.82, 0.25, 0.18), // Red
            new Color3(0.85, 0.72, 0.22), // Golden
            new Color3(0.78, 0.65, 0.52)  // Tan
        ];

        for (let i = 0; i < count; i++) {
            const offsetX = (Math.random() - 0.5) * 0.8;
            const offsetZ = (Math.random() - 0.5) * 0.8;
            const stemH = 0.2 + Math.random() * 0.2;
            const capR = 0.12 + Math.random() * 0.12;

            // Stem
            const stem = MeshBuilder.CreateCylinder(`mushStem_${i}`, {
                height: stemH,
                diameter: 0.06,
                tessellation: 5
            }, this.scene);
            stem.position = new Vector3(position.x + offsetX, position.y + stemH / 2, position.z + offsetZ);
            stem.material = createLowPolyMaterial('mushStemMat', new Color3(0.85, 0.82, 0.72), this.scene);
            makeFlatShaded(stem);
            this.decorationMeshes.push(stem);

            // Cap
            const cap = MeshBuilder.CreateCylinder(`mushCap_${i}`, {
                height: capR * 0.6,
                diameterTop: 0,
                diameterBottom: capR * 2,
                tessellation: 6
            }, this.scene);
            cap.position = new Vector3(position.x + offsetX, position.y + stemH + capR * 0.2, position.z + offsetZ);
            cap.material = createLowPolyMaterial('mushCapMat',
                mushroomColors[Math.floor(Math.random() * mushroomColors.length)], this.scene);
            makeFlatShaded(cap);
            this.decorationMeshes.push(cap);
        }
    }

    /**
     * Create a fallen log decoration
     */
    private createFallenLog(position: Vector3): void {
        const length = 1.0 + Math.random() * 1.0;
        const log = MeshBuilder.CreateCylinder('fallenLog', {
            height: length,
            diameterTop: 0.18 + Math.random() * 0.08,
            diameterBottom: 0.22 + Math.random() * 0.1,
            tessellation: 6
        }, this.scene);
        log.position = new Vector3(position.x, position.y + 0.12, position.z);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = Math.random() * Math.PI;
        log.material = createLowPolyMaterial('logMat', PALETTE.TREE_TRUNK.scale(0.85), this.scene);
        makeFlatShaded(log);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(log);
        this.decorationMeshes.push(log);

        // Moss patch on the log
        if (Math.random() > 0.4) {
            const moss = MeshBuilder.CreateIcoSphere('logMoss', {
                subdivisions: 1,
                radius: 0.15 + Math.random() * 0.1
            }, this.scene);
            moss.position = new Vector3(position.x, position.y + 0.22, position.z);
            moss.scaling.y = 0.3;
            moss.material = createLowPolyMaterial('mossMat', new Color3(0.22, 0.50, 0.18), this.scene);
            makeFlatShaded(moss);
            this.decorationMeshes.push(moss);
        }
    }

    /**
     * Create a bush decoration
     */
    private createBush(position: Vector3, color: Color3): void {
        const bush = MeshBuilder.CreateIcoSphere('bush', {
            subdivisions: 1,
            radius: 0.25 + Math.random() * 0.2
        }, this.scene);
        bush.position = new Vector3(position.x, position.y + 0.22, position.z);
        bush.material = createLowPolyMaterial('bushMat', color, this.scene);
        makeFlatShaded(bush);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(bush);
        this.decorationMeshes.push(bush);
    }

    /**
     * Create a single rock
     */
    private createRock(position: Vector3, size: number): void {
        const rock = MeshBuilder.CreatePolyhedron('rock', {
            type: Math.floor(Math.random() * 4),
            size: size
        }, this.scene);
        rock.scaling.y = 0.5 + Math.random() * 0.3;
        rock.position = new Vector3(position.x, position.y + size * 0.5, position.z);
        rock.rotation.y = Math.random() * Math.PI * 2;
        rock.rotation.x = Math.random() * 0.3;
        rock.material = createLowPolyMaterial('rockMat',
            Math.random() > 0.5 ? PALETTE.ROCK : PALETTE.ROCK_DARK, this.scene);
        makeFlatShaded(rock);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(rock);
        this.decorationMeshes.push(rock);
    }

    /**
     * Create a large boulder for highland areas
     */
    private createBoulder(position: Vector3): void {
        const size = 0.35 + Math.random() * 0.25;
        const boulder = MeshBuilder.CreatePolyhedron('boulder', {
            type: Math.floor(Math.random() * 3),
            size: size
        }, this.scene);
        boulder.scaling.y = 0.6 + Math.random() * 0.4;
        boulder.position = new Vector3(position.x, position.y + size * 0.4, position.z);
        boulder.rotation.y = Math.random() * Math.PI * 2;
        boulder.material = createLowPolyMaterial('boulderMat', PALETTE.ROCK_DARK, this.scene);
        makeFlatShaded(boulder);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(boulder);
        this.decorationMeshes.push(boulder);

        // Smaller rocks at the base
        const fragmentCount = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < fragmentCount; i++) {
            const frag = MeshBuilder.CreatePolyhedron(`boulderFrag_${i}`, {
                type: Math.floor(Math.random() * 4),
                size: 0.08 + Math.random() * 0.08
            }, this.scene);
            frag.position = new Vector3(
                position.x + (Math.random() - 0.5) * 0.8,
                position.y + 0.08,
                position.z + (Math.random() - 0.5) * 0.8
            );
            frag.rotation.y = Math.random() * Math.PI * 2;
            frag.scaling.y = 0.5;
            frag.material = createLowPolyMaterial(`fragMat_${i}`, PALETTE.ROCK, this.scene);
            makeFlatShaded(frag);
            this.decorationMeshes.push(frag);
        }
    }

    /**
     * Create a cluster of rocks
     */
    private createRockCluster(position: Vector3): void {
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            const size = 0.10 + Math.random() * 0.18;
            const rock = MeshBuilder.CreatePolyhedron(`rockCluster_${i}`, {
                type: Math.floor(Math.random() * 4),
                size: size
            }, this.scene);
            rock.position = new Vector3(
                position.x + (Math.random() - 0.5) * 1.0,
                position.y + size * 0.4,
                position.z + (Math.random() - 0.5) * 1.0
            );
            rock.scaling.y = 0.4 + Math.random() * 0.4;
            rock.rotation.y = Math.random() * Math.PI * 2;
            rock.material = createLowPolyMaterial(`clusterRockMat_${i}`,
                Math.random() > 0.3 ? PALETTE.ROCK_DARK : PALETTE.ROCK, this.scene);
            makeFlatShaded(rock);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(rock);
            this.decorationMeshes.push(rock);
        }
    }

    /**
     * Create a flower patch with multiple stems
     */
    private createFlowerPatch(position: Vector3): void {
        const count = 2 + Math.floor(Math.random() * 3);
        const petalColors = [PALETTE.FLOWER_PETAL_RED, PALETTE.FLOWER_PETAL_YELLOW, PALETTE.FLOWER_PETAL_PURPLE];
        const patchColor = petalColors[Math.floor(Math.random() * petalColors.length)];

        for (let i = 0; i < count; i++) {
            const offsetX = (Math.random() - 0.5) * 0.8;
            const offsetZ = (Math.random() - 0.5) * 0.8;

            const stem = MeshBuilder.CreateCylinder(`flowerStem_${i}`, {
                height: 0.4 + Math.random() * 0.2,
                diameter: 0.05,
                tessellation: 4
            }, this.scene);
            stem.position = new Vector3(position.x + offsetX, position.y + 0.22, position.z + offsetZ);
            stem.material = createLowPolyMaterial('stemMat', PALETTE.FLOWER_STEM, this.scene);
            this.decorationMeshes.push(stem);

            const petal = MeshBuilder.CreateDisc(`flowerPetal_${i}`, {
                radius: 0.12 + Math.random() * 0.08,
                tessellation: 5
            }, this.scene);
            petal.position = new Vector3(position.x + offsetX, position.y + 0.45, position.z + offsetZ);
            petal.rotation.x = -Math.PI / 6 + Math.random() * 0.3;
            petal.rotation.y = Math.random() * Math.PI * 2;
            petal.material = createLowPolyMaterial('petalMat', patchColor, this.scene);
            this.decorationMeshes.push(petal);
        }
    }

    /**
     * Create a crystal formation for the crystal grove
     */
    private createCrystalFormation(position: Vector3): void {
        const count = 2 + Math.floor(Math.random() * 3);
        const crystalColors = [
            new Color3(0.65, 0.30, 0.85),  // Purple
            new Color3(0.45, 0.78, 0.95),  // Cyan
            new Color3(0.85, 0.50, 0.95)   // Pink
        ];

        for (let i = 0; i < count; i++) {
            const height = 0.5 + Math.random() * 1.0;
            const crystal = MeshBuilder.CreateCylinder(`crystal_${i}`, {
                height: height,
                diameterTop: 0,
                diameterBottom: 0.15 + Math.random() * 0.15,
                tessellation: 4 + Math.floor(Math.random() * 3)
            }, this.scene);
            crystal.position = new Vector3(
                position.x + (Math.random() - 0.5) * 0.6,
                position.y + height / 2,
                position.z + (Math.random() - 0.5) * 0.6
            );
            crystal.rotation.x = (Math.random() - 0.5) * 0.4;
            crystal.rotation.z = (Math.random() - 0.5) * 0.4;

            const color = crystalColors[Math.floor(Math.random() * crystalColors.length)];
            crystal.material = createEmissiveMaterial(`crystalMat_${i}`, color, 0.4, this.scene);
            makeFlatShaded(crystal);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(crystal);
            this.decorationMeshes.push(crystal);
        }
    }

    /**
     * Create a small crystal shard
     */
    private createCrystalShard(position: Vector3): void {
        const height = 0.3 + Math.random() * 0.4;
        const shard = MeshBuilder.CreateCylinder('crystalShard', {
            height: height,
            diameterTop: 0,
            diameterBottom: 0.10 + Math.random() * 0.08,
            tessellation: 4
        }, this.scene);
        shard.position = new Vector3(position.x, position.y + height / 2, position.z);
        shard.rotation.x = (Math.random() - 0.5) * 0.5;
        shard.rotation.z = (Math.random() - 0.5) * 0.5;

        const shardColor = new Color3(0.55 + Math.random() * 0.3, 0.35, 0.85);
        shard.material = createEmissiveMaterial('shardMat', shardColor, 0.3, this.scene);
        makeFlatShaded(shard);
        this.decorationMeshes.push(shard);
    }

    /**
     * Create a glowing mushroom for the crystal grove
     */
    private createGlowingMushroom(position: Vector3): void {
        const stemH = 0.25 + Math.random() * 0.15;
        const capR = 0.15 + Math.random() * 0.1;

        const stem = MeshBuilder.CreateCylinder('glowStem', {
            height: stemH,
            diameter: 0.06,
            tessellation: 5
        }, this.scene);
        stem.position = new Vector3(position.x, position.y + stemH / 2, position.z);
        stem.material = createLowPolyMaterial('glowStemMat', new Color3(0.70, 0.68, 0.80), this.scene);
        makeFlatShaded(stem);
        this.decorationMeshes.push(stem);

        const cap = MeshBuilder.CreateCylinder('glowCap', {
            height: capR * 0.5,
            diameterTop: 0,
            diameterBottom: capR * 2,
            tessellation: 6
        }, this.scene);
        cap.position = new Vector3(position.x, position.y + stemH + capR * 0.1, position.z);
        const glowColor = Math.random() > 0.5
            ? new Color3(0.30, 0.80, 0.90)
            : new Color3(0.75, 0.40, 0.90);
        cap.material = createEmissiveMaterial('glowCapMat', glowColor, 0.5, this.scene);
        makeFlatShaded(cap);
        this.decorationMeshes.push(cap);
    }

    /**
     * Create riverside reed clusters
     */
    private createReeds(position: Vector3): void {
        const count = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            const height = 0.5 + Math.random() * 0.5;
            const reed = MeshBuilder.CreateCylinder(`reed_${i}`, {
                height: height,
                diameter: 0.04,
                tessellation: 4
            }, this.scene);
            reed.position = new Vector3(
                position.x + (Math.random() - 0.5) * 0.6,
                position.y + height / 2,
                position.z + (Math.random() - 0.5) * 0.6
            );
            reed.rotation.x = (Math.random() - 0.5) * 0.15;
            reed.rotation.z = (Math.random() - 0.5) * 0.15;
            reed.material = createLowPolyMaterial(`reedMat_${i}`, new Color3(0.40, 0.55, 0.25), this.scene);
            this.decorationMeshes.push(reed);
        }

        // Optional reed top tuft
        if (Math.random() > 0.5) {
            const tuft = MeshBuilder.CreateIcoSphere('reedTuft', {
                subdivisions: 1,
                radius: 0.08
            }, this.scene);
            tuft.position = new Vector3(position.x, position.y + 0.8, position.z);
            tuft.scaling.y = 1.5;
            tuft.material = createLowPolyMaterial('tuftMat', new Color3(0.65, 0.58, 0.40), this.scene);
            makeFlatShaded(tuft);
            this.decorationMeshes.push(tuft);
        }
    }

    /**
     * Portal particle effects - more dramatic with higher counts and varied colors
     */
    private addParticleEffects(): void {
        // Start portal particles - emerald energy wisps
        const startPos = this.gridToWorld(this.startPosition.x, this.startPosition.y);
        const startParticles = new ParticleSystem("startParticles", 80, this.scene);
        startParticles.emitter = new Vector3(startPos.x, 1.0, startPos.z);
        startParticles.minEmitBox = new Vector3(-0.8, -0.5, -0.8);
        startParticles.maxEmitBox = new Vector3(0.8, 0.5, 0.8);
        startParticles.color1 = new Color4(0.10, 0.90, 0.30, 0.9);
        startParticles.color2 = new Color4(0.20, 0.70, 0.50, 0.7);
        startParticles.colorDead = new Color4(0, 0.4, 0.1, 0.0);
        startParticles.minSize = 0.10;
        startParticles.maxSize = 0.35;
        startParticles.minLifeTime = 0.5;
        startParticles.maxLifeTime = 1.5;
        startParticles.emitRate = 25;
        startParticles.direction1 = new Vector3(-0.4, 1.5, -0.4);
        startParticles.direction2 = new Vector3(0.4, 2.5, 0.4);
        startParticles.gravity = new Vector3(0, -0.3, 0);
        startParticles.start();
        this.pathParticles.push(startParticles);

        // Start portal swirl particles
        const startSwirl = new ParticleSystem("startSwirl", 40, this.scene);
        startSwirl.emitter = new Vector3(startPos.x, 1.5, startPos.z);
        startSwirl.minEmitBox = new Vector3(-0.3, -0.3, -0.3);
        startSwirl.maxEmitBox = new Vector3(0.3, 0.3, 0.3);
        startSwirl.color1 = new Color4(0.50, 1.0, 0.60, 0.6);
        startSwirl.color2 = new Color4(0.30, 0.80, 0.40, 0.4);
        startSwirl.colorDead = new Color4(0.1, 0.3, 0.1, 0.0);
        startSwirl.minSize = 0.05;
        startSwirl.maxSize = 0.18;
        startSwirl.minLifeTime = 0.3;
        startSwirl.maxLifeTime = 0.8;
        startSwirl.emitRate = 15;
        startSwirl.direction1 = new Vector3(-1, 0.2, -1);
        startSwirl.direction2 = new Vector3(1, 0.5, 1);
        startSwirl.gravity = new Vector3(0, 0.5, 0);
        startSwirl.start();
        this.pathParticles.push(startSwirl);

        // End portal particles - crimson vortex energy
        const endPos = this.gridToWorld(this.endPosition.x, this.endPosition.y);
        const endParticles = new ParticleSystem("endParticles", 80, this.scene);
        endParticles.emitter = new Vector3(endPos.x, 1.0, endPos.z);
        endParticles.minEmitBox = new Vector3(-0.8, -0.5, -0.8);
        endParticles.maxEmitBox = new Vector3(0.8, 0.5, 0.8);
        endParticles.color1 = new Color4(0.95, 0.20, 0.15, 0.9);
        endParticles.color2 = new Color4(0.70, 0.10, 0.10, 0.7);
        endParticles.colorDead = new Color4(0.3, 0, 0, 0.0);
        endParticles.minSize = 0.10;
        endParticles.maxSize = 0.35;
        endParticles.minLifeTime = 0.5;
        endParticles.maxLifeTime = 1.5;
        endParticles.emitRate = 25;
        endParticles.direction1 = new Vector3(-0.4, 1.5, -0.4);
        endParticles.direction2 = new Vector3(0.4, 2.5, 0.4);
        endParticles.gravity = new Vector3(0, -0.3, 0);
        endParticles.start();
        this.pathParticles.push(endParticles);

        // End portal dark energy
        const endDark = new ParticleSystem("endDark", 30, this.scene);
        endDark.emitter = new Vector3(endPos.x, 1.8, endPos.z);
        endDark.minEmitBox = new Vector3(-0.5, -0.2, -0.5);
        endDark.maxEmitBox = new Vector3(0.5, 0.2, 0.5);
        endDark.color1 = new Color4(0.4, 0.0, 0.0, 0.5);
        endDark.color2 = new Color4(0.2, 0.0, 0.05, 0.3);
        endDark.colorDead = new Color4(0.1, 0, 0, 0.0);
        endDark.minSize = 0.2;
        endDark.maxSize = 0.5;
        endDark.minLifeTime = 0.8;
        endDark.maxLifeTime = 2.0;
        endDark.emitRate = 10;
        endDark.direction1 = new Vector3(-0.6, -0.2, -0.6);
        endDark.direction2 = new Vector3(0.6, 0.8, 0.6);
        endDark.gravity = new Vector3(0, 0.3, 0);
        endDark.start();
        this.pathParticles.push(endDark);
    }

    /**
     * Atmospheric effects: fog patches, firefly particles in forest,
     * crystal sparkles in the grove, mist near the river.
     */
    private addAtmosphericEffects(): void {
        // Fireflies in the forest area
        const forestCenter = this.gridToWorld(2, 4);
        const fireflies = new ParticleSystem("fireflies", 30, this.scene);
        fireflies.emitter = new Vector3(forestCenter.x, 1.0, forestCenter.z);
        fireflies.minEmitBox = new Vector3(-4, 0, -4);
        fireflies.maxEmitBox = new Vector3(4, 2, 6);
        fireflies.color1 = new Color4(0.8, 0.95, 0.3, 0.7);
        fireflies.color2 = new Color4(0.6, 0.85, 0.2, 0.5);
        fireflies.colorDead = new Color4(0.3, 0.4, 0.1, 0.0);
        fireflies.minSize = 0.06;
        fireflies.maxSize = 0.14;
        fireflies.minLifeTime = 2.0;
        fireflies.maxLifeTime = 4.0;
        fireflies.emitRate = 5;
        fireflies.direction1 = new Vector3(-0.3, 0.1, -0.3);
        fireflies.direction2 = new Vector3(0.3, 0.4, 0.3);
        fireflies.gravity = new Vector3(0, 0.02, 0);
        fireflies.start();
        this.pathParticles.push(fireflies);

        // Crystal sparkles in the grove
        const groveCenter = this.gridToWorld(17, 15);
        const sparkles = new ParticleSystem("crystalSparkles", 25, this.scene);
        sparkles.emitter = new Vector3(groveCenter.x, 0.5, groveCenter.z);
        sparkles.minEmitBox = new Vector3(-3, 0, -3);
        sparkles.maxEmitBox = new Vector3(3, 1, 3);
        sparkles.color1 = new Color4(0.7, 0.4, 0.95, 0.6);
        sparkles.color2 = new Color4(0.5, 0.8, 0.95, 0.4);
        sparkles.colorDead = new Color4(0.3, 0.2, 0.5, 0.0);
        sparkles.minSize = 0.04;
        sparkles.maxSize = 0.10;
        sparkles.minLifeTime = 1.0;
        sparkles.maxLifeTime = 2.5;
        sparkles.emitRate = 8;
        sparkles.direction1 = new Vector3(-0.1, 0.5, -0.1);
        sparkles.direction2 = new Vector3(0.1, 1.0, 0.1);
        sparkles.gravity = new Vector3(0, -0.1, 0);
        sparkles.start();
        this.pathParticles.push(sparkles);

        // River mist
        const riverMidPoint = this.gridToWorld(10, 10);
        const mist = new ParticleSystem("riverMist", 20, this.scene);
        mist.emitter = new Vector3(riverMidPoint.x, 0.2, riverMidPoint.z);
        mist.minEmitBox = new Vector3(-6, 0, -6);
        mist.maxEmitBox = new Vector3(6, 0.3, 6);
        mist.color1 = new Color4(0.7, 0.8, 0.9, 0.15);
        mist.color2 = new Color4(0.6, 0.75, 0.85, 0.10);
        mist.colorDead = new Color4(0.5, 0.6, 0.7, 0.0);
        mist.minSize = 0.8;
        mist.maxSize = 2.0;
        mist.minLifeTime = 3.0;
        mist.maxLifeTime = 5.0;
        mist.emitRate = 3;
        mist.direction1 = new Vector3(-0.2, 0.05, -0.2);
        mist.direction2 = new Vector3(0.2, 0.15, 0.2);
        mist.gravity = new Vector3(0.05, 0, 0.02);
        mist.start();
        this.pathParticles.push(mist);

        // Fog patches using translucent discs at various locations
        const fogPositions = [
            { x: 6, y: 3 },
            { x: 13, y: 16 },
            { x: 1, y: 14 },
            { x: 16, y: 7 }
        ];

        const fogMat = createLowPolyMaterial('fogMat', new Color3(0.75, 0.82, 0.88), this.scene);
        fogMat.alpha = 0.08;

        for (let i = 0; i < fogPositions.length; i++) {
            const fp = fogPositions[i];
            const fogPos = this.gridToWorld(fp.x, fp.y);
            const fogDisc = MeshBuilder.CreateDisc(`fog_${i}`, {
                radius: 2.5 + Math.random() * 2.0,
                tessellation: 6
            }, this.scene);
            fogDisc.position = new Vector3(fogPos.x, 0.3 + Math.random() * 0.3, fogPos.z);
            fogDisc.rotation.x = Math.PI / 2;
            fogDisc.material = fogMat;
            this.groundMeshes.push(fogDisc);
        }
    }

    // ==================== PUBLIC API (UNCHANGED) ====================

    public gridToWorld(gridX: number, gridY: number): Vector3 {
        const x = gridX * this.cellSize + this.cellSize / 2;
        const z = gridY * this.cellSize + this.cellSize / 2 + this.zOffset;
        return new Vector3(x, 0, z);
    }

    public worldToGrid(position: Vector3): { x: number, y: number } {
        const gridX = Math.floor(position.x / this.cellSize);
        const gridY = Math.floor((position.z - this.zOffset) / this.cellSize);
        return { x: gridX, y: gridY };
    }

    public canPlaceTower(gridX: number, gridY: number): boolean {
        if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
            return false;
        }
        return this.grid[gridX][gridY] === CellType.EMPTY;
    }

    public setTowerPlaced(gridX: number, gridY: number, placed: boolean): void {
        if (gridX >= 0 && gridX < this.gridSize && gridY >= 0 && gridY < this.gridSize) {
            this.grid[gridX][gridY] = placed ? CellType.TOWER : CellType.EMPTY;
        }
    }

    public getPath(): Vector3[] {
        return this.path;
    }

    public getStartPosition(): Vector3 {
        return this.gridToWorld(this.startPosition.x, this.startPosition.y);
    }

    public getEndPosition(): Vector3 {
        return this.gridToWorld(this.endPosition.x, this.endPosition.y);
    }

    public getZOffsetValue(): number {
        return this.zOffset;
    }

    /**
     * Add semi-transparent cell indicators on buildable (EMPTY) cells.
     * Named 'ground_cell_x_y' so they match the startsWith('ground_') predicate.
     */
    private addCellIndicators(): void {
        const cellMat = createLowPolyMaterial('cellIndicatorMat', PALETTE.GROUND.scale(1.15), this.scene);
        cellMat.alpha = 0.15;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y] === CellType.EMPTY) {
                    const position = this.gridToWorld(x, y);
                    const cell = MeshBuilder.CreateBox(`ground_cell_${x}_${y}`, {
                        width: 1.9,
                        height: 0.02,
                        depth: 1.9
                    }, this.scene);
                    cell.position = new Vector3(position.x, 0.01 + Math.max(this.heightMap[x][y], 0), position.z);
                    cell.material = cellMat;
                    cell.receiveShadows = true;
                    this.groundMeshes.push(cell);
                }
            }
        }
    }

    /**
     * Add border strips along path edges where path meets non-path terrain.
     */
    private addPathBorders(): void {
        const borderMat = createLowPolyMaterial('pathBorderMat', PALETTE.PATH_BORDER, this.scene);
        const borderWidth = 0.12;
        const borderHeight = 0.16;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const cell = this.grid[x][y];
                if (cell === CellType.PATH || cell === CellType.START || cell === CellType.END) {
                    const position = this.gridToWorld(x, y);
                    const terrainH = Math.max(this.heightMap[x][y] * 0.5, 0);

                    const neighbors: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

                    for (const [dx, dy] of neighbors) {
                        const nx = x + dx;
                        const ny = y + dy;

                        let isPathCell = false;
                        if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
                            const adj = this.grid[nx][ny];
                            isPathCell = adj === CellType.PATH || adj === CellType.START || adj === CellType.END;
                        }

                        if (!isPathCell) {
                            const border = MeshBuilder.CreateBox(`pathBorder_${x}_${y}_${dx}_${dy}`, {
                                width: dx !== 0 ? borderWidth : this.cellSize,
                                height: borderHeight,
                                depth: dy !== 0 ? borderWidth : this.cellSize
                            }, this.scene);

                            const offset = this.cellSize / 2;
                            border.position = new Vector3(
                                position.x + dx * offset,
                                borderHeight / 2 + terrainH,
                                position.z + dy * offset
                            );
                            border.material = borderMat;
                            border.receiveShadows = true;
                            this.groundMeshes.push(border);
                        }
                    }
                }
            }
        }
    }

    /**
     * Add a natural stone and wood border around the playable area.
     * Features irregular stone walls with wooden watch towers at corners.
     */
    private addMapBorder(): void {
        const mapWidth = this.gridSize * this.cellSize;
        const borderHeight = 0.7;
        const borderThickness = 0.9;
        const borderMat = createLowPolyMaterial('mapBorderMat', PALETTE.ROCK_DARK, this.scene);
        const borderTopMat = createLowPolyMaterial('mapBorderTopMat', PALETTE.ROCK, this.scene);

        // Four walls around the perimeter (zOffset applied to all Z positions)
        const zo = this.zOffset;
        const walls = [
            { w: mapWidth + borderThickness * 2, d: borderThickness, x: mapWidth / 2, z: -borderThickness / 2 + zo },
            { w: mapWidth + borderThickness * 2, d: borderThickness, x: mapWidth / 2, z: mapWidth + borderThickness / 2 + zo },
            { w: borderThickness, d: mapWidth + borderThickness * 2, x: -borderThickness / 2, z: mapWidth / 2 + zo },
            { w: borderThickness, d: mapWidth + borderThickness * 2, x: mapWidth + borderThickness / 2, z: mapWidth / 2 + zo }
        ];

        for (let i = 0; i < walls.length; i++) {
            const wall = MeshBuilder.CreateBox(`mapBorder_${i}`, {
                width: walls[i].w,
                height: borderHeight,
                depth: walls[i].d
            }, this.scene);
            wall.position = new Vector3(walls[i].x, borderHeight / 2, walls[i].z);
            wall.material = borderMat;
            wall.receiveShadows = true;
            makeFlatShaded(wall);
            this.groundMeshes.push(wall);

            // Add rough stone cap on top of walls
            const cap = MeshBuilder.CreateBox(`mapBorderCap_${i}`, {
                width: walls[i].w + 0.1,
                height: 0.08,
                depth: walls[i].d + 0.1
            }, this.scene);
            cap.position = new Vector3(walls[i].x, borderHeight + 0.04, walls[i].z);
            cap.material = borderTopMat;
            this.groundMeshes.push(cap);
        }

        // Corner watchtowers - more elaborate than simple pillars
        const corners = [
            { x: -borderThickness / 2, z: -borderThickness / 2 + zo },
            { x: mapWidth + borderThickness / 2, z: -borderThickness / 2 + zo },
            { x: -borderThickness / 2, z: mapWidth + borderThickness / 2 + zo },
            { x: mapWidth + borderThickness / 2, z: mapWidth + borderThickness / 2 + zo }
        ];

        for (let i = 0; i < corners.length; i++) {
            // Tower base
            const base = MeshBuilder.CreateCylinder(`cornerBase_${i}`, {
                height: borderHeight * 2.2,
                diameter: borderThickness * 1.4,
                tessellation: 6
            }, this.scene);
            base.position = new Vector3(corners[i].x, borderHeight * 1.1, corners[i].z);
            base.material = createLowPolyMaterial(`cornerBaseMat_${i}`, PALETTE.ROCK, this.scene);
            makeFlatShaded(base);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(base);
            this.groundMeshes.push(base);

            // Tower roof - cone
            const roof = MeshBuilder.CreateCylinder(`cornerRoof_${i}`, {
                height: 0.6,
                diameterTop: 0,
                diameterBottom: borderThickness * 1.8,
                tessellation: 6
            }, this.scene);
            roof.position = new Vector3(corners[i].x, borderHeight * 2.5, corners[i].z);
            roof.material = createLowPolyMaterial(`cornerRoofMat_${i}`, new Color3(0.55, 0.30, 0.15), this.scene);
            makeFlatShaded(roof);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(roof);
            this.groundMeshes.push(roof);
        }

        // Decorative stones along the outer wall
        const stoneCount = 16;
        for (let i = 0; i < stoneCount; i++) {
            const angle = (i / stoneCount) * 4;
            let sx, sz;

            const side = Math.floor(angle);
            const t = angle - side;

            switch (side) {
                case 0: sx = t * mapWidth; sz = -borderThickness + zo; break;
                case 1: sx = mapWidth + borderThickness; sz = t * mapWidth + zo; break;
                case 2: sx = (1 - t) * mapWidth; sz = mapWidth + borderThickness + zo; break;
                default: sx = -borderThickness; sz = (1 - t) * mapWidth + zo; break;
            }

            const stone = MeshBuilder.CreatePolyhedron(`borderStone_${i}`, {
                type: Math.floor(Math.random() * 3),
                size: 0.15 + Math.random() * 0.12
            }, this.scene);
            stone.position = new Vector3(sx + (Math.random() - 0.5) * 0.5, 0.15, sz + (Math.random() - 0.5) * 0.5);
            stone.rotation.y = Math.random() * Math.PI * 2;
            stone.scaling.y = 0.5 + Math.random() * 0.3;
            stone.material = createLowPolyMaterial(`bStoneMat_${i}`, PALETTE.ROCK_DARK, this.scene);
            makeFlatShaded(stone);
            this.groundMeshes.push(stone);
        }
    }

    public dispose(): void {
        for (const mesh of this.groundMeshes) {
            mesh.dispose();
        }
        for (const mesh of this.decorationMeshes) {
            mesh.dispose();
        }
        for (const particles of this.pathParticles) {
            particles.dispose();
        }
        this.groundMeshes = [];
        this.decorationMeshes = [];
        this.pathParticles = [];
    }
}
