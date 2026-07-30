import { describe, it, expect, beforeEach } from 'vitest';
import {
    LOCALE_IDS, catalogue, detectLocale, getLocale, nextLocale, setLocale, t, tc,
    __resetLocaleForTests,
} from '../src/i18n';
import { EN } from '../src/i18n/locales/en';
import type { ContentStrings, LocaleId, UiStrings } from '../src/i18n/types';
import { POWER_DEFS } from '../src/survivors/powers/PowerDefinitions';
import { ITEM_CATALOG } from '../src/survivors/items/ItemCatalog';
import { RunItems } from '../src/survivors/RunItems';
import { MAX_AUTHORED_TIER } from '../src/survivors/enemies/bossTiers';

/**
 * The suite runs in the `node` environment (see vitest.config.ts) — no DOM, so no
 * `localStorage` and no `navigator`. The i18n module is written to survive their
 * absence (that is what makes it safe to import from a headless test at all), but
 * the persistence and detection paths need something to talk to, so they get
 * minimal stubs here rather than the suite switching to jsdom for one file.
 */
const store = new Map<string, string>();
const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
};
const fakeNavigator: { languages?: readonly string[]; language?: string } = { languages: ['en-US'] };
// `navigator` exists on modern Node's globalThis as a getter-only property, so it
// has to be redefined rather than assigned.
Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: fakeNavigator, configurable: true });

/** Every dotted leaf path in an object of strings. */
function leaves(node: unknown, prefix = ''): string[] {
    if (typeof node === 'string') return [prefix];
    if (typeof node !== 'object' || node === null) return [];
    return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

const TRANSLATED: LocaleId[] = LOCALE_IDS.filter(id => id !== 'en');

beforeEach(() => {
    __resetLocaleForTests();
    localStorage.clear();
});

describe('locale catalogues', () => {
    it('ships every declared locale', () => {
        for (const id of LOCALE_IDS) {
            const c = catalogue(id);
            expect(c, id).toBeDefined();
            expect(c.tag, `${id} needs a BCP-47 tag for lang= and Intl`).toBeTruthy();
            expect(c.label, `${id} needs an endonym for the picker`).toBeTruthy();
        }
    });

    it('labels each language in its OWN language', () => {
        // The one label a player who cannot read the current UI can still find.
        expect(catalogue('en').label).toBe('English');
        expect(catalogue('es').label).toBe('Español');
        expect(catalogue('pt').label).toBe('Português');
    });

    it('gives every locale exactly the English UI keys — no gaps, no strays', () => {
        // The type system already forbids a MISSING key. This catches the other
        // direction (a stray key that no longer exists in English, i.e. dead
        // weight a translator will keep maintaining) and re-checks the first in
        // case a catalogue is ever loaded from data.
        const expected = leaves(EN.ui).sort();
        for (const id of TRANSLATED) {
            expect(leaves(catalogue(id).ui).sort(), `${id} UI keys`).toEqual(expected);
        }
    });

    it('leaves no UI string untranslated by accident', () => {
        // A copied-but-not-translated string is invisible to every other check
        // here. Proper nouns and symbols legitimately match, so those are listed.
        const SHARED_BY_DESIGN = new Set([
            'menu.title',        // KTG — the game's name
            'hud.ascension',     // ASC — the same abbreviation reads in all three
            'hud.noCount',       // an em dash
            'leaderboard.rank',  // #
            'shop.upgradeLevel', // +{n}
            'coop.codePlaceholder', // ABC123 — an example of the code FORMAT
        ]);
        for (const id of TRANSLATED) {
            const c = catalogue(id);
            for (const key of leaves(EN.ui)) {
                if (SHARED_BY_DESIGN.has(key)) continue;
                const en = key.split('.').reduce<any>((o, k) => o?.[k], EN.ui);
                const mine = key.split('.').reduce<any>((o, k) => o?.[k], c.ui);
                expect(mine, `${id}.${key} is still the English string`).not.toBe(en);
            }
        }
    });

    it('keeps every interpolation placeholder the English string declares', () => {
        // A dropped `{n}` silently renders "Wave" with no number — the kind of bug
        // that only shows up in the language nobody on the team reads.
        const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
        for (const id of TRANSLATED) {
            const c = catalogue(id);
            for (const key of leaves(EN.ui)) {
                const en: string = key.split('.').reduce<any>((o, k) => o?.[k], EN.ui);
                const mine: string = key.split('.').reduce<any>((o, k) => o?.[k], c.ui);
                expect(placeholders(mine), `${id}.${key} placeholders`).toEqual(placeholders(en));
            }
        }
    });
});

describe('content catalogues vs the real data tables', () => {
    // These assert against the SHIPPED tables, so renaming an id in the data (or
    // adding a power) surfaces here rather than as a raw key in front of a player.
    const CATEGORIES: Array<{
        category: keyof ContentStrings;
        ids: string[];
        what: string;
    }> = [
        { category: 'powerName', ids: Object.keys(POWER_DEFS), what: 'power' },
        { category: 'itemName', ids: ITEM_CATALOG.map(i => i.id), what: 'item' },
        {
            category: 'runItemName',
            ids: RunItems.itemRowForClass('barbarian').concat(RunItems.itemRowForClass('ranger')),
            what: 'run item',
        },
        {
            category: 'bossName',
            ids: Array.from({ length: MAX_AUTHORED_TIER }, (_, i) => String(i + 1)),
            what: 'boss tier',
        },
    ];

    it.each(CATEGORIES)('covers every $what id in English', ({ category, ids }) => {
        const have = EN.content[category];
        for (const id of new Set(ids)) {
            expect(have[id], `English is missing ${category}.${id}`).toBeTruthy();
        }
    });

    it.each(CATEGORIES)('translates every $what id in every locale', ({ category, ids }) => {
        for (const locale of TRANSLATED) {
            const have = catalogue(locale).content[category];
            for (const id of new Set(ids)) {
                expect(have[id], `${locale} is missing ${category}.${id}`).toBeTruthy();
            }
        }
    });

    it('declares no content id the data tables no longer have', () => {
        // A renamed power would otherwise leave three orphan translations behind.
        const live: Partial<Record<keyof ContentStrings, Set<string>>> = {
            powerName: new Set(Object.keys(POWER_DEFS)),
            itemName: new Set(ITEM_CATALOG.map(i => i.id)),
        };
        for (const id of LOCALE_IDS) {
            for (const [category, ids] of Object.entries(live)) {
                const declared = Object.keys(catalogue(id).content[category as keyof ContentStrings]);
                for (const key of declared) {
                    expect(ids!.has(key), `${id}.${category}.${key} has no matching data-table id`).toBe(true);
                }
            }
        }
    });
});

describe('t()', () => {
    it('interpolates named placeholders', () => {
        setLocale('en');
        expect(t('hud.wave', { n: 7 })).toBe('WAVE 7');
    });

    it('leaves an unsupplied placeholder visible rather than printing undefined', () => {
        // A brace on screen is a bug report; "undefined" is a shrug.
        setLocale('en');
        expect(t('hud.wave')).toBe('WAVE {n}');
    });

    it('returns the active locale\'s string', () => {
        setLocale('es');
        expect(t('hud.wave', { n: 3 })).toBe('OLEADA 3');
        setLocale('pt');
        expect(t('hud.wave', { n: 3 })).toBe('ONDA 3');
    });
});

describe('tc()', () => {
    it('translates a known content id', () => {
        setLocale('es');
        expect(tc('powerName', 'mage_fire', 'Fireball')).toBe('Bola de Fuego');
    });

    it('falls back to the caller\'s English literal for an unknown id', () => {
        // The whole point of the open content catalogue: a power added after the
        // last translation pass renders in English, never as a raw key.
        setLocale('es');
        expect(tc('powerName', 'not_a_real_power', 'Brand New Power')).toBe('Brand New Power');
    });

    it('falls back through English before reaching the literal', () => {
        // An id English knows but Spanish does not should read as English, not as
        // whatever the call site happened to pass.
        setLocale('es');
        const enOnly = Object.keys(EN.content.enemyName)
            .find(k => !catalogue('es').content.enemyName[k]);
        if (!enOnly) return; // Spanish is complete here — nothing to assert
        expect(tc('enemyName', enOnly, 'ignored')).toBe(EN.content.enemyName[enOnly]);
    });
});

describe('locale selection', () => {
    it('persists the choice', () => {
        setLocale('pt');
        __resetLocaleForTests();
        expect(getLocale()).toBe('pt');
    });

    it('ignores an unreadable stored value instead of breaking', () => {
        localStorage.setItem('ktg.locale.v1', 'klingon');
        expect(LOCALE_IDS).toContain(getLocale());
    });

    it('cycles through every locale and returns to the start', () => {
        setLocale('en');
        const seen: LocaleId[] = [];
        for (let i = 0; i < LOCALE_IDS.length; i++) {
            const next = nextLocale();
            setLocale(next);
            seen.push(next);
        }
        expect(new Set(seen).size).toBe(LOCALE_IDS.length);
        expect(getLocale()).toBe('en');
    });

    it('matches a browser language ignoring its region', () => {
        // pt-BR and pt-PT are both Portuguese; es-419 is Spanish.
        const orig = fakeNavigator.languages;
        try {
            fakeNavigator.languages = ['pt-BR'];
            expect(detectLocale()).toBe('pt');
            fakeNavigator.languages = ['es-419', 'en-US'];
            expect(detectLocale()).toBe('es');
            fakeNavigator.languages = ['fr-FR'];
            expect(detectLocale()).toBe('en');
        } finally {
            fakeNavigator.languages = orig;
        }
    });
});

describe('HUD label lengths', () => {
    it('keeps fixed-width HUD labels short in every language', () => {
        // The medallion tag and the ascension chip sit in fixed-width chrome, and
        // Spanish/Portuguese run ~20% longer than English. A literal translation
        // of a two-letter label overflows the plate, which is why both catalogues
        // use NV rather than NIVEL.
        const FIXED_WIDTH: Array<keyof UiStrings['hud']> = ['level', 'ascension'];
        for (const id of LOCALE_IDS) {
            for (const key of FIXED_WIDTH) {
                const s = catalogue(id).ui.hud[key];
                expect(s.length, `${id}.hud.${key} = "${s}" is too wide for its plate`)
                    .toBeLessThanOrEqual(4);
            }
        }
    });
});
