import { EquipSlot } from '../../survivors/items/ItemTypes';
import { IconName } from '../icons';

/** Shared display metadata for equipment slots — used by the shop, the HUD
    inventory strip, and the character profile so they stay consistent. */
export const SLOT_LABEL: Record<EquipSlot, string> = {
    weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest',
    legs: 'Legs', boots: 'Boots', trinket: 'Trinket',
};

/** The empty-socket mark for each slot, from the authored icon set. */
export const SLOT_ICON: Record<EquipSlot, IconName> = {
    weapon: 'sword', helmet: 'helm', chest: 'cuirass',
    legs: 'greaves', boots: 'boot', trinket: 'amulet',
};
