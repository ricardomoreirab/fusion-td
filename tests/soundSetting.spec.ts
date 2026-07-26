import { describe, expect, it } from 'vitest';
import { GameSettings } from '../src/shared/GameSettings';
import { isMuted, setMuted } from '../src/engine/three/audio';

describe('sound preference', () => {
    it('defaults to sound OFF', () => {
        expect(GameSettings.getSoundOn()).toBe(false);
    });

    it('setSoundOn flips the setting and notifies subscribers', () => {
        let notified = 0;
        const unsub = GameSettings.subscribe(() => notified++);

        GameSettings.setSoundOn(true);
        expect(GameSettings.getSoundOn()).toBe(true);
        expect(notified).toBe(1);

        GameSettings.setSoundOn(true); // no-op — no re-notify
        expect(notified).toBe(1);

        GameSettings.setSoundOn(false);
        expect(GameSettings.getSoundOn()).toBe(false);
        expect(notified).toBe(2);
        unsub();
    });
});

describe('audio master mute', () => {
    it('tracks the muted flag headlessly (no AudioContext needed)', () => {
        expect(isMuted()).toBe(false);
        setMuted(true);
        expect(isMuted()).toBe(true);
        setMuted(false);
        expect(isMuted()).toBe(false);
    });
});
