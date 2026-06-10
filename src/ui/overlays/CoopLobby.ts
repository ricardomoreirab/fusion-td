import { makeModal, ModalController } from '../primitives/Modal';
import { makeCard } from '../primitives/Card';
import { makeButton } from '../primitives/Button';
import { el } from '../dom';
import { onTap } from '../interaction';
import type { RoomService } from '../../net/RoomService';
import type { NetTransport } from '../../net/NetTransport';
import type { PendingCoopConfig } from '../../survivors/coop/PendingCoop';

export interface CoopLobbyCallbacks {
    /** A live session is ready — stash it (PendingCoop) and change state.
     *  Ownership of the transport moves to the caller; the lobby is closed. */
    onAdvance: (cfg: PendingCoopConfig) => void;
    /** The player backed out (Close / Escape). Any owned transport is closed. */
    onClose: () => void;
}

/**
 * CoopLobbyOverlay — the menu's Host/Join flow (DOM, pattern-matched to
 * Leaderboard/ChampionSelect: modal into the GameUI overlay layer).
 *
 *  Host: createRoom() → connect immediately (claiming the room while it is
 *  empty guarantees the relay's join-order role assignment gives us 'host'),
 *  show the code big + Copy, and wait for the relay's {t:'peer-joined'} to
 *  auto-advance. "Start without waiting" advances solo — the guest can still
 *  join mid-run (requestState catch-up handles it).
 *
 *  Join: 6-char [A-Z2-9] code input → connect(code) → advance as guest. The
 *  worker mints Room DOs on demand, so a wrong/expired code "succeeds" with
 *  role 'host' in an empty room — the lobby detects that, closes the socket,
 *  and shows "no game found". A full room rejects the upgrade (423 → ws error).
 *
 *  Handoff: before advancing, transport.offMessage() restores backlog buffering
 *  so frames arriving during champion select wait for the game's NetClient
 *  instead of hitting a dead lobby handler.
 */
export class CoopLobbyOverlay {
    private modal: ModalController | null = null;
    /** Transport the LOBBY owns. Nulled on handoff so dispose() can't close it. */
    private transport: NetTransport | null = null;
    private code: string | null = null;
    /** Bumped on every view change/teardown — invalidates in-flight async work. */
    private gen = 0;
    private keyHandler: ((e: KeyboardEvent) => void) | null = null;
    private callbacks: CoopLobbyCallbacks | null = null;
    /** Enter routes here while the join view is up. */
    private submitJoin: (() => void) | null = null;

    constructor(private parent: HTMLElement, private roomService: RoomService) {}

    public show(callbacks: CoopLobbyCallbacks): void {
        this.dispose();
        this.callbacks = callbacks;

        const modal = makeModal({ title: 'Co-op', panelClass: 'modal-panel--coop' });
        this.modal = modal;
        this.parent.appendChild(modal.root);

        this.keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.requestClose();
            } else if (e.key === 'Enter' && this.submitJoin) {
                e.preventDefault();
                this.submitJoin();
            }
        };
        document.addEventListener('keydown', this.keyHandler);

        this.renderChoose();
    }

    /** Tear down DOM + key listener and close any transport the lobby still owns.
     *  Safe to call repeatedly; called by MenuState.exit() so a hosted-but-
     *  unjoined room slot is always freed. Does NOT fire onClose. */
    public dispose(): void {
        this.gen++;
        this.submitJoin = null;
        this.dropOwnedTransport();
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        this.modal?.dispose();
        this.modal = null;
        this.callbacks = null;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    private renderChoose(errorText?: string): void {
        const body = this.resetView('Co-op');
        if (!body) return;

        if (errorText) body.appendChild(el('div', { class: 'coop-error', text: errorText }));
        const choices = el('div', { class: 'modal-choices' });
        choices.appendChild(makeCard({
            name: 'Host Game',
            subtitle: 'Create a room and share\nthe code with a friend',
            glyph: '🏰',
            accent: '#c9a23f',
            kind: 'host',
            onClick: () => this.startHosting(),
        }));
        choices.appendChild(makeCard({
            name: 'Join Game',
            subtitle: 'Enter the 6-letter code\nyour friend shared',
            glyph: '🤝',
            accent: '#5fb0e8',
            kind: 'join',
            onClick: () => this.renderJoin(),
        }));
        body.appendChild(choices);
        body.appendChild(makeButton({ label: 'Close', variant: 'ghost', onClick: () => this.requestClose() }));
    }

    private async startHosting(): Promise<void> {
        const body = this.resetView('Hosting');
        if (!body) return;
        const myGen = this.gen;

        const status = el('div', { class: 'modal-subtitle coop-wait', text: 'Forging a room…' });
        body.appendChild(status);
        body.appendChild(makeButton({ label: 'Back', variant: 'ghost', onClick: () => this.renderChoose() }));

        try {
            const { code } = await this.roomService.createRoom();
            if (myGen !== this.gen) return; // view changed / lobby closed mid-flight
            // Connect NOW, while the room is empty: the relay assigns roles by
            // connection order, so claiming the first slot here guarantees 'host'.
            const transport = await this.roomService.connect(code);
            if (myGen !== this.gen) { transport.close(); return; }
            this.transport = transport;
            this.code = code;
            this.renderHosting(code, transport);
        } catch (err) {
            console.error('[coop] hosting failed:', err);
            if (myGen === this.gen) this.renderChoose('Could not create a room — check your connection.');
        }
    }

    private renderHosting(code: string, transport: NetTransport): void {
        const body = this.resetView('Hosting');
        if (!body) return;
        const myGen = this.gen;

        body.appendChild(el('div', { class: 'modal-subtitle', text: 'Share this code with your teammate' }));

        const codeEl = el('div', { class: 'coop-code', text: code });
        const copyBtn = makeButton({
            label: 'Copy',
            variant: 'ghost',
            class: 'coop-copy-btn',
            onClick: () => {
                void navigator.clipboard?.writeText(code).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { if (myGen === this.gen) copyBtn.textContent = 'Copy'; }, 1200);
                }).catch(() => { /* clipboard unavailable — the code text is selectable */ });
            },
        });
        body.appendChild(el('div', { class: 'coop-code-row' }, [codeEl, copyBtn]));

        body.appendChild(el('div', { class: 'modal-subtitle coop-wait', text: 'Waiting for teammate…' }));

        // The relay notifies the first peer with {t:'peer-joined'} when the
        // second attaches. The transport backlogs frames until a handler is set,
        // so even an instant join can't race this subscription.
        transport.onMessage((m) => {
            if (typeof m.data !== 'string') return;
            try {
                const obj = JSON.parse(m.data) as { t?: unknown };
                if (obj.t === 'peer-joined') this.advance();
            } catch { /* not a control frame — ignore */ }
        });
        transport.onClose?.(() => {
            if (myGen === this.gen) this.renderChoose('Connection lost — try hosting again.');
        });

        // Escape hatch: start alone; the guest can still join mid-run (the
        // requestState catch-up resync brings them up to speed).
        const soloLink = el('div', { class: 'coop-link', text: 'Start without waiting' });
        onTap(soloLink, () => this.advance());
        body.appendChild(soloLink);

        body.appendChild(makeButton({
            label: 'Cancel',
            variant: 'ghost',
            onClick: () => {
                this.dropOwnedTransport(); // free the room slot
                this.renderChoose();
            },
        }));
    }

    private renderJoin(errorText?: string): void {
        const body = this.resetView('Join Game');
        if (!body) return;

        body.appendChild(el('div', { class: 'modal-subtitle', text: 'Enter your friend’s room code' }));

        const input = el('input', {
            class: 'lb-name-input coop-code-input',
            attrs: {
                type: 'text', maxlength: '6', placeholder: 'ABC123',
                autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
            },
        });
        // GameUI preventDefaults #ui-root mousedown (to keep canvas keyboard
        // focus); stop it from bubbling so click-to-focus works on this input —
        // same fix as the game-over leaderboard name input.
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        // Force uppercase + the room-code alphabet ([A-Z2-9]) as the user types.
        input.addEventListener('input', () => {
            input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
        });
        const errEl = el('div', { class: 'coop-error', text: errorText ?? '' });
        const joinBtn = makeButton({ label: 'Join', variant: 'forged', onClick: () => { void this.tryJoin(input, errEl, joinBtn); } });
        const row = el('div', { class: 'coop-join-row' }, [input, joinBtn]);
        body.append(row, errEl);
        body.appendChild(makeButton({ label: 'Back', variant: 'ghost', onClick: () => this.renderChoose() }));

        this.submitJoin = () => { void this.tryJoin(input, errEl, joinBtn); };
        input.focus();
    }

    private async tryJoin(input: HTMLInputElement, errEl: HTMLDivElement, joinBtn: HTMLDivElement): Promise<void> {
        const code = input.value.trim().toUpperCase();
        if (code.length !== 6) {
            errEl.textContent = 'Codes are 6 characters.';
            return;
        }
        if (joinBtn.classList.contains('btn--disabled')) return; // already in flight
        const myGen = this.gen;
        joinBtn.classList.add('btn--disabled');
        errEl.textContent = '';

        const fail = (msg: string) => {
            if (myGen !== this.gen) return;
            joinBtn.classList.remove('btn--disabled');
            errEl.textContent = msg;
        };

        try {
            const connectPromise = this.roomService.connect(code);
            // A dead server can leave the ws neither open nor errored — bound the wait.
            const transport = await Promise.race([
                connectPromise,
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
            ]).catch((err: unknown) => {
                // If the race lost to the timeout but the socket opens later, close it.
                connectPromise.then((t) => { if (this.transport !== t) t.close(); }).catch(() => { /* never opened */ });
                throw err;
            });
            if (myGen !== this.gen) { transport.close(); return; }
            if (transport.role !== 'guest') {
                // The worker mints Room DOs on demand, so an unknown code connects
                // us into an EMPTY room as 'host'. That means nobody is hosting
                // under this code — reject and free the phantom room.
                transport.close();
                fail('No game found with that code.');
                return;
            }
            this.transport = transport;
            this.code = code;
            this.advance();
        } catch {
            fail('Could not join — room is full or unreachable.');
        }
    }

    // ── Plumbing ─────────────────────────────────────────────────────────────

    /** Hand the live session to the game. The transport's handler is detached
     *  (frames backlog until the game's NetClient attaches) and ownership moves
     *  to the callback, so the dispose() below won't close it. */
    private advance(): void {
        const transport = this.transport;
        const code = this.code;
        const callbacks = this.callbacks;
        if (!transport || !code) return;
        transport.offMessage?.();
        this.transport = null; // handed off — no longer ours to close
        this.dispose();
        callbacks?.onAdvance({ transport, role: transport.role, code, roomService: this.roomService });
    }

    /** Close via UI/Escape: free any held room slot and tell the owner. */
    private requestClose(): void {
        const callbacks = this.callbacks;
        this.dispose();
        callbacks?.onClose();
    }

    private dropOwnedTransport(): void {
        this.transport?.close();
        this.transport = null;
        this.code = null;
    }

    /** Clear the modal body for a new view; bumps gen so stale async work and
     *  stale Enter handlers die. Returns null if the lobby was already closed. */
    private resetView(title: string): HTMLDivElement | null {
        if (!this.modal) return null;
        this.gen++;
        this.submitJoin = null;
        this.modal.setTitle(title);
        this.modal.body.replaceChildren();
        return this.modal.body;
    }
}
