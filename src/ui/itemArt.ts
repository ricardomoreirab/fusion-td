import { ITEM_ART } from './generated/itemArt';
import { glyphEl } from './icons';

/**
 * Baked item art — 256px WebP renders of the Tripo source models under
 * `art-source/items/`, produced by `npm run icons:items`.
 *
 * Coverage is partial by design: an item without a baked icon falls back to
 * its authored SVG glyph, so the catalogue can grow art incrementally without
 * ever showing a broken image.
 */

export function itemArtUrl(id: string | null | undefined): string | null {
    return (id && ITEM_ART[id]) || null;
}

/** The emblem for an item: baked art when it exists, else the SVG glyph. */
export function itemArtEl(
    id: string | null | undefined,
    glyph: string | null | undefined,
    alt = '',
): HTMLImageElement | SVGSVGElement {
    const url = itemArtUrl(id);
    if (!url) return glyphEl(glyph);
    const img = document.createElement('img');
    img.className = 'item-art';
    img.src = url;
    img.alt = alt;
    img.decoding = 'async';
    // A failed fetch must not leave a broken-image frame in the card; drop to
    // the glyph the same way an unbaked item does.
    img.addEventListener('error', () => img.replaceWith(glyphEl(glyph)), { once: true });
    return img;
}

/** Catalogue ids that currently have baked art (art-review surfaces). */
export function itemArtIds(): string[] {
    return Object.keys(ITEM_ART);
}

/** Warm the HTTP cache so the shop modal never pops in mid-open. */
export function preloadItemArt(): void {
    for (const url of Object.values(ITEM_ART)) new Image().src = url;
}
