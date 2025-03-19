/**
 * Enum representing the different states of a wave
 */
export enum WaveStatus {
    /**
     * No wave is active, ready to start the next wave
     */
    Ready,
    
    /**
     * A wave is currently in progress with enemies spawning or active on the map
     */
    InProgress,
    
    /**
     * Between waves, counting down to the next wave
     */
    Countdown
} 