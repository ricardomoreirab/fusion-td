import { rgba } from '../engine/three/math';
import { Game } from '../engine/Game';
import { GameState } from '../engine/GameState';
import { GameSettings, GraphicsQuality } from '../shared/GameSettings';
import { GameUI } from '../ui/GameUI';
import { el } from '../ui/dom';
import { onTap } from '../ui/interaction';
import { makeButton } from '../ui/primitives/Button';
import { LeaderboardOverlay } from '../ui/overlays/Leaderboard';
import { CoopLobbyOverlay } from '../ui/overlays/CoopLobby';
import { PrivateRoomService } from '../net/RoomService';
import { setPendingCoop } from '../survivors/coop/PendingCoop';

export class MenuState implements GameState {
    private game: Game;
    private gameUI: GameUI | null = null;
    private lbOpen = false;
    private coopLobby: CoopLobbyOverlay | null = null;

    constructor(game: Game) {
        this.game = game;
    }

    public enter(): void {
        console.log('Entering menu state');

        // Create animated 3D background
        this.createBackground();

        // Create UI
        this.createUI();

        // Play background music
        this.game.getAssetManager().playSound('bgMusic');
    }

    public exit(): void {
        console.log('Exiting menu state');

        // Dispose UI. The co-op lobby goes FIRST and explicitly: it may hold a
        // live transport (hosting, waiting for a teammate) whose socket must be
        // closed to free the room slot — removing its DOM alone wouldn't do that.
        // On the advance path the lobby already handed the transport off (and
        // nulled it), so this close can never kill a session being started.
        this.coopLobby?.dispose();
        this.coopLobby = null;
        this.gameUI?.dispose();
        this.gameUI = null;
        this.lbOpen = false; // singleton state — clear the guard so the board reopens next time
    }

    public update(_deltaTime: number): void {
        // Background animation is handled via registerBeforeRender
    }

    private createBackground(): void {
        // Solid dark backdrop — the themed UI rectangle in createUI() draws on top.
        // No 3D objects, no enemies, no particles. Clean start screen.
        this.game.setClearColor(rgba(0.027, 0.020, 0.039, 1.0)); // matches #07050a
    }

    private createUI(): void {
        this.gameUI = new GameUI();
        const overlay = this.gameUI.layer('overlay');

        // ── Full-screen container ────────────────────────────────────────
        const screen = el('div', { class: 'screen interactive' });

        // Title
        screen.appendChild(el('div', { class: 'screen__title', text: 'KTG' }));

        // Subtitle
        screen.appendChild(el('div', { class: 'screen__subtitle', text: 'KILL THE GOBLINS' }));

        // Start button
        const startBtn = makeButton({
            label: 'Begin the Hunt',
            variant: 'forged',
            onClick: () => this.game.getStateManager().changeState('survivors'),
        });
        screen.appendChild(startBtn);

        // Co-op button — opens the host/join lobby. On advance the live transport
        // is stashed in PendingCoop and the survivors state picks it up in
        // startRun (taking precedence over the dev ?host/?join URL flow).
        screen.appendChild(makeButton({
            label: 'Co-op',
            variant: 'forged',
            onClick: () => {
                if (this.coopLobby) return; // guard against stacking on rapid taps
                this.coopLobby = new CoopLobbyOverlay(overlay, new PrivateRoomService());
                this.coopLobby.show({
                    onAdvance: (cfg) => {
                        this.coopLobby = null; // lobby already disposed itself
                        setPendingCoop(cfg);
                        this.game.getStateManager().changeState('survivors');
                    },
                    onClose: () => { this.coopLobby = null; },
                });
            },
        }));

        // ── Graphics preset selector ─────────────────────────────────────
        const gfxLabel = el('div', { class: 'screen__label', text: 'Graphics' });
        screen.appendChild(gfxLabel);

        const levels: GraphicsQuality[] = ['low', 'medium', 'high'];
        const labels = ['LOW', 'MEDIUM', 'HIGH'];
        const gfxBtns: HTMLDivElement[] = [];

        const refresh = () => {
            const current = GameSettings.getGraphicsQuality();
            for (let i = 0; i < levels.length; i++) {
                if (levels[i] === current) {
                    gfxBtns[i].classList.add('gfx-btn--active');
                } else {
                    gfxBtns[i].classList.remove('gfx-btn--active');
                }
            }
        };

        const row = el('div', { class: 'screen__row' });
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const btn = el('div', { class: 'gfx-btn', text: labels[i] });
            onTap(btn, () => {
                GameSettings.setGraphicsQuality(level);
                refresh();
            });
            gfxBtns.push(btn);
            row.appendChild(btn);
        }
        screen.appendChild(row);

        // Apply initial active state
        refresh();

        // Leaderboard button — opens the shared modal over the menu.
        screen.appendChild(makeButton({
            label: '🏆 Leaderboard',
            variant: 'ghost',
            onClick: () => {
                if (this.lbOpen) return; // guard against stacking panels on rapid taps
                this.lbOpen = true;
                const board = new LeaderboardOverlay(overlay);
                void board.show(() => { this.lbOpen = false; });
            },
        }));

        overlay.appendChild(screen);
    }
}
