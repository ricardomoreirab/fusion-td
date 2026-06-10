import { describe, it, expect } from 'vitest';
import { FakeTransport } from '../src/net/FakeTransport';
import { NetClient } from '../src/net/NetClient';
import { CoopSession, INPUT_HISTORY_SIZE, MAX_INPUT_DT_S } from '../src/survivors/coop/CoopSession';

/** Build a guest-side session wired to a fake transport (peer end unused). */
function makeSession(): CoopSession {
    const [a] = FakeTransport.pair();
    return new CoopSession(new NetClient(a), 'ranger', () => 0);
}

describe('CoopSession input history ring (M6 E2)', () => {
    it('records each sendLocalInput and returns them in send order', () => {
        const s = makeSession();
        s.sendLocalInput(1, 0, 0, 0.016);
        s.sendLocalInput(0, 1, 0, 0.017);
        s.sendLocalInput(-1, -1, 0, 0.018);

        const all = s.getUnackedInputs(0);
        expect(all).toHaveLength(3);
        expect(all.map(i => ({ dx: i.dx, dz: i.dz, dt: i.dt }))).toEqual([
            { dx: 1, dz: 0, dt: 0.016 },
            { dx: 0, dz: 1, dt: 0.017 },
            { dx: -1, dz: -1, dt: 0.018 },
        ]);
        // Seqs strictly increase (sendLocalPose shares the counter, so not necessarily contiguous).
        expect(all[1].seq).toBeGreaterThan(all[0].seq);
        expect(all[2].seq).toBeGreaterThan(all[1].seq);
    });

    it('getUnackedInputs(ackSeq) returns only entries with seq > ackSeq', () => {
        const s = makeSession();
        s.sendLocalInput(1, 0, 0, 0.016);
        s.sendLocalInput(2, 0, 0, 0.016);
        s.sendLocalInput(3, 0, 0, 0.016);
        const all = s.getUnackedInputs(0);

        const tail = s.getUnackedInputs(all[1].seq);
        expect(tail).toHaveLength(1);
        expect(tail[0].dx).toBe(3);
    });

    it('pruneInputHistory drops acked entries; unacked survive', () => {
        const s = makeSession();
        s.sendLocalInput(1, 0, 0, 0.016);
        s.sendLocalInput(2, 0, 0, 0.016);
        s.sendLocalInput(3, 0, 0, 0.016);
        const all = s.getUnackedInputs(0);

        s.pruneInputHistory(all[1].seq);
        const left = s.getUnackedInputs(0);
        expect(left).toHaveLength(1);
        expect(left[0].dx).toBe(3);
    });

    it('prune with a stale (lower) ackSeq is a no-op; prune past the end empties', () => {
        const s = makeSession();
        s.sendLocalInput(1, 0, 0, 0.016);
        s.sendLocalInput(2, 0, 0, 0.016);
        const all = s.getUnackedInputs(0);

        s.pruneInputHistory(all[0].seq);
        s.pruneInputHistory(0); // stale — must not resurrect or corrupt anything
        expect(s.getUnackedInputs(0)).toHaveLength(1);

        s.pruneInputHistory(999999);
        expect(s.getUnackedInputs(0)).toHaveLength(0);
    });

    it('ring is bounded: oldest entries are dropped beyond INPUT_HISTORY_SIZE', () => {
        const s = makeSession();
        const total = INPUT_HISTORY_SIZE + 40;
        for (let i = 0; i < total; i++) s.sendLocalInput(i, 0, 0, 0.016);

        const all = s.getUnackedInputs(0);
        expect(all).toHaveLength(INPUT_HISTORY_SIZE);
        // Oldest 40 dropped: first surviving entry carries dx=40, last dx=total-1.
        expect(all[0].dx).toBe(40);
        expect(all[all.length - 1].dx).toBe(total - 1);
        // Order is still strictly increasing across the wrap.
        for (let i = 1; i < all.length; i++) {
            expect(all[i].seq).toBeGreaterThan(all[i - 1].seq);
        }
    });

    it('clamps recorded dt to MAX_INPUT_DT_S (tab-switch spike protection)', () => {
        const s = makeSession();
        s.sendLocalInput(1, 0, 0, 1.5); // a 1.5s frame spike
        s.sendLocalInput(1, 0, 0, 0.016);
        const all = s.getUnackedInputs(0);
        expect(all[0].dt).toBe(MAX_INPUT_DT_S);
        expect(all[1].dt).toBe(0.016);
    });

    it('still sends the InputMsg over the wire (dt is local-only, not in the protocol)', () => {
        const [a, b] = FakeTransport.pair();
        const s = new CoopSession(new NetClient(a), 'ranger', () => 0);
        const peer = new NetClient(b);
        let got: any = null;
        peer.onInput = (m) => { got = m; };

        s.sendLocalInput(0.5, -1, 3, 0.016);
        b.flush();
        expect(got).toMatchObject({ t: 'input', dx: 0.5, dz: -1, buttons: 3 });
        expect(got.dt).toBeUndefined();
    });
});
