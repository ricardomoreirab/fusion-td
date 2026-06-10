// Pure run-state predicates for co-op. No Babylon, no DOM — safe for Vitest.

export interface SlotAliveView { id: number; alive: boolean }

/** Count alive heroes. */
export function aliveCount(slots: SlotAliveView[]): number {
    return slots.filter(s => s.alive).length;
}

/** True when the run is over (no heroes alive). Single-player: length-1. */
export function isRunOver(slots: SlotAliveView[]): boolean {
    return slots.length > 0 && aliveCount(slots) === 0;
}

/** True when a just-died hero should SPECTATE instead of ending the run
 *  (co-op, ≥1 teammate still alive). */
export function shouldSpectate(slots: SlotAliveView[], isCoop: boolean): boolean {
    return isCoop && aliveCount(slots) > 0;
}
