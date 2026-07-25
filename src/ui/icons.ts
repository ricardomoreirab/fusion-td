/**
 * Authored icon set — the UI's visual vocabulary.
 *
 * Every glyph in the interface used to be a platform emoji (🔥 🪙 ❤ 🏹 …),
 * which renders as a full-colour Apple/Noto sticker on top of a forged-bronze
 * fantasy HUD. These replace them with one coherent engraved-line family:
 * 24×24 viewBox, `currentColor`, round joins, so a single `color` (or the
 * element/rarity `--accent`) tints them and they scale from the 13 px shop
 * price row to the 58 px ultimate button without a second asset.
 *
 * Most icons are stroked (they read as etched metal at HUD scale); a handful
 * of silhouettes — heart, flame, bolt, pause/play — are filled, because a
 * solid mass survives being shrunk to 12 px where an outline collapses.
 *
 * Data tables elsewhere (ItemCatalog, PowerDefinitions, UltimateDefinitions)
 * still carry their legacy emoji strings. `iconForGlyph` maps those to an
 * authored icon so the catalogues never had to be rewritten, and `glyphEl`
 * renders any of them safely — an unmapped glyph falls back to a rune mark
 * rather than throwing or leaking an emoji into the frame.
 */

interface IconDef {
  /** Inner SVG markup. Coordinates are authored against a 24×24 viewBox. */
  body: string;
  /** Filled silhouette instead of the default engraved stroke. */
  filled?: boolean;
}

const ICONS = {
  // ── Vitals & run state ────────────────────────────────────────────────
  heart: {
    filled: true,
    body: '<path d="M12 20.9c-.37 0-.72-.14-1-.38C7.28 17.28 3 13.57 3 9.46 3 6.57 5.2 4.35 8.02 4.35c1.62 0 3.12.76 4 1.98.88-1.22 2.38-1.98 4-1.98C18.84 4.35 21 6.57 21 9.46c0 4.11-4.28 7.82-8 11.06-.28.24-.63.38-1 .38Z"/>',
  },
  clock: {
    body: '<circle cx="12" cy="12" r="8.9"/><path d="M12 6.9v5.35l3.5 2.05"/>',
  },
  skull: {
    body: '<path d="M12 3.1c-4.05 0-7.3 3.06-7.3 6.98 0 2.02.9 3.94 2.5 5.2.32.25.5.62.5 1.02v1.3c0 .9.74 1.62 1.65 1.62h5.3c.91 0 1.65-.72 1.65-1.62v-1.3c0-.4.18-.77.5-1.02 1.6-1.26 2.5-3.18 2.5-5.2 0-3.92-3.25-6.98-7.3-6.98Z"/><circle cx="9.3" cy="10.3" r="1.65"/><circle cx="14.7" cy="10.3" r="1.65"/><path d="m12 13.5-.85 1.75h1.7z"/><path d="M10.3 19.2v1.7M13.7 19.2v1.7"/>',
  },
  coin: {
    body: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.3"/><path d="m12 8.5 1.06 2.19 2.4.33-1.74 1.68.42 2.4L12 13.96l-2.14 1.14.42-2.4-1.74-1.68 2.4-.33z"/>',
  },
  /** Goblins still standing this wave — a rake of claw marks. */
  claw: {
    body: '<path d="M6.4 3.6c-.3 4.7.4 8.3 2 11M11.3 2.8c-.3 5.1.1 9 1.1 11.9M16.9 4.2c.2 4.6-.3 8.1-1.5 10.7"/><path d="M5.1 15c1.5 3.7 3.9 5.6 7 5.6 3 0 5.4-1.8 6.9-5.3"/>',
  },
  pause: { filled: true, body: '<path d="M7.8 4.4h3.1v15.2H7.8zM13.1 4.4h3.1v15.2h-3.1z"/>' },
  play: { filled: true, body: '<path d="M7.8 4.3 19.2 12 7.8 19.7z"/>' },
  close: { body: '<path d="M5.6 5.6 18.4 18.4M18.4 5.6 5.6 18.4"/>' },

  // ── Elements ──────────────────────────────────────────────────────────
  flame: {
    filled: true,
    body: '<path d="M12.1 1.9c.66 3-.45 4.62-1.9 6.16-1.62 1.72-3.6 3.5-3.6 6.4A5.94 5.94 0 0 0 12.5 21a5.6 5.6 0 0 0 5.05-5.65c0-2.42-1.02-4.06-2.24-5.5-.4 1.02-1 1.68-1.8 2 .82-3.24-.4-6.75-1.41-9.95Z"/>',
  },
  snowflake: {
    body: '<path d="M12 2.4v19.2M3.68 7.2l16.64 9.6M3.68 16.8l16.64-9.6"/><path d="M9.5 4.6 12 7.1l2.5-2.5M9.5 19.4 12 16.9l2.5 2.5"/><path d="m4.3 10.1 3.4-.9.9-3.4M19.7 13.9l-3.4.9-.9 3.4M4.3 13.9l3.4.9.9 3.4M19.7 10.1l-3.4-.9-.9-3.4"/>',
  },
  rune: {
    body: '<path d="M12 2.6 21.4 12 12 21.4 2.6 12z"/><path d="M12 7.3 16.7 12 12 16.7 7.3 12z"/><circle cx="12" cy="12" r="1.5"/>',
  },
  spear: {
    body: '<path d="M12 2.4 16.5 12 12 21.6 7.5 12z"/><path d="M12 6.7v10.6"/>',
  },
  bolt: { filled: true, body: '<path d="M13.7 2 5.4 13.7h4.9l-1.6 8.3 8.9-12.1h-5.3z"/>' },

  // ── Power tiers ───────────────────────────────────────────────────────
  fusion: {
    body: '<path d="m12 3.4 1.95 6.15 6.15 1.95-6.15 1.95L12 19.6l-1.95-6.15L3.9 11.5l6.15-1.95z"/><path d="M18.6 17.2v3M17.1 18.7h3M5.4 4.2v2.6M4.1 5.5h2.6"/>',
  },
  ultimate: {
    body: '<path d="m12 2.4 1.85 6.5 6.4-1.8-3.2 4.9 3.2 4.9-6.4-1.8L12 21.6l-1.85-6.5-6.4 1.8 3.2-4.9-3.2-4.9 6.4 1.8z"/><circle cx="12" cy="12" r="2.3"/>',
  },
  /** An unfilled power socket: an engraved, deliberately broken rune line. */
  socket: {
    body: '<path d="M12 3.7 20.3 12 12 20.3 3.7 12z" stroke-dasharray="3.2 2.8"/>',
  },
  star: {
    body: '<path d="m12 2.9 2.72 5.86 6.38.72-4.73 4.33 1.28 6.3L12 16.94l-5.65 3.17 1.28-6.3L2.9 9.48l6.38-.72z"/>',
  },
  chevronUp: { body: '<path d="m5.5 14.8 6.5-6.4 6.5 6.4"/><path d="m5.5 20.4 6.5-6.4 6.5 6.4"/>' },

  // ── Champion classes ──────────────────────────────────────────────────
  axe: {
    body: '<path d="m12.6 11.4-8 8a1.9 1.9 0 1 0 2.7 2.7l8-8"/><path d="M10.3 9.1 16.7 2.7a7.3 7.3 0 0 1 4.7 7.6 7.3 7.3 0 0 1-6.4 6z"/><path d="M13.4 4.9a5.6 5.6 0 0 1 3.9 6"/>',
  },
  bow: {
    body: '<path d="M8 2.6a13 13 0 0 1 0 18.8"/><path d="M8 2.6v18.8"/><path d="M4.4 12h14.2M15.4 8.8 18.6 12l-3.2 3.2"/><path d="m4.4 12 2.3-2.3M4.4 12l2.3 2.3"/>',
  },
  orb: {
    body: '<circle cx="12" cy="8.8" r="5.9"/><path d="M9.4 6a3.6 3.6 0 0 0-1.5 2.8"/><path d="m7.9 13.6-1.6 6.2h11.4l-1.6-6.2"/><path d="M4.6 19.8h14.8"/>',
  },

  // ── Ultimates ─────────────────────────────────────────────────────────
  meteor: {
    body: '<circle cx="15.4" cy="8.6" r="4.3"/><path d="M11.2 12.8 3.6 20.4M9.7 8.4 5.4 12.7M15.2 17.8l-4.3 4.3"/>',
  },
  frostNova: {
    body: '<circle cx="12" cy="12" r="9"/><path d="M12 6.6v10.8M7.3 9.3l9.4 5.4M7.3 14.7l9.4-5.4"/>',
  },
  whirlwind: {
    body: '<path d="M12 20.6a8.6 8.6 0 1 0-8.6-8.6"/><path d="M12 16.4a4.4 4.4 0 1 1-4.4-4.4"/><path d="m3.4 12 2.5-2.5M3.4 12l2.5 2.5"/>',
  },
  smash: {
    body: '<path d="m12 2.4 2.3 5.5 5.3-2.1-2.6 5.1 4 3.4-5.4.6 1 5.3-4.6-2.9-4.6 2.9 1-5.3-5.4-.6 4-3.4-2.6-5.1 5.3 2.1z"/>',
  },
  multishot: {
    body: '<path d="M3 5.6h12.2M11.9 2.5l3.1 3.1-3.1 3.1"/><path d="M3 12h15.4M15.1 8.9 18.2 12l-3.1 3.1"/><path d="M3 18.4h12.2M11.9 15.3l3.1 3.1-3.1 3.1"/>',
  },
  explosiveArrow: {
    body: '<path d="M2.9 21.1 11.6 12.4M2.9 16.5v4.6h4.6"/><path d="m16.1 4.3 1.45 3.4 3.4 1.45-3.4 1.45-1.45 3.4-1.45-3.4-3.4-1.45 3.4-1.45z"/>',
  },
  dash: {
    body: '<path d="M3 8h8.6M3 12h12.6M3 16h8.6"/><path d="m16.6 7.4 4.6 4.6-4.6 4.6"/>',
  },

  // ── Run items ─────────────────────────────────────────────────────────
  lifeRune: { body: '<circle cx="12" cy="12" r="9"/><path d="M12 6.6v10.8M6.6 12h10.8"/>' },
  cleave: {
    body: '<path d="M3.6 19.8C3.6 11.9 9 5.4 16.4 4.2"/><path d="M7.2 21C7.2 14.3 11.5 8.8 17.6 7.2"/><path d="M10.8 21.4c0-5.1 3.1-9.6 7.8-11.4"/>',
  },
  impact: {
    body: '<path d="M3.6 4.4v15.2"/><path d="M6.8 12h6.6M10.4 8.4 14 12l-3.6 3.6"/><path d="M17.2 6.6 21 12l-3.8 5.4"/>',
  },
  gem: {
    body: '<path d="M8.2 2.9h7.6L20.4 8 12 21 3.6 8z"/><path d="M3.6 8h16.8M8.2 2.9 12 8l3.8-5.1M12 8v13"/>',
  },

  // ── Equipment slots ───────────────────────────────────────────────────
  sword: {
    body: '<path d="M12 2.4 14.1 6.6v8.1H9.9V6.6z"/><path d="M7.9 14.7h8.2M12 14.7v5.1M10.2 19.8h3.6"/>',
  },
  helm: {
    body: '<path d="M5 11.2a7 7 0 0 1 14 0v4.5c0 2.4-1.7 4.4-4 4.8l-3-.6-3 .6c-2.3-.4-4-2.4-4-4.8z"/><path d="M5 11.9h14M12 11.9v8.6"/>',
  },
  cuirass: {
    body: '<path d="m8.1 3.2 3.9 2.5 3.9-2.5 3.4 1.7-1 4.4 1 3.3c0 4-3.2 7.4-7.3 7.9-4.1-.5-7.3-3.9-7.3-7.9l1-3.3-1-4.4z"/><path d="M12 5.7v14.8"/>',
  },
  greaves: {
    body: '<path d="M7.3 3h4.1v6.6c0 2.6-.4 5.2-1.2 7.7l-.8 3.7H6.6l.6-3.7c.4-2.6.5-5.2.3-7.8z"/><path d="M16.7 3h-4.1v6.6c0 2.6.4 5.2 1.2 7.7l.8 3.7h2.8l-.6-3.7c-.4-2.6-.5-5.2-.3-7.8z"/>',
  },
  boot: {
    body: '<path d="M6.6 3.2h4.6v7.1c0 1.4.55 2.75 1.55 3.75l3.7 3.7c.7.7 1.1 1.65 1.1 2.65v.4H6.6z"/><path d="M6.6 17.4h9.9"/>',
  },
  amulet: {
    body: '<path d="M6.4 3.1 12 8.4l5.6-5.3"/><circle cx="12" cy="14.4" r="5.4"/><path d="m12 11.4 1.15 2.35 2.6.38-1.88 1.82.44 2.58L12 17.31l-2.31 1.22.44-2.58-1.88-1.82 2.6-.38z"/>',
  },
  shield: {
    body: '<path d="M12 2.7 20 5.5v5.9c0 4.6-3.2 8.8-8 9.9-4.8-1.1-8-5.3-8-9.9V5.5z"/>',
  },

  // ── Merchant / shop ───────────────────────────────────────────────────
  potion: {
    body: '<path d="M9.6 2.9h4.8v3.7l3.2 6.5a5.6 5.6 0 0 1-5 8.2h-1.2a5.6 5.6 0 0 1-5-8.2l3.2-6.5z"/><path d="M8.2 6.6h7.6M6.7 15.4h10.6"/>',
  },
  dice: {
    body: '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3"/><circle cx="8.3" cy="8.3" r="1.25"/><circle cx="15.7" cy="15.7" r="1.25"/><circle cx="12" cy="12" r="1.25"/>',
  },
  anvil: {
    body: '<path d="M3.2 7.4h9.9a5.2 5.2 0 0 0 5.2 5.2h2.5v1.9a3.7 3.7 0 0 1-3.7 3.7H9.5l1.2 2.6H6.2l1.2-2.6a4.2 4.2 0 0 1-4.2-4.2z"/>',
  },
  swords: {
    body: '<path d="M3.9 3.2h2.6l11 11-2.6 2.6-11-11z"/><path d="M20.1 3.2h-2.6l-11 11 2.6 2.6 11-11z"/><path d="m5.1 17.5-1.8 1.8 1.5 1.5 1.8-1.8M18.9 17.5l1.8 1.8-1.5 1.5-1.8-1.8"/>',
  },
  /** Wave / objective marker: a hung battle pennant. */
  banner: {
    body: '<path d="M5.6 2.6v18.8"/><path d="M5.6 4h12.8l-2.6 4.1 2.6 4.1H5.6z"/>',
  },
  scroll: {
    body: '<path d="M6.4 3.4h11.2a1.8 1.8 0 0 1 1.8 1.8v13.6a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V5.2a1.8 1.8 0 0 1 1.8-1.8Z"/><path d="M8 8.2h8M8 11.8h8M8 15.4h4.8"/>',
  },

  // ── Co-op ─────────────────────────────────────────────────────────────
  /** Host a room: raise your own keep. */
  keep: {
    body: '<path d="M3.4 8.2V4.6h2.6v1.8h2.6V4.6h2.6v3.6M12.8 8.2V4.6h2.6v1.8H18V4.6h2.6v3.6"/><path d="M3.4 8.2h17.2v12.2H3.4z"/><path d="M9.8 20.4v-5.2a2.2 2.2 0 0 1 4.4 0v5.2"/>',
  },
  /** Join a room: two rings interlocked — a pact between two players. */
  pact: {
    body: '<circle cx="8.6" cy="12" r="5.4"/><circle cx="15.4" cy="12" r="5.4"/>',
  },

  // ── Meta ──────────────────────────────────────────────────────────────
  /** Leaderboard: a victor's cup. */
  trophy: {
    body: '<path d="M7.4 3.4h9.2v5.2a4.6 4.6 0 0 1-9.2 0z"/><path d="M7.4 4.8H4.6v1.6a3.4 3.4 0 0 0 3 3.4M16.6 4.8h2.8v1.6a3.4 3.4 0 0 1-3 3.4"/><path d="M12 13.2v3.9M8.4 20.6h7.2l-.9-3.5H9.3z"/>',
  },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/**
 * Legacy glyph strings still living in gameplay data tables → authored icons.
 * Keeps ItemCatalog / PowerDefinitions / UltimateDefinitions untouched while
 * the interface renders a coherent family.
 */
const GLYPH_TO_ICON: Record<string, IconName> = {
  // elements & powers
  '🔥': 'flame', '❄️': 'snowflake', '❄': 'snowflake', '◆': 'snowflake',
  '◉': 'rune', '➤': 'spear', '⚡': 'bolt', '⚡︎': 'bolt', '☄': 'meteor',
  '🌀': 'whirlwind', '💥': 'smash', '🏹': 'bow', '🔮': 'orb', '🪓': 'axe',
  // tiers & cards
  '✦': 'fusion', '✪': 'ultimate', '★': 'star', '◇': 'socket', '↑': 'chevronUp',
  // items & currency
  '🪙': 'coin', '💎': 'gem', '✚': 'lifeRune', '☠': 'skull',
  // equipment
  '⚔': 'swords', '🪖': 'helm', '🛡': 'shield', '🦵': 'greaves',
  '👢': 'boot', '📿': 'amulet',
  // chrome
  '⏱': 'clock', '❤': 'heart', '⏸': 'pause', '▶': 'play', '✕': 'close',
  '🎲': 'dice', '⬆': 'anvil', '🏆': 'trophy', '🧪': 'potion',
  // single-letter power codes from PowerDefinitions
  A: 'rune', F: 'flame', I: 'snowflake', L: 'bolt', P: 'spear', W: 'fusion',
};

const NS = 'http://www.w3.org/2000/svg';

/** Icon markup as an SVG string (for innerHTML-style composition). */
export function iconMarkup(name: IconName, cls = 'icon'): string {
  const def: IconDef = ICONS[name];
  const paint = def.filled
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="${cls}" viewBox="0 0 24 24" ${paint} aria-hidden="true" focusable="false">${def.body}</svg>`;
}

/** Icon as a live SVG element, ready to append. */
export function iconEl(name: IconName, cls = 'icon'): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = iconMarkup(name, cls);
  const node = tpl.content.firstElementChild;
  // Defensive: a parser hiccup must not hand callers a null they'd append.
  return (node as SVGSVGElement | null) ?? document.createElementNS(NS, 'svg');
}

/** Resolve a legacy data-table glyph to an authored icon (rune when unknown). */
export function iconForGlyph(glyph: string | null | undefined): IconName {
  if (!glyph) return 'rune';
  return GLYPH_TO_ICON[glyph.trim()] ?? 'rune';
}

/** Render a legacy data-table glyph as an authored SVG icon. */
export function glyphEl(glyph: string | null | undefined, cls = 'icon'): SVGSVGElement {
  return iconEl(iconForGlyph(glyph), cls);
}

/** Replace an element's children with a single icon. */
export function setIcon(host: Element, name: IconName, cls = 'icon'): void {
  host.replaceChildren(iconEl(name, cls));
}
