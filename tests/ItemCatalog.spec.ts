import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG, ITEM_SETS, itemById, setById } from '../src/survivors/items/ItemCatalog';
import { EQUIP_SLOTS, RARITY_BASE_PRICE } from '../src/survivors/items/ItemTypes';

describe('ItemCatalog integrity', () => {
    it('has 30 items with unique ids', () => {
        expect(ITEM_CATALOG.length).toBe(30);
        const ids = new Set(ITEM_CATALOG.map(i => i.id));
        expect(ids.size).toBe(ITEM_CATALOG.length);
    });

    it('glyphs are unique (the icon is the item\'s visual identity in the shop)', () => {
        const glyphs = ITEM_CATALOG.map(i => i.glyph);
        expect(new Set(glyphs).size).toBe(glyphs.length);
    });

    it('every item has a valid slot, rarity, glyph and flavor', () => {
        for (const item of ITEM_CATALOG) {
            expect(EQUIP_SLOTS).toContain(item.slot);
            expect(RARITY_BASE_PRICE[item.rarity]).toBeGreaterThan(0);
            expect(item.glyph.length).toBeGreaterThan(0);
            expect(item.flavor.length).toBeGreaterThan(0);
        }
    });

    it('every weapon is class-gated (never "all")', () => {
        for (const item of ITEM_CATALOG.filter(i => i.slot === 'weapon')) {
            expect(item.classes).not.toBe('all');
        }
    });

    it('has 4 sets of exactly 3 existing pieces with distinct slots and back-references', () => {
        expect(ITEM_SETS.length).toBe(4);
        for (const set of ITEM_SETS) {
            expect(set.pieces.length).toBe(3);
            const slots = new Set<string>();
            for (const pieceId of set.pieces) {
                const piece = itemById(pieceId);
                expect(piece, `set ${set.id} piece ${pieceId} must exist`).toBeDefined();
                expect(piece!.setId).toBe(set.id);
                slots.add(piece!.slot);
            }
            expect(slots.size).toBe(3);
        }
    });

    it('every item setId points to an existing set that lists the item', () => {
        for (const item of ITEM_CATALOG) {
            if (!item.setId) continue;
            const set = setById(item.setId);
            expect(set).toBeDefined();
            expect(set!.pieces).toContain(item.id);
        }
    });

    it('class-specific sets only contain pieces usable by that class', () => {
        for (const set of ITEM_SETS) {
            const classLists = set.pieces.map(p => itemById(p)!.classes);
            const specific = classLists.filter(c => c !== 'all');
            if (specific.length > 0) {
                const first = (specific[0] as string[])[0];
                for (const c of specific) expect(c).toContain(first);
            }
        }
    });
});
