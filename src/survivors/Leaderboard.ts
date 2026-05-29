import type { LeaderboardEntry, ScoreSubmission } from './leaderboardValidation';
import type { SurvivorsRunSummary } from '../game-over/GameOverState';

const API = '/api/scores';

/**
 * Submit a finished run to the global leaderboard. Returns the rank earned, or
 * null if the request failed (offline, the webpack dev server has no Worker, or
 * a server error) — callers must degrade gracefully.
 */
export async function submitScore(
    summary: SurvivorsRunSummary,
    name: string,
): Promise<{ rank: number } | null> {
    const payload: ScoreSubmission = {
        name,
        // Clamp to 1: a death before wave 1 starts reports wave 0, which the
        // server rejects (wave >= 1) and would surface a spurious submit failure.
        wave: Math.max(1, Math.trunc(summary.waveReached)),
        timeSec: Math.trunc(summary.timeSurvivedSec),
        kills: Math.trunc(summary.kills),
        gold: Math.trunc(summary.goldCollected),
        champion: summary.championType,
    };
    try {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { ok?: boolean; rank?: number };
        return data.ok && typeof data.rank === 'number' ? { rank: data.rank } : null;
    } catch {
        return null;
    }
}

/** Fetch the top-N leaderboard entries. Returns [] on any failure. */
export async function fetchTop(limit = 20): Promise<LeaderboardEntry[]> {
    try {
        const res = await fetch(`${API}?limit=${Math.trunc(limit)}`);
        if (!res.ok) return [];
        const data = (await res.json()) as { scores?: LeaderboardEntry[] };
        return Array.isArray(data.scores) ? data.scores : [];
    } catch {
        return [];
    }
}
