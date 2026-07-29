/**
 * The shape every locale must fill, and the two kinds of string in the game.
 *
 * ── Why two kinds ─────────────────────────────────────────────────────────────
 * `ui` is the hand-authored chrome: menu buttons, HUD labels, screen titles. It
 * is a CLOSED set that changes only when someone edits the interface, so it is
 * typed — `es`/`pt` must satisfy `UiStrings` exactly and a missing key is a
 * compile error. That is the strongest guarantee available and it costs nothing,
 * because nobody adds a menu button by accident.
 *
 * `content` is gameplay data: power, item, ascension-node and champion names and
 * descriptions. It is an OPEN set keyed by the id the data table already carries,
 * and it grows every time a power or an item is added — often by someone who has
 * no translation to hand. Typing it would mean a new power breaks the build in
 * three locales at once, so instead it is a partial record resolved with the data
 * table's own English literal as the fallback. `tests/i18n.spec.ts` asserts the
 * shipped locales are COMPLETE against English, so a gap is a failing test rather
 * than either a broken build or a silent hole.
 *
 * The distinction is not cosmetic: it puts the compile-time check exactly where
 * the set is closed, and a test where it is not.
 */

/** Every UI-chrome string, grouped by the surface it appears on. */
export interface UiStrings {
    menu: {
        title: string;
        subtitle: string;
        play: string;
        coop: string;
        leaderboard: string;
        graphics: string;
        qualityLow: string;
        qualityMedium: string;
        qualityHigh: string;
        language: string;
        toggleSound: string;
        rotateTitle: string;
        rotateBody: string;
    };
    hud: {
        /** `{n}` = wave number. */
        wave: string;
        /** The terminal endless phase — no number to show. */
        lastStand: string;
        level: string;
        ascension: string;
        pause: string;
        nextWave: string;
        /** `{n}` = wave number. */
        waveBanner: string;
        /** `{n}` = wave number. */
        waveCleared: string;
        lastStandBanner: string;
        /** Nothing to count between waves. */
        noCount: string;
    };
    champion: {
        chooseTitle: string;
        hp: string;
        speed: string;
        attack: string;
        melee: string;
        ranged: string;
    };
    power: {
        chooseTitle: string;
        replaceTitle: string;
        replaceBody: string;
        damage: string;
        cooldown: string;
        /** `{n}` = level. */
        levelUp: string;
        newPower: string;
        empty: string;
        noneClaimed: string;
        /** `{a}`/`{b}` = the two parent powers a fusion is forged from. */
        forgedFrom: string;
        /** `{a}`/`{b}` = the two slots a fusion consumes. */
        consumes: string;
        /** Appended to a new-power subtitle when all four slots are full. */
        replaceSuffix: string;
    };
    shop: {
        title: string;
        gold: string;
        buy: string;
        sold: string;
        equipped: string;
        yourGear: string;
        setBonuses: string;
        emptySlot: string;
        nothingEquipped: string;
        close: string;
        potions: string;
        /** `{n}` = upgrade level. */
        upgradeLevel: string;
    };
    pause: {
        title: string;
        resume: string;
        restart: string;
        mainMenu: string;
        hintDesktop: string;
        hintTouch: string;
    };
    gameOver: {
        defeatTitle: string;
        victoryTitle: string;
        runSummary: string;
        waveReached: string;
        timeSurvived: string;
        enemiesSlain: string;
        xpEarned: string;
        levelReached: string;
        /** Row label in the co-op per-hero column, where the number is the value. */
        level: string;
        playAgain: string;
        mainMenu: string;
        submitScore: string;
        submitting: string;
        submitFailed: string;
        enterName: string;
        /** `{n}` = rank. */
        rank: string;
    };
    leaderboard: {
        title: string;
        rank: string;
        name: string;
        wave: string;
        time: string;
        loading: string;
        empty: string;
        close: string;
    };
    ascension: {
        title: string;
        /** `{n}` = unspent points. */
        points: string;
        nextPoint: string;
        selectNode: string;
        invest: string;
        locked: string;
        capstone: string;
    };
    coop: {
        title: string;
        host: string;
        hostBlurb: string;
        join: string;
        joinBlurb: string;
        joinAction: string;
        copy: string;
        codePlaceholder: string;
        forging: string;
        shareCode: string;
        enterCode: string;
        waiting: string;
        startAnyway: string;
        connecting: string;
        /** `{name}` = teammate label. */
        teammateLeft: string;
        reconnecting: string;
        cancel: string;
    };
    boss: {
        /** `{name}` = the boss's own name. A tier-3 twin reads as its echo. */
        echo: string;
    };
    common: {
        loading: string;
        active: string;
        newTag: string;
        back: string;
        close: string;
        skip: string;
    };
}

/**
 * Gameplay-content strings, keyed by the id the data table already uses. Partial
 * on purpose — see the header. Resolution falls back to the data table's own
 * English literal, so an unlisted id renders in English rather than as a key.
 */
export interface ContentStrings {
    /** PowerDefinitions / fusion ids → display name. */
    powerName: Record<string, string>;
    powerDesc: Record<string, string>;
    /** ItemCatalog ids. */
    itemName: Record<string, string>;
    itemDesc: Record<string, string>;
    /** Milestone-boss run-item ids (RunItems.ItemId). */
    runItemName: Record<string, string>;
    /** AscensionTrees node ids. */
    nodeName: Record<string, string>;
    nodeDesc: Record<string, string>;
    /** Ultimate/ability ids. */
    ultName: Record<string, string>;
    ultDesc: Record<string, string>;
    /** Champion class ids ('barbarian' | 'ranger' | 'mage'). */
    championName: Record<string, string>;
    /** Champion one-line role blurb (the stat block is composed separately so the
     *  numbers are not duplicated into every locale). */
    championBlurb: Record<string, string>;
    /** Milestone-boss tier labels, keyed by tier number as a string. */
    bossName: Record<string, string>;
    /** Enemy archetype display names, for anywhere an enemy is named. */
    enemyName: Record<string, string>;
    /** Element names (fire/ice/arcane/physical/storm). */
    elementName: Record<string, string>;
}

/** One complete locale. */
export interface LocaleStrings {
    /** BCP-47-ish tag, for `Intl` formatting and the `lang` attribute. */
    tag: string;
    /** Endonym shown in the language picker — always in its OWN language, which
     *  is the one thing a player who cannot read the current UI can still find. */
    label: string;
    ui: UiStrings;
    content: ContentStrings;
}

/** The locales the game ships. */
export type LocaleId = 'en' | 'es' | 'pt';
export const LOCALE_IDS: readonly LocaleId[] = ['en', 'es', 'pt'];
