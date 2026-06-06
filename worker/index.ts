/// <reference types="@cloudflare/workers-types" />
import { validateScore, type LeaderboardEntry } from '../src/survivors/leaderboardValidation';

export { Room } from './rooms/Room';

interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    ROOMS: DurableObjectNamespace;
}

interface ScoreRow {
    name: string;
    wave: number;
    time_sec: number;
    kills: number;
    gold: number;
    champion: string | null;
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

async function handleGet(env: Env, url: URL): Promise<Response> {
    // null (param absent) → '20'; '' (present but empty) → Number('')=0 → clamped to 1. Clamp to [1, 100].
    const rawLimit = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20;

    const result = await env.DB
        .prepare('SELECT name, wave, time_sec, kills, gold, champion FROM scores ORDER BY wave DESC, time_sec DESC LIMIT ?1')
        .bind(limit)
        .all<ScoreRow>();

    const scores: LeaderboardEntry[] = (result.results ?? []).map((row, i) => ({
        rank: i + 1,
        name: row.name,
        wave: row.wave,
        timeSec: row.time_sec,
        kills: row.kills,
        gold: row.gold,
        champion: row.champion ?? undefined,
    }));

    return json({ scores });
}

async function handlePost(request: Request, env: Env): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return json({ ok: false, error: 'invalid json' }, 400);
    }

    const v = validateScore(body);
    if (!v.ok) return json({ ok: false, error: v.error }, 400);
    const s = v.value;

    await env.DB
        .prepare('INSERT INTO scores (name, wave, time_sec, kills, gold, champion, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(s.name, s.wave, s.timeSec, s.kills, s.gold, s.champion ?? null, Date.now())
        .run();

    // Rank = number of rows that rank strictly higher, + 1. Ties on (wave, time)
    // share a rank; the just-inserted row is excluded by the strict comparison.
    // Non-atomic INSERT-then-COUNT: a concurrent insert could race and make this
    // rank off by one. Acceptable for a casual leaderboard.
    const rankRow = await env.DB
        .prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE wave > ?1 OR (wave = ?1 AND time_sec > ?2)')
        .bind(s.wave, s.timeSec)
        .first<{ rank: number }>();

    return json({ ok: true, rank: rankRow?.rank ?? null });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/api/scores') {
            try {
                if (request.method === 'GET') return await handleGet(env, url);
                if (request.method === 'POST') return await handlePost(request, env);
                return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), {
                    status: 405,
                    headers: { 'content-type': 'application/json', Allow: 'GET, POST' },
                });
            } catch (err) {
                console.error('leaderboard error', err);
                return json({ ok: false, error: 'internal error' }, 500);
            }
        }
        return env.ASSETS.fetch(request);
    },
};
