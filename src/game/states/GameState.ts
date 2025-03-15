import { Game } from '../Game';

export interface GameState {
    /**
     * Called when entering this state
     */
    enter(): void;
    
    /**
     * Called when exiting this state
     */
    exit(): void;
    
    /**
     * Called every frame to update the state
     * @param deltaTime Time elapsed since the last update in seconds
     */
    update(deltaTime: number): void;
} 