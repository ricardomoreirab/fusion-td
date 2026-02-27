import { Vector3, Animation, ArcRotateCamera, Scene, CubicEase, EasingFunction, MeshBuilder, Mesh, Color3 } from '@babylonjs/core';
import { createLowPolyMaterial, makeFlatShaded } from '../rendering/LowPolyMaterial';
import { PALETTE, MAP_THEMES } from '../rendering/StyleConstants';
import { Game } from '../Game';
import { Map } from './Map';
import { LevelConfig, LEVEL_1, generateProceduralLevelConfig } from './LevelConfig';

export class LevelManager {
    private game: Game;
    private scene: Scene;
    private segments: Map[] = [];
    private segmentConfigs: LevelConfig[] = [];
    private bridgeMeshes: Mesh[] = [];
    private readonly zOffsetPerLevel: number = 50;

    constructor(game: Game) {
        this.game = game;
        this.scene = game.getScene();
    }

    public getSegmentCount(): number {
        return this.segments.length;
    }

    public getZOffset(segmentIndex: number): number {
        return segmentIndex * this.zOffsetPerLevel;
    }

    public getCameraTarget(segmentIndex: number): Vector3 {
        return new Vector3(20, 0, 20 + this.getZOffset(segmentIndex));
    }

    /**
     * Create the first Map (Level 1: The Enchanted Forest).
     */
    public createFirstSegment(): Map {
        const config = LEVEL_1;
        const zOffset = this.getZOffset(0);
        const map = new Map(this.game, config, zOffset);
        map.initialize();
        this.segments.push(map);
        this.segmentConfigs.push(config);
        return map;
    }

    /**
     * Generate and create the next procedural segment, connected to the previous one.
     * Returns the new Map.
     */
    public generateNextSegment(): Map {
        const prevMap = this.segments[this.segments.length - 1];
        const prevEndGrid = prevMap.getEndPositionGrid();
        const segmentIndex = this.segments.length; // 0-indexed, so this is the new segment's index

        // Generate a procedural config connected to previous segment's end
        const config = generateProceduralLevelConfig(segmentIndex - 1, prevEndGrid.x);
        const zOffset = this.getZOffset(segmentIndex);

        // Intermediate segments suppress start portal (enemies walk in from bridge).
        // The new segment gets an end portal (it's the latest).
        const map = new Map(this.game, config, zOffset, true, false);
        map.initialize();

        this.segments.push(map);
        this.segmentConfigs.push(config);

        // Create visual bridge between previous and new segment
        this.createBridgeVisuals(prevMap, map);

        return map;
    }

    /**
     * Create ground and path visuals in the gap between two connected segments.
     */
    private createBridgeVisuals(prevMap: Map, currMap: Map): void {
        const prevEnd = prevMap.getEndPosition();
        const currStart = currMap.getStartPosition();

        // Use the new segment's theme palette for bridge colors
        const tp = currMap.getThemePalette();

        // Bridge ground plane spanning the gap
        const midX = (prevEnd.x + currStart.x) / 2;
        const midZ = (prevEnd.z + currStart.z) / 2;
        const gapLength = Math.abs(currStart.z - prevEnd.z) + 4; // extra padding
        const bridgeWidth = 8;

        const bridgeGround = MeshBuilder.CreateGround('bridge_ground', {
            width: bridgeWidth,
            height: gapLength,
            subdivisions: 4
        }, this.scene);
        bridgeGround.position = new Vector3(midX, -0.15, midZ);
        bridgeGround.material = createLowPolyMaterial('bridgeGroundMat', tp.ground, this.scene);
        bridgeGround.receiveShadows = true;
        this.bridgeMeshes.push(bridgeGround);

        // Path stones along the bridge
        const steps = Math.max(4, Math.floor(gapLength / 2));
        const pathMat = createLowPolyMaterial('bridgePathMat', tp.path, this.scene);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = prevEnd.x + (currStart.x - prevEnd.x) * t;
            const pz = prevEnd.z + (currStart.z - prevEnd.z) * t;

            const stone = MeshBuilder.CreateBox(`bridge_stone_${i}`, {
                width: 1.6 + Math.random() * 0.4,
                height: 0.08,
                depth: 1.6 + Math.random() * 0.4
            }, this.scene);
            stone.position = new Vector3(
                px + (Math.random() - 0.5) * 0.3,
                0.05,
                pz
            );
            stone.rotation.y = Math.random() * 0.3;
            stone.material = pathMat;
            makeFlatShaded(stone);
            this.bridgeMeshes.push(stone);
        }
    }

    /**
     * Remove the end portal from the latest (last) segment.
     * Called before generating a new segment so enemies pass through.
     */
    public removeEndPortalFromLatestSegment(): void {
        if (this.segments.length > 0) {
            this.segments[this.segments.length - 1].removeEndPortal();
        }
    }

    /**
     * Interpolate between two points with steps no larger than maxStep units.
     * Returns intermediate points (excluding the start, including the end).
     */
    private interpolateBridge(from: Vector3, to: Vector3, maxStep: number = 1.5): Vector3[] {
        const dist = Vector3.Distance(from, to);
        const steps = Math.max(1, Math.ceil(dist / maxStep));
        const points: Vector3[] = [];
        for (let i = 1; i <= steps; i++) {
            points.push(Vector3.Lerp(from, to, i / steps));
        }
        return points;
    }

    /**
     * Get the composite path across all segments, including finely-interpolated
     * bridge waypoints between segments so enemies can traverse smoothly.
     */
    public getCompositePath(): Vector3[] {
        if (this.segments.length === 0) return [];

        const compositePath: Vector3[] = [...this.segments[0].getPath()];

        for (let i = 1; i < this.segments.length; i++) {
            const prevMap = this.segments[i - 1];
            const currMap = this.segments[i];

            const prevEnd = prevMap.getEndPosition();
            const currStart = currMap.getStartPosition();

            // Interpolate bridge with fine steps (≤ 1.5 units each)
            compositePath.push(...this.interpolateBridge(prevEnd, currStart));

            // Add the current segment's path
            compositePath.push(...currMap.getPath());
        }

        return compositePath;
    }

    /**
     * Get bridge waypoints + new segment path for extending in-flight enemies.
     * Returns points from the previous segment's end through to the new segment's full path.
     */
    public getBridgeAndNewSegmentPath(segmentIndex: number): Vector3[] {
        if (segmentIndex <= 0 || segmentIndex >= this.segments.length) return [];

        const prevMap = this.segments[segmentIndex - 1];
        const currMap = this.segments[segmentIndex];

        const prevEnd = prevMap.getEndPosition();
        const currStart = currMap.getStartPosition();

        return [...this.interpolateBridge(prevEnd, currStart), ...currMap.getPath()];
    }

    /**
     * Determine which map segment a world position belongs to, based on Z ranges.
     */
    public getMapForWorldPosition(pos: Vector3): Map | null {
        for (let i = 0; i < this.segments.length; i++) {
            const zOff = this.getZOffset(i);
            // Each segment spans z from zOff to zOff + 40 (20 cells * 2 units)
            if (pos.z >= zOff - 2 && pos.z <= zOff + 42) {
                return this.segments[i];
            }
        }
        return null;
    }

    /**
     * Get all map segments.
     */
    public getAllMaps(): Map[] {
        return this.segments;
    }

    /**
     * Get the latest (most recently created) map segment.
     */
    public getLatestMap(): Map {
        return this.segments[this.segments.length - 1];
    }

    /**
     * Get the maximum Z extent of all segments (for camera clamping).
     */
    public getMaxZ(): number {
        if (this.segments.length === 0) return 40;
        return this.getZOffset(this.segments.length - 1) + 40;
    }

    /**
     * Animate camera from current position to a specific segment's center.
     * Returns a Promise that resolves when the animation completes.
     */
    public animateCameraToSegment(segmentIndex: number): Promise<void> {
        return new Promise((resolve) => {
            const camera = this.scene.activeCamera as ArcRotateCamera;
            if (!camera) {
                resolve();
                return;
            }

            const from = camera.target.clone();
            const to = this.getCameraTarget(segmentIndex);

            const anim = new Animation(
                'cameraTransition',
                'target',
                30,
                Animation.ANIMATIONTYPE_VECTOR3,
                Animation.ANIMATIONLOOPMODE_CONSTANT
            );

            anim.setKeys([
                { frame: 0, value: from },
                { frame: 60, value: to }
            ]);

            const easing = new CubicEase();
            easing.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
            anim.setEasingFunction(easing);

            camera.animations = [anim];

            this.scene.beginAnimation(camera, 0, 60, false, 1, () => {
                camera.target = to;
                resolve();
            });
        });
    }

    /**
     * Dispose all maps created by this manager.
     */
    public dispose(): void {
        for (const map of this.segments) {
            map.dispose();
        }
        for (const mesh of this.bridgeMeshes) {
            if (mesh && !mesh.isDisposed()) mesh.dispose();
        }
        this.segments = [];
        this.segmentConfigs = [];
        this.bridgeMeshes = [];
    }
}
