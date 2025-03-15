import { Game } from './game/Game';

// Wait for the DOM to be ready
window.addEventListener('DOMContentLoaded', () => {
    // Create and start the game
    const game = new Game('renderCanvas');
    game.start();

    // Handle window resize
    window.addEventListener('resize', () => {
        game.resize();
    });
}); 