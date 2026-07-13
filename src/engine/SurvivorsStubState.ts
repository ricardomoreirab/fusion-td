/**
 * TEMPORARY migration stub for the survivors state (Phase B of the
 * Babylon -> Three migration). Registered under 'survivors' until the real
 * SurvivorsGameplayState is converted (Phase C), at which point this file
 * is deleted and Game registers the real state again.
 */

import { Game } from './Game';
import { GameState } from './GameState';
import { GameUI } from '../ui/GameUI';
import { el } from '../ui/dom';
import { makeButton } from '../ui/primitives/Button';

export class SurvivorsStubState implements GameState {
    private gameUI: GameUI | null = null;

    constructor(private game: Game) {}

    public enter(): void {
        console.warn('[migration] survivors gameplay is stubbed out during the Three.js migration');
        this.gameUI = new GameUI();
        const overlay = this.gameUI.layer('overlay');
        const screen = el('div', { class: 'screen interactive' });
        screen.appendChild(el('div', { class: 'screen__title', text: 'MIGRATION' }));
        screen.appendChild(el('div', { class: 'screen__subtitle', text: 'Survivors mode is being ported to Three.js' }));
        screen.appendChild(makeButton({
            label: 'Back to Menu',
            variant: 'forged',
            onClick: () => this.game.getStateManager().changeState('menu'),
        }));
        overlay.appendChild(screen);
    }

    public exit(): void {
        this.gameUI?.dispose();
        this.gameUI = null;
    }

    public update(_deltaTime: number): void {}
}
