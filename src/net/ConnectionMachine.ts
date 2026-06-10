// Pure FSM for peer-left → grace-window → rejoin|expire flow. No Babylon, safe for Vitest.

export type ConnState = 'connected' | 'reconnecting' | 'closed';

/**
 * Pure FSM for the peer-left → grace-window → rejoin|expire flow.
 * Drive it with tick(dtSeconds); read state + graceRemaining for pause-overlay UX.
 */
export class ConnectionMachine {
    private _state: ConnState = 'connected';
    private _graceRemaining: number = 0;

    constructor(private graceWindowS: number = 30) {}

    get state(): ConnState {
        return this._state;
    }

    /** Seconds left in the reconnection window (0 when not reconnecting). */
    get graceRemaining(): number {
        return this._graceRemaining;
    }

    /** Connected → reconnecting: start the grace countdown. */
    onPeerLeft(): void {
        if (this._state !== 'connected') return;
        this._state = 'reconnecting';
        this._graceRemaining = this.graceWindowS;
    }

    /** Reconnecting → connected: peer came back, reset. */
    onPeerRejoined(): void {
        if (this._state !== 'reconnecting') return;
        this._state = 'connected';
        this._graceRemaining = 0;
    }

    /** Advance time. Only active while reconnecting — counts down; at 0 → closed. */
    tick(dtSeconds: number): void {
        if (this._state !== 'reconnecting') return;
        this._graceRemaining = Math.max(0, this._graceRemaining - dtSeconds);
        if (this._graceRemaining <= 0) {
            this._state = 'closed';
        }
    }
}
