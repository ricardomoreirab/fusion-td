import { describe, it, expect } from 'vitest';
import { encode, decode, type NetMessage } from '../src/net/Protocol';

describe('Protocol codec', () => {
    it('round-trips a ping message', () => {
        const msg: NetMessage = { t: 'ping', seq: 7, sent: 1234.5 };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a hello message', () => {
        const msg: NetMessage = { t: 'hello', role: 'guest' };
        expect(decode(encode(msg))).toEqual(msg);
    });

    it('throws on malformed json', () => {
        expect(() => decode('not json')).toThrow();
    });

    it('throws on an unknown message tag', () => {
        expect(() => decode(JSON.stringify({ t: 'bogus' }))).toThrow(/unknown/i);
    });
});
