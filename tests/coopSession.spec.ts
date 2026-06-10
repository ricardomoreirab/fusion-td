import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';
import { CoopSession } from '../src/survivors/coop/CoopSession';

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
