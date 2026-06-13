import { EquipSlot } from '../../survivors/items/ItemTypes';

/** Shared display metadata for equipment slots — used by the shop, the HUD
    inventory strip, and the character profile so they stay consistent. */
export const SLOT_LABEL: Record<EquipSlot, string> = {
    weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest',
    legs: 'Legs', boots: 'Boots', trinket: 'Trinket',
};

export const SLOT_GLYPH: Record<EquipSlot, string> = {
    weapon: '⚔', helmet: '🪖', chest: '🛡', legs: '🦵', boots: '👢', trinket: '📿',
};
