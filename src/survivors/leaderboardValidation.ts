/** A run score as submitted by the client and stored in D1. */
export interface ScoreSubmission {
    name: string;
    wave: number;
    timeSec: number;
    kills: number;
    gold: number;
    champion?: string;
}

/** A ranked row returned by the leaderboard API. */
export interface LeaderboardEntry extends ScoreSubmission {
    rank: number;
}

export type ValidationResult =
    | { ok: true; value: ScoreSubmission }
    | { ok: false; error: string };

const MAX = {
    nameLen: 16,
    wave: 200,
    timeSec: 7200,
    kills: 100000,
    gold: 10000000,
    championLen: 32,
};

function isFiniteInt(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
}

/** Remove control chars, trim, and clamp a free-text field. */
function sanitizeText(raw: string, maxLen: number): string {
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

/**
 * Casual server-side sanity validation for a submitted run. Trusts the client
 * but rejects clearly-impossible values and sanitizes the display name. Pure
 * (no I/O) so it is unit-tested and shared by the Worker and the client.
 */
export function validateScore(raw: unknown): ValidationResult {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' };
    const r = raw as Record<string, unknown>;

    const name = sanitizeText(typeof r.name === 'string' ? r.name : '', MAX.nameLen);
    if (name.length === 0) return { ok: false, error: 'name required' };

    if (!isFiniteInt(r.wave) || r.wave < 1 || r.wave > MAX.wave) return { ok: false, error: 'wave out of range' };
    if (!isFiniteInt(r.timeSec) || r.timeSec < 0 || r.timeSec > MAX.timeSec) return { ok: false, error: 'timeSec out of range' };
    if (!isFiniteInt(r.kills) || r.kills < 0 || r.kills > MAX.kills) return { ok: false, error: 'kills out of range' };
    if (!isFiniteInt(r.gold) || r.gold < 0 || r.gold > MAX.gold) return { ok: false, error: 'gold out of range' };

    let champion: string | undefined;
    if (r.champion !== undefined && r.champion !== null) {
        if (typeof r.champion !== 'string') return { ok: false, error: 'champion must be a string' };
        champion = sanitizeText(r.champion, MAX.championLen) || undefined;
    }

    return { ok: true, value: { name, wave: r.wave, timeSec: r.timeSec, kills: r.kills, gold: r.gold, champion } };
}
