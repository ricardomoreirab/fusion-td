/**
 * PauseScreen - full-screen DOM pause overlay (dim backdrop, title, and
 * Resume / Restart / Main Menu buttons). Lives directly under document.body
 * with its own high z-index so it renders above every game surface,
 * independent of any state's UI lifecycle.
 *
 * Styling lives in components.css alongside every other modal state. It used
 * to be Arial + inline `cssText`, which made it the one screen in the build
 * not speaking the game's typeface.
 */

import { Game } from '../../engine/Game';
import { el } from '../../ui/dom';
import { makeButton } from '../../ui/primitives/Button';
import { makeFrame } from '../../ui/primitives/Frame';

export class PauseScreen {
    private readonly root: HTMLDivElement;
    private isVisible = false;

    constructor(private game: Game) {
        this.root = el('div', { class: 'pause-screen' });

        const panel = makeFrame({ variant: 'ornate', class: 'pause-panel' });
        panel.appendChild(el('div', { class: 'pause-title', text: 'Paused' }));

        const isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 1024;
        panel.appendChild(el('div', {
            class: 'pause-hint',
            text: isMobile ? 'Tap Resume to continue' : 'Press Escape or Resume to continue',
        }));

        panel.appendChild(makeButton({
            label: 'Resume',
            variant: 'forged',
            onClick: () => this.game.resume(),
        }));
        panel.appendChild(makeButton({
            label: 'Restart',
            variant: 'ghost',
            onClick: () => {
                this.game.resume();
                this.game.getStateManager().changeState('survivors');
            },
        }));
        panel.appendChild(makeButton({
            label: 'Main Menu',
            variant: 'ghost',
            onClick: () => {
                this.game.resume();
                this.game.getStateManager().changeState('menu');
            },
        }));

        this.root.appendChild(panel);
        document.body.appendChild(this.root);
    }

    public show(): void {
        if (this.isVisible) return;
        this.isVisible = true;
        this.root.classList.add('pause-screen--open');
    }

    public hide(): void {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.root.classList.remove('pause-screen--open');
    }

    public dispose(): void {
        this.root.remove();
    }
}
