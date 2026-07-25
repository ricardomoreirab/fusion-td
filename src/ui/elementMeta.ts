import { ELEMENT_HEX } from '../survivors/ElementColors';
import { PowerElement } from '../survivors/powers/PowerDefinitions';
import { IconName } from './icons';

/**
 * The element/tier display vocabulary for every interface surface.
 *
 * The HUD, the power-choice cards and the replace-slot prompt each used to
 * carry their own copy of the element glyph AND hex maps, so a palette tweak
 * had to be made in four files or the surfaces drifted. Colours now come from
 * the canonical `ElementColors.ELEMENT_HEX`; only the icon mapping lives here.
 */
export const ELEMENT_ICON: Record<PowerElement, IconName> = {
    fire: 'flame', ice: 'snowflake', arcane: 'rune', physical: 'spear', storm: 'bolt',
};

/** Per-power icon override, where the power reads as more than its element. */
export const POWER_ICON: Record<string, IconName> = {
    fireball: 'flame', frost_shards: 'snowflake', arcane_nova: 'rune',
    piercing_arrow: 'spear', whirling_blades: 'swords', lightning_chain: 'bolt',
};

export const TIER_COLOR = {
    fusion: '#c060ff',
    ultimate: '#ffd24d',
} as const;

export const TIER_ICON = {
    fusion: 'fusion',
    ultimate: 'ultimate',
} as const satisfies Record<string, IconName>;

/** Neutral fallback for an unknown element string. */
const NEUTRAL = '#e0e0e0';

export function elementColor(element: string | undefined): string {
    return ELEMENT_HEX[element as PowerElement] ?? NEUTRAL;
}

export function elementIcon(element: string | undefined): IconName {
    return ELEMENT_ICON[element as PowerElement] ?? 'rune';
}
