/**
 * Localisation. English, Spanish and Portuguese.
 *
 * ── Why a module-level singleton and not a context ────────────────────────────
 * This game has no component framework. The UI is imperative DOM built by state
 * classes (`MenuState`, `Hud`, the overlays), and a string is needed wherever one
 * of those happens to be constructing a node. A singleton `t()` is the only shape
 * that does not require threading a locale through every constructor in
 * `src/ui/**`, and it matches how `GameSettings` already works.
 *
 * ── Reactivity ────────────────────────────────────────────────────────────────
 * Strings are read at BUILD time, not bound. That is fine because the language
 * can only be changed from the main menu, and the menu rebuilds itself on the
 * change (`subscribeLocale`). Nothing else in the game outlives a language
 * switch — a run cannot be in progress while the menu is up. Do NOT introduce a
 * language control inside a run without making the HUD rebuild too.
 *
 * ── Missing keys ──────────────────────────────────────────────────────────────
 * `t()` cannot miss: the key type is derived from the English catalogue, so a
 * typo is a compile error. `tc()` (content) CAN miss, by design — see types.ts —
 * and falls back to the English catalogue and then to the caller's literal, so a
 * new power added without translations renders its English name rather than a key.
 */

import { EN } from './locales/en';
import { ES } from './locales/es';
import { PT } from './locales/pt';
import type { ContentStrings, LocaleId, LocaleStrings, UiStrings } from './types';
import { LOCALE_IDS } from './types';

export type { LocaleId, LocaleStrings } from './types';
export { LOCALE_IDS } from './types';

const CATALOGUES: Record<LocaleId, LocaleStrings> = { en: EN, es: ES, pt: PT };

const STORAGE_KEY = 'ktg.locale.v1';

/**
 * Dotted paths into the UI catalogue, e.g. `'menu.play'`. Generated from the
 * English shape, which is what makes a typo a compile error rather than a blank
 * label discovered by a player.
 */
type Leaves<T> = {
    [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];
export type UiKey = Leaves<UiStrings>;

type Listener = (id: LocaleId) => void;
const _listeners = new Set<Listener>();

let _current: LocaleId | null = null;

/** True for a string that is one of the shipped locale ids. */
function isLocaleId(s: string): s is LocaleId {
    return (LOCALE_IDS as readonly string[]).includes(s);
}

/**
 * Best locale for this browser, ignoring region: `pt-BR` and `pt-PT` both get
 * Portuguese, `es-419` gets Spanish. Falls back to English for anything else,
 * which is also what an unreadable stored value degrades to.
 */
export function detectLocale(): LocaleId {
    const langs: readonly string[] = typeof navigator !== 'undefined'
        ? (navigator.languages ?? (navigator.language ? [navigator.language] : []))
        : [];
    for (const raw of langs) {
        const base = raw.toLowerCase().split('-')[0];
        if (isLocaleId(base)) return base;
    }
    return 'en';
}

function load(): LocaleId {
    if (_current) return _current;
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(STORAGE_KEY);
    } catch {
        // private-mode Safari — fall through to detection
    }
    _current = stored && isLocaleId(stored) ? stored : detectLocale();
    applyDocumentLang(_current);
    return _current;
}

/** Keep the document's `lang` in step so the browser hyphenates, spell-checks and
 *  reads the page out in the right language. */
function applyDocumentLang(id: LocaleId): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = CATALOGUES[id].tag;
}

export function getLocale(): LocaleId {
    return load();
}

export function getLocaleLabel(id: LocaleId): string {
    return CATALOGUES[id].label;
}

export function setLocale(id: LocaleId): void {
    if (!isLocaleId(id) || load() === id) return;
    _current = id;
    try {
        localStorage.setItem(STORAGE_KEY, id);
    } catch {
        // ignore — the choice just will not survive a reload
    }
    applyDocumentLang(id);
    for (const fn of _listeners) fn(id);
}

/** Returns an unsubscribe function, same contract as GameSettings.subscribe. */
export function subscribeLocale(fn: Listener): () => void {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
}

/** Cycle to the next shipped locale — what the menu's language chip does. */
export function nextLocale(): LocaleId {
    const ids = LOCALE_IDS;
    return ids[(ids.indexOf(load()) + 1) % ids.length];
}

function walk(root: unknown, key: string): string | undefined {
    let node: unknown = root;
    for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null) return undefined;
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : undefined;
}

/** Replace `{name}` placeholders. Missing values are left as-is rather than
 *  printed as "undefined" — a visible brace is a bug report, "undefined" is a
 *  shrug. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const v = vars[name];
        return v === undefined ? whole : String(v);
    });
}

/**
 * A UI-chrome string. The key is compile-checked against the English catalogue.
 *
 * Falls back to English for the (impossible by typing, possible by hot-reload)
 * case of a locale missing a key, so a partial catalogue degrades to English
 * rather than to an empty label.
 */
export function t(key: UiKey, vars?: Record<string, string | number>): string {
    const id = load();
    const hit = walk(CATALOGUES[id].ui, key) ?? walk(EN.ui, key);
    return interpolate(hit ?? key, vars);
}

/**
 * A gameplay-content string, keyed by the id the data table already carries.
 *
 * `fallback` is the data table's own English literal, which is what renders when
 * a locale has no entry for this id — the normal state of affairs for content
 * added after the last translation pass. Order: current locale → English
 * catalogue → the literal.
 */
export function tc(
    category: keyof ContentStrings,
    id: string,
    fallback: string,
): string {
    const current = CATALOGUES[load()].content[category]?.[id];
    if (current) return current;
    return EN.content[category]?.[id] ?? fallback;
}

/** Whole catalogue, for the completeness test and the language picker. */
export function catalogue(id: LocaleId): LocaleStrings {
    return CATALOGUES[id];
}

/**
 * Test-only reset. The locale is cached on first read (and reads localStorage),
 * so a suite that flips languages needs a way back to a clean slate.
 */
export function __resetLocaleForTests(): void {
    _current = null;
    _listeners.clear();
}
