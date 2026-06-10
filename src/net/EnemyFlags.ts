// Pure bitfield helpers for enemy status flags. No Babylon, no DOM — safe for Vitest.

export interface EnemyFlags {
    frozen: boolean;
    stunned: boolean;
    confused: boolean;
    flying: boolean;
    elite: boolean;
    meleePhase: number; // 0..3
}

export function packEnemyFlags(f: EnemyFlags): number {
    return (f.frozen ? 1 : 0)
        | (f.stunned ? 1 << 1 : 0)
        | (f.confused ? 1 << 2 : 0)
        | (f.flying ? 1 << 3 : 0)
        | (f.elite ? 1 << 4 : 0)
        | ((f.meleePhase & 0b11) << 5);
}

export function unpackEnemyFlags(bits: number): EnemyFlags {
    return {
        frozen: (bits & 1) !== 0,
        stunned: (bits & (1 << 1)) !== 0,
        confused: (bits & (1 << 2)) !== 0,
        flying: (bits & (1 << 3)) !== 0,
        elite: (bits & (1 << 4)) !== 0,
        meleePhase: (bits >> 5) & 0b11,
    };
}
