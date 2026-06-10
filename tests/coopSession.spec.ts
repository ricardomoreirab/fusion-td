import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';
import { CoopSession, SEQ_RESTART_GAP } from '../src/survivors/coop/CoopSession';

describe('CoopSession', () => {
    it('sends the local hero pose to the peer', () => {
        const [a, b] = FakeTransport.pair();
        const host = new CoopSession(new NetClient(a), 'barbarian', () => 0);
        const guestClient = new NetClient(b);
        let got: any = null;
        guestClient.onHeroState = (m) => { got = m; };

        host.sendLocalPose({ x: 1, y: 2, z: 3, ry: 0.5 }, 1);
        b.flush();

        expect(got).toMatchObject({ t: 'heroState', x: 1, z: 3, champ: 'barbarian' });
    });

    it('exposes the remote champ + interpolated remote pose from received messages', () => {
        const [a, b] = FakeTransport.pair();
        let tGuest = 0;
        const guest = new CoopSession(new NetClient(b), 'mage', () => tGuest);
        const hostClient = new NetClient(a);

        tGuest = 1000;
        hostClient.sendHeroState({ seq: 1, x: 0, y: 0, z: 0, ry: 0, champ: 'ranger', anim: 1 });
        b.flush();
        tGuest = 1100;
        hostClient.sendHeroState({ seq: 2, x: 10, y: 0, z: 0, ry: 0, champ: 'ranger', anim: 1 });
        b.flush();

        expect(guest.getRemoteChamp()).toBe('ranger');
        const pose = guest.getRemotePose(1050);
        expect(pose).not.toBeNull();
        expect(pose!.x).toBeGreaterThan(0);
        expect(pose!.x).toBeLessThan(10);
    });

    it('relays peer-rejoined and reports gameplay traffic (M6 D1 rejoin detection)', () => {
        const [a, b] = FakeTransport.pair();
        const host = new CoopSession(new NetClient(a), 'barbarian', () => 0);
        const guestClient = new NetClient(b);
        let rejoined = 0;
        let traffic = 0;
        host.onPeerRejoined = () => { rejoined++; };
        host.onPeerTraffic = () => { traffic++; };

        // Relay's explicit notice → onPeerRejoined, NOT gameplay traffic.
        b.send('event', JSON.stringify({ t: 'peer-rejoined', role: 'guest' }));
        a.flush();
        expect(rejoined).toBe(1);
        expect(traffic).toBe(0);

        // Gameplay messages from the peer → onPeerTraffic (fallback rejoin signal).
        guestClient.sendHeroState({ seq: 1, x: 0, y: 0, z: 0, ry: 0, champ: 'mage', anim: 0 });
        a.flush();
        expect(traffic).toBe(1);
        guestClient.sendInput({ seq: 1, dx: 0, dz: 1, buttons: 0 });
        a.flush();
        expect(traffic).toBe(2);
        guestClient.sendRequestState();
        a.flush();
        expect(traffic).toBe(3);
    });
});

describe('CoopSession host input-seq guard (guest drop+resume)', () => {
    function makeHostAndGuestClient() {
        const [a, b] = FakeTransport.pair();
        const host = new CoopSession(new NetClient(a), 'barbarian', () => 0);
        const guest = new NetClient(b);
        const push = (seq: number, dx = 0, dz = 0) => {
            guest.sendInput({ seq, dx, dz, buttons: 0 });
            a.flush();
        };
        return { host, push };
    }

    it('drops small backward (reordered) input seqs', () => {
        const { host, push } = makeHostAndGuestClient();
        push(100, 1, 0);
        push(101, 0, 1);
        expect(host.getInputAckSeq()).toBe(101);

        push(99, -1, 0); // small backward jump → stale reorder, dropped
        expect(host.getInputAckSeq()).toBe(101);
        expect(host.getLatestInput()).toMatchObject({ seq: 101, dx: 0, dz: 1 });
    });

    it('accepts a large backward jump as a stream restart and follows the new counter', () => {
        const { host, push } = makeHostAndGuestClient();
        push(50000, 1, 0);
        expect(host.getInputAckSeq()).toBe(50000);

        // Guest rebuilt its session after a drop+resume: counter restarted near 0.
        push(5, 0, 1);
        expect(host.getInputAckSeq()).toBe(5);
        expect(host.getLatestInput()).toMatchObject({ seq: 5, dx: 0, dz: 1 });

        // The fresh stream keeps flowing normally afterwards.
        push(6, 1, 1);
        push(7, -1, 0);
        expect(host.getInputAckSeq()).toBe(7);
        expect(host.getLatestInput()).toMatchObject({ seq: 7, dx: -1, dz: 0 });
    });

    it('a backward jump of exactly SEQ_RESTART_GAP is still a normal drop', () => {
        const { host, push } = makeHostAndGuestClient();
        push(5000, 1, 0);
        push(5000 - SEQ_RESTART_GAP, 0, 1); // boundary: NOT a restart
        expect(host.getInputAckSeq()).toBe(5000);
        expect(host.getLatestInput()).toMatchObject({ seq: 5000, dx: 1, dz: 0 });
    });
});

describe('CoopSession seq continuity across re-wire (startSeq)', () => {
    it('continues input numbering from startSeq so the host never sees a stale seq', () => {
        const [a, b] = FakeTransport.pair();
        const s = new CoopSession(new NetClient(a), 'ranger', () => 0, 12345);
        const peer = new NetClient(b);
        let got: any = null;
        peer.onInput = (m) => { got = m; };

        s.sendLocalInput(1, 0, 0, 0.016);
        b.flush();
        expect(got).not.toBeNull();
        expect(got.seq).toBeGreaterThan(12345);
        expect(s.getLocalSeq()).toBe(got.seq);
    });

    it('exposes the live counter so a new session can carry it over (poses share it too)', () => {
        const [a, b] = FakeTransport.pair();
        const old = new CoopSession(new NetClient(a), 'ranger', () => 0);
        old.sendLocalInput(1, 0, 0, 0.016);
        old.sendLocalPose({ x: 0, y: 0, z: 0, ry: 0 }, 0); // pose shares the counter
        old.sendLocalInput(0, 1, 0, 0.016);
        const carried = old.getLocalSeq();
        expect(carried).toBe(3);

        const [c, d] = FakeTransport.pair();
        const fresh = new CoopSession(new NetClient(c), 'ranger', () => 0, carried);
        const peer = new NetClient(d);
        const seqs: number[] = [];
        peer.onInput = (m) => { seqs.push(m.seq); };
        fresh.sendLocalInput(1, 0, 0, 0.016);
        fresh.sendLocalInput(0, 1, 0, 0.016);
        d.flush();
        expect(seqs).toEqual([carried + 1, carried + 2]);
    });
});
