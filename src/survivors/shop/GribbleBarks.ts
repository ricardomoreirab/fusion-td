/** Gribble the traveling merchant — bark lines. Pure data, picked with an
 *  injected rng so tests (and the bark rotation) stay deterministic. */
export const GRIBBLE_NAME = 'Gribble';

export type BarkCategory = 'arrive' | 'browse' | 'buy' | 'poor' | 'leave' | 'reroll';

export const GRIBBLE_BARKS: Record<BarkCategory, string[]> = {
    arrive: [
        'Fresh goods! Fell off a caravan. ALL of it fell off a caravan.',
        'Gribble\'s Emporium is OPEN! No refunds, no questions, no witnesses.',
        'Psst! Hero! Yes you, the stabby one. Come spend!',
        'I followed the screaming. Screaming means customers!',
    ],
    browse: [
        'For you? Triple price. Kidding! …Mostly.',
        'That one\'s cursed. The price, I mean. The item\'s fine.',
        'Try it on! If it bites, that\'s a feature.',
        'Quality goods! Gribble only steals from the BEST.',
    ],
    buy: [
        'Pleasure doin\' business, tall person!',
        'SOLD! Gribble eats tonight!',
        'Excellent choice. The last owner barely used it. Briefly.',
        'A coin saved is a coin Gribble doesn\'t have. Spend more!',
    ],
    poor: [
        'Come back when yer pockets jingle!',
        'No gold, no goods. Gribble\'s heart says yes, Gribble\'s ledger says NO.',
        'I take gold, not exposure.',
    ],
    leave: [
        'Window shoppers don\'t keep Gribble fed!',
        'Fine, FINE! Go fight monsters in DISCOUNT gear!',
        'You\'ll be back. They\'re always back. Usually bleeding.',
    ],
    reroll: [
        'Shake the wagon, see what falls out!',
        'New stock! Don\'t ask where from.',
        'Gribble\'s cousin "found" these this morning.',
    ],
};

export function pickBark(category: BarkCategory, rng: () => number = Math.random): string {
    const lines = GRIBBLE_BARKS[category];
    return lines[Math.floor(rng() * lines.length) % lines.length];
}
