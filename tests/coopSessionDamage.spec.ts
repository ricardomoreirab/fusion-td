import { describe, it, expect, vi } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';
import { CoopSession } from '../src/survivors/coop/CoopSession';
import type { DamageReportMsg, DamageResultMsg } from '../src/net/Protocol';

/** Build a paired host/guest CoopSession via FakeTransports. */
function makeCoopPair(): { host: CoopSession; guest: CoopSession; hostT: FakeTransport; guestT: FakeTransport } {
    const [hostT, guestT] = FakeTransport.pair();
    const hostClient  = new NetClient(hostT);
    const guestClient = new NetClient(guestT);
    const host  = new CoopSession(hostClient, 'barbarian');
    const guest = new CoopSession(guestClient, 'ranger');
    return { host, guest, hostT, guestT };
}

describe('CoopSession M3 — damageReport plumbing', () => {
    it('host onDamageReport fires when guest sends a damageReport', () => {
        const { host, guest, hostT } = makeCoopPair();

        const report: DamageReportMsg = { t: 'damageReport', enemyId: 7, amount: 42, element: 'fire', sourceHeroId: 1 };
        const cb = vi.fn();
        host.onDamageReport = cb;

        guest.sendDamageReport(report);
        // Flush host transport (delivers guest → host queue)
        hostT.flush();

        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith(report);
    });

    it('multiple damageReport messages each fire the callback', () => {
        const { host, guest, hostT } = makeCoopPair();

        const cb = vi.fn();
        host.onDamageReport = cb;

        guest.sendDamageReport({ t: 'damageReport', enemyId: 1, amount: 10, element: 'physical', sourceHeroId: 1 });
        guest.sendDamageReport({ t: 'damageReport', enemyId: 2, amount: 20, element: 'ice', sourceHeroId: 1 });
        hostT.flush();

        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb.mock.calls[0][0].enemyId).toBe(1);
        expect(cb.mock.calls[1][0].enemyId).toBe(2);
    });
});

describe('CoopSession M3 — damageResult plumbing', () => {
    it('guest onDamageResult fires when host sends a damageResult', () => {
        const { host, guest, guestT } = makeCoopPair();

        const result: DamageResultMsg = { t: 'damageResult', enemyId: 7, amount: 42, isCrit: true, element: 'fire', x: 3, z: -1 };
        const cb = vi.fn();
        guest.onDamageResult = cb;

        host.sendDamageResult(result);
        // Flush guest transport (delivers host → guest queue)
        guestT.flush();

        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith(result);
    });

    it('multiple damageResult messages each fire the callback', () => {
        const { host, guest, guestT } = makeCoopPair();

        const cb = vi.fn();
        guest.onDamageResult = cb;

        host.sendDamageResult({ t: 'damageResult', enemyId: 3, amount: 15, isCrit: false, element: 'arcane', x: 0, z: 0 });
        host.sendDamageResult({ t: 'damageResult', enemyId: 4, amount: 30, isCrit: true,  element: 'storm',  x: 1, z: 2 });
        guestT.flush();

        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb.mock.calls[1][0].isCrit).toBe(true);
    });
});
