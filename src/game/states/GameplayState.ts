import { Engine, Scene, Vector3, Color3, Color4, ArcRotateCamera, HemisphericLight, DirectionalLight, PointLight, ShadowGenerator, MeshBuilder, StandardMaterial, Texture, KeyboardEventTypes, Mesh, LinesMesh, Matrix, PointerEventTypes, PointerInfo } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Rectangle, TextBlock, Image, Grid, StackPanel } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';
import { Map } from '../gameplay/Map';
import { TowerManager } from '../gameplay/TowerManager';
import { EnemyManager } from '../gameplay/EnemyManager';
import { WaveManager } from '../gameplay/WaveManager';
import { PlayerStats } from '../gameplay/PlayerStats';

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
                this.waveManager.startNextWave();
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
            if (evt.button !== 0) return;
            
            // If we're in tower placement mode
            if (this.selectedTowerType && this.scene) {
                // Check if we clicked on a UI element
                const pickInfo = this.scene.pick(
                    this.scene.pointerX, 
                    this.scene.pointerY
                );
                
                // Skip if we're clicking on a UI element
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
                
                if (pickResult.hit) {
                    const position = pickResult.pickedPoint;
                    if (position && this.map) {
                        // Check if the position is valid for tower placement
                        const gridPosition = this.map.worldToGrid(position);
                        if (this.map.canPlaceTower(gridPosition.x, gridPosition.y)) {
                            // Show confirmation buttons
                            this.showConfirmationButtons(position);
                        }
                    }
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
        // Clear any existing confirmation state
        this.hideConfirmationButtons();
        
        // Set the selected tower type
        this.selectedTowerType = type;
        this.placementState = 'selecting';
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
        // Hide confirmation buttons
        this.hideConfirmationButtons();
        
        // Reset tower selection completely
        this.selectedTowerType = null;
        this.placementState = 'selecting';
        
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
} 