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
import { subscribeLocale, t } from '../../i18n';

export class PauseScreen {
    private readonly root: HTMLDivElement;
    private isVisible = false;
    /** Rebuilds the panel on a language change — see `build()`. */
    private readonly unsubLocale: () => void;

    constructor(private game: Game) {
        this.root = el('div', { class: 'pause-screen' });
        document.body.appendChild(this.root);
        this.build();
        // This overlay is constructed ONCE at boot and outlives every state, so
        // unlike the menu (which rebuilds itself) its labels would otherwise be
        // frozen in whichever language the game booted in. It is the only
        // persistent surface with text, hence the only one that needs this.
        this.unsubLocale = subscribeLocale(() => this.build());
    }

    /** (Re)build the panel's contents in the current language. */
    private build(): void {
        const panel = makeFrame({ variant: 'ornate', class: 'pause-panel' });
        panel.appendChild(el('div', { class: 'pause-title', text: t('pause.title') }));

        const isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 1024;
        panel.appendChild(el('div', {
            class: 'pause-hint',
            text: isMobile ? t('pause.hintTouch') : t('pause.hintDesktop'),
        }));

        panel.appendChild(makeButton({
            label: t('pause.resume'),
            variant: 'forged',
            onClick: () => this.game.resume(),
        }));
        panel.appendChild(makeButton({
            label: t('pause.restart'),
            variant: 'ghost',
            onClick: () => {
                this.game.resume();
                this.game.getStateManager().changeState('survivors');
            },
        }));
        panel.appendChild(makeButton({
            label: t('pause.mainMenu'),
            variant: 'ghost',
            onClick: () => {
                this.game.resume();
                this.game.getStateManager().changeState('menu');
            },
        }));

        this.root.replaceChildren(panel);
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
        this.unsubLocale();
        this.root.remove();
    }
}
