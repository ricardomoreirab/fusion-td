import { Color } from 'three';
import { PowerElement } from './powers/PowerDefinitions';

/**
 * Single source of truth for the 5-element palette. The hex map is the canonical
 * UI color (used by the HUD, PowerChoice overlay, damage numbers); the Color map
 * is derived from it so 3D FX and UI never drift apart.
 */
export const ELEMENT_HEX: Record<PowerElement, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

export const ELEMENT_COLOR: Record<PowerElement, Color> = {
    fire:     new Color(ELEMENT_HEX.fire),
    ice:      new Color(ELEMENT_HEX.ice),
    arcane:   new Color(ELEMENT_HEX.arcane),
    physical: new Color(ELEMENT_HEX.physical),
    storm:    new Color(ELEMENT_HEX.storm),
};

/**
 * Component-wise average of the given elements' colors. Empty set → neutral
 * white. Used to tint the barbarian's blended slash arc.
 */
export function blendElements(elements: PowerElement[]): Color {
    if (elements.length === 0) return new Color(1, 1, 1);
    let r = 0, g = 0, b = 0;
    for (const el of elements) {
        const c = ELEMENT_COLOR[el];
        r += c.r; g += c.g; b += c.b;
    }
    const n = elements.length;
    return new Color(r / n, g / n, b / n);
}
