import { describe, it, expect, vi } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';
import { CoopSession } from '../src/survivors/coop/CoopSession';
import type { SnapshotMsg, SpawnMsg, DeathMsg } from '../src/net/Protocol';

/** Build a paired host/guest CoopSession via FakeTransports. */
function makeCoopPair(): { host: CoopSession; guest: CoopSession; hostT: FakeTransport; guestT: FakeTransport } {
    const [hostT, guestT] = FakeTransport.pair();
    const hostClient  = new NetClient(hostT);
    const guestClient = new NetClient(guestT);
    const host  = new CoopSession(hostClient, 'barbarian');
    const guest = new CoopSession(guestClient, 'ranger');
    return { host, guest, hostT, guestT };
}

describe('CoopSession M3 — snapshot plumbing', () => {
    it('guest receives snapshot sent by host', () => {
        const { host, guest, guestT } = makeCoopPair();

        const snap: SnapshotMsg = {
            t: 'snapshot',
            tick: 42,
            ackSeq: 0,
            timeScale: 1,
            heroes: [],
            enemies: [
                { id: 1, x: 3, z: 5, ry: 0.5, hp: 80, flags: 0, anim: 1 },
                { id: 2, x: -1, z: 2, ry: 1.2, hp: 50, flags: 1, anim: 0 },
            ],
            wave: { n: 3, alive: 2, inProgress: 1, breather: 0 },
        };

        expect(guest.getLatestSnapshot()).toBeNull();

        host.sendEnemySnapshot(snap);
        // Flush the guest transport (delivers host → guest queue)
        guestT.flush();

        expect(guest.getLatestSnapshot()).toEqual(snap);
    });

    it('later snapshot overwrites the earlier one (last-wins)', () => {
        const { host, guest, guestT } = makeCoopPair();

        const snap1: SnapshotMsg = { t: 'snapshot', tick: 1, ackSeq: 0, timeScale: 1, heroes: [], enemies: [], wave: { n: 1, alive: 0, inProgress: 0, breather: 0 } };
        const snap2: SnapshotMsg = { t: 'snapshot', tick: 2, ackSeq: 0, timeScale: 1, heroes: [], enemies: [], wave: { n: 1, alive: 0, inProgress: 0, breather: 0 } };

        host.sendEnemySnapshot(snap1);
        host.sendEnemySnapshot(snap2);
        guestT.flush();

        expect(guest.getLatestSnapshot()?.tick).toBe(2);
    });

    it('guest onSpawn callback fires with spawn payload', () => {
        const { host, guest, guestT } = makeCoopPair();

        const spawnMsg: SpawnMsg = { t: 'spawn', id: 7, type: 'basic', x: 10, z: -3, maxHealth: 30 };

        const cb = vi.fn();
        guest.onSpawn = cb;

        host.sendSpawn(spawnMsg);
        guestT.flush();

        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith(spawnMsg);
    });

    it('guest onDeath callback fires with death payload', () => {
        const { host, guest, guestT } = makeCoopPair();

        const deathMsg: DeathMsg = { t: 'death', id: 7, x: 10, z: -3, isElite: false, isClone: false, reward: 10 };

        const cb = vi.fn();
        guest.onDeath = cb;

        host.sendDeath(deathMsg);
        guestT.flush();

        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith(deathMsg);
    });

    it('multiple spawn/death events each trigger the callback', () => {
        const { host, guest, guestT } = makeCoopPair();

        const spawnCb = vi.fn();
        const deathCb = vi.fn();
        guest.onSpawn = spawnCb;
        guest.onDeath = deathCb;

        host.sendSpawn({ t: 'spawn', id: 1, type: 'basic',  x: 0, z: 0, maxHealth: 30 });
        host.sendSpawn({ t: 'spawn', id: 2, type: 'fast',   x: 1, z: 1, maxHealth: 20 });
        host.sendDeath({ t: 'death', id: 1, x: 0, z: 0, isElite: false, isClone: false, reward: 10 });
        guestT.flush();

        expect(spawnCb).toHaveBeenCalledTimes(2);
        expect(deathCb).toHaveBeenCalledTimes(1);
        expect(deathCb.mock.calls[0][0].id).toBe(1);
    });
});
