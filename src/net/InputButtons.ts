// Pure bitfield helpers for the InputMsg buttons field. No Babylon, no DOM — safe for Vitest.

export interface InputButtons {
    /** Dash/dodge action. */
    dash: boolean;
    /** Ultimate ability slot 1. */
    ult1: boolean;
    /** Ultimate ability slot 2. */
    ult2: boolean;
    /** Ability slot 3. */
    ability3: boolean;
}

export function packButtons(b: InputButtons): number {
    return (b.dash     ? 1      : 0)
         | (b.ult1     ? 1 << 1 : 0)
         | (b.ult2     ? 1 << 2 : 0)
         | (b.ability3 ? 1 << 3 : 0);
}

export function unpackButtons(bits: number): InputButtons {
    return {
        dash:     (bits & 1)      !== 0,
        ult1:     (bits & (1<<1)) !== 0,
        ult2:     (bits & (1<<2)) !== 0,
        ability3: (bits & (1<<3)) !== 0,
    };
}
