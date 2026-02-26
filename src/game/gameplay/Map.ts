import { Vector3, MeshBuilder, Mesh, Scene, Color4, ParticleSystem, ShadowGenerator, DirectionalLight } from '@babylonjs/core';
import { Game } from '../Game';
import { PALETTE } from '../rendering/StyleConstants';
import { createLowPolyMaterial, createEmissiveMaterial, makeFlatShaded } from '../rendering/LowPolyMaterial';

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
    f: number;
    g: number;
    h: number;
    parent: PathNode | null;
}

interface TerrainType {
    heightOffset: number;
    scale: { width: number, height: number, depth: number };
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

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();

        for (let x = 0; x < this.gridSize; x++) {
            this.grid[x] = [];
            for (let y = 0; y < this.gridSize; y++) {
                this.grid[x][y] = CellType.EMPTY;
            }
        }
    }

    public initialize(): void {
        this.setupLighting();
        this.createGround();

        this.startPosition = { x: 0, y: Math.floor(this.gridSize / 2) };
        this.endPosition = { x: 19, y: 10 };

        this.grid[this.startPosition.x][this.startPosition.y] = CellType.START;
        this.grid[this.endPosition.x][this.endPosition.y] = CellType.END;

        this.generatePathWithTurns();
        this.createPathVisuals();
        this.addDecorations();
        this.addWaterFeature();
        this.addMapBorder();
        this.addCellIndicators();
        this.addPathBorders();
        this.addParticleEffects();
    }

    private setupLighting(): void {
        const light = new DirectionalLight("mapLight", new Vector3(-0.5, -1, -0.5), this.scene);
        light.intensity = 0.7;
        light.position = new Vector3(10, 30, 10);

        this.shadowGenerator = new ShadowGenerator(1024, light);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 8;
    }

    /**
     * Create ground with subdivided mesh and flat shading for organic terrain feel
     */
    private createGround(): void {
        const mapWidth = this.gridSize * this.cellSize;
        const mapHeight = this.gridSize * this.cellSize;
        const centerX = mapWidth / 2 - this.cellSize;
        const centerZ = mapHeight / 2 - this.cellSize;

        // Single large ground with subdivisions for vertex displacement
        const ground = MeshBuilder.CreateGround('ground_main', {
            width: mapWidth + 8,
            height: mapHeight + 8,
            subdivisions: 32
        }, this.scene);
        ground.position = new Vector3(centerX, -0.1, centerZ);

        // Subtle vertex displacement for organic terrain feel
        const positions = ground.getVerticesData('position');
        if (positions) {
            for (let i = 1; i < positions.length; i += 3) {
                positions[i] += (Math.random() - 0.5) * 0.4;
            }
            ground.updateVerticesData('position', positions);
        }

        makeFlatShaded(ground);

        const groundMat = createLowPolyMaterial('groundMat', PALETTE.GROUND, this.scene);
        ground.material = groundMat;
        ground.receiveShadows = true;
        this.groundMeshes.push(ground);

        // Scatter dark grass patches for ground variation
        const numPatches = 8 + Math.floor(Math.random() * 5);
        const grassMat = createLowPolyMaterial('grassPatchMat', PALETTE.GROUND.scale(0.85), this.scene);
        grassMat.alpha = 0.25;
        for (let i = 0; i < numPatches; i++) {
            const radius = 1.5 + Math.random() * 1.5;
            const patch = MeshBuilder.CreateDisc(`grassPatch_${i}`, {
                radius: radius,
                tessellation: 6
            }, this.scene);
            const px = Math.random() * mapWidth;
            const pz = Math.random() * mapHeight;
            patch.position = new Vector3(px, 0.02, pz);
            patch.rotation.x = Math.PI / 2;
            patch.material = grassMat;
            this.groundMeshes.push(patch);
        }
    }

    private generatePathWithTurns(): void {
        const waypoints = [
            this.startPosition,
            { x: 2, y: Math.floor(this.gridSize / 2) },
            { x: 2, y: 5 },
            { x: 6, y: 5 },
            { x: 6, y: 15 },
            { x: 10, y: 15 },
            { x: 10, y: 2 },
            { x: 14, y: 2 },
            { x: 14, y: 10 },
            { x: 15, y: 10 },
            { x: 19, y: 10 },
            this.endPosition
        ];

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
     * Create flat-shaded sandstone path tiles with slight height variation
     */
    private createPathVisuals(): void {
        const pathMat = createLowPolyMaterial('pathMat', PALETTE.PATH, this.scene);

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y] === CellType.PATH ||
                    this.grid[x][y] === CellType.START ||
                    this.grid[x][y] === CellType.END) {

                    const position = this.gridToWorld(x, y);
                    // Slight random height variation for cobblestone feel
                    const heightVar = Math.random() * 0.04;
                    position.y = 0.06 + heightVar;

                    // Minimal size variation for organic look
                    const sizeVar = 0.92 + Math.random() * 0.06;

                    const pathTile = MeshBuilder.CreateBox(`path_${x}_${y}`, {
                        width: this.cellSize * sizeVar,
                        height: 0.14,
                        depth: this.cellSize * sizeVar
                    }, this.scene);

                    pathTile.position = position;
                    pathTile.material = pathMat;
                    pathTile.receiveShadows = true;
                    makeFlatShaded(pathTile);

                    this.groundMeshes.push(pathTile);
                }
            }
        }

        // Start marker - rotating torus with emissive glow
        const startPos = this.gridToWorld(this.startPosition.x, this.startPosition.y);
        startPos.y = 0.3;

        const startMat = createEmissiveMaterial('startMat', PALETTE.PORTAL_START, 0.6, this.scene);
        startMat.alpha = 0.9;

        const startMarker = MeshBuilder.CreateTorus('startMarker', {
            diameter: this.cellSize * 0.8,
            thickness: this.cellSize * 0.12,
            tessellation: 8
        }, this.scene);
        startMarker.position = startPos;
        startMarker.material = startMat;
        makeFlatShaded(startMarker);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(startMarker);
        this.groundMeshes.push(startMarker);

        // Ground disc beneath start portal
        const startDisc = MeshBuilder.CreateDisc('startDisc', {
            radius: this.cellSize * 0.6,
            tessellation: 8
        }, this.scene);
        startDisc.position = new Vector3(startPos.x, 0.02, startPos.z);
        startDisc.rotation.x = Math.PI / 2;
        const startDiscMat = createEmissiveMaterial('startDiscMat', PALETTE.PORTAL_START, 0.8, this.scene);
        startDiscMat.alpha = 0.5;
        startDisc.material = startDiscMat;
        this.groundMeshes.push(startDisc);

        // Vertical pillar at start portal
        const startPillar = MeshBuilder.CreateCylinder('startPillar', {
            height: 2.5,
            diameter: 0.2,
            tessellation: 6
        }, this.scene);
        startPillar.position = new Vector3(startPos.x, 1.25, startPos.z);
        const startPillarMat = createEmissiveMaterial('startPillarMat', PALETTE.PORTAL_START, 0.4, this.scene);
        startPillarMat.alpha = 0.7;
        startPillar.material = startPillarMat;
        makeFlatShaded(startPillar);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(startPillar);
        this.groundMeshes.push(startPillar);

        this.scene.registerBeforeRender(() => {
            startMarker.rotation.y += 0.015;
        });

        // End marker
        const endPos = this.gridToWorld(this.endPosition.x, this.endPosition.y);
        endPos.y = 0.3;

        const endMat = createEmissiveMaterial('endMat', PALETTE.PORTAL_END, 0.6, this.scene);
        endMat.alpha = 0.9;

        const endMarker = MeshBuilder.CreateTorus('endMarker', {
            diameter: this.cellSize * 0.8,
            thickness: this.cellSize * 0.12,
            tessellation: 8
        }, this.scene);
        endMarker.position = endPos;
        endMarker.material = endMat;
        makeFlatShaded(endMarker);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(endMarker);
        this.groundMeshes.push(endMarker);

        // Ground disc beneath end portal
        const endDisc = MeshBuilder.CreateDisc('endDisc', {
            radius: this.cellSize * 0.6,
            tessellation: 8
        }, this.scene);
        endDisc.position = new Vector3(endPos.x, 0.02, endPos.z);
        endDisc.rotation.x = Math.PI / 2;
        const endDiscMat = createEmissiveMaterial('endDiscMat', PALETTE.PORTAL_END, 0.8, this.scene);
        endDiscMat.alpha = 0.5;
        endDisc.material = endDiscMat;
        this.groundMeshes.push(endDisc);

        // Vertical pillar at end portal
        const endPillar = MeshBuilder.CreateCylinder('endPillar', {
            height: 2.5,
            diameter: 0.2,
            tessellation: 6
        }, this.scene);
        endPillar.position = new Vector3(endPos.x, 1.25, endPos.z);
        const endPillarMat = createEmissiveMaterial('endPillarMat', PALETTE.PORTAL_END, 0.4, this.scene);
        endPillarMat.alpha = 0.7;
        endPillar.material = endPillarMat;
        makeFlatShaded(endPillar);
        if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(endPillar);
        this.groundMeshes.push(endPillar);

        this.scene.registerBeforeRender(() => {
            endMarker.rotation.y -= 0.015;
        });
    }

    /**
     * Low-poly decorations: triangular trees, faceted rocks, icosphere bushes, flowers
     */
    private addDecorations(): void {
        const decorations = [
            // Trees - tapered cylinder trunk + 2-3 stacked cones
            {
                mesh: (position: Vector3) => {
                    const meshes: Mesh[] = [];

                    // Trunk - tapered cylinder
                    const trunk = MeshBuilder.CreateCylinder('treeTrunk', {
                        height: 1.0,
                        diameterTop: 0.15,
                        diameterBottom: 0.3,
                        tessellation: 6
                    }, this.scene);
                    trunk.position = new Vector3(position.x, 0.5, position.z);
                    trunk.material = createLowPolyMaterial('trunkMat', PALETTE.TREE_TRUNK, this.scene);
                    makeFlatShaded(trunk);
                    meshes.push(trunk);

                    // 2-3 stacked cones for Christmas tree / triangular foliage
                    const numCones = 2 + Math.floor(Math.random() * 2);
                    for (let i = 0; i < numCones; i++) {
                        const coneHeight = 1.0 - i * 0.15;
                        const coneDiam = 1.4 - i * 0.35;
                        const cone = MeshBuilder.CreateCylinder(`treeLeaves_${i}`, {
                            height: coneHeight,
                            diameterTop: 0,
                            diameterBottom: coneDiam,
                            tessellation: 5 + Math.floor(Math.random() * 3)
                        }, this.scene);
                        cone.position = new Vector3(position.x, 1.0 + i * 0.6, position.z);
                        cone.material = createLowPolyMaterial(`leavesMat_${i}`,
                            i === 0 ? PALETTE.TREE_FOLIAGE_DARK : PALETTE.TREE_FOLIAGE, this.scene);
                        makeFlatShaded(cone);
                        meshes.push(cone);
                    }

                    if (this.shadowGenerator) {
                        for (const m of meshes) this.shadowGenerator.addShadowCaster(m);
                    }

                    return meshes;
                },
                probability: 0.15
            },
            // Rocks - polyhedrons with faceted look
            {
                mesh: (position: Vector3) => {
                    const rock = MeshBuilder.CreatePolyhedron('rock', {
                        type: Math.floor(Math.random() * 4),
                        size: 0.25 + Math.random() * 0.2
                    }, this.scene);

                    rock.scaling.y = 0.5 + Math.random() * 0.3;
                    rock.position = new Vector3(position.x, 0.2, position.z);
                    rock.rotation.y = Math.random() * Math.PI * 2;
                    rock.rotation.x = Math.random() * 0.3;
                    rock.material = createLowPolyMaterial('rockMat',
                        Math.random() > 0.5 ? PALETTE.ROCK : PALETTE.ROCK_DARK, this.scene);
                    makeFlatShaded(rock);

                    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(rock);

                    return [rock];
                },
                probability: 0.08
            },
            // Bushes - very low-poly icospheres
            {
                mesh: (position: Vector3) => {
                    const bush = MeshBuilder.CreateIcoSphere('bush', {
                        subdivisions: 1,
                        radius: 0.3 + Math.random() * 0.15
                    }, this.scene);

                    bush.position = new Vector3(position.x, 0.25, position.z);
                    bush.material = createLowPolyMaterial('bushMat', PALETTE.BUSH, this.scene);
                    makeFlatShaded(bush);

                    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(bush);

                    return [bush];
                },
                probability: 0.10
            },
            // Flowers - small stem + disc petal
            {
                mesh: (position: Vector3) => {
                    const meshes: Mesh[] = [];

                    const stem = MeshBuilder.CreateCylinder('flowerStem', {
                        height: 0.5,
                        diameter: 0.06,
                        tessellation: 4
                    }, this.scene);
                    stem.position = new Vector3(position.x, 0.25, position.z);
                    stem.material = createLowPolyMaterial('stemMat', PALETTE.FLOWER_STEM, this.scene);
                    meshes.push(stem);

                    const petalColors = [PALETTE.FLOWER_PETAL_RED, PALETTE.FLOWER_PETAL_YELLOW, PALETTE.FLOWER_PETAL_PURPLE];
                    const petal = MeshBuilder.CreateDisc('flowerPetal', {
                        radius: 0.18,
                        tessellation: 5
                    }, this.scene);
                    petal.position = new Vector3(position.x, 0.52, position.z);
                    petal.rotation.x = -Math.PI / 6;
                    petal.material = createLowPolyMaterial('petalMat',
                        petalColors[Math.floor(Math.random() * petalColors.length)], this.scene);
                    meshes.push(petal);

                    return meshes;
                },
                probability: 0.06
            }
        ];

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y] === CellType.EMPTY) {
                    for (const decType of decorations) {
                        if (Math.random() < decType.probability) {
                            const position = this.gridToWorld(x, y);
                            const decorMeshes = decType.mesh(position);
                            this.decorationMeshes.push(...decorMeshes);
                            this.grid[x][y] = CellType.DECORATION;
                            break;
                        }
                    }
                }
            }
        }
    }

    /**
     * Reduced particle effects for portals (50-80 particles instead of 500)
     */
    private addParticleEffects(): void {
        const startPos = this.gridToWorld(this.startPosition.x, this.startPosition.y);
        const startParticles = new ParticleSystem("startParticles", 60, this.scene);
        startParticles.emitter = new Vector3(startPos.x, 0.5, startPos.z);
        startParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
        startParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);
        startParticles.color1 = new Color4(0.15, 0.85, 0.35, 0.9);
        startParticles.color2 = new Color4(0.1, 0.6, 0.2, 0.7);
        startParticles.colorDead = new Color4(0, 0.3, 0, 0.0);
        startParticles.minSize = 0.15;
        startParticles.maxSize = 0.4;
        startParticles.minLifeTime = 0.4;
        startParticles.maxLifeTime = 1.2;
        startParticles.emitRate = 20;
        startParticles.direction1 = new Vector3(-0.3, 1, -0.3);
        startParticles.direction2 = new Vector3(0.3, 1.5, 0.3);
        startParticles.gravity = new Vector3(0, -0.5, 0);
        startParticles.start();
        this.pathParticles.push(startParticles);

        const endPos = this.gridToWorld(this.endPosition.x, this.endPosition.y);
        const endParticles = new ParticleSystem("endParticles", 60, this.scene);
        endParticles.emitter = new Vector3(endPos.x, 0.5, endPos.z);
        endParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
        endParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);
        endParticles.color1 = new Color4(0.90, 0.20, 0.20, 0.9);
        endParticles.color2 = new Color4(0.60, 0.10, 0.10, 0.7);
        endParticles.colorDead = new Color4(0.3, 0, 0, 0.0);
        endParticles.minSize = 0.15;
        endParticles.maxSize = 0.4;
        endParticles.minLifeTime = 0.4;
        endParticles.maxLifeTime = 1.2;
        endParticles.emitRate = 20;
        endParticles.direction1 = new Vector3(-0.3, 1, -0.3);
        endParticles.direction2 = new Vector3(0.3, 1.5, 0.3);
        endParticles.gravity = new Vector3(0, -0.5, 0);
        endParticles.start();
        this.pathParticles.push(endParticles);
    }

    public gridToWorld(gridX: number, gridY: number): Vector3 {
        const x = gridX * this.cellSize + this.cellSize / 2;
        const z = gridY * this.cellSize + this.cellSize / 2;
        return new Vector3(x, 0, z);
    }

    public worldToGrid(position: Vector3): { x: number, y: number } {
        const gridX = Math.floor(position.x / this.cellSize);
        const gridY = Math.floor(position.z / this.cellSize);
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
                    cell.position = new Vector3(position.x, 0.01, position.z);
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

                    // Check 4 adjacent cells: [dx, dy]
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
                                borderHeight / 2,
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
     * Add a small water pond in an empty area of the map for visual interest.
     * Uses transparent blue material with subtle vertex displacement for ripple effect.
     */
    private addWaterFeature(): void {
        // Find a good spot for a pond (look for a cluster of empty cells)
        // Place it in the upper-right quadrant which tends to be open
        const pondCenter = { x: 16, y: 4 };
        const pondRadius = 2;

        // Check if area is actually empty
        let canPlace = true;
        for (let dx = -pondRadius; dx <= pondRadius; dx++) {
            for (let dy = -pondRadius; dy <= pondRadius; dy++) {
                const gx = pondCenter.x + dx;
                const gy = pondCenter.y + dy;
                if (gx >= 0 && gx < this.gridSize && gy >= 0 && gy < this.gridSize) {
                    if (this.grid[gx][gy] !== CellType.EMPTY && this.grid[gx][gy] !== CellType.DECORATION) {
                        canPlace = false;
                        break;
                    }
                }
            }
            if (!canPlace) break;
        }

        if (!canPlace) return;

        const worldPos = this.gridToWorld(pondCenter.x, pondCenter.y);

        // Water surface - translucent blue disc
        const waterSurface = MeshBuilder.CreateGround('waterSurface', {
            width: pondRadius * this.cellSize * 1.5,
            height: pondRadius * this.cellSize * 1.5,
            subdivisions: 8
        }, this.scene);
        waterSurface.position = new Vector3(worldPos.x, 0.05, worldPos.z);

        // Subtle vertex displacement for ripple effect
        const positions = waterSurface.getVerticesData('position');
        if (positions) {
            for (let i = 1; i < positions.length; i += 3) {
                positions[i] += (Math.random() - 0.5) * 0.08;
            }
            waterSurface.updateVerticesData('position', positions);
        }
        makeFlatShaded(waterSurface);

        const waterMat = createLowPolyMaterial('waterMat', PALETTE.TOWER_WATER_CRYSTAL, this.scene);
        waterMat.alpha = 0.55;
        waterSurface.material = waterMat;
        this.groundMeshes.push(waterSurface);

        // Mark cells as decoration so towers can't be placed on water
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const gx = pondCenter.x + dx;
                const gy = pondCenter.y + dy;
                if (gx >= 0 && gx < this.gridSize && gy >= 0 && gy < this.gridSize) {
                    if (this.grid[gx][gy] === CellType.EMPTY) {
                        this.grid[gx][gy] = CellType.DECORATION;
                    }
                }
            }
        }

        // Pond border rocks
        const rockCount = 6 + Math.floor(Math.random() * 4);
        for (let i = 0; i < rockCount; i++) {
            const angle = (i / rockCount) * Math.PI * 2;
            const dist = pondRadius * 1.1 + Math.random() * 0.5;
            const rx = worldPos.x + Math.cos(angle) * dist;
            const rz = worldPos.z + Math.sin(angle) * dist;

            const rock = MeshBuilder.CreatePolyhedron(`pondRock_${i}`, {
                type: Math.floor(Math.random() * 3),
                size: 0.15 + Math.random() * 0.12
            }, this.scene);
            rock.position = new Vector3(rx, 0.1, rz);
            rock.rotation.y = Math.random() * Math.PI * 2;
            rock.scaling.y = 0.6;
            rock.material = createLowPolyMaterial(`pondRockMat_${i}`, PALETTE.ROCK, this.scene);
            makeFlatShaded(rock);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(rock);
            this.decorationMeshes.push(rock);
        }
    }

    /**
     * Add a stone wall border around the playable area to frame the map.
     */
    private addMapBorder(): void {
        const mapWidth = this.gridSize * this.cellSize;
        const borderHeight = 0.6;
        const borderThickness = 0.8;
        const borderMat = createLowPolyMaterial('mapBorderMat', PALETTE.ROCK_DARK, this.scene);

        // Four walls around the perimeter
        const walls = [
            // North wall
            { w: mapWidth + borderThickness * 2, d: borderThickness, x: mapWidth / 2, z: -borderThickness / 2 },
            // South wall
            { w: mapWidth + borderThickness * 2, d: borderThickness, x: mapWidth / 2, z: mapWidth + borderThickness / 2 },
            // West wall (leave gap for start portal)
            { w: borderThickness, d: mapWidth + borderThickness * 2, x: -borderThickness / 2, z: mapWidth / 2 },
            // East wall (leave gap for end portal)
            { w: borderThickness, d: mapWidth + borderThickness * 2, x: mapWidth + borderThickness / 2, z: mapWidth / 2 }
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
        }

        // Corner pillars for visual polish
        const corners = [
            { x: -borderThickness / 2, z: -borderThickness / 2 },
            { x: mapWidth + borderThickness / 2, z: -borderThickness / 2 },
            { x: -borderThickness / 2, z: mapWidth + borderThickness / 2 },
            { x: mapWidth + borderThickness / 2, z: mapWidth + borderThickness / 2 }
        ];

        for (let i = 0; i < corners.length; i++) {
            const pillar = MeshBuilder.CreateCylinder(`cornerPillar_${i}`, {
                height: borderHeight * 1.8,
                diameter: borderThickness * 1.2,
                tessellation: 6
            }, this.scene);
            pillar.position = new Vector3(corners[i].x, borderHeight * 0.9, corners[i].z);
            pillar.material = createLowPolyMaterial(`cornerPillarMat_${i}`, PALETTE.ROCK, this.scene);
            makeFlatShaded(pillar);
            if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(pillar);
            this.groundMeshes.push(pillar);
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
