import { describe, it, expect, beforeEach } from 'vitest';
import { setPendingCoop, takePendingCoop, type PendingCoopConfig } from '../src/survivors/coop/PendingCoop';
import type { NetTransport } from '../src/net/NetTransport';
import type { RoomService } from '../src/net/RoomService';

function fakeTransport(role: 'host' | 'guest'): NetTransport {
    return { role, send: () => {}, onMessage: () => {}, close: () => {} };
}

const fakeRoomService: RoomService = {
    createRoom: async () => ({ code: 'ABCDEF' }),
    connect: async () => fakeTransport('host'),
};

function cfg(role: 'host' | 'guest', code = 'ABCDEF'): PendingCoopConfig {
    return { transport: fakeTransport(role), role, code, roomService: fakeRoomService };
}

describe('PendingCoop', () => {
    beforeEach(() => {
        takePendingCoop(); // drain module state between tests
    });

    it('take returns null when nothing is pending', () => {
        expect(takePendingCoop()).toBeNull();
    });

    it('set then take returns the exact config', () => {
        const c = cfg('host');
        setPendingCoop(c);
        expect(takePendingCoop()).toBe(c);
    });

    it('take clears the stash — a second take returns null', () => {
        setPendingCoop(cfg('guest'));
        takePendingCoop();
        expect(takePendingCoop()).toBeNull();
    });

    it('a later set overwrites an earlier one (latest wins)', () => {
        const first = cfg('host', 'AAAAAA');
        const second = cfg('guest', 'BBBBBB');
        setPendingCoop(first);
        setPendingCoop(second);
        expect(takePendingCoop()).toBe(second);
        expect(takePendingCoop()).toBeNull();
    });
});
