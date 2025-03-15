import { GameState } from '../states/GameState';
import { Game } from '../Game';

export class StateManager {
    private states: Map<string, GameState>;
    private currentState: GameState | null;
    private currentStateName: string | null;
    private game: Game;

    constructor(game: Game) {
        this.game = game;
        this.states = new Map<string, GameState>();
        this.currentState = null;
        this.currentStateName = null;
    }

    /**
     * Register a new state
     * @param name The name of the state
     * @param state The state instance
     */
    public registerState(name: string, state: GameState): void {
        this.states.set(name, state);
    }

    /**
     * Change to a different state
     * @param name The name of the state to change to
     */
    public changeState(name: string): void {
        if (!this.states.has(name)) {
            console.error(`State '${name}' does not exist`);
            return;
        }

        // Exit the current state if there is one
        if (this.currentState) {
            this.currentState.exit();
        }

        // Clean up the scene to ensure a fresh start
        this.game.cleanupScene();

        // Get the new state
        const newState = this.states.get(name)!;
        
        // Update current state
        this.currentState = newState;
        this.currentStateName = name;
        
        // Enter the new state
        this.currentState.enter();
        
        console.log(`Changed to state: ${name}`);
    }

    /**
     * Update the current state
     * @param deltaTime Time elapsed since the last update in seconds
     */
    public update(deltaTime: number): void {
        if (this.currentState) {
            this.currentState.update(deltaTime);
        }
    }

    /**
     * Get the current state name
     * @returns The name of the current state
     */
    public getCurrentStateName(): string | null {
        return this.currentStateName;
    }
} 