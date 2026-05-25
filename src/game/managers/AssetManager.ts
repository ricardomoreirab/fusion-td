import { Scene, AssetsManager, AbstractMesh, Texture, Sound, AssetContainer } from '@babylonjs/core';
import '@babylonjs/loaders/glTF'; // registers .glb / .gltf loaders for SceneLoader + AssetsManager

export class AssetManager {
    private scene: Scene;
    private assetsManager: AssetsManager;
    private meshes: Map<string, AbstractMesh>;
    private textures: Map<string, Texture>;
    private sounds: Map<string, Sound>;
    private containers: Map<string, AssetContainer>;

    constructor(scene: Scene) {
        this.scene = scene;
        this.assetsManager = new AssetsManager(scene);
        this.meshes = new Map<string, AbstractMesh>();
        this.textures = new Map<string, Texture>();
        this.sounds = new Map<string, Sound>();
        this.containers = new Map<string, AssetContainer>();
        
        // Configure asset manager
        this.assetsManager.useDefaultLoadingScreen = false;
        this.assetsManager.onProgress = (remainingCount, totalCount) => {
            const progress = (totalCount - remainingCount) / totalCount;
            console.log(`Loading progress: ${Math.round(progress * 100)}%`);
        };
    }

    /**
     * Load all game assets
     * @param onComplete Callback when all assets are loaded
     * @param onProgress Callback for loading progress (0-1)
     */
    public loadAssets(onComplete: () => void, onProgress?: (progress: number) => void): void {
        // Set up progress callback
        if (onProgress) {
            this.assetsManager.onProgressObservable.add((progress) => {
                // Calculate progress as a ratio between 0 and 1
                const progressRatio = progress ? (progress as any).loadedCount / (progress as any).totalCount : 0;
                onProgress(progressRatio);
            });
        }

        // Define assets to load
        this.loadMeshes();
        this.loadTextures();
        this.loadSounds();

        // Start loading and call onComplete when done
        this.assetsManager.onFinish = onComplete;
        this.assetsManager.load();
    }

    /**
     * Load mesh assets
     */
    private loadMeshes(): void {
        // Tower meshes
        const basicTowerTask = this.assetsManager.addMeshTask("basicTower", "", "assets/models/", "basic_tower.glb");
        basicTowerTask.onSuccess = (task) => {
            if (task.loadedMeshes.length > 0) {
                this.meshes.set("basicTower", task.loadedMeshes[0]);
                task.loadedMeshes[0].setEnabled(false); // Hide until needed
            }
        };

        // Enemy meshes
        const basicEnemyTask = this.assetsManager.addMeshTask("basicEnemy", "", "assets/models/", "basic_enemy.glb");
        basicEnemyTask.onSuccess = (task) => {
            if (task.loadedMeshes.length > 0) {
                this.meshes.set("basicEnemy", task.loadedMeshes[0]);
                task.loadedMeshes[0].setEnabled(false); // Hide until needed
            }
        };

        // Map elements
        const mapTileTask = this.assetsManager.addMeshTask("mapTile", "", "assets/models/", "map_tile.glb");
        mapTileTask.onSuccess = (task) => {
            if (task.loadedMeshes.length > 0) {
                this.meshes.set("mapTile", task.loadedMeshes[0]);
                task.loadedMeshes[0].setEnabled(false); // Hide until needed
            }
        };

        // Champion 3D models — loaded as AssetContainer so Champion can call
        // instantiateModelsToScene() to spawn a fresh copy each run without
        // touching the original (and so the original survives state.exit()).
        const rangerTask = this.assetsManager.addContainerTask(
            "rangerArcher", "", "assets/elven-archer-in-the-forest/source/", "model.glb",
        );
        rangerTask.onSuccess = (task) => {
            // Detach from the active scene immediately. Game.cleanupScene() (called on
            // every state transition) iterates scene.meshes/materials/textures and
            // disposes ALL of them — without this, our preloaded source meshes get
            // wiped on the first survivors enter() and subsequent instantiateModelsToScene
            // calls clone disposed objects, producing invisible instances.
            task.loadedContainer.removeAllFromScene();
            this.containers.set("rangerArcher", task.loadedContainer);
            console.log(
                `[AssetManager] rangerArcher loaded — ${task.loadedContainer.meshes.length} meshes, ` +
                `${task.loadedContainer.animationGroups.length} anim groups, ` +
                `${task.loadedContainer.skeletons.length} skeletons`,
            );
        };
        rangerTask.onError = (_task, message, exception) => {
            console.error("Failed to load ranger GLB:", message, exception);
        };
    }

    /**
     * Load texture assets
     */
    private loadTextures(): void {
        // UI textures
        const buttonTexture = this.assetsManager.addTextureTask("buttonTexture", "assets/textures/button.png");
        buttonTexture.onSuccess = (task) => {
            this.textures.set("button", task.texture);
        };

        // Game textures
        const groundTexture = this.assetsManager.addTextureTask("groundTexture", "assets/textures/ground.png");
        groundTexture.onSuccess = (task) => {
            this.textures.set("ground", task.texture);
        };

        const pathTexture = this.assetsManager.addTextureTask("pathTexture", "assets/textures/path.png");
        pathTexture.onSuccess = (task) => {
            this.textures.set("path", task.texture);
        };
    }

    /**
     * Load sound assets
     */
    private loadSounds(): void {
        // Background music
        const bgMusic = new Sound("bgMusic", "assets/sounds/background.mp3", this.scene, null, {
            loop: true,
            autoplay: false,
            volume: 0.5
        });
        this.sounds.set("bgMusic", bgMusic);

        // Sound effects
        const towerShoot = new Sound("towerShoot", "assets/sounds/tower_shoot.mp3", this.scene, null, {
            loop: false,
            autoplay: false,
            volume: 0.7
        });
        this.sounds.set("towerShoot", towerShoot);

        const enemyDeath = new Sound("enemyDeath", "assets/sounds/enemy_death.mp3", this.scene, null, {
            loop: false,
            autoplay: false,
            volume: 0.7
        });
        this.sounds.set("enemyDeath", enemyDeath);
        
        // Cannon explosion sound
        const explosion = new Sound("explosion", "assets/sounds/explosion.mp3", this.scene, null, {
            loop: false,
            autoplay: false,
            volume: 0.8
        });
        this.sounds.set("explosion", explosion);
    }

    /**
     * Get a preloaded AssetContainer by name. Returns null if the asset failed
     * to load or wasn't registered. Caller is responsible for calling
     * `container.instantiateModelsToScene(...)` to spawn instances.
     */
    public getContainer(name: string): AssetContainer | null {
        const c = this.containers.get(name);
        if (!c) {
            console.warn(`AssetContainer '${name}' not found`);
            return null;
        }
        return c;
    }

    /**
     * Get a mesh by name
     * @param name The name of the mesh
     * @returns The mesh or null if not found
     */
    public getMesh(name: string): AbstractMesh | null {
        const mesh = this.meshes.get(name);
        if (!mesh) {
            console.warn(`Mesh '${name}' not found`);
            return null;
        }
        return mesh.clone(name, null);
    }

    /**
     * Get a texture by name
     * @param name The name of the texture
     * @returns The texture or null if not found
     */
    public getTexture(name: string): Texture | null {
        const texture = this.textures.get(name);
        if (!texture) {
            console.warn(`Texture '${name}' not found`);
            return null;
        }
        return texture;
    }

    /**
     * Get a sound by name
     * @param name The name of the sound
     * @returns The sound or null if not found
     */
    public getSound(name: string): Sound | null {
        const sound = this.sounds.get(name);
        if (!sound) {
            console.warn(`Sound '${name}' not found`);
            return null;
        }
        return sound;
    }

    /**
     * Play a sound by name
     * @param name The name of the sound
     */
    public playSound(name: string): void {
        const sound = this.getSound(name);
        if (sound) {
            sound.play();
        }
    }
} 