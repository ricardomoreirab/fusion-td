/**
 * Is this page being served from a development machine, as opposed to the
 * deployed game?
 *
 * `?test` hands out an invulnerable hero, free ascension levels, a horde
 * spawner and the whole enemy roster on a hotkey. On the deployed site that is
 * a cheat anyone can turn on from the URL bar — and since a finished run posts
 * to the shared leaderboard, an invulnerable one can post an arbitrary score.
 * Gating on the host keeps the switch where it is useful and off where it is
 * not.
 *
 * Deliberately allows the LAN as well as loopback: `npm run start:lan` exists so
 * the game can be opened on a phone against the dev machine's private IP, and a
 * strict localhost-only check would silently kill that workflow.
 *
 * This is a convenience gate, not a security boundary. Anything client-side is
 * reachable with devtools; the point is that a casual visitor cannot enable it
 * by editing the address bar.
 */

/** 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 — the RFC1918 private ranges a dev
 *  server binds to for LAN testing. 172 is range-checked rather than
 *  prefix-matched: 172.15.x and 172.32.x are public. */
function isPrivateIPv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4) return false;
    const octets = parts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
    if (octets.some(o => Number.isNaN(o) || o > 255)) return false;
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
}

/**
 * @param hostname `location.hostname` — already stripped of port and userinfo by
 *   the browser, and for IPv6 the surrounding brackets are removed too.
 */
export function isDevHost(hostname: string): boolean {
    const h = hostname.toLowerCase();

    // file:// and about:blank hand back an empty host.
    if (h === '') return true;

    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
    // Whole-label suffixes only — `evil-localhost.com` and `localhost.evil.com`
    // must NOT match, which a substring test would let through.
    if (h.endsWith('.localhost')) return true;
    // mDNS/Bonjour names, e.g. `macbook-pro.local`.
    if (h.endsWith('.local')) return true;

    // 127.0.0.0/8 is all loopback, not just 127.0.0.1.
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;

    return isPrivateIPv4(h);
}

/**
 * True when `?test` is present AND the host is allowed to honour it.
 *
 * Logs when the flag was asked for and refused — otherwise a `?test` URL that
 * silently does nothing on the deployed site looks like a broken build.
 */
export function isTestModeEnabled(loc: { search: string; hostname: string }): boolean {
    const requested = new URLSearchParams(loc.search).has('test');
    if (!requested) return false;
    if (isDevHost(loc.hostname)) return true;
    console.info(`[test] ?test ignored on "${loc.hostname}" — dev hosts only.`);
    return false;
}
