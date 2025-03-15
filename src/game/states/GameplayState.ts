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

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering gameplay state');
        
        // Create game components
        this.map = new Map(this.game);
        this.playerStats = new PlayerStats(100, 100); // Start with 100 health and 100 money
        this.towerManager = new TowerManager(this.game, this.map);
        this.enemyManager = new EnemyManager(this.game, this.map);
        this.waveManager = new WaveManager(this.enemyManager, this.playerStats);
        
        // Connect managers
        this.enemyManager.setPlayerStats(this.playerStats);
        this.towerManager.setEnemyManager(this.enemyManager);
        
        // Initialize the map
        this.map.initialize();
        
        // Create UI
        this.createUI();
        
        // Set up input handling
        this.setupInputHandling();
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
        // Create fullscreen UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('gameplayUI', true, this.game.getScene());
        
        // Create top panel for player stats
        const topPanel = new Rectangle('topPanel');
        topPanel.width = '100%';
        topPanel.height = '70px';
        topPanel.background = 'rgba(33, 33, 33, 0.85)';
        topPanel.thickness = 0;
        topPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        topPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        topPanel.shadowColor = "black";
        topPanel.shadowBlur = 10;
        topPanel.shadowOffsetY = 3;
        this.ui.addControl(topPanel);
        
        // Create a container for the stats
        const statsContainer = new Rectangle('statsContainer');
        statsContainer.width = '90%';
        statsContainer.height = '50px';
        statsContainer.background = 'transparent';
        statsContainer.thickness = 0;
        statsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        statsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        topPanel.addControl(statsContainer);
        
        // Health display with icon
        const healthContainer = new Rectangle('healthContainer');
        healthContainer.width = '200px';
        healthContainer.height = '40px';
        healthContainer.background = 'rgba(255, 255, 255, 0.1)';
        healthContainer.cornerRadius = 5;
        healthContainer.thickness = 1;
        healthContainer.color = "#4CAF50";
        healthContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        statsContainer.addControl(healthContainer);
        
        const healthIcon = new Rectangle('healthIcon');
        healthIcon.width = '30px';
        healthIcon.height = '30px';
        healthIcon.background = '#4CAF50';
        healthIcon.cornerRadius = 15;
        healthIcon.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthIcon.left = '10px';
        healthContainer.addControl(healthIcon);
        
        const healthText = new TextBlock('healthText');
        healthText.text = 'Health: 100';
        healthText.color = 'white';
        healthText.fontSize = 18;
        healthText.fontFamily = 'Arial';
        healthText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthText.left = '50px';
        healthContainer.addControl(healthText);
        
        // Money display with icon
        const moneyContainer = new Rectangle('moneyContainer');
        moneyContainer.width = '200px';
        moneyContainer.height = '40px';
        moneyContainer.background = 'rgba(255, 255, 255, 0.1)';
        moneyContainer.cornerRadius = 5;
        moneyContainer.thickness = 1;
        moneyContainer.color = "#FFD700";
        moneyContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        statsContainer.addControl(moneyContainer);
        
        const moneyIcon = new Rectangle('moneyIcon');
        moneyIcon.width = '30px';
        moneyIcon.height = '30px';
        moneyIcon.background = '#FFD700';
        moneyIcon.cornerRadius = 15;
        moneyIcon.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyIcon.left = '10px';
        moneyContainer.addControl(moneyIcon);
        
        const moneyText = new TextBlock('moneyText');
        moneyText.text = 'Money: 100';
        moneyText.color = 'white';
        moneyText.fontSize = 18;
        moneyText.fontFamily = 'Arial';
        moneyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        moneyText.left = '50px';
        moneyContainer.addControl(moneyText);
        
        // Wave display with icon
        const waveContainer = new Rectangle('waveContainer');
        waveContainer.width = '200px';
        waveContainer.height = '40px';
        waveContainer.background = 'rgba(255, 255, 255, 0.1)';
        waveContainer.cornerRadius = 5;
        waveContainer.thickness = 1;
        waveContainer.color = "#2196F3";
        waveContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        statsContainer.addControl(waveContainer);
        
        const waveIcon = new Rectangle('waveIcon');
        waveIcon.width = '30px';
        waveIcon.height = '30px';
        waveIcon.background = '#2196F3';
        waveIcon.cornerRadius = 15;
        waveIcon.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveIcon.left = '10px';
        waveContainer.addControl(waveIcon);
        
        const waveText = new TextBlock('waveText');
        waveText.text = 'Wave: 0/∞';
        waveText.color = 'white';
        waveText.fontSize = 18;
        waveText.fontFamily = 'Arial';
        waveText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        waveText.left = '50px';
        waveContainer.addControl(waveText);
        
        // Create right panel for game controls - just the wave button
        const waveButton = Button.CreateSimpleButton('waveButton', 'New Wave');
        waveButton.width = '140px';
        waveButton.height = '40px';
        waveButton.color = 'white';
        waveButton.background = '#D32F2F'; // Solid color instead of gradient
        waveButton.cornerRadius = 20;
        waveButton.thickness = 2; // Add border for better visibility
        waveButton.fontFamily = 'Arial';
        waveButton.fontSize = 16;
        waveButton.fontWeight = 'bold';
        waveButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        waveButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        waveButton.top = '90px';
        waveButton.left = '-20px';
        waveButton.shadowColor = "rgba(0, 0, 0, 0.6)"; // Darker shadow
        waveButton.shadowBlur = 5;
        waveButton.shadowOffsetY = 2;
        // Add text outline for better visibility
        if (waveButton.textBlock) {
            waveButton.textBlock.outlineWidth = 1;
            waveButton.textBlock.outlineColor = "black";
        }
        waveButton.onPointerEnterObservable.add(() => {
            waveButton.background = '#F44336'; // Lighter on hover
            waveButton.shadowOffsetY = 4;
        });
        waveButton.onPointerOutObservable.add(() => {
            waveButton.background = '#D32F2F'; // Back to original
            waveButton.shadowOffsetY = 2;
        });
        waveButton.onPointerUpObservable.add(() => {
            if (this.waveManager) {
                // If a wave is already in progress, create a parallel wave
                if (this.waveManager.isWaveInProgress()) {
                    // Create a parallel wave with similar enemies to the current wave
                    const currentWave = this.waveManager.getCurrentWave();
                    const enemies = [];
                    
                    // Add basic enemies
                    enemies.push({ type: 'basic', count: 5 + Math.floor(currentWave / 2), delay: 1.0 });
                    
                    // Add fast enemies after wave 2
                    if (currentWave > 2) {
                        enemies.push({ type: 'fast', count: 3 + Math.floor((currentWave - 2) / 2), delay: 0.8 });
                    }
                    
                    // Add tank enemies after wave 4
                    if (currentWave > 4) {
                        enemies.push({ type: 'tank', count: 1 + Math.floor((currentWave - 4) / 3), delay: 2.0 });
                    }
                    
                    // Add boss enemy for every 10 waves
                    if (currentWave % 10 === 0 && currentWave > 0) {
                        enemies.push({ type: 'boss', count: 1, delay: 0 });
                    }
                    
                    // Create the parallel wave with a reward based on the current wave
                    const reward = 25 + currentWave * 10;
                    
                    // Increment the wave counter manually to count this as a new wave
                    this.waveManager.incrementWaveCounter();
                    
                    // Create the parallel wave
                    this.waveManager.createParallelWave(enemies, reward);
                    
                    console.log(`Created parallel wave with ${enemies.length} enemy types as wave ${this.waveManager.getCurrentWave()}`);
                } else {
                    // Start a new wave if none is in progress
                    this.waveManager.startNextWave();
                }
            }
        });
        this.ui.addControl(waveButton);
        
        // Create left panel for tower selection
        const leftPanel = new Rectangle('leftPanel');
        leftPanel.width = '100px';
        leftPanel.height = '450px';
        leftPanel.background = 'rgba(33, 33, 33, 0.85)';
        leftPanel.thickness = 0;
        leftPanel.cornerRadius = 10;
        leftPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        leftPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        leftPanel.top = '90px';
        leftPanel.paddingLeft = '10px';
        leftPanel.shadowColor = "black";
        leftPanel.shadowBlur = 10;
        leftPanel.shadowOffsetX = 3;
        this.ui.addControl(leftPanel);
        
        // Panel title - moved to the very top with a background
        const titleBackground = new Rectangle('titleBackground');
        titleBackground.width = '100%';
        titleBackground.height = '30px';
        titleBackground.background = 'rgba(0, 0, 0, 0.5)';
        titleBackground.thickness = 0;
        titleBackground.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        titleBackground.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        titleBackground.zIndex = 9;
        leftPanel.addControl(titleBackground);
        
        const towerPanelTitle = new TextBlock('towerPanelTitle');
        towerPanelTitle.text = "TOWERS";
        towerPanelTitle.color = 'white';
        towerPanelTitle.fontSize = 16;
        towerPanelTitle.fontFamily = 'Arial';
        towerPanelTitle.fontWeight = 'bold';
        towerPanelTitle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        towerPanelTitle.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        towerPanelTitle.zIndex = 10; // Ensure it's on top of other elements
        towerPanelTitle.outlineWidth = 1; // Add outline for better visibility
        towerPanelTitle.outlineColor = 'black';
        titleBackground.addControl(towerPanelTitle);
        
        // Create tower category tabs for left panel - adjusted position
        this.createLeftPanelTabs(leftPanel);
        
        // Create tower selection container for left panel
        const leftTowerPanel = new Rectangle('leftTowerPanel');
        leftTowerPanel.width = '90px';
        leftTowerPanel.height = '370px';
        leftTowerPanel.background = 'transparent';
        leftTowerPanel.thickness = 0;
        leftTowerPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        leftTowerPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        leftTowerPanel.top = '100px'; // Adjusted to be below the tabs
        leftTowerPanel.zIndex = 1; // Lower z-index than tabs
        leftPanel.addControl(leftTowerPanel);
        
        // Create basic tower buttons for left panel with more spacing
        this.createVerticalTowerButton('basicTower_left', 'Basic', '$50', '#4CAF50', 0, leftTowerPanel);
        this.createVerticalTowerButton('fastTower_left', 'Fast', '$100', '#2196F3', 80, leftTowerPanel);
        this.createVerticalTowerButton('heavyTower_left', 'Heavy', '$150', '#FF9800', 160, leftTowerPanel);
        this.createVerticalTowerButton('sniperTower_left', 'Sniper', '$200', '#9C27B0', 240, leftTowerPanel);
        
        // Create elemental tower buttons for left panel (initially hidden) with more spacing
        this.createVerticalTowerButton('fireTower_left', 'Fire', '$125', '#FF5722', 0, leftTowerPanel, true);
        this.createVerticalTowerButton('waterTower_left', 'Water', '$125', '#03A9F4', 80, leftTowerPanel, true);
        this.createVerticalTowerButton('windTower_left', 'Wind', '$125', '#8BC34A', 160, leftTowerPanel, true);
        this.createVerticalTowerButton('earthTower_left', 'Earth', '$125', '#795548', 240, leftTowerPanel, true);
    }

    private createTowerButton(type: string, name: string, cost: string, color: string, left: number, parent: Rectangle, hidden: boolean = false): void {
        const button = new Rectangle(`${type}Button`);
        button.width = '85px'; // Slightly wider
        button.height = '65px'; // Slightly taller
        button.background = color;
        button.cornerRadius = 8; // Increased corner radius
        button.thickness = 2; // Added border
        button.color = "white"; // Border color
        button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        button.left = `${left}px`;
        button.isVisible = !hidden;
        button.isPointerBlocker = true; // Ensure clicks are captured
        
        // Add tower name
        const nameText = new TextBlock(`${type}Name`);
        nameText.text = name;
        nameText.color = 'white';
        nameText.fontSize = 14; // Increased font size
        nameText.fontFamily = 'Arial';
        nameText.top = '-18px';
        nameText.outlineWidth = 1; // Add text outline for better visibility
        nameText.outlineColor = 'black';
        button.addControl(nameText);
        
        // Add tower cost
        const costText = new TextBlock(`${type}Cost`);
        costText.text = cost;
        costText.color = 'white';
        costText.fontSize = 14; // Increased font size
        costText.fontFamily = 'Arial';
        costText.top = '18px';
        costText.outlineWidth = 1; // Add text outline for better visibility
        costText.outlineColor = 'black';
        button.addControl(costText);
        
        // Add hover effect
        button.onPointerEnterObservable.add(() => {
            button.alpha = 0.8;
            button.thickness = 3;
        });
        
        button.onPointerOutObservable.add(() => {
            button.alpha = 1;
            button.thickness = 2;
        });
        
        // Add click effect
        button.onPointerDownObservable.add(() => {
            button.alpha = 0.6;
        });
        
        // Add click event
        button.onPointerUpObservable.add(() => {
            button.alpha = 0.8;
            this.selectTowerType(type);
        });
        
        parent.addControl(button);
    }

    private updateUI(): void {
        if (!this.ui || !this.playerStats || !this.waveManager) return;
        
        // Update health display
        const healthText = this.ui.getControlByName('healthText') as TextBlock;
        if (healthText) {
            healthText.text = `Health: ${this.playerStats.getHealth()}`;
        }
        
        // Update money display
        const moneyText = this.ui.getControlByName('moneyText') as TextBlock;
        if (moneyText) {
            moneyText.text = `Money: ${this.playerStats.getMoney()}`;
        }
        
        // Update wave display
        const waveText = this.ui.getControlByName('waveText') as TextBlock;
        if (waveText) {
            // Show current wave and infinity symbol
            waveText.text = `Wave: ${this.waveManager.getCurrentWave()}/∞`;
            
            // Add difficulty info if difficulty has increased
            const difficulty = this.waveManager.getDifficultyMultiplier();
            if (difficulty > 1.0) {
                waveText.text += ` (${difficulty.toFixed(1)}x)`;
            }
        }
        
        // Update wave button text based on wave status
        const waveButton = this.ui.getControlByName('waveButton') as Button;
        if (waveButton && waveButton.textBlock) {
            // Always show "New Wave" button text
            waveButton.textBlock.text = 'New Wave';
            
            // Show auto-wave countdown if active
            const autoWaveTime = this.waveManager.getAutoWaveTimeRemaining();
            if (autoWaveTime > 0) {
                waveButton.textBlock.text = `Next Wave in ${Math.ceil(autoWaveTime)}s`;
            }
            
            // Always enable the button, but change color when wave is in progress
            waveButton.isEnabled = true;
            
            // Change button color based on state
            if (this.waveManager.isWaveInProgress()) {
                waveButton.background = '#F57C00'; // Orange when in progress
                waveButton.color = 'white'; // Ensure text is visible
            } else if (this.waveManager.getAutoWaveTimeRemaining() > 0) {
                waveButton.background = '#1976D2'; // Blue for auto-wave countdown
                waveButton.color = 'white'; // Ensure text is visible
            } else {
                waveButton.background = '#D32F2F'; // Red when ready for manual call
                waveButton.color = 'white'; // Ensure text is visible
            }
            
            // Ensure text outline is always applied
            waveButton.textBlock.outlineWidth = 1;
            waveButton.textBlock.outlineColor = "black";
        }
    }

    private setupInputHandling(): void {
        // Handle pointer down events on the scene
        this.scene = this.game.getScene();
        if (!this.scene) return;
        
        this.scene.onPointerDown = (evt) => {
            // Only handle left mouse button
            if (evt.button !== 0 || !this.scene) return;
            
            // Check if we clicked on a UI element
            const pickInfo = this.scene.pick(
                this.scene.pointerX, 
                this.scene.pointerY
            );
            
            // Skip if we're clicking on a UI element
            if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                return;
            }
            
            // If we're in tower placement mode
            if (this.selectedTowerType && this.scene) {
                // Get the position from the ground
                const pickResult = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY,
                    (mesh) => {
                        return mesh.name.startsWith('ground_');
                    }
                );
                
                if (pickResult.hit) {
                    const position = pickResult.pickedPoint;
                    if (position && this.map) {
                        // Check if the position is valid for tower placement
                        const gridPosition = this.map.worldToGrid(position);
                        if (this.map.canPlaceTower(gridPosition.x, gridPosition.y)) {
                            // Place tower immediately instead of showing confirmation buttons
                            this.placeTowerAtPosition(position);
                        }
                    }
                }
            } else {
                // We're not in tower placement mode, check if we clicked on a tower
                const pickResult = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY
                );
                
                if (pickResult.hit && pickResult.pickedMesh) {
                    // Find the tower that owns this mesh
                    const clickedTower = this.findTowerByMesh(pickResult.pickedMesh);
                    
                    if (clickedTower) {
                        // Select the tower
                        this.selectTower(clickedTower);
                    } else {
                        // Clicked on something else, deselect current tower
                        this.deselectTower();
                    }
                } else {
                    // Clicked on nothing, deselect current tower
                    this.deselectTower();
                }
            }
        };
        
        // Handle pointer move for tower preview
        this.scene.onPointerMove = (evt) => {
            if (this.selectedTowerType && this.towerPreview && this.scene) {
                // Skip if we're over a UI element
                const pickInfo = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY
                );
                
                if (pickInfo.hit && pickInfo.pickedMesh && pickInfo.pickedMesh.name.includes('GUI')) {
                    return;
                }
                
                // Get the position from the ground
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
        
        // Handle keyboard events
        this.scene.onKeyboardObservable.add((kbInfo) => {
            switch (kbInfo.type) {
                case KeyboardEventTypes.KEYDOWN:
                    switch (kbInfo.event.key) {
                        case 'Escape':
                            // Cancel tower placement
                            if (this.selectedTowerType) {
                                this.cancelTowerPlacement();
                            }
                            break;
                    }
                    break;
            }
        });
    }

    private selectTowerType(type: string): void {
        // Set the selected tower type
        this.selectedTowerType = type;
        console.log(`Selected tower type: ${type}`);
        
        // Create tower preview if it doesn't exist
        if (!this.towerPreview) {
            this.createTowerPreview();
        } else {
            this.towerPreview.setEnabled(true);
        }
        
        // Create square outline if it doesn't exist
        if (!this.squareOutline) {
            this.createSquareOutline();
        } else {
            this.squareOutline.setEnabled(true);
        }
        
        // Force an initial update of the preview position
        if (this.scene && this.scene.activeCamera) {
            const ray = this.scene.createPickingRay(
                this.scene.pointerX,
                this.scene.pointerY,
                Matrix.Identity(),
                this.scene.activeCamera
            );
            
            // Define the ground plane (y = 0)
            const groundPlane = new Vector3(0, 1, 0);
            const planeOrigin = new Vector3(0, 0, 0);
            
            // Find intersection with ground plane
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
        // Create a simple cylinder as tower preview
        this.towerPreview = MeshBuilder.CreateCylinder('towerPreview', {
            height: 2,
            diameter: 1.5
        }, this.game.getScene());
        
        // Set material
        const material = new StandardMaterial('towerPreviewMaterial', this.game.getScene());
        material.diffuseColor = new Color3(0, 1, 0);
        material.alpha = 0.5;
        this.towerPreview.material = material;
        
        // Hide initially
        this.towerPreview.setEnabled(false);
    }

    private createSquareOutline(): void {
        // Create a square outline to show the grid cell
        const size = 2.2; // Slightly larger than the cell size for better visibility
        const y = 0.1; // Slightly above ground
        const lineThickness = 0.05; // Thicker lines for better visibility
        
        // Define the corners of the square
        const corners = [
            new Vector3(-size/2, y, -size/2),
            new Vector3(size/2, y, -size/2),
            new Vector3(size/2, y, size/2),
            new Vector3(-size/2, y, size/2),
            new Vector3(-size/2, y, -size/2) // Close the loop
        ];
        
        // Create the lines mesh
        this.squareOutline = MeshBuilder.CreateLines('squareOutline', {
            points: corners,
            updatable: true
        }, this.game.getScene());
        
        // Set color
        this.squareOutline.color = new Color3(1, 1, 0); // Yellow outline
        
        // Make the lines thicker
        this.squareOutline.enableEdgesRendering();
        this.squareOutline.edgesWidth = 10.0;
        
        // Hide initially
        this.squareOutline.setEnabled(false);
    }

    private updateTowerPreview(position: Vector3): void {
        if (!this.towerPreview || !this.map) return;
        
        // Show the preview
        this.towerPreview.setEnabled(true);
        
        // Get the grid position
        const gridPosition = this.map.worldToGrid(position);
        
        // Get the world position at the center of the grid cell
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        // Update tower preview position to the center of the grid cell
        this.towerPreview.position = new Vector3(worldPosition.x, 1, worldPosition.z);
        
        // Create or update the square outline
        if (!this.squareOutline) {
            this.createSquareOutline();
        }
        
        // Make sure squareOutline exists after potentially creating it
        if (this.squareOutline) {
            this.squareOutline.setEnabled(true);
            this.squareOutline.position = new Vector3(worldPosition.x, 0.1, worldPosition.z);
            
            // Update color based on whether tower can be placed here
            const canPlace = this.map.canPlaceTower(gridPosition.x, gridPosition.y);
            
            const material = this.towerPreview.material as StandardMaterial;
            if (canPlace) {
                material.diffuseColor = new Color3(0, 1, 0); // Green for valid
                this.squareOutline.color = new Color3(0, 1, 0); // Green outline
                material.alpha = 0.6;
            } else {
                material.diffuseColor = new Color3(1, 0, 0); // Red for invalid
                this.squareOutline.color = new Color3(1, 0, 0); // Red outline
                material.alpha = 0.6;
            }
            
            // Log the grid position for debugging
            console.log(`Tower preview at grid position (${gridPosition.x}, ${gridPosition.y}), can place: ${canPlace}`);
        }
    }

    private showConfirmationButtons(position: Vector3): void {
        if (!this.ui || !this.map) return;
        
        // Keep the tower preview visible but make it more transparent
        if (this.towerPreview) {
            const material = this.towerPreview.material as StandardMaterial;
            material.alpha = 0.3;
        }
        
        // Store the position for later use
        this.confirmationButtons.position = position.clone();
        
        // Get the grid position and world position
        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        // Create a container for the confirmation buttons
        const container = new Rectangle('confirmationContainer');
        container.width = '300px';
        container.height = '50px';
        container.background = '#333333';
        container.alpha = 0.9;
        container.thickness = 1;
        container.cornerRadius = 5;
        container.color = "white";
        container.zIndex = 10; // Ensure it's on top of other UI elements
        
        // Position the container at the top center of the screen with more space
        container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        container.top = "70px"; // Just below the top stats panel
        
        // Add text to show what tower is being placed (in the middle)
        const towerTypeText = new TextBlock('towerTypeText');
        towerTypeText.text = `${this.selectedTowerType?.replace('Tower', '')} Tower`;
        towerTypeText.color = 'white';
        towerTypeText.fontSize = 14;
        towerTypeText.fontFamily = 'Arial';
        towerTypeText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        towerTypeText.top = "-15px";
        container.addControl(towerTypeText);
        
        // Create a stack panel for the buttons to ensure proper layout
        const buttonPanel = new Rectangle("buttonPanel");
        buttonPanel.width = "280px";
        buttonPanel.height = "40px";
        buttonPanel.thickness = 0;
        buttonPanel.background = "transparent";
        buttonPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        buttonPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        buttonPanel.top = "5px";
        container.addControl(buttonPanel);
        
        // Create confirm button (green check) - as a separate control
        const confirmButton = Button.CreateSimpleButton('confirmButton', '✓ Confirm');
        confirmButton.width = '130px';
        confirmButton.height = '30px';
        confirmButton.color = 'white';
        confirmButton.background = '#4CAF50';
        confirmButton.cornerRadius = 5;
        confirmButton.thickness = 1;
        confirmButton.fontFamily = 'Arial';
        confirmButton.fontSize = 16;
        confirmButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        confirmButton.isPointerBlocker = true;
        
        // Add direct click handler
        confirmButton.onPointerClickObservable.add(() => {
            console.log("Confirm button clicked");
            this.confirmTowerPlacement();
        });
        
        // Add up handler as backup
        confirmButton.onPointerUpObservable.add(() => {
            console.log("Confirm button up");
            this.confirmTowerPlacement();
        });
        
        buttonPanel.addControl(confirmButton);
        
        // Create cancel button (red X) - as a separate control
        const cancelButton = Button.CreateSimpleButton('cancelButton', '✗ Cancel');
        cancelButton.width = '130px';
        cancelButton.height = '30px';
        cancelButton.color = 'white';
        cancelButton.background = '#F44336';
        cancelButton.cornerRadius = 5;
        cancelButton.thickness = 1;
        cancelButton.fontFamily = 'Arial';
        cancelButton.fontSize = 16;
        cancelButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        cancelButton.isPointerBlocker = true;
        
        // Add direct click handler
        cancelButton.onPointerClickObservable.add(() => {
            console.log("Cancel button clicked");
            this.cancelTowerPlacement();
        });
        
        // Add up handler as backup
        cancelButton.onPointerUpObservable.add(() => {
            console.log("Cancel button up");
            this.cancelTowerPlacement();
        });
        
        buttonPanel.addControl(cancelButton);
        
        // Add the container to the UI
        this.ui.addControl(container);
        this.confirmationButtons.container = container;
        
        // Make sure the container is a pointer blocker
        container.isPointerBlocker = true;
        
        // Log for debugging
        console.log(`Showing confirmation buttons for ${this.selectedTowerType} at grid position (${gridPosition.x}, ${gridPosition.y})`);
    }

    private hideConfirmationButtons(): void {
        if (this.confirmationButtons.container && this.ui) {
            this.ui.removeControl(this.confirmationButtons.container);
            this.confirmationButtons.container = null;
            this.confirmationButtons.position = null;
        }
        
        // Reset placement state
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
        
        // Check if we can afford the tower
        const towerCost = this.getTowerCost(this.selectedTowerType);
        if (this.playerStats.getMoney() >= towerCost) {
            // Place the tower at the grid center position
            this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);
            
            // Mark the grid cell as occupied
            this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);
            
            // Play sound effect
            this.game.getAssetManager().playSound('towerShoot');
            
            console.log(`Tower placed at grid position (${gridPosition.x}, ${gridPosition.y})`);
        } else {
            console.log(`Not enough money to place tower. Need ${towerCost}, have ${this.playerStats.getMoney()}`);
        }
        
        // Hide confirmation buttons
        this.hideConfirmationButtons();
        
        // Keep the tower type selected for placing more towers
        this.placementState = 'selecting';
        
        // Show the preview again with normal transparency
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
        // Reset tower selection completely
        this.selectedTowerType = null;
        
        // Hide the preview
        if (this.towerPreview) {
            this.towerPreview.setEnabled(false);
        }
        if (this.squareOutline) {
            this.squareOutline.setEnabled(false);
        }
        
        console.log('Tower placement cancelled');
    }

    private getTowerCost(type: string): number {
        switch (type) {
            case 'basicTower': return 50;
            case 'fastTower': return 100;
            case 'heavyTower': return 150;
            case 'sniperTower': return 200;
            // Elemental tower costs
            case 'fireTower': return 125;
            case 'waterTower': return 125;
            case 'windTower': return 125;
            case 'earthTower': return 125;
            // Hybrid tower costs (these are typically created through combinations)
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

    /**
     * Create tabs for the left panel tower categories
     * @param parent The parent container
     */
    private createLeftPanelTabs(parent: Rectangle): void {
        const tabsContainer = new Rectangle('leftTabsContainer');
        tabsContainer.width = '90px';
        tabsContainer.height = '60px';
        tabsContainer.background = 'transparent';
        tabsContainer.thickness = 0;
        tabsContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        tabsContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        tabsContainer.top = '35px'; // Position just below the title background
        tabsContainer.zIndex = 5; // Lower than the title's zIndex
        parent.addControl(tabsContainer);
        
        // Create basic towers tab
        const basicLeftTab = Button.CreateSimpleButton('basicLeftTab', 'Basic');
        basicLeftTab.width = '80px';
        basicLeftTab.height = '25px'; // Slightly smaller
        basicLeftTab.color = 'white';
        basicLeftTab.background = '#388E3C'; // Solid color instead of gradient
        basicLeftTab.cornerRadius = 12;
        basicLeftTab.thickness = 1; // Add border
        basicLeftTab.fontFamily = 'Arial';
        basicLeftTab.fontSize = 14;
        basicLeftTab.fontWeight = 'bold';
        basicLeftTab.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        basicLeftTab.shadowColor = "rgba(0, 0, 0, 0.6)"; // Darker shadow
        basicLeftTab.shadowBlur = 5;
        basicLeftTab.shadowOffsetY = 2;
        basicLeftTab.isPointerBlocker = true; // Ensure clicks are captured
        
        // Add text outline for better visibility
        if (basicLeftTab.textBlock) {
            basicLeftTab.textBlock.outlineWidth = 1;
            basicLeftTab.textBlock.outlineColor = "black";
        }
        
        // Add hover effects for basic tab
        basicLeftTab.onPointerEnterObservable.add(() => {
            basicLeftTab.background = '#4CAF50'; // Lighter on hover
            basicLeftTab.shadowOffsetY = 4;
        });
        
        basicLeftTab.onPointerOutObservable.add(() => {
            if (this.ui) {
                const currentTab = this.ui.getControlByName('basicLeftTab') as Button;
                if (currentTab && currentTab !== basicLeftTab) {
                    basicLeftTab.background = '#388E3C'; // Back to original
                    basicLeftTab.shadowOffsetY = 2;
                }
            }
        });
        
        basicLeftTab.onPointerUpObservable.add(() => {
            this.switchLeftPanelCategory('basic');
        });
        tabsContainer.addControl(basicLeftTab);
        
        // Create elemental towers tab
        const elementalLeftTab = Button.CreateSimpleButton('elementalLeftTab', 'Elemental');
        elementalLeftTab.width = '80px';
        elementalLeftTab.height = '25px'; // Slightly smaller
        elementalLeftTab.color = 'white';
        elementalLeftTab.background = '#333333'; // Solid color instead of gradient
        elementalLeftTab.cornerRadius = 12;
        elementalLeftTab.thickness = 1; // Add border
        elementalLeftTab.fontFamily = 'Arial';
        elementalLeftTab.fontSize = 14;
        elementalLeftTab.fontWeight = 'bold';
        elementalLeftTab.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        elementalLeftTab.shadowColor = "rgba(0, 0, 0, 0.6)"; // Darker shadow
        elementalLeftTab.shadowBlur = 5;
        elementalLeftTab.shadowOffsetY = 2;
        elementalLeftTab.isPointerBlocker = true; // Ensure clicks are captured
        
        // Add text outline for better visibility
        if (elementalLeftTab.textBlock) {
            elementalLeftTab.textBlock.outlineWidth = 1;
            elementalLeftTab.textBlock.outlineColor = "black";
        }
        
        // Add hover effects for elemental tab
        elementalLeftTab.onPointerEnterObservable.add(() => {
            elementalLeftTab.background = '#555555'; // Lighter on hover
            elementalLeftTab.shadowOffsetY = 4;
        });
        
        elementalLeftTab.onPointerOutObservable.add(() => {
            if (this.ui) {
                const currentTab = this.ui.getControlByName('elementalLeftTab') as Button;
                if (currentTab && currentTab !== elementalLeftTab) {
                    elementalLeftTab.background = '#333333'; // Back to original
                    elementalLeftTab.shadowOffsetY = 2;
                }
            }
        });
        
        elementalLeftTab.onPointerUpObservable.add(() => {
            this.switchLeftPanelCategory('elemental');
        });
        tabsContainer.addControl(elementalLeftTab);
    }
    
    /**
     * Switch the tower category in the left panel
     * @param category The category to switch to
     */
    private switchLeftPanelCategory(category: 'basic' | 'elemental'): void {
        if (!this.ui) return;
        
        // Get all tower buttons
        const basicTowers = ['basicTower_left', 'fastTower_left', 'heavyTower_left', 'sniperTower_left'];
        const elementalTowers = ['fireTower_left', 'waterTower_left', 'windTower_left', 'earthTower_left'];
        
        // Show/hide appropriate tower buttons with animation
        for (const type of basicTowers) {
            const button = this.ui.getControlByName(`${type}`);
            if (button) {
                if (category === 'basic') {
                    button.isVisible = true;
                    // Add a small animation effect
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
            const button = this.ui.getControlByName(`${type}`);
            if (button) {
                if (category === 'elemental') {
                    button.isVisible = true;
                    // Add a small animation effect
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
        
        // Update the tab colors
        const basicTab = this.ui.getControlByName('basicLeftTab') as Button;
        const elementalTab = this.ui.getControlByName('elementalLeftTab') as Button;
        
        if (basicTab && elementalTab) {
            if (category === 'basic') {
                basicTab.background = '#4CAF50'; // Active color
                elementalTab.background = '#333333'; // Inactive color
            } else {
                basicTab.background = '#333333'; // Inactive color
                elementalTab.background = '#555555'; // Active color
            }
        }
    }
    
    /**
     * Create a vertical tower button for the left panel
     * @param id The button ID
     * @param name The tower name
     * @param cost The tower cost
     * @param color The button color
     * @param top The top position
     * @param parent The parent container
     * @param hidden Whether the button should be hidden initially
     */
    private createVerticalTowerButton(id: string, name: string, cost: string, color: string, top: number, parent: Rectangle, hidden: boolean = false): void {
        const button = new Rectangle(id);
        button.width = '80px';
        button.height = '65px';
        button.background = color;
        button.cornerRadius = 10;
        button.thickness = 0;
        button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        button.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        button.top = `${top}px`;
        button.isVisible = !hidden;
        button.isPointerBlocker = true;
        button.shadowColor = "rgba(0, 0, 0, 0.4)";
        button.shadowBlur = 5;
        button.shadowOffsetY = 2;
        
        // Add tower name
        const nameText = new TextBlock(`${id}_name`);
        nameText.text = name;
        nameText.color = 'white';
        nameText.fontSize = 16;
        nameText.fontFamily = 'Arial';
        nameText.fontWeight = 'bold';
        nameText.top = '-20px';
        nameText.outlineWidth = 1;
        nameText.outlineColor = 'black';
        button.addControl(nameText);
        
        // Add tower cost
        const costText = new TextBlock(`${id}_cost`);
        costText.text = cost;
        costText.color = 'white';
        costText.fontSize = 14;
        costText.fontFamily = 'Arial';
        costText.top = '20px';
        costText.outlineWidth = 1;
        costText.outlineColor = 'black';
        button.addControl(costText);
        
        // Add hover effect
        button.onPointerEnterObservable.add(() => {
            button.alpha = 0.8;
            button.shadowOffsetY = 4;
        });
        
        button.onPointerOutObservable.add(() => {
            button.alpha = 1;
            button.shadowOffsetY = 2;
        });
        
        // Add click effect
        button.onPointerDownObservable.add(() => {
            button.alpha = 0.6;
        });
        
        // Add click event - extract the tower type from the ID by removing "_left"
        button.onPointerUpObservable.add(() => {
            button.alpha = 0.8;
            const towerType = id.replace('_left', '');
            this.selectTowerType(towerType);
        });
        
        parent.addControl(button);
    }

    /**
     * Find a tower that owns the given mesh
     * @param mesh The mesh to check
     * @returns The tower that owns the mesh, or null if not found
     */
    private findTowerByMesh(mesh: AbstractMesh): Tower | null {
        if (!this.towerManager) return null;
        
        // Get all towers
        const towers = this.towerManager.getTowers();
        
        // Check if the mesh is part of any tower
        for (const tower of towers) {
            const towerMesh = tower.getMesh();
            // Check if the mesh is the tower's mesh or a child of it
            if (towerMesh && (towerMesh === mesh || this.isMeshChildOf(mesh, towerMesh))) {
                return tower;
            }
        }
        
        return null;
    }
    
    /**
     * Check if a mesh is a child of another mesh
     * @param child The potential child mesh
     * @param parent The potential parent mesh
     * @returns True if the child is a descendant of the parent
     */
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
    
    /**
     * Select a tower
     * @param tower The tower to select
     */
    private selectTower(tower: Tower): void {
        // Deselect current tower if there is one
        this.deselectTower();
        
        // Select the new tower
        this.selectedTower = tower;
        tower.select();
        
        // Show tower info and action buttons
        this.showTowerActions();
    }
    
    /**
     * Deselect the current tower
     */
    private deselectTower(): void {
        if (this.selectedTower) {
            this.selectedTower.deselect();
            this.selectedTower = null;
        }
        
        // Hide tower actions
        this.hideTowerActions();
    }
    
    /**
     * Show tower info and action buttons
     */
    private showTowerActions(): void {
        if (!this.ui || !this.selectedTower) return;
        
        // Create container for tower actions if it doesn't exist
        if (!this.towerInfoPanel) {
            this.towerInfoPanel = new Rectangle('towerInfoPanel');
            this.towerInfoPanel.width = "220px";
            this.towerInfoPanel.height = "160px";
            this.towerInfoPanel.cornerRadius = 10;
            this.towerInfoPanel.color = "#333333";
            this.towerInfoPanel.thickness = 2;
            this.towerInfoPanel.background = "#222222";
            this.towerInfoPanel.alpha = 0.9;
            this.towerInfoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.towerInfoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.towerInfoPanel.top = "-80px";
            this.towerInfoPanel.left = "-20px";
            this.ui.addControl(this.towerInfoPanel);
            
            // Add title
            const titleBlock = new TextBlock('towerInfoTitle', 'Tower Info');
            titleBlock.color = "white";
            titleBlock.fontSize = 16;
            titleBlock.height = "30px";
            titleBlock.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            titleBlock.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
            titleBlock.top = "10px";
            this.towerInfoPanel.addControl(titleBlock);
            
            // Create sell button
            this.sellButton = new Rectangle('sellButton');
            this.sellButton.width = "100px";
            this.sellButton.height = "40px";
            this.sellButton.cornerRadius = 5;
            this.sellButton.color = "#FF4444";
            this.sellButton.thickness = 2;
            this.sellButton.background = "#AA2222";
            this.sellButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.sellButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.sellButton.top = "-20px";
            this.sellButton.left = "0px";
            this.sellButton.isPointerBlocker = true; // Ensure clicks are captured
            
            // Add text to sell button
            const sellText = new TextBlock('sellText', 'SELL');
            sellText.color = "white";
            sellText.fontSize = 14;
            this.sellButton.addControl(sellText);
            
            // Add sell value text
            const sellValueText = new TextBlock('sellValueText', '');
            sellValueText.color = "white";
            sellValueText.fontSize = 12;
            sellValueText.top = "15px";
            this.sellButton.addControl(sellValueText);
            
            // Add hover effects for better feedback
            this.sellButton.onPointerEnterObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#DD3333";
                    this.sellButton.thickness = 3;
                }
            });
            
            this.sellButton.onPointerOutObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#AA2222";
                    this.sellButton.thickness = 2;
                }
            });
            
            // Add click effect
            this.sellButton.onPointerDownObservable.add(() => {
                if (this.sellButton) {
                    this.sellButton.background = "#991111";
                    this.sellButton.alpha = 0.8;
                }
            });
            
            // Add multiple click handlers to ensure the click is captured
            this.sellButton.onPointerClickObservable.add(() => {
                console.log("Sell button clicked");
                this.sellSelectedTower();
            });
            
            // Add up handler as backup
            this.sellButton.onPointerUpObservable.add(() => {
                console.log("Sell button up");
                if (this.sellButton) {
                    this.sellButton.background = "#DD3333";
                    this.sellButton.alpha = 1.0;
                }
                this.sellSelectedTower();
            });
            
            this.towerInfoPanel.addControl(this.sellButton);
            
            // Create upgrade button
            this.upgradeButton = new Rectangle('upgradeButton');
            this.upgradeButton.width = "100px";
            this.upgradeButton.height = "40px";
            this.upgradeButton.cornerRadius = 5;
            this.upgradeButton.color = "#44FF44";
            this.upgradeButton.thickness = 2;
            this.upgradeButton.background = "#22AA22";
            this.upgradeButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.upgradeButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.upgradeButton.top = "-70px";
            this.upgradeButton.left = "0px";
            this.upgradeButton.isPointerBlocker = true; // Ensure clicks are captured
            
            // Add text to upgrade button
            const upgradeText = new TextBlock('upgradeText', 'UPGRADE');
            upgradeText.color = "white";
            upgradeText.fontSize = 14;
            this.upgradeButton.addControl(upgradeText);
            
            // Add upgrade cost text
            const upgradeCostText = new TextBlock('upgradeCostText', '');
            upgradeCostText.color = "white";
            upgradeCostText.fontSize = 12;
            upgradeCostText.top = "15px";
            this.upgradeButton.addControl(upgradeCostText);
            
            // Add hover effects for better feedback
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
                        this.upgradeButton.thickness = 2;
                    } else {
                        this.upgradeButton.background = "#555555";
                        this.upgradeButton.color = "#777777";
                    }
                }
            });
            
            // Add click effect
            this.upgradeButton.onPointerDownObservable.add(() => {
                if (this.upgradeButton && this.playerStats && this.selectedTower && 
                    this.playerStats.getMoney() >= this.selectedTower.getUpgradeCost()) {
                    this.upgradeButton.background = "#119911";
                    this.upgradeButton.alpha = 0.8;
                }
            });
            
            // Add multiple click handlers to ensure the click is captured
            this.upgradeButton.onPointerClickObservable.add(() => {
                console.log("Upgrade button clicked");
                this.upgradeSelectedTower();
            });
            
            // Add up handler as backup
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
        
        // Update sell value text
        if (this.sellButton) {
            const sellValueTextBlock = this.sellButton.getChildByName('sellValueText') as TextBlock;
            if (sellValueTextBlock) {
                sellValueTextBlock.text = `$${this.selectedTower.getSellValue()}`;
            }
        }
        
        // Update upgrade cost text
        if (this.upgradeButton) {
            const upgradeCostTextBlock = this.upgradeButton.getChildByName('upgradeCostText') as TextBlock;
            if (upgradeCostTextBlock) {
                upgradeCostTextBlock.text = `$${this.selectedTower.getUpgradeCost()}`;
            }
            
            // Disable upgrade button if player doesn't have enough money
            if (this.playerStats && this.playerStats.getMoney() < this.selectedTower.getUpgradeCost()) {
                this.upgradeButton.background = "#555555";
                this.upgradeButton.color = "#777777";
            } else {
                this.upgradeButton.background = "#22AA22";
                this.upgradeButton.color = "#44FF44";
            }
        }
    }
    
    /**
     * Hide tower info and action buttons
     */
    private hideTowerActions(): void {
        if (this.towerInfoPanel) {
            this.towerInfoPanel.isVisible = false;
        }
    }
    
    /**
     * Sell the selected tower
     */
    private sellSelectedTower(): void {
        if (!this.selectedTower || !this.towerManager || !this.playerStats) {
            console.log("Cannot sell tower: missing tower, manager, or player stats");
            return;
        }
        
        console.log("Selling tower...");
        
        try {
            // Get the tower position for grid update
            const towerPosition = this.selectedTower.getPosition();
            
            // Get the sell value
            const sellValue = this.selectedTower.getSellValue();
            console.log(`Tower sell value: $${sellValue}`);
            
            // Sell the tower through the tower manager
            this.towerManager.sellTower(this.selectedTower);
            
            // Add money to player
            this.playerStats.addMoney(sellValue);
            console.log(`Added $${sellValue} to player. New balance: $${this.playerStats.getMoney()}`);
            
            // Free up the grid cell if map exists
            if (this.map && towerPosition) {
                const gridPosition = this.map.worldToGrid(towerPosition);
                this.map.setTowerPlaced(gridPosition.x, gridPosition.y, false);
                console.log(`Freed up grid cell at (${gridPosition.x}, ${gridPosition.y})`);
            }
            
            // Create a money particle effect at the tower's position
            this.createMoneyEffect(towerPosition);
            
            // Play sound effect
            this.game.getAssetManager().playSound('towerSell');
            
            // Clear selection
            this.selectedTower = null;
            
            // Hide tower actions
            this.hideTowerActions();
        } catch (error) {
            console.error("Error selling tower:", error);
        }
    }
    
    /**
     * Create a money particle effect
     * @param position The position to create the effect
     */
    private createMoneyEffect(position: Vector3): void {
        if (!this.scene) return;
        
        // Create a particle system for the money effect
        const particleSystem = new ParticleSystem('moneyParticles', 20, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        particleSystem.emitter = new Vector3(position.x, position.y + 1, position.z);
        particleSystem.minEmitBox = new Vector3(-0.5, 0, -0.5);
        particleSystem.maxEmitBox = new Vector3(0.5, 0.5, 0.5);
        
        // Set particle properties
        particleSystem.color1 = new Color4(1.0, 0.8, 0.0, 1.0); // Gold
        particleSystem.color2 = new Color4(0.8, 0.8, 0.0, 1.0); // Yellow
        particleSystem.colorDead = new Color4(0.5, 0.5, 0.0, 0.0); // Faded gold
        
        particleSystem.minSize = 0.2;
        particleSystem.maxSize = 0.5;
        
        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;
        
        particleSystem.emitRate = 50;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 5, 0); // Particles float upward
        
        particleSystem.direction1 = new Vector3(-1, 2, -1);
        particleSystem.direction2 = new Vector3(1, 5, 1);
        
        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        // Stop and dispose after 1.5 seconds
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1500);
        }, 500);
    }
    
    /**
     * Upgrade the selected tower
     */
    private upgradeSelectedTower(): void {
        if (!this.selectedTower || !this.towerManager || !this.playerStats) {
            console.log("Cannot upgrade tower: missing tower, manager, or player stats");
            return;
        }
        
        // Check if player has enough money
        const upgradeCost = this.selectedTower.getUpgradeCost();
        if (this.playerStats.getMoney() < upgradeCost) {
            console.log(`Not enough money to upgrade tower. Need $${upgradeCost}, have $${this.playerStats.getMoney()}`);
            
            // Play error sound
            this.game.getAssetManager().playSound('error');
            
            // Shake the upgrade button to indicate error
            this.shakeButton(this.upgradeButton);
            
            return;
        }
        
        console.log(`Upgrading tower for $${upgradeCost}...`);
        
        try {
            // Get the tower position for the upgrade effect
            const towerPosition = this.selectedTower.getPosition();
            
            // Upgrade the tower
            if (this.towerManager.upgradeTower(this.selectedTower)) {
                // Deduct money from player
                this.playerStats.spendMoney(upgradeCost);
                console.log(`Spent $${upgradeCost}. New balance: $${this.playerStats.getMoney()}`);
                
                // Create upgrade effect at the tower's position
                this.createUpgradeEffect(towerPosition);
                
                // Play sound effect
                this.game.getAssetManager().playSound('towerUpgrade');
                
                // Update tower actions UI
                this.showTowerActions();
                
                console.log(`Tower upgraded to level ${this.selectedTower.getLevel()}`);
            } else {
                console.log("Tower upgrade failed");
            }
        } catch (error) {
            console.error("Error upgrading tower:", error);
        }
    }
    
    /**
     * Create an upgrade particle effect
     * @param position The position to create the effect
     */
    private createUpgradeEffect(position: Vector3): void {
        if (!this.scene) return;
        
        // Create a particle system for the upgrade effect
        const particleSystem = new ParticleSystem('upgradeParticles', 50, this.scene);
        
        // Set particle texture
        particleSystem.particleTexture = new Texture('assets/textures/particle.png', this.scene);
        
        // Set emission properties
        particleSystem.emitter = new Vector3(position.x, position.y, position.z);
        particleSystem.minEmitBox = new Vector3(-1, 0, -1);
        particleSystem.maxEmitBox = new Vector3(1, 0, 1);
        
        // Set particle properties
        particleSystem.color1 = new Color4(0.0, 1.0, 0.0, 1.0); // Green
        particleSystem.color2 = new Color4(0.5, 1.0, 0.5, 1.0); // Light green
        particleSystem.colorDead = new Color4(0.0, 0.5, 0.0, 0.0); // Dark green
        
        particleSystem.minSize = 0.2;
        particleSystem.maxSize = 0.5;
        
        particleSystem.minLifeTime = 0.5;
        particleSystem.maxLifeTime = 1.5;
        
        particleSystem.emitRate = 100;
        
        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        
        particleSystem.gravity = new Vector3(0, 8, 0); // Particles float upward
        
        particleSystem.direction1 = new Vector3(-2, 5, -2);
        particleSystem.direction2 = new Vector3(2, 10, 2);
        
        particleSystem.minAngularSpeed = 0;
        particleSystem.maxAngularSpeed = Math.PI;
        
        particleSystem.minEmitPower = 1;
        particleSystem.maxEmitPower = 3;
        particleSystem.updateSpeed = 0.01;
        
        // Start the particle system
        particleSystem.start();
        
        // Stop and dispose after 1 second
        setTimeout(() => {
            particleSystem.stop();
            setTimeout(() => {
                particleSystem.dispose();
            }, 1500);
        }, 500);
        
        // Create a flash effect at the tower
        this.createUpgradeFlash(position);
    }
    
    /**
     * Create a flash effect for tower upgrade
     * @param position The position to create the effect
     */
    private createUpgradeFlash(position: Vector3): void {
        if (!this.scene) return;
        
        // Create a sphere for the flash
        const flash = MeshBuilder.CreateSphere('upgradeFlash', {
            diameter: 3,
            segments: 16
        }, this.scene);
        
        flash.position = new Vector3(position.x, position.y + 1, position.z);
        
        // Create material for the flash
        const flashMaterial = new StandardMaterial('upgradeFlashMaterial', this.scene);
        flashMaterial.diffuseColor = new Color3(0.3, 1.0, 0.3);
        flashMaterial.emissiveColor = new Color3(0.3, 1.0, 0.3);
        flashMaterial.alpha = 0.7;
        flash.material = flashMaterial;
        
        // Animate the flash to grow and fade
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
    
    /**
     * Shake a button to indicate an error
     * @param button The button to shake
     */
    private shakeButton(button: Rectangle | null): void {
        if (!button) return;
        
        const originalLeft = button.left;
        const shakeAmount = 5;
        const shakeSpeed = 50;
        
        // Shake the button
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) - shakeAmount}px`; }, shakeSpeed * 0);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) + shakeAmount}px`; }, shakeSpeed * 1);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) - shakeAmount}px`; }, shakeSpeed * 2);
        setTimeout(() => { button.left = `${parseInt(originalLeft as string) + shakeAmount}px`; }, shakeSpeed * 3);
        setTimeout(() => { button.left = originalLeft; }, shakeSpeed * 4);
    }

    /**
     * Place a tower at the specified position
     * @param position The world position to place the tower
     */
    private placeTowerAtPosition(position: Vector3): void {
        if (!this.map || !this.towerManager || !this.playerStats || !this.selectedTowerType) {
            return;
        }
        
        const gridPosition = this.map.worldToGrid(position);
        const worldPosition = this.map.gridToWorld(gridPosition.x, gridPosition.y);
        
        // Check if we can afford the tower
        const towerCost = this.getTowerCost(this.selectedTowerType);
        if (this.playerStats.getMoney() >= towerCost) {
            // Place the tower at the grid center position
            this.towerManager.createTower(this.selectedTowerType, new Vector3(worldPosition.x, position.y, worldPosition.z));
            this.playerStats.spendMoney(towerCost);
            
            // Mark the grid cell as occupied
            this.map.setTowerPlaced(gridPosition.x, gridPosition.y, true);
            
            // Play sound effect
            this.game.getAssetManager().playSound('towerShoot');
            
            console.log(`Tower placed at grid position (${gridPosition.x}, ${gridPosition.y})`);
        } else {
            console.log(`Not enough money to place tower. Need ${towerCost}, have ${this.playerStats.getMoney()}`);
        }
    }
} 