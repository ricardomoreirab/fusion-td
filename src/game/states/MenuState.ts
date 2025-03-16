import { AdvancedDynamicTexture, Button, Control, TextBlock, Rectangle } from '@babylonjs/gui';
import { Game } from '../Game';
import { GameState } from './GameState';

export class MenuState implements GameState {
    private game: Game;
    private ui: AdvancedDynamicTexture | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering menu state');
        
        // Create UI
        this.createUI();
        
        // Play background music
        this.game.getAssetManager().playSound('bgMusic');
    }

    public exit(): void {
        console.log('Exiting menu state');
        
        // Dispose UI
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
    }

    public update(deltaTime: number): void {
        // Nothing to update in menu state
    }

    private createUI(): void {
        // Create fullscreen UI
        this.ui = AdvancedDynamicTexture.CreateFullscreenUI('menuUI', true, this.game.getScene());
        
        // Create title
        const titleText = new TextBlock('titleText');
        titleText.text = 'FUSION TD';
        titleText.color = 'white';
        titleText.fontSize = 60;
        titleText.top = '-200px';
        titleText.fontFamily = 'Arial';
        titleText.shadowColor = 'black';
        titleText.shadowBlur = 5;
        titleText.shadowOffsetX = 3;
        titleText.shadowOffsetY = 3;
        this.ui.addControl(titleText);
        
        // Create subtitle
        const subtitleText = new TextBlock('subtitleText');
        subtitleText.text = 'Tower Defense';
        subtitleText.color = '#cccccc';
        subtitleText.fontSize = 30;
        subtitleText.top = '-130px';
        subtitleText.fontFamily = 'Arial';
        this.ui.addControl(subtitleText);
        
        // Create start button with mobile-friendly dimensions
        const startButton = Button.CreateSimpleButton('startButton', 'START GAME');
        startButton.width = '220px';
        startButton.height = '60px';
        startButton.color = 'white';
        startButton.background = '#4CAF50';
        startButton.cornerRadius = 30;
        startButton.thickness = 2;
        startButton.fontFamily = 'Arial';
        startButton.fontSize = 24;
        startButton.fontWeight = 'bold';
        startButton.top = '0px';
        startButton.paddingLeft = '20px';
        startButton.paddingRight = '20px';
        startButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        startButton.shadowBlur = 5;
        startButton.shadowOffsetY = 2;
        startButton.onPointerUpObservable.add(() => {
            this.game.getStateManager().changeState('gameplay');
        });
        this.ui.addControl(startButton);
        
        // Create instructions button with mobile-friendly dimensions
        const instructionsButton = Button.CreateSimpleButton('instructionsButton', 'INSTRUCTIONS');
        instructionsButton.width = '220px';
        instructionsButton.height = '60px';
        instructionsButton.color = 'white';
        instructionsButton.background = '#2196F3';
        instructionsButton.cornerRadius = 30;
        instructionsButton.thickness = 2;
        instructionsButton.fontFamily = 'Arial';
        instructionsButton.fontSize = 24;
        instructionsButton.fontWeight = 'bold';
        instructionsButton.top = '80px';
        instructionsButton.paddingLeft = '20px';
        instructionsButton.paddingRight = '20px';
        instructionsButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        instructionsButton.shadowBlur = 5;
        instructionsButton.shadowOffsetY = 2;
        instructionsButton.onPointerUpObservable.add(() => {
            this.showInstructions();
        });
        this.ui.addControl(instructionsButton);
    }

    private showInstructions(): void {
        // Create background panel
        const panel = new Rectangle();
        panel.width = '600px';
        panel.height = '400px';
        panel.cornerRadius = 20;
        panel.background = '#333333';
        panel.alpha = 0.9;
        panel.thickness = 2;
        panel.color = '#ffffff';
        this.ui?.addControl(panel);
        
        // Create title
        const titleText = new TextBlock('instructionsTitle');
        titleText.text = 'HOW TO PLAY';
        titleText.color = 'white';
        titleText.fontSize = 30;
        titleText.top = '-160px';
        titleText.fontFamily = 'Arial';
        panel.addControl(titleText);
        
        // Create instructions text
        const instructionsText = new TextBlock('instructionsText');
        instructionsText.text = 
            '1. Place towers on the map to defend against enemies\n\n' +
            '2. Enemies follow the path from the start to your base\n\n' +
            '3. Each enemy that reaches your base reduces your health\n\n' +
            '4. Destroy enemies to earn money for more towers\n\n' +
            '5. Upgrade towers to increase their power\n\n' +
            '6. Survive all waves to win!';
        instructionsText.color = 'white';
        instructionsText.fontSize = 18;
        instructionsText.top = '0px';
        instructionsText.fontFamily = 'Arial';
        instructionsText.textWrapping = true;
        instructionsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        instructionsText.paddingLeft = '30px';
        instructionsText.paddingRight = '30px';
        panel.addControl(instructionsText);
        
        // Create close button
        const closeButton = Button.CreateSimpleButton('closeButton', 'CLOSE');
        closeButton.width = '160px';
        closeButton.height = '50px';
        closeButton.color = 'white';
        closeButton.background = '#F44336';
        closeButton.cornerRadius = 25;
        closeButton.thickness = 2;
        closeButton.fontFamily = 'Arial';
        closeButton.fontSize = 20;
        closeButton.fontWeight = 'bold';
        closeButton.paddingLeft = '15px';
        closeButton.paddingRight = '15px';
        closeButton.shadowColor = "rgba(0, 0, 0, 0.4)";
        closeButton.shadowBlur = 5;
        closeButton.shadowOffsetY = 2;
        closeButton.onPointerUpObservable.add(() => {
            this.ui?.removeControl(panel);
        });
        panel.addControl(closeButton);
    }
} 