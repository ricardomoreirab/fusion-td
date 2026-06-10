import { describe, it, expect } from 'vitest';
import { ConnectionMachine } from '../src/net/ConnectionMachine';

describe('ConnectionMachine', () => {
    it('starts in connected state', () => {
        const m = new ConnectionMachine(30);
        expect(m.state).toBe('connected');
        expect(m.graceRemaining).toBe(0);
    });

    it('onPeerLeft transitions to reconnecting with full grace window', () => {
        const m = new ConnectionMachine(30);
        m.onPeerLeft();
        expect(m.state).toBe('reconnecting');
        expect(m.graceRemaining).toBe(30);
    });

    it('tick partway through window keeps state reconnecting with reduced graceRemaining', () => {
        const m = new ConnectionMachine(30);
        m.onPeerLeft();
        m.tick(10);
        expect(m.state).toBe('reconnecting');
        expect(m.graceRemaining).toBeCloseTo(20);
    });

    it('onPeerRejoined while reconnecting transitions back to connected and resets graceRemaining', () => {
        const m = new ConnectionMachine(30);
        m.onPeerLeft();
        m.tick(10);
        m.onPeerRejoined();
        expect(m.state).toBe('connected');
        expect(m.graceRemaining).toBe(0);
    });

    it('tick past the full window transitions to closed', () => {
        const m = new ConnectionMachine(30);
        m.onPeerLeft();
        m.tick(29);
        expect(m.state).toBe('reconnecting');
        m.tick(2); // push past 30s total
        expect(m.state).toBe('closed');
    });

    it('graceRemaining is 0 when closed', () => {
        const m = new ConnectionMachine(30);
        m.onPeerLeft();
        m.tick(31);
        expect(m.state).toBe('closed');
        expect(m.graceRemaining).toBe(0);
    });

    it('onPeerRejoined after closed is a no-op — stays closed', () => {
        const m = new ConnectionMachine(30);
        m.onPeerLeft();
        m.tick(31);
        expect(m.state).toBe('closed');
        m.onPeerRejoined();
        expect(m.state).toBe('closed');
    });

    it('tick while connected is a no-op — stays connected', () => {
        const m = new ConnectionMachine(30);
        m.tick(100);
        expect(m.state).toBe('connected');
        expect(m.graceRemaining).toBe(0);
    });

    it('tick while closed is a no-op — stays closed', () => {
        const m = new ConnectionMachine(30);
        m.onPeerLeft();
        m.tick(31);
        m.tick(100);
        expect(m.state).toBe('closed');
    });

    it('uses default grace window of 30s when constructed without argument', () => {
        const m = new ConnectionMachine();
        m.onPeerLeft();
        expect(m.graceRemaining).toBe(30);
    });

    it('graceRemaining never goes below 0', () => {
        const m = new ConnectionMachine(10);
        m.onPeerLeft();
        m.tick(100);
        expect(m.graceRemaining).toBe(0);
    });
});
