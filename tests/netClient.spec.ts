import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';

describe('NetClient', () => {
    it('exposes the transport role', () => {
        const [host, guest] = FakeTransport.pair();
        expect(new NetClient(host).role).toBe('host');
        expect(new NetClient(guest).role).toBe('guest');
    });

    it('auto-replies pong to a ping and measures RTT against an injected clock', () => {
        const [host, guest] = FakeTransport.pair();
        let tHost = 1000;
        const ca = new NetClient(host, () => tHost);
        const cb = new NetClient(guest);

        ca.sendPing();
        guest.flush();
        tHost = 1050;
        host.flush();

        expect(ca.lastRttMs).toBe(50);
    });

    it('notifies peer-left', () => {
        const [host, guest] = FakeTransport.pair();
        let left = false;
        const ca = new NetClient(host);
        ca.onPeerLeft = () => { left = true; };
        guest.send('event', JSON.stringify({ t: 'peer-left' }));
        host.flush();
        expect(left).toBe(true);
    });
});
