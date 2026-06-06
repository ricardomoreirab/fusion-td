import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import type { IncomingMessage } from '../src/net/NetTransport';

describe('FakeTransport', () => {
    it('assigns host/guest roles to the pair', () => {
        const [host, guest] = FakeTransport.pair();
        expect(host.role).toBe('host');
        expect(guest.role).toBe('guest');
    });

    it('delivers a sent message to the peer only after flush', () => {
        const [host, guest] = FakeTransport.pair();
        const received: IncomingMessage[] = [];
        guest.onMessage((m) => received.push(m));

        host.send('tick', 'hi');
        expect(received).toEqual([]);
        guest.flush();
        expect(received).toEqual([{ channel: 'tick', data: 'hi' }]);
    });

    it('does not echo a message back to the sender', () => {
        const [host, guest] = FakeTransport.pair();
        const hostRx: IncomingMessage[] = [];
        host.onMessage((m) => hostRx.push(m));
        host.send('event', 'x');
        host.flush();
        expect(hostRx).toEqual([]);
    });
});
