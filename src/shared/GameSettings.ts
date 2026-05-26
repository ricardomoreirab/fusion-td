/**
 * Persistent user settings exposed via a tiny pub-sub. Read from localStorage
 * on first access, written back on every mutation. Listeners are notified
 * synchronously so consumers can react to changes from the main menu before
 * the next run starts.
 */

const STORAGE_KEY = 'ktg.settings.v1';

export type GraphicsQuality = 'low' | 'medium' | 'high';

interface SettingsShape {
    graphicsQuality: GraphicsQuality;
}

const DEFAULTS: SettingsShape = {
    graphicsQuality: 'high',
};

type Listener = (next: SettingsShape) => void;

let _state: SettingsShape | null = null;
const _listeners: Set<Listener> = new Set();

function load(): SettingsShape {
    if (_state) return _state;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<SettingsShape>;
            const quality: GraphicsQuality =
                parsed.graphicsQuality === 'low' || parsed.graphicsQuality === 'medium' || parsed.graphicsQuality === 'high'
                    ? parsed.graphicsQuality
                    : DEFAULTS.graphicsQuality;
            _state = { graphicsQuality: quality };
            return _state;
        }
    } catch (_) {
        // ignore — fall through to defaults
    }
    _state = { ...DEFAULTS };
    return _state;
}

function persist(): void {
    if (!_state) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch (_) {
        // private-mode Safari etc — silently ignore
    }
}

export const GameSettings = {
    getGraphicsQuality(): GraphicsQuality {
        return load().graphicsQuality;
    },

    setGraphicsQuality(q: GraphicsQuality): void {
        const s = load();
        if (s.graphicsQuality === q) return;
        s.graphicsQuality = q;
        persist();
        for (const fn of _listeners) fn(s);
    },

    /** Returns an unsubscribe function. */
    subscribe(fn: Listener): () => void {
        _listeners.add(fn);
        return () => { _listeners.delete(fn); };
    },
};

/** Hardware-instanced grass blades per arena. Tuned so low ≈ 25% of high. */
export function bladeCountForQuality(q: GraphicsQuality): number {
    if (q === 'low')    return 40000;
    if (q === 'medium') return 80000;
    return 160000;
}
