// Pure logic — no Babylon, no DOM. Covered by tests/WaveElites.spec.ts.
//
// Rule: every wave ends with one elite per distinct non-boss enemy type that
// appeared in the wave. Each elite in the same wave gets a different element
// (so the player always sees varied power-orb drops). With 5 elements and at
// most 6 trash types, we always have enough distinct elements.

export type EliteElement = 'fire' | 'ice' | 'arcane' | 'physical' | 'storm';

export interface EliteSpec {
    type: string;
    element: EliteElement;
    count: number;
}

export interface WaveElitesInput {
    enemies: { type: string; count: number }[];
}

const ELEMENTS: readonly EliteElement[] = ['fire', 'ice', 'arcane', 'physical', 'storm'];

export function computeWaveElites(
    wave: WaveElitesInput,
    rng: () => number = Math.random,
): EliteSpec[] {
    const types: string[] = [];
    for (const g of wave.enemies) {
        if (g.type === 'boss' || g.count <= 0) continue;
        if (!types.includes(g.type)) types.push(g.type);
    }
    if (types.length === 0) return [];

    // Fisher-Yates shuffle of the element pool, then take the first N.
    const pool: EliteElement[] = [...ELEMENTS];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return types.map((type, i) => ({ type, element: pool[i], count: 1 }));
}
