import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDevHost, isTestModeEnabled } from '../src/engine/devHost';

afterEach(() => { vi.restoreAllMocks(); });

describe('dev host detection', () => {
    it.each([
        'localhost',
        'LOCALHOST',
        '127.0.0.1',
        '127.1.2.3',      // all of 127.0.0.0/8 is loopback
        '::1',
        '[::1]',
        'app.localhost',
        'macbook-pro.local',
        '',               // file:// and about:blank
    ])('allows %o', h => {
        expect(isDevHost(h)).toBe(true);
    });

    it.each([
        '192.168.1.5',    // npm run start:lan, opened on a phone
        '192.168.0.1',
        '10.0.0.7',
        '10.255.255.255',
        '172.16.0.1',
        '172.31.255.255',
    ])('allows the LAN address %o so phone testing keeps working', h => {
        expect(isDevHost(h)).toBe(true);
    });

    it.each([
        'fusion-td.ricardo-1d8.workers.dev',
        'example.com',
        'ricardombc.com.br',
    ])('refuses the deployed host %o', h => {
        expect(isDevHost(h)).toBe(false);
    });

    it.each([
        // The whole point of matching whole labels rather than substrings: every
        // one of these contains an allowed name and none of them is a dev host.
        'evil-localhost.com',
        'localhost.evil.com',
        'notlocalhost',
        'mylocal',
        'local.evil.com',
        'evil.local.com',
        '127.0.0.1.evil.com',
        '192.168.1.5.evil.com',
        'x10.0.0.1',
    ])('refuses the lookalike %o', h => {
        expect(isDevHost(h)).toBe(false);
    });

    it.each([
        '172.15.0.1',     // just below the private block
        '172.32.0.1',     // just above it
        '172.0.0.1',
        '172.255.0.1',
    ])('refuses %o — 172 is only private in 16..31', h => {
        expect(isDevHost(h)).toBe(false);
    });

    it.each([
        '11.0.0.1', '193.168.1.1', '192.169.1.1', '9.255.255.255',
    ])('refuses the near-miss public address %o', h => {
        expect(isDevHost(h)).toBe(false);
    });

    it.each([
        '10.0.0',          // too few octets
        '10.0.0.1.1',      // too many
        '10.0.0.256',      // out of range
        '10.0.0.-1',
        '10.0.0.0x1',
        '10.0.0.a',
    ])('refuses the malformed address %o', h => {
        expect(isDevHost(h)).toBe(false);
    });
});

describe('test-mode gate', () => {
    it('needs BOTH the flag and a dev host', () => {
        expect(isTestModeEnabled({ search: '?test', hostname: 'localhost' })).toBe(true);
        expect(isTestModeEnabled({ search: '', hostname: 'localhost' })).toBe(false);
        expect(isTestModeEnabled({ search: '?test', hostname: 'example.com' })).toBe(false);
    });

    it('cannot be turned on from the URL bar of the deployed game', () => {
        // The reason this gate exists: ?test grants an invulnerable hero, and a
        // finished run posts to the SHARED leaderboard.
        for (const search of ['?test', '?test=1', '?test&champ=mage', '?champ=mage&test']) {
            expect(isTestModeEnabled({ search, hostname: 'fusion-td.ricardo-1d8.workers.dev' }))
                .toBe(false);
        }
    });

    it('says why it refused, so a dead ?test URL is not read as a broken build', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        isTestModeEnabled({ search: '?test', hostname: 'example.com' });
        expect(info).toHaveBeenCalledTimes(1);
        expect(String(info.mock.calls[0][0])).toContain('dev hosts only');
    });

    it('stays quiet when no one asked for it', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        isTestModeEnabled({ search: '?champ=mage', hostname: 'example.com' });
        expect(info).not.toHaveBeenCalled();
    });
});
