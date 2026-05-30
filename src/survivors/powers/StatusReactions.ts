// Babylon-free synergy registry: (incoming element, present status) -> reaction.
// Consumed by Phase 1b's dealElementalHit to fire cross-element combos
// (e.g. a storm hit on a Burning enemy detonates the burn — "Overload").
// MUST NOT import @babylonjs/core.
import type { RichStatusKind } from './StatusModel';

/** Element string matches PowerElement ('fire'|'ice'|'arcane'|'physical'|'storm'). */
export type ReactionKind = 'overload';

export interface Reaction {
    kind: ReactionKind;
}

const REACTIONS = new Map<string, Reaction>();

function key(element: string, status: RichStatusKind): string {
    return `${element}:${status}`;
}

export function registerReaction(element: string, status: RichStatusKind, reaction: Reaction): void {
    REACTIONS.set(key(element, status), reaction);
}

export function getReaction(element: string, status: RichStatusKind): Reaction | undefined {
    return REACTIONS.get(key(element, status));
}

// Built-in reactions.
registerReaction('storm', 'burn', { kind: 'overload' });
