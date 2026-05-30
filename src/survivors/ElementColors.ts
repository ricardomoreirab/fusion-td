import { Color3 } from '@babylonjs/core';
import { PowerElement } from './powers/PowerDefinitions';

/**
 * Single source of truth for the 5-element palette. The hex map is the canonical
 * UI color (used by HeroHud, PowerChoiceOverlay, damage numbers); the Color3 map
 * is derived from it so 3D FX and UI never drift apart.
 */
export const ELEMENT_HEX: Record<PowerElement, string> = {
    fire:     '#ff6030',
    ice:      '#30cfff',
    arcane:   '#b050ff',
    physical: '#e0e0e0',
    storm:    '#ffe040',
};

export const ELEMENT_COLOR: Record<PowerElement, Color3> = {
    fire:     Color3.FromHexString(ELEMENT_HEX.fire),
    ice:      Color3.FromHexString(ELEMENT_HEX.ice),
    arcane:   Color3.FromHexString(ELEMENT_HEX.arcane),
    physical: Color3.FromHexString(ELEMENT_HEX.physical),
    storm:    Color3.FromHexString(ELEMENT_HEX.storm),
};

/**
 * Component-wise average of the given elements' colors. Empty set → neutral
 * white. Used to tint the barbarian's blended slash arc.
 */
export function blendElements(elements: PowerElement[]): Color3 {
    if (elements.length === 0) return new Color3(1, 1, 1);
    let r = 0, g = 0, b = 0;
    for (const el of elements) {
        const c = ELEMENT_COLOR[el];
        r += c.r; g += c.g; b += c.b;
    }
    const n = elements.length;
    return new Color3(r / n, g / n, b / n);
}
