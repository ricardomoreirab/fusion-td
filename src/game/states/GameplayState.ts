import { Engine, Scene, Vector3, Color3, Color4, ArcRotateCamera, HemisphericLight, DirectionalLight, PointLight, ShadowGenerator, MeshBuilder, StandardMaterial, Texture, KeyboardEventTypes, Mesh, LinesMesh, Matrix, PointerEventTypes, PointerInfo, AbstractMesh, ParticleSystem } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, TextBlock, Image, Grid, StackPanel } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { TowerManager } from '../gameplay/TowerManager';
import { EnemyManager } from '../gameplay/EnemyManager';
import { WaveManager } from '../gameplay/WaveManager';
import { PlayerStats } from '../gameplay/PlayerStats';
import { Tower } from '../gameplay/towers/Tower';
import { WaveStatus } from '../gameplay/WaveStatus';

export class GameplayState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;
    private map: Map | null = null;
    private towerManager: TowerManager | null = null;
    private enemyManager: EnemyManager | null = null;
    private waveManager: WaveManager | null = null;
    private playerStats: PlayerStats | null = null;
    private isPaused: boolean = false;
    private selectedTowerType: string | null = null;
    private towerPreview: Mesh | null = null;
    private squareOutline: LinesMesh | null = null;
    private confirmationButtons: { container: Rectangle | null, position: Vector3 | null } = { container: null, position: null };
    private placementState: 'selecting' | 'confirming' = 'selecting';
    private scene: Scene | null = null;
    private selectedTower: Tower | null = null;
    private sellButton: Rectangle | null = null;
    private upgradeButton: Rectangle | null = null;
    private towerInfoPanel: Rectangle | null = null;
    private iconCache: { [key: number]: string } = {};
    private fontLoaded: boolean = false;
    private maxRetries: number = 3;
    private retryDelay: number = 500; // milliseconds
    private selectedPosition: Vector3 | null = null;
    private towerSelectorPanel: Rectangle | null = null;
    private placementOutline: Mesh | null = null;
    private placementPlane: Mesh | null = null;
    private towerTypeText: TextBlock | null = null;
    private towerLevelText: TextBlock | null = null;
    private towerDamageText: TextBlock | null = null;
    private towerRangeText: TextBlock | null = null;
    private towerRateText: TextBlock | null = null;
    private playerHealth: number = 100;
    private playerMoney: number = 200;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log("Entering gameplay state");
        this.game.cleanupScene();

        this.scene = this.game.getScene();
        if (!this.scene) {
            console.error("Scene is null in GameplayState.enter()");
            return;
        }

        // Setup camera control based on Shift key
        this.setupCameraControls();
        
        // Reset all state variables to ensure a clean start
        this.ui = null;
        this.map = null;
        this.towerManager = null;
        this.enemyManager = null;
        this.waveManager = null;
        this.playerStats = null;
        this.isPaused = false;
        this.selectedTowerType = null;
        this.towerPreview = null;
        this.squareOutline = null;
        this.confirmationButtons = { container: null, position: null };
        this.placementState = 'selecting';
        this.selectedTower = null;
        this.sellButton = null;
        this.upgradeButton = null;
        this.towerInfoPanel = null;
        this.selectedPosition = null;
        this.towerSelectorPanel = null;
        this.placementOutline = null;
        this.placementPlane = null;
        this.towerTypeText = null;
        this.towerLevelText = null;
        this.towerDamageText = null;
        this.towerRangeText = null;
        this.towerRateText = null;
        
        // Setup the map
        this.map = new Map(this.game);
        
        // Initialize the map
        this.map.initialize();
        
        // Create enemy manager
        this.enemyManager = new EnemyManager(this.game, this.map);
        
        // Create player stats (initial values: health, money)
        this.playerStats = new PlayerStats(100, 200);
        
        // Set player stats in enemy manager for rewards
        this.enemyManager.setPlayerStats(this.playerStats);
        
        // Create tower manager
        this.towerManager = new TowerManager(this.game, this.map);
        
        // Connect managers for targeting
        this.towerManager.setEnemyManager(this.enemyManager);
        
        // Connect managers for tower destruction (new)
        this.enemyManager.setTowerManager(this.towerManager);
        
        // Create wave manager
        this.waveManager = new WaveManager(this.enemyManager, this.playerStats);
        
        // Create UI
        this.createUI();
        
        // Setup input handling
        this.setupInputHandling();
        
        // Store player stats reference in scene metadata for access by game over state
        this.game.getScene().metadata = {
            playerStats: this.playerStats
        };
        
        console.log('Gameplay state initialized with fresh state');
    }

    public exit(): void {
        console.log('Exiting gameplay state');
        
        // Dispose UI
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
        
        // Dispose game components
        this.map?.dispose();
        this.towerManager?.dispose();
        this.enemyManager?.dispose();
        this.waveManager?.dispose();
        
        // Dispose preview meshes
        if (this.towerPreview) {
            this.towerPreview.dispose();
            this.towerPreview = null;
        }
        if (this.squareOutline) {
            this.squareOutline.dispose();
            this.squareOutline = null;
        }
        
        // Clear references
        this.map = null;
        this.towerManager = null;
        this.enemyManager = null;
        this.waveManager = null;
        this.playerStats = null;
        this.confirmationButtons.container = null;
        this.confirmationButtons.position = null;
    }

    public update(deltaTime: number): void {
        if (this.isPaused) return;
        
        // Update game components
        this.towerManager?.update(deltaTime);
        this.enemyManager?.update(deltaTime);
        this.waveManager?.update(deltaTime);
        
        // Check for game over condition
        if (this.playerStats && this.playerStats.getHealth() <= 0) {
            this.game.getStateManager().changeState('gameOver');
        }
        
        // Check for win condition
        if (this.waveManager?.isAllWavesCompleted() && this.enemyManager?.getEnemyCount() === 0) {
            // Player won
            this.playerStats?.setWon(true);
            this.game.getStateManager().changeState('gameOver');
        }
        
        // Update UI
        this.updateUI();
    }

    private createUI(): void {
        // Create the UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI("gameplayUI", true, this.scene!);
        
        // Detect if we're on a mobile device
        const isMobile = this.isMobileDevice();
        
        // Apply device-specific UI scaling
        if (isMobile) {
            // Scale UI for mobile devices
            this.ui.idealWidth = 1024; // Reference width for scaling
            this.ui.useSmallestIdeal = true;
            this.ui.renderScale = 1.5; // Scale up UI elements for better touch targets
        }
        
        // Create minimalist stats icons with emojis
        const statsContainer = new Rectangle('statsContainer');
        statsContainer.width = '200px';  // Reduced width for more compact display
        statsContainer.height = '140px';  // Reduced height (reduced from 180px to 140px)
        statsContainer.background = 'transparent';
        statsContainer.thickness = 0;
        statsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        statsContainer.left = '10px';
        statsContainer.top = '10px';
        this.ui.addControl(statsContainer);

        // Health display with heart emoji
        const healthContainer = new Rectangle('healthContainer');
        healthContainer.width = '190px';  // Slightly less than parent
        healthContainer.height = '40px';
        healthContainer.background = 'transparent';
        healthContainer.thickness = 0;
        healthContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        healthContainer.top = '0px';
        healthContainer.left = '0px';
        statsContainer.addControl(healthContainer);

        const healthText = new TextBlock('healthText');
        healthText.text = `❤ 100`;  // Using heart emoji
        healthText.color = 'white';
        healthText.fontSize = 22;
        healthText.fontFamily = 'Arial';
        healthText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthText.left = '10px';
        healthText.outlineWidth = 1;
        healthText.outlineColor = 'black';
        healthText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthContainer.addControl(healthText);

        // Money display with coin emoji
        const moneyContainer = new Rectangle('moneyContainer');
        moneyContainer.width = '190px'; // Slightly less than parent
        moneyContainer.height = '40px';
        moneyContainer.background = 'transparent';
        moneyContainer.thickness = 0;
        moneyContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        moneyContainer.top = '40px'; // Reduced spacing between items
        moneyContainer.left = '0px';
        statsContainer.addControl(moneyContainer);

        const moneyText = new TextBlock('moneyText');
        moneyText.text = `💰 100`;  // Using money bag emoji
        moneyText.color = 'white';
        moneyText.fontSize = 22;
        moneyText.fontFamily = 'Arial';
        moneyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyText.left = '10px';
        moneyText.outlineWidth = 1;
        moneyText.outlineColor = 'black';
        moneyText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyContainer.addControl(moneyText);

        // Wave display with wave emoji
        const waveContainer = new Rectangle('waveContainer');
        waveContainer.width = '190px'; // Slightly less than parent
        waveContainer.height = '40px'; // Reduced height for single line
        waveContainer.background = 'transparent';
        waveContainer.thickness = 0;
        waveContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveContainer.top = '80px'; // Return to original spacing
        waveContainer.left = '0px';
        statsContainer.addControl(waveContainer);

        const waveText = new TextBlock('waveText');
        waveText.text = `🌊 1`;  // Using wave emoji
        waveText.color = 'white';
        waveText.fontSize = 22;
        waveText.fontFamily = 'Arial';
        waveText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveText.left = '10px';
        waveText.outlineWidth = 1;
        waveText.outlineColor = 'black';
        waveText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveContainer.addControl(waveText);
        
        // Add camera controls help text
        const cameraHelpContainer = new Rectangle('cameraHelpContainer');
        cameraHelpContainer.width = '300px';
        cameraHelpContainer.height = '100px';
        cameraHelpContainer.background = 'rgba(0,0,0,0.5)';
        cameraHelpContainer.cornerRadius = 5;
        cameraHelpContainer.thickness = 0;
        cameraHelpContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        cameraHelpContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        cameraHelpContainer.left = '-20px';
        cameraHelpContainer.top = '70px';
        cameraHelpContainer.alpha = 0.7;
        this.ui.addControl(cameraHelpContainer);

        const cameraHelpText = new TextBlock('cameraHelpText');
        
        // Detect if we're on a mobile device for appropriate help text
        if (this.isMobileDevice()) {
            cameraHelpText.text = `👆 Use one finger to rotate camera\n✌️ Pinch to zoom in/out\n🎮 Use control pad to move map`;
        } else {
            cameraHelpText.text = `⌨️ Hold Shift key for camera controls\n🖱 Shift+Mouse drag to rotate/move\n⚙ Shift+Mouse wheel to zoom\n⌨️ Shift+WASD/Arrows keys also work`;
        }
        
        cameraHelpText.color = 'white';
        cameraHelpText.fontSize = 12;
        cameraHelpText.fontFamily = 'Arial';
        cameraHelpText.outlineWidth = 1;
        cameraHelpText.outlineColor = 'black';
        cameraHelpContainer.addControl(cameraHelpText);

        // Add show/hide button for camera help
        const toggleHelpButton = Button.CreateSimpleButton('toggleHelpButton', 'ℹ');  // Using info emoji
        toggleHelpButton.width = '40px';
        toggleHelpButton.height = '40px';
        toggleHelpButton.color = 'white';
        toggleHelpButton.background = '#2196F3';
        toggleHelpButton.cornerRadius = 20;
        toggleHelpButton.thickness = 2;
        toggleHelpButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        toggleHelpButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        toggleHelpButton.top = '60px';
        toggleHelpButton.left = '-20px';
        toggleHelpButton.zIndex = 100;
        toggleHelpButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        toggleHelpButton.shadowBlur = 5;
        toggleHelpButton.shadowOffsetY = 2;
        
        // Add hover effect for help button
        toggleHelpButton.onPointerEnterObservable.add(() => {
            toggleHelpButton.background = '#0b7dda';
            toggleHelpButton.shadowOffsetY = 4;
        });
        
        toggleHelpButton.onPointerOutObservable.add(() => {
            toggleHelpButton.background = '#2196F3';
            toggleHelpButton.shadowOffsetY = 2;
        });
        
        this.ui.addControl(toggleHelpButton);

        // Initially hide the help text
        cameraHelpContainer.isVisible = false;

        // Toggle visibility on click
        toggleHelpButton.onPointerClickObservable.add(() => {
            cameraHelpContainer.isVisible = !cameraHelpContainer.isVisible;
        });

        // Add pause/resume toggle button to the top right
        const pauseButton = Button.CreateSimpleButton('pauseButton', '⏸');  // Using pause icon
        pauseButton.width = '40px';
        pauseButton.height = '40px';
        pauseButton.color = 'white';
        pauseButton.background = '#2196F3';
        pauseButton.cornerRadius = 20;
        pauseButton.thickness = 2;
        pauseButton.fontFamily = 'Arial';  // Removed FontAwesome
        pauseButton.fontSize = 20;
        pauseButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        pauseButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        pauseButton.top = '10px';
        pauseButton.left = '-20px';
        pauseButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        pauseButton.shadowBlur = 5;
        pauseButton.shadowOffsetY = 2;
        pauseButton.zIndex = 100;
        
        // Add hover effect
        pauseButton.onPointerEnterObservable.add(() => {
            pauseButton.background = '#0b7dda';
            pauseButton.shadowOffsetY = 4;
        });
        
        pauseButton.onPointerOutObservable.add(() => {
            pauseButton.background = '#2196F3';
            pauseButton.shadowOffsetY = 2;
        });
        
        // Add click handler
        pauseButton.onPointerClickObservable.add(() => {
            console.log('Pause/Resume button clicked');
            this.game.togglePause();
        });
        
        this.ui.addControl(pauseButton);

        // Register button to update its state when the game pauses/resumes
        this.registerPauseButtonUpdate(pauseButton);

        // Create wave button in top right
        const waveButton = Button.CreateSimpleButton('waveButton', '+');  // Using plus sign
        waveButton.width = '40px';
        waveButton.height = '40px';
        waveButton.color = 'white';
        waveButton.background = '#D32F2F';
        waveButton.cornerRadius = 20;
        waveButton.thickness = 2;
        waveButton.fontFamily = 'Arial';  // Removed FontAwesome
        waveButton.fontSize = 20;
        waveButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        waveButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveButton.top = '110px';
        waveButton.left = '-20px';
        waveButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        waveButton.shadowBlur = 5;
        waveButton.shadowOffsetY = 2;
        waveButton.zIndex = 100;

        // Add hover effect for wave button
        waveButton.onPointerEnterObservable.add(() => {
            waveButton.background = '#F44336';
            waveButton.shadowOffsetY = 4;
        });

        waveButton.onPointerOutObservable.add(() => {
            waveButton.background = '#D32F2F';
            waveButton.shadowOffsetY = 2;
        });

        waveButton.onPointerUpObservable.add(() => {
            if (this.waveManager) {
                if (this.waveManager.isWaveInProgress()) {
                    const currentWave = this.waveManager.getCurrentWave();
                    const enemies = [];
                    
                    enemies.push({ type: 'basic', count: 5 + Math.floor(currentWave / 2), delay: 1.0 });
                    
                    if (currentWave > 2) {
                        enemies.push({ type: 'fast', count: 3 + Math.floor((currentWave - 2) / 2), delay: 0.8 });
                    }
                    
                    if (currentWave > 4) {
                        enemies.push({ type: 'tank', count: 1 + Math.floor((currentWave - 4) / 3), delay: 2.0 });
                    }
                    
                    if (currentWave % 10 === 0 && currentWave > 0) {
                        enemies.push({ type: 'boss', count: 1, delay: 0 });
                    }
                    
                    const reward = 25 + currentWave * 10;
                    
                    this.waveManager.incrementWaveCounter();
                    
                    this.waveManager.createParallelWave(enemies, reward);
                    
                    console.log(`Created parallel wave with ${enemies.length} enemy types as wave ${this.waveManager.getCurrentWave()}`);
                } else {
                    this.waveManager.startNextWave();
                }
            }
        });
        this.ui.addControl(waveButton);

        // Register wave button to update its state
        this.registerWaveButtonUpdate(waveButton);
    }

    private createResponsiveTowerButton(id: string, name: string, cost: string, color: string, width: string, left: string, parent: Rectangle, hidden: boolean = false): void {
        const button = new Rectangle(id);
        button.width = width;
        button.height = '40px';
        button.background = color;
        button.cornerRadius = 4;
        button.thickness = 2;
        button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        button.left = left;
        button.isVisible = !hidden;
        button.isPointerBlocker = true;
        button.shadowColor = "rgba(0, 0, 0, 0.4)";
        button.shadowBlur = 5;
        button.shadowOffsetY = 2;
        
        // Create a container for the text to ensure proper alignment
        const textContainer = new Rectangle(`${id}_textContainer`);
        textContainer.width = '100%';
        textContainer.height = '100%';
        textContainer.thickness = 0;
        textContainer.background = 'transparent';
        button.addControl(textContainer);
        
        // Name text at the top
        const nameText = new TextBlock(`${id}_name`);
        nameText.text = name;
        nameText.color = 'white';
        nameText.fontSize = 13;
        nameText.fontFamily = 'Arial';
        nameText.fontWeight = 'bold';
        nameText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        nameText.top = '4px';
        nameText.outlineWidth = 1;
        nameText.outlineColor = 'black';
        textContainer.addControl(nameText);
        
        // Cost text at the bottom
        const costText = new TextBlock(`${id}_cost`);
        costText.text = cost;
        costText.color = 'white';
        costText.fontSize = 13;
        costText.fontFamily = 'Arial';
        costText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        costText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        costText.top = '-4px';
        costText.outlineWidth = 1;
        costText.outlineColor = 'black';
        textContainer.addControl(costText);
        
        button.onPointerEnterObservable.add(() => {
            button.alpha = 0.8;
            button.thickness = 3;
            button.shadowOffsetY = 4;
        });
        
        button.onPointerOutObservable.add(() => {
            button.alpha = 1;
            button.thickness = 2;
            button.shadowOffsetY = 2;
        });
        
        button.onPointerDownObservable.add(() => {
            button.alpha = 0.6;
        });
        
        button.onPointerUpObservable.add(() => {
            button.alpha = 0.8;
            this.selectTowerType(id);
        });
        
        parent.addControl(button);
    }

    private updateUI(): void {
        if (!this.ui || !this.playerStats || !this.waveManager) return;

        // Get references to UI elements
        const healthText = this.ui.getControlByName('healthText') as TextBlock;
        const moneyText = this.ui.getControlByName('moneyText') as TextBlock;
        const waveText = this.ui.getControlByName('waveText') as TextBlock;

        if (!healthText || !moneyText || !waveText) return;

        // Update health display with hearts
        const health = this.playerStats.getHealth();
        healthText.text = `❤ ${health}`;
        
        // Change color based on health
        if (health <= 25) {
            healthText.color = 'red';
        } else if (health <= 50) {
            healthText.color = 'orange';
        } else {
            healthText.color = 'white';
        }

        // Update money display with coins
        moneyText.text = `💰 ${this.playerStats.getMoney()}`;

        // Update wave display - simplified
        const currentWave = this.waveManager.getCurrentWave();
        let waveDisplay = `🌊 ${currentWave}`;
        
        // Add milestone indicator for milestone waves
        if (this.waveManager.isMilestoneWave()) {
            waveDisplay += " 🔥🔥";
        }
        
        // Show the effective difficulty
        const difficulty = this.waveManager.getDifficultyMultiplier().toFixed(1);
        waveDisplay += ` (×${difficulty})`;
        
        // Show a boss icon for boss waves
        if (this.waveManager.isBossWave()) {
            waveDisplay += " 👑";
        }
        
        waveText.text = waveDisplay;
    }
    
    /**
     * Get a color based on difficulty level
     * @param difficulty The current difficulty
     * @returns A color string in hex format
     */
    private getDifficultyColor(difficulty: number): string {
        // Start at yellow (1.0) and go to red (10.0)
        const normalizedDifficulty = Math.min((difficulty - 1) / 9, 1);
        
        // Calculate RGB values
        const red = 255; // Always full red
        const green = Math.floor(255 * (1 - normalizedDifficulty * 0.8)); // Decrease green component
        
        // Convert to hex
        const redHex = red.toString(16).padStart(2, '0');
        const greenHex = green.toString(16).padStart(2, '0');
        
        return `#${redHex}${greenHex}00`;
    }

    private setupInputHandling(): void {
        this.scene = this.game.getScene();
        if (!this.scene) return;
        
        this.scene.onPointerDown = (evt) => {
            if (evt.button !== 0 || !this.scene) return;
            
            // Check if we're clicking on UI elements
            const pickInfo = this.scene.pick(
                this.scene.pointerX, 
                this.scene.pointerY
            );
            
            // Don't process clicks on GUI elements
            if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                return;
            }
            
            // If we have an open tower selector, check if the click is outside it
            // and close it if so
            if (this.towerSelectorPanel) {
                // First hide the tower selector to handle "clicking outside"
                this.hideTowerSelector();
                this.hidePlacementOutline();
                return; // Return here to prevent immediate selection on the next click
            }
            
            // We'll detect clicks outside of towers and handle UI cleanup below

            // First check if we're clicking on a tower
            const pickResult = this.scene.pick(
                this.scene.pointerX, 
                this.scene.pointerY,
                (mesh) => {
                    // Only pick meshes that aren't UI or range indicators
                    return !mesh.name.includes('GUI') && 
                           !mesh.name.includes('rangeIndicator') &&
                           !mesh.name.includes('rangeRing');
                }
            );
            
            if (pickResult.hit && pickResult.pickedMesh) {
                const clickedTower = this.findTowerByMesh(pickResult.pickedMesh);
                
                if (clickedTower) {
                    // If we already have this tower selected, do nothing (allows clicking range indicator)
                    if (this.selectedTower === clickedTower) {
                        return;
                    }
                    
                    // Otherwise, select the new tower
                    this.selectTower(clickedTower);
                    // Hide any existing placement UI when selecting a tower
                    this.hidePlacementOutline();
                    this.hideTowerSelector();
                    return;
                }
            }
            
            // If click wasn't on a tower, deselect any selected tower
            if (this.selectedTower) {
                this.deselectTower();
            }

            // If we're not clicking on a tower, check if we're clicking on the ground
            const groundPickResult = this.scene.pick(
                this.scene.pointerX, 
                this.scene.pointerY,
                (mesh) => {
                    return mesh.name.startsWith('ground_');
                }
            );
            
            if (groundPickResult.hit && groundPickResult.pickedPoint) {
                const position = groundPickResult.pickedPoint;
                if (this.map) {
                    const gridPosition = this.map.worldToGrid(position);
                    if (this.map.canPlaceTower(gridPosition.x, gridPosition.y)) {
                        // Hide any existing placement UI before showing new ones
                        this.hidePlacementOutline();
                        this.hideTowerSelector();
                        
                        // Store the selected position and show tower selector
                        this.selectedPosition = position;
                        this.showPlacementOutline(position);
                        this.showTowerSelector();
                    }
                }
            } else {
                this.deselectTower();
                this.hidePlacementOutline();
                this.hideTowerSelector();
            }
        };
        
        this.scene.onPointerMove = (evt) => {
            if (this.selectedTowerType && this.towerPreview && this.scene) {
                const pickInfo = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY
                );
                
                if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                    return;
                }
                
                const pickResult = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY,
                    (mesh) => {
                        return mesh.name.startsWith('ground_');
                    }
                );
                
                if (pickResult.hit && pickResult.pickedPoint) {
                    this.updateTowerPreview(pickResult.pickedPoint);
                }
            }
        };
        
        this.scene.onKeyboardObservable.add((kbInfo) => {
            switch (kbInfo.type) {
                case KeyboardEventTypes.KEYDOWN:
                    // Check if Escape is pressed to cancel tower placement
                    if (kbInfo.event.key === 'Escape') {
                        if (this.selectedTowerType) {
                            this.cancelTowerPlacement();
                        }
                        return;
                    }
                    
                    // Check if Shift key is pressed for camera controls
                    const isShiftPressed = kbInfo.event.shiftKey;
                    
                    if (isShiftPressed) {
                        // Camera movement with Shift+WASD
                        switch (kbInfo.event.key) {
                            case 'w':
                            case 'W':
                                this.moveCamera(0, 0, 1); // Move forward
                                break;
                            case 's':
                            case 'S':
                                this.moveCamera(0, 0, -1); // Move backward
                                break;
                            case 'a':
                            case 'A':
                                this.moveCamera(-1, 0, 0); // Move left
                                break;
                            case 'd':
                            case 'D':
                                this.moveCamera(1, 0, 0); // Move right
                                break;
                                
                            // Camera zoom with Shift+E/Q
                            case 'e':
                            case 'E':
                                this.zoomCamera(-1); // Zoom in
                                break;
                            case 'q':
                            case 'Q':
                                this.zoomCamera(1); // Zoom out
                                break;
                                
                            // Camera rotation with Shift+Arrow keys
                            case 'ArrowLeft':
                                this.rotateCamera(-1, 0); // Rotate left
                                break;
                            case 'ArrowRight':
                                this.rotateCamera(1, 0); // Rotate right
                                break;
                            case 'ArrowUp':
                                this.rotateCamera(0, -1); // Rotate up
                                break;
                            case 'ArrowDown':
                                this.rotateCamera(0, 1); // Rotate down
                                break;
                        }
                    }
                    break;
            }
        });
    }

    private selectTowerType(type: string): void {
        this.selectedTowerType = type;
        console.log(`Selected tower type: ${type}`);
        
        if (!this.towerPreview) {
            this.createTowerPreview();
        } else {
            this.towerPreview.setEnabled(true);
        }
        
        if (!this.squareOutline) {
            this.createSquareOutline();
        } else {
            this.squareOutline.setEnabled(true);
        }
        
        if (this.scene && this.scene.activeCamera) {
            const ray = this.scene.createPickingRay(
                this.scene.pointerX,
                this.scene.pointerY,
                Matrix.Identity(),
                this.scene.activeCamera
            );
            
            const groundPlane = new Vector3(0, 1, 0);
            const planeOrigin = new Vector3(0, 0, 0);
            
            const distance = ray.direction.dot(groundPlane);
            
            if (Math.abs(distance) > 0.0001) {
                const t = (planeOrigin.subtract(ray.origin).dot(groundPlane)) / distance;
                
                if (t >= 0) {
                    const intersectionPoint = ray.origin.add(ray.direction.scale(t));
                    this.updateTowerPreview(intersectionPoint);
                }
            }
        }
    }

    private createTowerPreview(): void {
        this.towerPreview = MeshBuilder.CreateCylinder('towerPreview', {
            height: 2,
            diameter: 1.5
        }, this.game.getScene());
        
        const material = new StandardMaterial('towerPreviewMaterial', this.game.getScene());
        material.diffuseColor = new Color3(0, 1, 0);
        material.alpha = 0.5;
        this.towerPreview.material = material;
        
        this.towerPreview.setEnabled(false);
    }

    private createSquareOutline(): void {
        const size = 2.2;
        const y = 0.1;
        const lineThickness = 0.05;
        
        const corners = [
            new Vector3(-size/2, y, -size/2),
            new Vector3(size/2, y, -size/2),
            new Vector3(size/2, y, size/2),
            new Vector3(-size/2, y, size/2),
            new Vector3(-size/2, y, -size/2)
        ];
        
        this.squareOutline = MeshBuilder.CreateLines('squareOutline', {
            points: corners,
            updatable: true
        }, this.game.getScene());
        
        this.squareOutline.color = new Color3(1, 1, 0);
        
        this.squareOutline.enableEdgesRendering();
        this.squareOutline.edgesWidth = 10.0;
        
        this.squareOutline.setEnabled(false);
    }

    private updateTowerPreview(position: Vector3): void {
        if (!this.towerPreview || !this.map) return;
        
        this.towerPreview.setEnabled(true);
        
        const gridPosition = this.map.worldToGrid(position);
        
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        this.towerPreview.position = new Vector3(worldPosition.x, 1, worldPosition.z);
        
        if (!this.squareOutline) {
            this.createSquareOutline();
        }
        
        if (this.squareOutline) {
            this.squareOutline.setEnabled(true);
            this.squareOutline.position = new Vector3(worldPosition.x, 0.1, worldPosition.z);
            
            const canPlace = this.map.canPlaceTower(gridPosition.x, gridPosition.y);
            
            const material = this.towerPreview.material as StandardMaterial;
            if (canPlace) {
                material.diffuseColor = new Color3(0, 1, 0);
                this.squareOutline.color = new Color3(0, 1, 0);
                material.alpha = 0.6;
            } else {
                material.diffuseColor = new Color3(1, 0, 0);
                this.squareOutline.color = new Color3(1, 0, 0);
                material.alpha = 0.6;
            }
            
            console.log(`Tower preview at grid position (${gridPosition.x}, ${gridPosition.y}), can place: ${canPlace}`);
        }
    }

    private showConfirmationButtons(position: Vector3): void {
        if (!this.ui || !this.map) return;
        
        if (this.towerPreview) {
            const material = this.towerPreview.material as StandardMaterial;
            material.alpha = 0.3;
        }
        
        this.confirmationButtons.position = position.clone();
        
        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        const container = new Rectangle('confirmationContainer');
        container.width = '300px';
        container.height = '120px';
        container.background = '#333333';
        container.alpha = 0.9;
        container.thickness = 1;
        container.cornerRadius = 10;
        container.color = "white";
        container.zIndex = 10;
        
        container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        container.top = "80px";
        
        const towerTypeText = new TextBlock('towerTypeText');
        towerTypeText.text = `${this.selectedTowerType?.replace('Tower', '')} Tower`;
        towerTypeText.color = 'white';
        towerTypeText.fontSize = 16;
        towerTypeText.fontFamily = 'Arial';
        towerTypeText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        towerTypeText.top = "-40px";
        container.addControl(towerTypeText);
        
        const buttonPanel = new Rectangle("buttonPanel");
        buttonPanel.width = "280px";
        buttonPanel.height = "60px";
        buttonPanel.thickness = 0;
        buttonPanel.background = "transparent";
        buttonPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        buttonPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        buttonPanel.top = "-10px";
        container.addControl(buttonPanel);
        
        const confirmButton = Button.CreateSimpleButton('confirmButton', '✓ Confirm');
        confirmButton.width = '130px';
        confirmButton.height = '50px';
        confirmButton.color = 'white';
        confirmButton.background = '#4CAF50';
        confirmButton.cornerRadius = 25;
        confirmButton.thickness = 2;
        confirmButton.fontFamily = 'Arial';
        confirmButton.fontSize = 18;
        confirmButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        confirmButton.isPointerBlocker = true;
        confirmButton.paddingLeft = '15px';
        confirmButton.paddingRight = '15px';
        confirmButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        confirmButton.shadowBlur = 5;
        confirmButton.shadowOffsetY = 2;
        
        confirmButton.onPointerClickObservable.add(() => {
            console.log("Confirm button clicked");
            this.confirmTowerPlacement();
        });
        
        confirmButton.onPointerUpObservable.add(() => {
            console.log("Confirm button up");
            this.confirmTowerPlacement();
        });
        
        buttonPanel.addControl(confirmButton);
        
        const cancelButton = Button.CreateSimpleButton('cancelButton', '✗ Cancel');
        cancelButton.width = '130px';
        cancelButton.height = '50px';
        cancelButton.color = 'white';
        cancelButton.background = '#F44336';
        cancelButton.cornerRadius = 25;
        cancelButton.thickness = 2;
        cancelButton.fontFamily = 'Arial';
        cancelButton.fontSize = 18;
        cancelButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        cancelButton.isPointerBlocker = true;
        cancelButton.paddingLeft = '15px';
        cancelButton.paddingRight = '15px';
        cancelButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        cancelButton.shadowBlur = 5;
        cancelButton.shadowOffsetY = 2;
        
        cancelButton.onPointerClickObservable.add(() => {
            console.log("Cancel button clicked");
            this.cancelTowerPlacement();
        });
        
        cancelButton.onPointerUpObservable.add(() => {
            console.log("Cancel button up");
            this.cancelTowerPlacement();
        });
        
        buttonPanel.addControl(cancelButton);
        
        this.ui.addControl(container);
        this.confirmationButtons.container = container;
        
        container.isPointerBlocker = true;
        
        console.log(`Showing confirmation buttons for ${this.selectedTowerType} at grid position (${gridPosition.x}, ${gridPosition.y})`);
    }

    private hideConfirmationButtons(): void {
        if (this.confirmationButtons.container && this.ui) {
            this.ui.removeControl(this.confirmationButtons.container);
            this.confirmationButtons.container = null;
            this.confirmationButtons.position = null;
        }
        
        this.placementState = 'selecting';
    }

    private confirmTowerPlacement(): void {
        if (!this.map || !this.towerManager || !this.playerStats || !this.selectedTowerType || !this.confirmationButtons.position) {
            this.hideConfirmationButtons();
            return;
        }
        
        const position = this.confirmationButtons.position;
        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        const towerCost = this.getTowerCost(this.selectedTowerType);
        if (this.playerStats.getMoney() >= towerCost) {
            this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);
            
            this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);
            
            this.game.getAssetManager().playSound('towerShoot');
            
            console.log(`Tower placed at grid position (${gridPosition.x}, ${gridPosition.y})`);
        } else {
            console.log(`Not enough money to place tower. Need ${towerCost}, have ${this.playerStats.getMoney()}`);
        }
        
        this.hideConfirmationButtons();
        
        this.placementState = 'selecting';
        
        if (this.towerPreview) {
            this.towerPreview.setEnabled(true);
            const material = this.towerPreview.material as StandardMaterial;
            material.alpha = 0.5;
        }
        if (this.squareOutline) {
            this.squareOutline.setEnabled(true);
        }
    }

    private cancelTowerPlacement(): void {
        this.selectedTowerType = null;
        this.selectedPosition = null;
        
        if (this.towerPreview) {
            this.towerPreview.setEnabled(false);
        }
        if (this.squareOutline) {
            this.squareOutline.setEnabled(false);
        }
        
        this.hideTowerSelector();
        this.hidePlacementOutline();
        
        console.log('Tower placement cancelled');
    }

    private getTowerCost(type: string): number {
        switch (type) {
            case 'basicTower': return 50;
            case 'fastTower': return 100;
            case 'heavyTower': return 150;
            case 'sniperTower': return 200;
            case 'fireTower': return 125;
            case 'waterTower': return 125;
            case 'windTower': return 125;
            case 'earthTower': return 125;
            case 'steamTower': return 250;
            case 'lavaTower': return 250;
            case 'iceTower': return 250;
            case 'stormTower': return 250;
            case 'mudTower': return 250;
            case 'dustTower': return 250;
            default: return 0;
        }
    }

    private togglePause(): void {
        this.isPaused = !this.isPaused;
        console.log(`Game ${this.isPaused ? 'paused' : 'resumed'}`);
    }

    private createHorizontalTowerButton(id: string, name: string, cost: string, color: string, left: number, parent: Rectangle, hidden: boolean = false): void {
        const button = new Rectangle(id);
        button.width = '130px';
        button.height = '40px';
        button.background = color;
        button.cornerRadius = 4;
        button.thickness = 2;
        button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        button.left = `${left}px`;
        button.isVisible = !hidden;
        button.isPointerBlocker = true;
        button.shadowColor = "rgba(0, 0, 0, 0.4)";
        button.shadowBlur = 5;
        button.shadowOffsetY = 2;
        
        // Create a container for the text to ensure proper alignment
        const textContainer = new Rectangle(`${id}_textContainer`);
        textContainer.width = '100%';
        textContainer.height = '100%';
        textContainer.thickness = 0;
        textContainer.background = 'transparent';
        button.addControl(textContainer);
        
        // Name text at the top
        const nameText = new TextBlock(`${id}_name`);
        nameText.text = name;
        nameText.color = 'white';
        nameText.fontSize = 13;
        nameText.fontFamily = 'Arial';
        nameText.fontWeight = 'bold';
        nameText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        nameText.top = '4px';
        nameText.outlineWidth = 1;
        nameText.outlineColor = 'black';
        textContainer.addControl(nameText);
        
        // Cost text at the bottom
        const costText = new TextBlock(`${id}_cost`);
        costText.text = cost;
        costText.color = 'white';
        costText.fontSize = 13;
        costText.fontFamily = 'Arial';
        costText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        costText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        costText.top = '-4px';
        costText.outlineWidth = 1;
        costText.outlineColor = 'black';
        textContainer.addControl(costText);
        
        button.onPointerEnterObservable.add(() => {
            button.alpha = 0.8;
            button.thickness = 3;
            button.shadowOffsetY = 4;
        });
        
        button.onPointerOutObservable.add(() => {
            button.alpha = 1;
            button.thickness = 2;
            button.shadowOffsetY = 2;
        });
        
        button.onPointerDownObservable.add(() => {
            button.alpha = 0.6;
        });
        
        button.onPointerUpObservable.add(() => {
            button.alpha = 0.8;
            this.selectTowerType(id);
        });
        
        parent.addControl(button);
    }

    private switchTowerCategory(category: 'basic' | 'elemental'): void {
        if (!this.ui) return;
        
        const basicTowers = ['basicTower', 'fastTower', 'heavyTower', 'sniperTower'];
        const elementalTowers = ['fireTower', 'waterTower', 'windTower', 'earthTower'];
        
        // Immediately update tab appearances
        const basicTab = this.ui.getControlByName('basicTab') as Button;
        const elementalTab = this.ui.getControlByName('elementalTab') as Button;
        
        if (basicTab && elementalTab) {
            if (category === 'basic') {
                basicTab.background = '#4CAF50';
                elementalTab.background = '#333333';
            } else {
                basicTab.background = '#333333';
                elementalTab.background = '#555555';
            }
        }
        
        // Handle tower visibility with a slight animation
        for (const type of basicTowers) {
            const button = this.ui.getControlByName(type);
            if (button) {
                if (category === 'basic') {
                    button.isVisible = true;
                    button.alpha = 0;
                    setTimeout(() => {
                        button.alpha = 1;
                    }, 50);
                } else {
                    button.alpha = 0;
                    setTimeout(() => {
                        button.isVisible = false;
                    }, 200);
                }
            }
        }
        
        for (const type of elementalTowers) {
            const button = this.ui.getControlByName(type);
            if (button) {
                if (category === 'elemental') {
                    button.isVisible = true;
                    button.alpha = 0;
                    setTimeout(() => {
                        button.alpha = 1;
                    }, 50);
                } else {
                    button.alpha = 0;
                    setTimeout(() => {
                        button.isVisible = false;
                    }, 200);
                }
            }
        }
    }

    private findTowerByMesh(mesh: AbstractMesh): Tower | null {
        if (!this.towerManager) return null;
        
        const towers = this.towerManager.getTowers();
        
        for (const tower of towers) {
            const towerMesh = tower.getMesh();
            if (towerMesh && (towerMesh === mesh || this.isMeshChildOf(mesh, towerMesh))) {
                return tower;
            }
        }
        
        return null;
    }
    
    private isMeshChildOf(child: AbstractMesh, parent: Mesh): boolean {
        if (!parent) return false;
        
        let current = child.parent;
        while (current) {
            if (current === parent) {
                return true;
            }
            current = current.parent;
        }
        
        return false;
    }
    
    private selectTower(tower: Tower): void {
        this.deselectTower();
        
        this.selectedTower = tower;
        tower.select();
        
        this.showTowerActions();
    }
    
    private deselectTower(): void {
        if (this.selectedTower) {
            this.selectedTower.deselect();
            this.selectedTower = null;
        }
        
        this.hideTowerActions();
    }
    
    private showTowerActions(): void {
        if (!this.ui || !this.selectedTower) return;
        
        if (!this.towerInfoPanel) {
            // Create medieval-styled tower info panel with larger size
            this.towerInfoPanel = new Rectangle('towerInfoPanel');
            this.towerInfoPanel.width = "260px";  // Wider to fit more info
            this.towerInfoPanel.height = "250px"; // Taller to fit more info
            this.towerInfoPanel.cornerRadius = 8;
            this.towerInfoPanel.color = "#5D4037"; // Brown border for medieval style
            this.towerInfoPanel.thickness = 3;
            this.towerInfoPanel.background = "#3E2723"; // Dark brown background
            this.towerInfoPanel.alpha = 0.95;
            this.towerInfoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.towerInfoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.towerInfoPanel.top = "-160px";
            this.towerInfoPanel.left = "-10px";
            this.towerInfoPanel.shadowColor = "rgba(0, 0, 0, 0.7)";
            this.towerInfoPanel.shadowBlur = 10;
            this.towerInfoPanel.shadowOffsetY = 3;
            this.ui.addControl(this.towerInfoPanel);
            
            // Create header with scroll-like appearance
            const headerBg = new Rectangle('headerBg');
            headerBg.width = "100%";
            headerBg.height = "40px";
            headerBg.background = "#8D6E63"; // Lighter brown
            headerBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            headerBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            headerBg.cornerRadius = 8;
            this.towerInfoPanel.addControl(headerBg);
            
            const titleBlock = new TextBlock('towerInfoTitle', 'Tower Information');
            titleBlock.color = "#FFEBEE"; // Off-white for parchment feel
            titleBlock.fontSize = 18;
            titleBlock.fontStyle = "bold";
            titleBlock.height = "40px";
            titleBlock.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            titleBlock.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            titleBlock.top = "10px";
            this.towerInfoPanel.addControl(titleBlock);
            
            // Create tower stats grid (name: value)
            const statsGrid = new Grid('statsGrid');
            statsGrid.addColumnDefinition(0.5); // Labels
            statsGrid.addColumnDefinition(0.5); // Values
            statsGrid.addRowDefinition(0.2); // Type
            statsGrid.addRowDefinition(0.2); // Level
            statsGrid.addRowDefinition(0.2); // Damage
            statsGrid.addRowDefinition(0.2); // Range
            statsGrid.addRowDefinition(0.2); // Rate
            statsGrid.width = "90%";
            statsGrid.height = "120px";
            statsGrid.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            statsGrid.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            statsGrid.top = "50px";
            this.towerInfoPanel.addControl(statsGrid);
            
            // Add labels
            const createLabel = (text: string, row: number) => {
                const label = new TextBlock(`${text}Label`, text + ":");
                label.color = "#D7CCC8"; // Light tan
                label.fontSize = 14;
                label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
                label.paddingRight = "10px";
                statsGrid.addControl(label, row, 0);
                return label;
            };
            
            createLabel("Type", 0);
            createLabel("Level", 1);
            createLabel("Damage", 2);
            createLabel("Range", 3);
            createLabel("Fire Rate", 4);
            
            // Add value fields (will be updated with each tower selection)
            const createValue = (id: string, row: number) => {
                const value = new TextBlock(id, "-");
                value.color = "#FFECB3"; // Gold-ish color for values
                value.fontSize = 14;
                value.fontStyle = "bold";
                value.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                statsGrid.addControl(value, row, 1);
                return value;
            };
            
            this.towerTypeText = createValue("typeValue", 0);
            this.towerLevelText = createValue("levelValue", 1);
            this.towerDamageText = createValue("damageValue", 2);
            this.towerRangeText = createValue("rangeValue", 3);
            this.towerRateText = createValue("rateValue", 4);
            
            // Create divider
            const divider = new Rectangle('divider');
            divider.width = "90%";
            divider.height = "2px";
            divider.background = "#8D6E63"; // Light brown
            divider.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            divider.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            divider.top = "175px";
            this.towerInfoPanel.addControl(divider);
            
            this.sellButton = new Rectangle('sellButton');
            this.sellButton.width = "110px";
            this.sellButton.height = "40px";
            this.sellButton.cornerRadius = 4;
            this.sellButton.color = "#D50000"; // Darker red border
            this.sellButton.thickness = 2;
            this.sellButton.background = "#B71C1C"; // Deep red background
            this.sellButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            this.sellButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.sellButton.top = "-15px";
            this.sellButton.left = "15px";
            this.sellButton.isPointerBlocker = true;
            this.sellButton.shadowColor = "rgba(0, 0, 0, 0.4)";
            this.sellButton.shadowBlur = 5;
            this.sellButton.shadowOffsetY = 2;
            
            // Add wooden texture pattern to button
            const sellPattern = new Rectangle('sellPattern');
            sellPattern.width = "100%";
            sellPattern.height = "100%";
            sellPattern.background = "#C62828"; // Slightly lighter red
            sellPattern.alpha = 0.4;
            sellPattern.zIndex = -1;
            this.sellButton.addControl(sellPattern);
            
            const sellText = new TextBlock('sellText', 'SELL');
            sellText.color = "#FFD700"; // Gold text for medieval feel
            sellText.fontSize = 16;
            sellText.fontStyle = "bold";
            sellText.top = "-8px";
            this.sellButton.addControl(sellText);
            
            const sellValueText = new TextBlock('sellValueText', '');
            sellValueText.color = "#FFFDE7"; // Off-white
            sellValueText.fontSize = 14;
            sellValueText.top = "12px";
            this.sellButton.addControl(sellValueText);
            
            this.sellButton.onPointerEnterObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#D32F2F"; // Brighter red
                    this.sellButton.thickness = 3;
                    this.sellButton.shadowOffsetY = 4; // Raise shadow on hover
                }
            });
            
            this.sellButton.onPointerOutObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#B71C1C";
                    this.sellButton.thickness = 2;
                    this.sellButton.shadowOffsetY = 2;
                }
            });
            
            this.sellButton.onPointerDownObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#991111";
                    this.sellButton.alpha = 0.8;
                }
            });
            
            this.sellButton.onPointerClickObservable.add(() => {
                console.log("Sell button clicked");
                this.sellSelectedTower();
            });
            
            this.sellButton.onPointerUpObservable.add(() => {
                console.log("Sell button up");
                if (this.sellButton) {
                    this.sellButton.background = "#DD3333";
                    this.sellButton.alpha = 1.0;
                }
                this.sellSelectedTower();
            });
            
            this.towerInfoPanel.addControl(this.sellButton);
            
            this.upgradeButton = new Rectangle('upgradeButton');
            this.upgradeButton.width = "110px";
            this.upgradeButton.height = "40px";
            this.upgradeButton.cornerRadius = 4;
            this.upgradeButton.color = "#2E7D32"; // Darker green border
            this.upgradeButton.thickness = 2;
            this.upgradeButton.background = "#1B5E20"; // Deep green background
            this.upgradeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.upgradeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.upgradeButton.top = "-15px";
            this.upgradeButton.left = "-15px";
            this.upgradeButton.isPointerBlocker = true;
            this.upgradeButton.shadowColor = "rgba(0, 0, 0, 0.4)";
            this.upgradeButton.shadowBlur = 5;
            this.upgradeButton.shadowOffsetY = 2;
            
            // Add wooden texture pattern to button
            const upgradePattern = new Rectangle('upgradePattern');
            upgradePattern.width = "100%";
            upgradePattern.height = "100%";
            upgradePattern.background = "#2E7D32"; // Slightly lighter green
            upgradePattern.alpha = 0.4;
            upgradePattern.zIndex = -1;
            this.upgradeButton.addControl(upgradePattern);
            
            const upgradeText = new TextBlock('upgradeText', 'UPGRADE');
            upgradeText.color = "#FFD700"; // Gold text
            upgradeText.fontSize = 16;
            upgradeText.fontStyle = "bold";
            upgradeText.top = "-8px";
            this.upgradeButton.addControl(upgradeText);
            
            const upgradeCostText = new TextBlock('upgradeCostText', '');
            upgradeCostText.color = "#FFFDE7"; // Off-white
            upgradeCostText.fontSize = 14;
            upgradeCostText.top = "12px";
            this.upgradeButton.addControl(upgradeCostText);
            
            this.upgradeButton.onPointerEnterObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower && 
                    this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.background = "#33CC33";
                    this.upgradeButton.thickness = 3;
                }
            });
            
            this.upgradeButton.onPointerOutObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower) {
                    if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                        this.upgradeButton.background = "#22AA22";
                        this.upgradeButton.color = "#44FF44";
                    } else {
                        this.upgradeButton.background = "#555555";
                        this.upgradeButton.color = "#777777";
                    }
                }
            });
            
            this.upgradeButton.onPointerDownObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower && 
                    this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.background = "#119911";
                    this.upgradeButton.alpha = 0.8;
                }
            });
            
            this.upgradeButton.onPointerClickObservable.add(() => {
                console.log("Upgrade button clicked");
                this.upgradeSelectedTower();
            });
            
            this.upgradeButton.onPointerUpObservable.add(() => {
                console.log("Upgrade button up");
                if (this.upgradeButton && this.playerStats && this.selectedTower) {
                    if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                        this.upgradeButton.background = "#33CC33";
                        this.upgradeButton.alpha = 1.0;
                    }
                }
                this.upgradeSelectedTower();
            });
            
            this.towerInfoPanel.addControl(this.upgradeButton);
        } else {
            this.towerInfoPanel.isVisible = true;
        }
        
        // Update tower info panel content based on selected tower
        this.updateTowerInfo();
        
        // Display the panel
        if (this.towerInfoPanel) {
            this.towerInfoPanel.isVisible = true;
        }
    }
    
    /**
     * Update the tower information display
     */
    private updateTowerInfo(): void {
        if (!this.selectedTower || !this.towerTypeText || !this.towerLevelText || 
            !this.towerDamageText || !this.towerRangeText || !this.towerRateText) {
            return;
        }
        
        // Get tower class name (e.g., "BasicTower" -> "Basic")
        let towerType = this.selectedTower.constructor.name;
        towerType = towerType.replace("Tower", "");
        
        // Update tower info text fields
        this.towerTypeText.text = towerType;
        this.towerLevelText.text = `${this.selectedTower.getLevel()}`;
        this.towerDamageText.text = `${this.selectedTower.getDamage().toFixed(1)}`;
        this.towerRangeText.text = `${this.selectedTower.getRange().toFixed(1)}`;
        this.towerRateText.text = `${this.selectedTower.getFireRate().toFixed(1)}/sec`;
        
        // Update sell value
        const sellValueEl = this.sellButton?.getChildByName('sellValueText') as TextBlock;
        if (sellValueEl) {
            sellValueEl.text = `$${this.selectedTower.getSellValue()}`;
        }
        
        // Update upgrade cost
        const upgradeCostEl = this.upgradeButton?.getChildByName('upgradeCostText') as TextBlock;
        if (upgradeCostEl) {
            upgradeCostEl.text = `$${this.selectedTower.getUpgradeCost()}`;
        }
        
        // Check if player can afford upgrade
        if (this.playerStats && this.upgradeButton) {
            if (this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                // Can afford upgrade
                this.upgradeButton.background = "#1B5E20"; // Normal green
                this.upgradeButton.color = "#2E7D32";      // Normal border
                this.upgradeButton.alpha = 1.0;
            } else {
                // Cannot afford upgrade
                this.upgradeButton.background = "#424242"; // Gray out
                this.upgradeButton.color = "#616161";      // Gray border
                this.upgradeButton.alpha = 0.8;
            }
        }
    }
    
    private hideTowerActions(): void {
        if (this.towerInfoPanel) {
            this.towerInfoPanel.isVisible = false;
        }
    }
    
    private sellSelectedTower(): void {
        if (!this.selectedTower || !this.towerManager || !this.playerStats) {
            console.log("Cannot sell tower: missing tower, manager, or player stats");
            return;
        }
        
        console.log("Selling tower...");
        
        try {
            const towerPosition = this.selectedTower.getPosition();
            
            const sellValue = this.selectedTower.getSellValue();
            console.log(`Tower sell value: $${sellValue}`);
            
            this.towerManager.sellTower(this.selectedTower);
            
            this.playerStats.addMoney(sellValue);
            console.log(`Added $${sellValue} to player. New balance: $${this.playerStats.getMoney()}`);
            
            if (this.map && towerPosition) {
                const gridPosition = this.map.worldToGrid(towerPosition);
                this.map.setTowerPlaced(gridPosition.x, gridPosition.y, false);
                console.log(`Freed up grid cell at (${gridPosition.x}, ${gridPosition.y})`);
            }
            
            this.createMoneyEffect(towerPosition);
            
            this.game.getAssetManager().playSound('towerSell');
            
            this.selectedTower = null;
            
            this.hideTowerActions();
        } catch (error) {
            console.error("Error selling tower:", error);
        }
    }
    
    private createMoneyEffect(position: Vector3): void {
        if (!this.scene) return;
        
        const particleSystem = new ParticleSystem('moneyParticles', 20, this.scene);
        
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        particleSystem.emitter = new Vector3(position.x, position.y + 1, position.z);
        particleSystem.minEmitBox = new Vector3(-0.5, 0, -0.5);
        particleSystem.maxEmitBox = new Vector3(0.5, 0.5, 0.5);
        
        particleSystem.color1 = new Color4(1.0, 0.8, 0.0, 1.0);
        particleSystem.color2 = new Color4(0.8, 0.8, 0.0, 1.0);
        particleSystem.colorDead = new Color4(0.5, 0.5, 0.0, 0.0);
        
        particleSystem.minSize = 0.2;
        particleSystem.maxSize = 0.5;
        
        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;
        
        particleSystem.emitRate = 50;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 5, 0);
        
        particleSystem.direction1 = new Vector3(-1, 2, -1);
        particleSystem.direction2 = new Vector3(1, 5, 1);
        
        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;
        
        particleSystem.start();
        
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1500);
        }, 500);
    }
    
    private upgradeSelectedTower(): void {
        if (!this.selectedTower || !this.towerManager || !this.playerStats) {
            console.log("Cannot upgrade tower: missing tower, manager, or player stats");
            return;
        }
        
        const upgradeCost = this.selectedTower.getUpgradeCost();
        if (this.playerStats.getMoney() < upgradeCost) {
            console.log(`Not enough money to upgrade tower. Need $${upgradeCost}, have $${this.playerStats.getMoney()}`);
            
            this.game.getAssetManager().playSound('error');
            
            this.shakeButton(this.upgradeButton);
            
            return;
        }
        
        console.log(`Upgrading tower for $${upgradeCost}...`);
        
        try {
            const towerPosition = this.selectedTower.getPosition();
            const selectedTowerId = this.selectedTower.getId(); // Ensure we have the specific tower ID
            
            if (this.towerManager.upgradeTower(this.selectedTower)) {
                this.playerStats.spendMoney(upgradeCost);
                console.log(`Spent $${upgradeCost}. New balance: $${this.playerStats.getMoney()}`);
                
                this.createUpgradeEffect(towerPosition);
                
                this.game.getAssetManager().playSound('towerUpgrade');
                
                // Make sure we update the UI with the same tower
                const upgradedTower = this.towerManager.getTowerById(selectedTowerId);
                if (upgradedTower) {
                    this.selectedTower = upgradedTower;
                }
                
                this.showTowerActions();
                
                console.log(`Tower upgraded to level ${this.selectedTower.getLevel()}`);
            } else {
                console.log("Tower upgrade failed");
            }
        } catch (error) {
            console.error("Error upgrading tower:", error);
        }
    }
    
    private createUpgradeEffect(position: Vector3): void {
        if (!this.scene) return;
        
        const particleSystem = new ParticleSystem('upgradeParticles', 50, this.scene);
        
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        particleSystem.emitter = new Vector3(position.x, position.y, position.z);
        particleSystem.minEmitBox = new Vector3(-1, 0, -1);
        particleSystem.maxEmitBox = new Vector3(1, 0, 1);
        
        particleSystem.color1 = new Color4(0.0, 1.0, 0.0, 1.0);
        particleSystem.color2 = new Color4(0.5, 1.0, 0.5, 1.0);
        particleSystem.colorDead = new Color4(0.0, 0.5, 0.0, 0.0);
        
        particleSystem.minSize = 0.2;
        particleSystem.maxSize = 0.5;
        
        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;
        
        particleSystem.emitRate = 100;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 8, 0);
        
        particleSystem.direction1 = new Vector3(-2, 5, -2);
        particleSystem.direction2 = new Vector3(2, 10, 2);
        
        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;
        
        particleSystem.start();
        
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1500);
        }, 500);
        
        this.createUpgradeFlash(position);
    }
    
    private createUpgradeFlash(position: Vector3): void {
        if (!this.scene) return;
        
        const flash = MeshBuilder.CreateSphere('upgradeFlash', {
            diameter: 3,
            segments: 16
        }, this.scene);
        
        flash.position = new Vector3(position.x, position.y + 1, position.z);
        
        const flashMaterial = new StandardMaterial('upgradeFlashMaterial', this.scene);
        flashMaterial.diffuseColor = new Color3(0.3, 1.0, 0.3);
        flashMaterial.emissiveColor = new Color3(0.3, 1.0, 0.3);
        flashMaterial.alpha = 0.7;
        flash.material = flashMaterial;
        
        let alpha = 0.7;
        let scale = 1.0;
        const flashAnimation = this.scene.onBeforeRenderObservable.add(() => {
            alpha -= 0.05;
            scale += 0.1;
            if (alpha <= 0) {
                flash.dispose();
                this.scene?.onBeforeRenderObservable.remove(flashAnimation);
            } else {
                (flash.material as StandardMaterial).alpha = alpha;
                flash.scaling.setAll(scale);
            }
        });
    }
    
    private shakeButton(button: Rectangle | null): void {
        if (!button) return;
        
        const originalLeft = button.left;
        const shakeAmount = 5;
        const shakeSpeed = 50;
        
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) - shakeAmount}px`; }, shakeSpeed * 0);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) + shakeAmount}px`; }, shakeSpeed * 1);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) - shakeAmount}px`; }, shakeSpeed * 2);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) + shakeAmount}px`; }, shakeSpeed * 3);
        setTimeout(() => { button.left = originalLeft; }, shakeSpeed * 4);
    }

    private placeTowerAtPosition(position: Vector3): void {
        if (!this.map || !this.towerManager || !this.playerStats || !this.selectedTowerType) {
            return;
        }
        
        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        const towerCost = this.getTowerCost(this.selectedTowerType);
        if (this.playerStats.getMoney() >= towerCost) {
            this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);
            
            this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);
            
            this.game.getAssetManager().playSound('towerShoot');
            
            console.log(`Tower placed at grid position (${gridPosition.x}, ${gridPosition.y})`);
        } else {
            console.log(`Not enough money to place tower. Need ${towerCost}, have ${this.playerStats.getMoney()}`);
        }
    }

    // Update the pause/resume button to reflect the current game state
    private registerPauseButtonUpdate(pauseButton: Button): void {
        // Initial state
        this.updatePauseButtonState(pauseButton);

        // Create a render observer to update the button state
        this.game.getScene().onBeforeRenderObservable.add(() => {
            this.updatePauseButtonState(pauseButton);
        });
    }

    private updatePauseButtonState(pauseButton: Button): void {
        if (!pauseButton || !pauseButton.textBlock) return;

        const isPaused = this.game.getIsPaused();
        
        if (isPaused) {
            pauseButton.textBlock.text = '▶';  // Using play icon
            pauseButton.background = '#4CAF50';
        } else {
            pauseButton.textBlock.text = '⏸';  // Using pause icon
            pauseButton.background = '#2196F3';
        }
    }

    private registerWaveButtonUpdate(waveButton: Button): void {
        if (!waveButton || !waveButton.textBlock) return;

        // Create a render observer to update the button state
        this.game.getScene().onBeforeRenderObservable.add(() => {
            this.updateWaveButtonState(waveButton);
        });
    }

    private updateWaveButtonState(waveButton: Button): void {
        if (!waveButton || !waveButton.textBlock || !this.waveManager) return;
        
        if (this.waveManager.isWaveInProgress()) {
            waveButton.textBlock.text = '⟳';  // Using random icon
            waveButton.background = '#F57C00';
            
            // Cancel any milestone pulse effect
            if (waveButton.metadata?.isPulsing) {
                waveButton.metadata.isPulsing = false;
                waveButton.fontSize = 20; // Reset font size
            }
        } else {
            // Check if next wave is a milestone wave (every 5th wave)
            const nextWave = this.waveManager.getCurrentWave() + 1;
            const isNextMilestone = nextWave % 5 === 0;
            
            if (isNextMilestone) {
                // Warning icon and color for milestone wave
                waveButton.textBlock.text = '⚠️';
                waveButton.background = '#FF8800';
                
                // Add pulse animation for milestone warning
                if (!waveButton.metadata?.isPulsing) {
                    waveButton.metadata = { isPulsing: true };
                    
                    // Create pulse animation
                    const pulseAnimation = () => {
                        if (!waveButton || !waveButton.metadata?.isPulsing) return;
                        
                        // Calculate scale based on time
                        const scaleValue = 1.0 + 0.1 * Math.sin(performance.now() / 200);
                        waveButton.fontSize = Math.floor(20 * scaleValue);
                        
                        // Continue animation
                        requestAnimationFrame(pulseAnimation);
                    };
                    
                    // Start pulse animation
                    pulseAnimation();
                }
            } else {
                // Normal next wave button
                waveButton.textBlock.text = '+';
                waveButton.background = '#D32F2F';
                
                // Cancel pulse if active
                if (waveButton.metadata?.isPulsing) {
                    waveButton.metadata.isPulsing = false;
                    waveButton.fontSize = 20; // Reset font size
                }
            }
        }
    }

    private async waitForFontLoad(): Promise<void> {
        if (this.fontLoaded) return;
        
        try {
            await document.fonts.load('16px FontAwesome');
            this.fontLoaded = true;
        } catch (e) {
            console.warn('Font loading API not supported, falling back to timeout');
            // Fallback: wait for a moment to let the font load
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    private getIcon(iconUnicode: number, fallbackText: string): string {
        // Check cache first
        if (this.iconCache[iconUnicode]) {
            return this.iconCache[iconUnicode];
        }

        // Try to get the icon with retries
        const tryGetIcon = async (retries: number = 0): Promise<string> => {
            try {
                // Wait for font to load on first try
                if (retries === 0) {
                    await this.waitForFontLoad();
                }

                const icon = String.fromCharCode(iconUnicode);
                
                // Create a test span with proper font settings
                const testSpan = document.createElement('span');
                testSpan.style.fontFamily = 'FontAwesome';
                testSpan.style.fontSize = '16px';
                testSpan.style.position = 'absolute';
                testSpan.style.visibility = 'hidden';
                testSpan.textContent = icon;
                
                // Add to document temporarily
                document.body.appendChild(testSpan);
                
                // More thorough check for icon rendering
                const isIconValid = testSpan.offsetWidth > 0 && 
                                  testSpan.offsetHeight > 0 && 
                                  window.getComputedStyle(testSpan).fontFamily.includes('FontAwesome');
                
                // Clean up
                document.body.removeChild(testSpan);
                
                if (!isIconValid && retries < this.maxRetries) {
                    // Wait and retry
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    return tryGetIcon(retries + 1);
                }
                
                // Cache and return the result
                const result = isIconValid ? icon : fallbackText;
                this.iconCache[iconUnicode] = result;
                return result;
            } catch (e) {
                console.warn('Failed to load icon:', e);
                return fallbackText;
            }
        };

        // Start the retry process and use fallback while waiting
        tryGetIcon().then(icon => {
            // Update all instances of this icon in the UI
            if (this.ui) {
                const controls = this.ui.getControlsByType("TextBlock");
                controls.forEach(control => {
                    const textBlock = control as TextBlock;
                    if (textBlock.text.includes(fallbackText)) {
                        textBlock.text = textBlock.text.replace(fallbackText, icon);
                    }
                });
            }
        });

        // Return fallback immediately while we wait for the icon to load
        return fallbackText;
    }

    private showPlacementOutline(position: Vector3): void {
        if (!this.map) return;

        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        // Create a more visible outline
        const size = 2.2;
        const y = 0.1;
        const lineThickness = 0.05;
        
        const corners = [
            new Vector3(-size/2, y, -size/2),
            new Vector3(size/2, y, -size/2),
            new Vector3(size/2, y, size/2),
            new Vector3(-size/2, y, size/2),
            new Vector3(-size/2, y, -size/2)
        ];
        
        // Create the outline mesh
        const outline = MeshBuilder.CreateLines('placementOutline', {
            points: corners.map(corner => corner.add(new Vector3(worldPosition.x, 0, worldPosition.z))),
            updatable: true
        }, this.game.getScene());
        
        outline.color = new Color3(0, 1, 0);
        outline.enableEdgesRendering();
        outline.edgesWidth = 10.0;
        
        // Create a semi-transparent plane to show the placement area
        const plane = MeshBuilder.CreateGround('placementPlane', {
            width: size,
            height: size,
            subdivisions: 1
        }, this.game.getScene());
        
        plane.position = new Vector3(worldPosition.x, y, worldPosition.z);
        plane.rotation = new Vector3(0, 0, 0);
        
        const material = new StandardMaterial('placementMaterial', this.game.getScene());
        material.diffuseColor = new Color3(0, 1, 0);
        material.alpha = 0.2;
        material.emissiveColor = new Color3(0, 0.7, 0);  // Increased green component for more glow
        plane.material = material;
        
        // Store references to clean up later
        this.placementOutline = outline;
        this.placementPlane = plane;
    }

    private hidePlacementOutline(): void {
        if (this.placementOutline) {
            this.placementOutline.dispose();
            this.placementOutline = null;
        }
        if (this.placementPlane) {
            this.placementPlane.dispose();
            this.placementPlane = null;
        }
    }

    private showTowerSelector(): void {
        if (!this.ui || !this.selectedPosition) return;
        
        // Store position in a local variable that's guaranteed not to be null
        const position = this.selectedPosition.clone();
        
        // Convert 3D world position to 2D screen position
        if (!this.scene || !this.scene.activeCamera) return;
        
        const worldPos = position;
        const screenPos = Vector3.Project(
            worldPos,
            Matrix.Identity(),
            this.scene.getTransformMatrix(),
            this.scene.activeCamera.viewport
        );
        
        // Detect if we're on a mobile device
        const isMobile = this.isMobileDevice();
        
        // Get UI dimensions
        const uiWidth = this.ui.getSize().width;
        const uiHeight = this.ui.getSize().height;
        
        // Calculate screen position
        const screenX = screenPos.x * uiWidth;
        const screenY = screenPos.y * uiHeight;
        
        // Adjust selector size based on device
        const selectorSize = isMobile ? 280 : 260; // Larger for mobile
        const selectorRadius = selectorSize / 2;

        // Create circular tower selector panel
        this.towerSelectorPanel = new Rectangle('towerSelectorPanel');
        this.towerSelectorPanel.width = selectorSize + 'px';
        this.towerSelectorPanel.height = selectorSize + 'px';
        this.towerSelectorPanel.background = 'rgba(0,0,0,0.7)';
        this.towerSelectorPanel.cornerRadius = selectorRadius;
        this.towerSelectorPanel.thickness = 1;
        this.towerSelectorPanel.color = "#444444";
        
        // Use center positioning to avoid edge issues
        this.towerSelectorPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.towerSelectorPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        
        // Calculate position offsets from center of screen
        const offsetX = screenX - (uiWidth / 2);
        const offsetY = screenY - (uiHeight / 2);
        
        // Apply position
        this.towerSelectorPanel.left = offsetX + 'px';
        this.towerSelectorPanel.top = offsetY + 'px';
        
        this.towerSelectorPanel.zIndex = 10;
        this.ui.addControl(this.towerSelectorPanel);
        
        // Define tower buttons
        const towers = [
            { id: 'basicTower', name: 'Basic', cost: '50', color: '#4CAF50' },
            { id: 'fastTower', name: 'Fast', cost: '100', color: '#2196F3' },
            { id: 'heavyTower', name: 'Heavy', cost: '150', color: '#FF9800' },
            { id: 'sniperTower', name: 'Sniper', cost: '200', color: '#9C27B0' },
            { id: 'fireTower', name: 'Fire', cost: '125', color: '#FF5722' },
            { id: 'waterTower', name: 'Water', cost: '125', color: '#03A9F4' },
            { id: 'windTower', name: 'Wind', cost: '125', color: '#8BC34A' },
            { id: 'earthTower', name: 'Earth', cost: '125', color: '#795548' }
        ];
        
        // Create a circular arrangement of tower buttons
        const radius = isMobile ? 105 : 85; // Larger radius for mobile
        const buttonsCount = towers.length;
        
        // Add label in center
        const centerLabel = new TextBlock("centerLabel", "Click to\nselect tower");
        centerLabel.color = "white";
        centerLabel.fontSize = 14;
        centerLabel.textWrapping = true;
        centerLabel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        centerLabel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        this.towerSelectorPanel.addControl(centerLabel);
        
        // Add close button
        const closeButton = Button.CreateSimpleButton("closeButton", "×");
        closeButton.width = "24px";
        closeButton.height = "24px";
        closeButton.color = "white";
        closeButton.background = "#E53935";
        closeButton.cornerRadius = 12;
        closeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        closeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        closeButton.top = "5px";
        closeButton.left = "-5px";
        closeButton.onPointerClickObservable.add(() => {
            this.hideTowerSelector();
            this.hidePlacementOutline();
        });
        this.towerSelectorPanel.addControl(closeButton);
        
        towers.forEach((tower, index) => {
            // Calculate position in circle
            const angle = (index / buttonsCount) * 2 * Math.PI;
            const x = Math.sin(angle) * radius;
            const y = -Math.cos(angle) * radius; // Negative because Y is down in UI coordinates
            
            // Create button container
            const button = new Button(`${tower.id}_button`);
            const buttonSize = isMobile ? 65 : 55; // Larger buttons for mobile
            button.width = buttonSize + "px";
            button.height = buttonSize + "px";
            button.background = tower.color;
            button.color = "white";
            button.cornerRadius = buttonSize / 2;
            button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            button.left = x + "px";
            button.top = y + "px";
            
            // Tower name (full name now)
            if (button.textBlock) {
                button.textBlock.text = "";
            }
            
            // Add tower name text with increased size on mobile
            const nameText = new TextBlock(`${tower.id}_name`, tower.name);
            nameText.color = "white";
            nameText.fontSize = isMobile ? 14 : 11;
            nameText.resizeToFit = false;
            nameText.textWrapping = true;
            nameText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            nameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            nameText.top = isMobile ? "-10px" : "-8px";
            nameText.outlineWidth = 1;
            nameText.outlineColor = "black";
            button.addControl(nameText);
            
            // Add small cost indicator at bottom of button
            const costIndicator = new TextBlock(`${tower.id}_cost`, "$" + tower.cost);
            costIndicator.color = "white";
            costIndicator.fontSize = isMobile ? 12 : 9;
            costIndicator.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            costIndicator.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            costIndicator.top = isMobile ? "18px" : "16px";
            costIndicator.outlineWidth = 1;
            costIndicator.outlineColor = "black";
            button.addControl(costIndicator);
            
            // Highlight effect on hover
            button.onPointerEnterObservable.add(() => {
                button.background = this.lightenColor(tower.color, 20);
                button.scaleX = 1.1;
                button.scaleY = 1.1;
                
                nameText.fontSize = 13;
                nameText.outlineWidth = 2;
            });
            
            button.onPointerOutObservable.add(() => {
                button.background = tower.color;
                button.scaleX = 1.0;
                button.scaleY = 1.0;
                
                nameText.fontSize = 12;
                nameText.outlineWidth = 1;
            });
            
            // Make button clickable
            button.isPointerBlocker = true;
            
            // Handle tower selection - use the stored position
            button.onPointerUpObservable.add(() => {
                // Check if player has enough money
                if (this.playerStats && this.getTowerCost(tower.id) > this.playerStats.getMoney()) {
                    // Shake effect for insufficient funds
                    this.shakeElement(button);
                    return;
                }
                
                // Select the tower type and place it immediately
                this.selectedTowerType = tower.id;
                
                // Hide the tower selector and outline
                this.hideTowerSelector();
                
                // Place the tower directly at the position
                this.placeTowerAtPosition(position);
                
                // Hide the placement outline after placing
                this.hidePlacementOutline();
            });
            
            // Add the button to the panel if it still exists
            if (this.towerSelectorPanel) {
                this.towerSelectorPanel.addControl(button);
            }
        });
    }
    
    /**
     * Create a shake animation for an element when player has insufficient funds
     */
    private shakeElement(element: Control): void {
        const originalLeft = element.left;
        const shakeAmount = 3;
        const duration = 50;
        let count = 0;
        
        const shakeInterval = setInterval(() => {
            element.left = (parseInt(originalLeft as string) + (Math.random() * shakeAmount * 2 - shakeAmount)) + "px";
            count++;
            if (count > 8) {
                clearInterval(shakeInterval);
                element.left = originalLeft;
            }
        }, duration);
    }
    
    /**
     * Lighten a color by the specified amount
     */
    private lightenColor(color: string, amount: number): string {
        // Convert hex to RGB
        let r = parseInt(color.substring(1, 3), 16);
        let g = parseInt(color.substring(3, 5), 16);
        let b = parseInt(color.substring(5, 7), 16);
        
        // Lighten
        r = Math.min(255, r + amount);
        g = Math.min(255, g + amount);
        b = Math.min(255, b + amount);
        
        // Convert back to hex
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /**
     * Move the camera in the specified direction
     * @param x X-axis movement (-1 for left, 1 for right)
     * @param y Y-axis movement (not used for panning)
     * @param z Z-axis movement (-1 for backward, 1 for forward)
     */
    private moveCamera(x: number, y: number, z: number): void {
        if (!this.scene || !this.scene.activeCamera) return;
        
        const camera = this.scene.activeCamera as ArcRotateCamera;
        const speed = 3; // Movement speed
        
        // Convert global direction to local camera direction
        const forward = new Vector3(0, 0, 1);
        const right = new Vector3(1, 0, 0);
        
        // Rotate directions based on camera angle
        const matrix = new Matrix();
        Matrix.RotationYawPitchRollToRef(camera.alpha, 0, 0, matrix);
        
        const transformedForward = Vector3.TransformNormal(forward, matrix);
        const transformedRight = Vector3.TransformNormal(right, matrix);
        
        // Calculate the movement vector
        const movementDirection = new Vector3(0, 0, 0);
        
        if (x !== 0) {
            movementDirection.addInPlace(transformedRight.scale(x * speed));
        }
        
        if (z !== 0) {
            movementDirection.addInPlace(transformedForward.scale(z * speed));
        }
        
        // Apply the movement to the camera target
        camera.target.addInPlace(movementDirection);
    }

    /**
     * Hide the tower selector UI
     */
    private hideTowerSelector(): void {
        if (this.towerSelectorPanel && this.ui) {
            this.ui.removeControl(this.towerSelectorPanel);
            this.towerSelectorPanel = null;
        }
    }

    /**
     * Zoom the camera in or out
     * @param direction Positive for zoom out, negative for zoom in
     */
    private zoomCamera(direction: number): void {
        if (!this.scene || !this.scene.activeCamera) return;
        
        const camera = this.scene.activeCamera as ArcRotateCamera;
        const zoomSpeed = 5; // Adjust this value to control zoom speed
        
        // Add delta to radius (distance from target)
        camera.radius += direction * zoomSpeed;
        
        // Enforce zoom limits
        camera.radius = Math.max(camera.lowerRadiusLimit || 25, camera.radius);
        camera.radius = Math.min(camera.upperRadiusLimit || 60, camera.radius);
    }
    
    /**
     * Rotate the camera horizontally or vertically
     * @param horizontalDirection -1 for left, 1 for right, 0 for no horizontal change
     * @param verticalDirection -1 for up, 1 for down, 0 for no vertical change
     */
    private rotateCamera(horizontalDirection: number, verticalDirection: number): void {
        if (!this.scene || !this.scene.activeCamera) return;
        
        const camera = this.scene.activeCamera as ArcRotateCamera;
        const rotationSpeed = 0.05; // Adjust this value to control rotation speed
        
        // Rotate horizontally (alpha)
        if (horizontalDirection !== 0) {
            camera.alpha += horizontalDirection * rotationSpeed;
        }
        
        // Rotate vertically (beta)
        if (verticalDirection !== 0) {
            camera.beta += verticalDirection * rotationSpeed;
            
            // Enforce beta limits to prevent flipping
            camera.beta = Math.max(camera.lowerBetaLimit || 0.1, camera.beta);
            camera.beta = Math.min(camera.upperBetaLimit || Math.PI - 0.1, camera.beta);
        }
    }

    /**
     * Setup camera controls to only work when Shift key is pressed on desktop,
     * and with touch gestures on mobile
     */
    private setupCameraControls(): void {
        if (!this.scene) return;
        
        const camera = this.scene.activeCamera as ArcRotateCamera;
        if (!camera) return;
        
        // Track shift key state
        let isShiftPressed = false;
        
        // Detect if we're on a mobile device
        const isMobile = this.isMobileDevice();
        
        // Setup for desktop controls
        if (!isMobile) {
            // Disable all inputs initially
            if (camera.inputs.attached.keyboard) {
                camera.inputs.attached.keyboard.detachControl();
            }
            if (camera.inputs.attached.pointers) {
                camera.inputs.attached.pointers.detachControl();
            }
            if (camera.inputs.attached.mousewheel) {
                camera.inputs.attached.mousewheel.detachControl();
            }
            
            // Add listeners for shift key
            this.scene.onKeyboardObservable.add((kbInfo) => {
                if (kbInfo.event.key === 'Shift') {
                    if (kbInfo.type === KeyboardEventTypes.KEYDOWN && !isShiftPressed) {
                        isShiftPressed = true;
                        // Enable inputs when shift is pressed
                        if (camera.inputs.attached.pointers) {
                            camera.inputs.attached.pointers.attachControl(true);
                        }
                        if (camera.inputs.attached.mousewheel) {
                            camera.inputs.attached.mousewheel.attachControl(true);
                        }
                    } else if (kbInfo.type === KeyboardEventTypes.KEYUP && isShiftPressed) {
                        isShiftPressed = false;
                        // Disable inputs when shift is released
                        if (camera.inputs.attached.pointers) {
                            camera.inputs.attached.pointers.detachControl();
                        }
                        if (camera.inputs.attached.mousewheel) {
                            camera.inputs.attached.mousewheel.detachControl();
                        }
                    }
                }
            });
        } 
        // Setup for mobile controls
        else {
            // Use built-in multitouch camera for pinch-to-zoom
            camera.useAutoRotationBehavior = false; // Disable auto-rotation on mobile
            
            // Enable touch camera controls
            if (camera.inputs.attached.pointers) {
                camera.inputs.attached.pointers.attachControl();
            }
            
            // Set up touch helper UI for mobile
            this.setupMobileTouchHelpers();
        }
    }
    
    /**
     * Add mobile touch helper UI elements
     */
    private setupMobileTouchHelpers(): void {
        if (!this.ui) return;
        
        // Create mobile camera control buttons
        const controlsContainer = new Rectangle("mobileCameraControls");
        controlsContainer.width = "120px";
        controlsContainer.height = "120px";
        controlsContainer.background = "rgba(0,0,0,0.3)";
        controlsContainer.cornerRadius = 60;
        controlsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        controlsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        controlsContainer.left = "20px";
        controlsContainer.top = "-20px";
        controlsContainer.zIndex = 10;
        this.ui.addControl(controlsContainer);
        
        // Add control buttons - arrows in a directional pad layout
        const directions = [
            { name: "up", icon: "↑", x: 0, y: -1, left: "0px", top: "-35px" },
            { name: "down", icon: "↓", x: 0, y: 1, left: "0px", top: "35px" },
            { name: "left", icon: "←", x: -1, y: 0, left: "-35px", top: "0px" },
            { name: "right", icon: "→", x: 1, y: 0, left: "35px", top: "0px" }
        ];
        
        directions.forEach(dir => {
            const button = Button.CreateSimpleButton(dir.name + "Button", dir.icon);
            button.width = "40px";
            button.height = "40px";
            button.color = "white";
            button.background = "rgba(0,0,0,0.5)";
            button.cornerRadius = 20;
            button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            button.left = dir.left;
            button.top = dir.top;
            
            // Make the button move the camera when pressed/held
            button.onPointerDownObservable.add(() => {
                // Start continuous movement
                const moveInterval = setInterval(() => {
                    this.moveCamera(dir.x, 0, dir.y);
                }, 50);
                
                // Stop movement when button is released
                button.onPointerUpObservable.add(() => {
                    clearInterval(moveInterval);
                });
                
                // Also stop if pointer leaves the button
                button.onPointerOutObservable.add(() => {
                    clearInterval(moveInterval);
                });
            });
            
            controlsContainer.addControl(button);
        });
        
        // Add zoom buttons
        const zoomIn = Button.CreateSimpleButton("zoomInButton", "+");
        zoomIn.width = "40px";
        zoomIn.height = "40px";
        zoomIn.color = "white";
        zoomIn.background = "rgba(0,0,0,0.5)";
        zoomIn.cornerRadius = 20;
        zoomIn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        zoomIn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        zoomIn.left = "-20px";
        zoomIn.top = "-70px";
        
        zoomIn.onPointerDownObservable.add(() => {
            const zoomInterval = setInterval(() => {
                this.zoomCamera(-1);
            }, 50);
            
            zoomIn.onPointerUpObservable.add(() => {
                clearInterval(zoomInterval);
            });
            
            zoomIn.onPointerOutObservable.add(() => {
                clearInterval(zoomInterval);
            });
        });
        
        this.ui.addControl(zoomIn);
        
        const zoomOut = Button.CreateSimpleButton("zoomOutButton", "-");
        zoomOut.width = "40px";
        zoomOut.height = "40px";
        zoomOut.color = "white";
        zoomOut.background = "rgba(0,0,0,0.5)";
        zoomOut.cornerRadius = 20;
        zoomOut.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        zoomOut.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        zoomOut.left = "-20px";
        zoomOut.top = "-20px";
        
        zoomOut.onPointerDownObservable.add(() => {
            const zoomInterval = setInterval(() => {
                this.zoomCamera(1);
            }, 50);
            
            zoomOut.onPointerUpObservable.add(() => {
                clearInterval(zoomInterval);
            });
            
            zoomOut.onPointerOutObservable.add(() => {
                clearInterval(zoomInterval);
            });
        });
        
        this.ui.addControl(zoomOut);
    }
    
    /**
     * Detect if the current device is a mobile device
     */
    private isMobileDevice(): boolean {
        // Check for touch capability and small screen
        return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && 
               window.innerWidth < 1024;
    }
} 