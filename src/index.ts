import { Game } from './game/Game';

// Wait for the DOM to be ready
window.addEventListener('DOMContentLoaded', () => {
    // Create and start the game. start() is async because the WebGPU engine
    // (when supported by the browser) requires async initialisation. We don't
    // await it at the top level — the loading screen stays visible until
    // assets finish, and resize handler is safe before engine init.
    const game = new Game('renderCanvas');
    game.start().catch(err => console.error('Game failed to start:', err));

    // Handle window resize
    window.addEventListener('resize', () => {
        game.resize();
    });
});