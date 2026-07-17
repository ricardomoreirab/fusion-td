import { GameUI } from '../GameUI';
import { Game } from '../../engine/Game';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';
import { AbilityManager } from '../../survivors/abilities/AbilityManager';
import { RunItems, ItemId } from '../../survivors/RunItems';
import { el } from '../dom';
import { makePill, PillController } from '../primitives/Pill';
import { makeIconSlot, IconSlotController } from '../primitives/IconSlot';
import { flashClass, onTap } from '../interaction';
import { cooldownFraction, waveLabel, levelLabel, runStatsLabel, WaveInfo } from '../format';
import { GearSlotVM } from '../overlays/CharacterProfile';
import { SLOT_GLYPH } from '../overlays/slotMeta';
import { EQUIP_SLOTS, RARITY_COLOR } from '../../survivors/items/ItemTypes';

// Glyph/colour maps for the HUD (originally from the now-deleted Babylon-GUI HeroHud).
const ELEMENT_GLYPH: Record<string, string> = {
  fire: '🔥', ice: '◆', arcane: '◉', physical: '➤', storm: '⚡',
};
const POWER_GLYPH: Record<string, string> = {
  fireball: '🔥', frost_shards: '◆', arcane_nova: '◉',
  piercing_arrow: '➤', whirling_blades: '✦', lightning_chain: '⚡',
};
const ELEMENT_COLOR: Record<string, string> = {
  fire: '#ff6030', ice: '#30cfff', arcane: '#b050ff', physical: '#e0e0e0', storm: '#ffe040',
};
const ITEM_GLYPH: Record<ItemId, string> = {
  extraLife: '✚', multishotCleave: '✦', knockback: '➤', attackSpeed: '⚡︎', elementalCore: '\u{1F48E}',
};
const ITEM_COLOR: Record<ItemId, string> = {
  extraLife: '#46e05a', multishotCleave: '#ffd84a', knockback: '#4ea7ff', attackSpeed: '#fff080', elementalCore: '#ff5a2e',
};
const ITEM_IDS: ItemId[] = ['extraLife', 'multishotCleave', 'knockback', 'attackSpeed', 'elementalCore'];

const ULT_DISPLAY: Record<string, { glyph: string; color: string }> = {
  meteor: { glyph: '☄', color: '#c04010' },
  frostNova: { glyph: '❄', color: '#3080c0' },
  whirlwind: { glyph: '\u{1F300}', color: '#4090d0' },
  smash: { glyph: '\u{1F4A5}', color: '#d06030' },
  multishot: { glyph: '\u{1F3F9}', color: '#60c060' },
  explosiveArrow: { glyph: '\u{1F4A2}', color: '#e06030' },
  dash: { glyph: '➤', color: '#a0a8c0' },
};

export class Hud {
  private gameUI: GameUI;
  private game: Game | null;
  private abilityManager: AbilityManager | null;
  private runItems: RunItems | null = null;

  private root: HTMLDivElement;
  private hpPill: PillController;
  private wavePill: PillController;
  private statsPill: PillController;
  private levelPill: PillController;
  private goldPill: PillController;

  private powerSlots: IconSlotController[] = [];
  private itemSlots: Record<ItemId, IconSlotController | null> = {
    extraLife: null, multishotCleave: null, knockback: null, attackSpeed: null, elementalCore: null,
  };
  private prevCooldownRemaining: number[] = [-1, -1, -1, -1];
  private cachedPowerEmpty: (boolean | null)[] = [null, null, null, null];
  private cachedPowerIcon: (string | null)[] = [null, null, null, null];
  private cachedPowerColor: (string | null)[] = [null, null, null, null];
  private cachedPowerLevel: (number | null)[] = [null, null, null, null];
  private cachedPowerCdFrac: number[] = [-1, -1, -1, -1];
  private itemPulse: Record<ItemId, boolean> = {
    extraLife: false, multishotCleave: false, knockback: false, attackSpeed: false, elementalCore: false,
  };
  private cachedItemOwned: Record<ItemId, boolean | null> = {
    extraLife: null, multishotCleave: null, knockback: null, attackSpeed: null, elementalCore: null,
  };
  private cachedItemStacks: Record<ItemId, number | null> = {
    extraLife: null, multishotCleave: null, knockback: null, attackSpeed: null, elementalCore: null,
  };

  private ultButtons: { root: HTMLDivElement; label: HTMLDivElement; cd: HTMLDivElement; cdText: HTMLDivElement; id: string }[] = [];
  private ultimateActivators: (() => void)[] = [];

  private pauseIcon!: HTMLDivElement;
  private vignette!: HTMLDivElement;
  private hornBtn!: HTMLDivElement;
  private onHorn: () => void = () => {};
  private lowHpTime = 0;

  // Always-visible equipment strip (single-player only) → opens the character profile.
  private inventoryStrip!: HTMLDivElement;
  private inventoryCells: HTMLDivElement[] = [];
  private onOpenCharacter: () => void = () => {};

  // diff trackers
  private prevHp = -1;
  private prevLevel = -1;
  private prevWaveInProgress = false;
  private prevGold = -1;

  // Per-frame write caches — the last value actually written to the DOM for
  // each field, so unchanged frames skip the write entirely (style/textContent
  // writes force style recalc even when the value is identical). Always
  // rounded/formatted BEFORE comparison so sub-visible deltas don't defeat the
  // cache.
  private cachedStatsText: string | null = null;
  private cachedHpFill = -1;
  private cachedHpText: string | null = null;
  private cachedLevelText: string | null = null;
  private cachedLevelFill = -1;
  private cachedWaveText: string | null = null;
  private cachedUltCdHeight: (number | null)[] = [];
  private cachedUltCdText: (string | null)[] = [];
  private cachedUltLabelOpacity: (number | null)[] = [];
  private cachedVignetteOpacity = -1;

  constructor(gameUI: GameUI, abilityManager?: AbilityManager, game?: Game) {
    this.gameUI = gameUI;
    this.abilityManager = abilityManager ?? null;
    this.game = game ?? null;

    this.root = el('div', { class: 'hud' });
    gameUI.layer('hud').appendChild(this.root);

    // Top bar: [HP | wave | level | gold] — HP + level carry fill bars; gold does not.
    const topBar = el('div', { class: 'hud__topbar' });
    this.hpPill = makePill('hp');
    this.wavePill = makePill('wave');
    this.statsPill = makePill('stats');
    this.levelPill = makePill('level');
    this.goldPill = makePill('gold');
    topBar.append(this.hpPill.root, this.wavePill.root, this.statsPill.root, this.levelPill.root, this.goldPill.root);
    this.root.appendChild(topBar);

    // Always-visible inventory strip, top-left under the top bar (single-player).
    // Hidden until setInventory() is called; clicking it opens the character profile.
    this.inventoryStrip = el('div', { class: 'hud__inventory interactive', attrs: { role: 'button', title: 'Character (equipment)' } });
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const cell = el('div', { class: 'gear-slot gear-slot--empty' });
      cell.appendChild(el('div', { class: 'gear-slot__glyph', text: SLOT_GLYPH[EQUIP_SLOTS[i]] }));
      this.inventoryCells.push(cell);
      this.inventoryStrip.appendChild(cell);
    }
    this.inventoryStrip.style.display = 'none';
    onTap(this.inventoryStrip, () => this.onOpenCharacter());
    this.root.appendChild(this.inventoryStrip);

    // Bottom-left cluster: 4 power slots + 4 item slots.
    const bottomLeft = el('div', { class: 'hud__cluster hud__cluster--left' });
    const powerRow = el('div', { class: 'hud__row' });
    for (let i = 0; i < 4; i++) {
      const slot = makeIconSlot();
      this.powerSlots.push(slot);
      powerRow.appendChild(slot.root);
    }
    const itemRow = el('div', { class: 'hud__row' });
    for (const id of ITEM_IDS) {
      const slot = makeIconSlot('slot--item');
      slot.setIcon(ITEM_GLYPH[id], '#3a3a46');
      slot.setAccent('#3a3a46');
      this.itemSlots[id] = slot;
      itemRow.appendChild(slot.root);
    }
    bottomLeft.append(powerRow, itemRow);
    this.root.appendChild(bottomLeft);

    // Bottom-right cluster: ultimate buttons.
    const bottomRight = el('div', { class: 'hud__cluster hud__cluster--right' });
    const ultDefs = this.resolveUltimateDefs();
    for (let i = 0; i < ultDefs.length; i++) {
      const def = ultDefs[i];
      const root = el('div', { class: 'ult slot interactive' });
      root.style.setProperty('--accent', def.color);
      const label = el('div', { class: 'ult__label', text: def.glyph });
      const cd = el('div', { class: 'slot__cd' });
      const cdText = el('div', { class: 'ult__cdtext' });
      root.append(label, cd, cdText);
      // Keybind hint — Q / E / Space, matching the keyboard activators.
      // Desktop only; hidden on touch via `@media (pointer: coarse)`.
      const keyLabel = i === 0 ? 'Q' : i === 1 ? 'E' : i === 2 ? 'SP' : null;
      if (keyLabel) root.appendChild(el('div', { class: 'ult__key', text: keyLabel }));
      const activate = () => {
        if (!this.abilityManager) return;
        if (this.abilityManager.activate(def.id)) flashClass(root, 'ult--fire');
      };
      onTap(root, activate);
      this.ultimateActivators.push(activate);
      this.ultButtons.push({ root, label, cd, cdText, id: def.id });
      bottomRight.appendChild(root);
    }
    this.root.appendChild(bottomRight);

    // Pause button (top-right, left of the level pill).
    const pauseBtn = el('div', { class: 'hud__pause frame frame--lite interactive', attrs: { role: 'button' } });
    this.pauseIcon = el('div', { class: 'hud__pause-icon', text: '⏸' });
    pauseBtn.appendChild(this.pauseIcon);
    onTap(pauseBtn, () => this.togglePause());
    this.root.appendChild(pauseBtn);

    // "Sound the horn" — starts the next wave during the merchant/shopping phase.
    this.hornBtn = el('div', { class: 'hud__horn frame frame--lite interactive', attrs: { role: 'button' } });
    this.hornBtn.appendChild(el('div', { class: 'hud__horn-label', text: '⚔ Next wave' }));
    this.hornBtn.style.display = 'none';
    onTap(this.hornBtn, () => this.onHorn());
    this.root.appendChild(this.hornBtn);

    // Low-HP vignette lives on the fx layer.
    this.vignette = el('div', { class: 'hud__vignette' });
    this.gameUI.layer('fx').appendChild(this.vignette);
  }

  setRunItems(runItems: RunItems): void { this.runItems = runItems; }

  /** Toggle pause and keep the button glyph in sync. Safe to call from a key
      handler (ESC) — the game-update loop is frozen while paused, so the icon
      must be synced here rather than in update(). */
  togglePause(): void {
    if (!this.game) return;
    this.game.togglePause();
    this.pauseIcon.textContent = this.game.getIsPaused() ? '▶' : '⏸';
  }

  private resolveUltimateDefs(): { id: string; glyph: string; color: string }[] {
    const fallback = [
      { id: 'meteor', glyph: '☄', color: '#c04010' },
      { id: 'frostNova', glyph: '❄', color: '#3080c0' },
    ];
    if (!this.abilityManager) return fallback;
    const ids = this.abilityManager.getRegisteredAbilityIds();
    if (ids.length === 0) return fallback;
    return ids.map(id => {
      const meta = ULT_DISPLAY[id];
      return { id, glyph: meta?.glyph ?? '◉', color: meta?.color ?? '#808080' };
    });
  }

  update(
    hp: { current: number; max: number },
    xp: { level: number; progress: number },
    slots: (PowerSlot | null)[],
    deltaTime = 0,
    waveInfo?: WaveInfo,
    runStats?: { timeS: number; kills: number },
  ): void {
    if (runStats) {
      const statsText = runStatsLabel(runStats.timeS, runStats.kills);
      if (statsText !== this.cachedStatsText) {
        this.cachedStatsText = statsText;
        this.statsPill.setText(statsText);
      }
    }
    const ratio = Math.max(0, hp.current / hp.max);
    const hpFill = Math.round(ratio * 1000) / 1000;
    if (hpFill !== this.cachedHpFill) {
      this.cachedHpFill = hpFill;
      this.hpPill.setFill(hpFill);
    }
    const hpText = `❤ ${Math.ceil(hp.current)} / ${hp.max}`;
    if (hpText !== this.cachedHpText) {
      this.cachedHpText = hpText;
      this.hpPill.setText(hpText);
    }
    if (this.prevHp >= 0 && hp.current < this.prevHp - 0.01) {
      flashClass(this.hpPill.root, 'pill--flash-dmg');
    }
    this.prevHp = hp.current;

    const levelText = levelLabel(xp.level);
    if (levelText !== this.cachedLevelText) {
      this.cachedLevelText = levelText;
      this.levelPill.setText(levelText);
    }
    const levelFill = Math.round(xp.progress * 1000) / 1000;
    if (levelFill !== this.cachedLevelFill) {
      this.cachedLevelFill = levelFill;
      this.levelPill.setFill(levelFill);
    }
    if (this.prevLevel >= 0 && xp.level > this.prevLevel) {
      flashClass(this.levelPill.root, 'pill--pulse');
    }
    this.prevLevel = xp.level;

    const waveText = waveLabel(waveInfo);
    if (waveText !== this.cachedWaveText) {
      this.cachedWaveText = waveText;
      this.wavePill.setText(waveText);
    }
    if (waveInfo && this.prevWaveInProgress && !waveInfo.inProgress) {
      flashClass(this.wavePill.root, 'pill--flash-clear');
    }
    if (waveInfo) this.prevWaveInProgress = waveInfo.inProgress;

    // Power slots
    for (let i = 0; i < 4; i++) {
      const slot = slots[i];
      const ui = this.powerSlots[i];
      if (!slot) {
        if (this.cachedPowerEmpty[i] !== true) { this.cachedPowerEmpty[i] = true; ui.setEmpty(true); }
        if (this.cachedPowerIcon[i] !== '+') { this.cachedPowerIcon[i] = '+'; this.cachedPowerColor[i] = '#666'; ui.setIcon('+', '#666'); }
        if (this.cachedPowerLevel[i] !== 0) { this.cachedPowerLevel[i] = 0; ui.setLevel(0); }
        if (this.cachedPowerCdFrac[i] !== 0) { this.cachedPowerCdFrac[i] = 0; ui.setCooldown(0); }
        this.prevCooldownRemaining[i] = -1;
        continue;
      }
      if (this.cachedPowerEmpty[i] !== false) { this.cachedPowerEmpty[i] = false; ui.setEmpty(false); }
      const { glyph, color } = this.glyphFor(slot);
      if (this.cachedPowerIcon[i] !== glyph || this.cachedPowerColor[i] !== color) {
        this.cachedPowerIcon[i] = glyph;
        this.cachedPowerColor[i] = color;
        ui.setIcon(glyph, color);
        ui.setAccent(color);
      }
      if (this.cachedPowerLevel[i] !== slot.state.level) {
        this.cachedPowerLevel[i] = slot.state.level;
        ui.setLevel(slot.state.level);
      }
      const total = slot.def.cooldownFor(slot.state);
      const remaining = Math.max(0, slot.state.cooldownRemaining);
      const cdFrac = Math.round(this.cdFraction(remaining, total) * 1000) / 1000;
      if (cdFrac !== this.cachedPowerCdFrac[i]) {
        this.cachedPowerCdFrac[i] = cdFrac;
        ui.setCooldown(cdFrac);
      }
      const prev = this.prevCooldownRemaining[i];
      if (prev >= 0 && prev < 0.05 && remaining > total * 0.9) ui.pulseReady();
      this.prevCooldownRemaining[i] = remaining;
    }

    // Item row
    for (const id of ITEM_IDS) {
      const ui = this.itemSlots[id];
      if (!ui) continue;
      const stacks = this.runItems?.getStacks(id) ?? 0;
      const owned = stacks > 0;
      if (this.cachedItemOwned[id] !== owned) {
        this.cachedItemOwned[id] = owned;
        ui.setIcon(ITEM_GLYPH[id], owned ? ITEM_COLOR[id] : '#3a3a46');
        ui.setAccent(owned ? ITEM_COLOR[id] : '#3a3a46');
      }
      if (this.cachedItemStacks[id] !== stacks) {
        this.cachedItemStacks[id] = stacks;
        ui.setLevel(stacks);
      }
      if (this.itemPulse[id]) { ui.pulseReady(); this.itemPulse[id] = false; }
    }

    if (this.abilityManager) {
      const ids = this.abilityManager.getRegisteredAbilityIds();
      for (let i = 0; i < this.ultButtons.length; i++) {
        const btn = this.ultButtons[i];
        const ability = ids[i] ? this.abilityManager.getAbility(ids[i]) : null;
        if (!ability) continue;
        if (ability.isReady) {
          if (this.cachedUltCdHeight[i] !== 0) { this.cachedUltCdHeight[i] = 0; btn.cd.style.height = '0%'; }
          if (this.cachedUltCdText[i] !== '') { this.cachedUltCdText[i] = ''; btn.cdText.textContent = ''; }
          if (this.cachedUltLabelOpacity[i] !== 1) { this.cachedUltLabelOpacity[i] = 1; btn.label.style.opacity = '1'; }
        } else {
          const heightPct = Math.round(this.cdFraction(ability.currentCooldown, ability.cooldown) * 1000) / 10;
          if (this.cachedUltCdHeight[i] !== heightPct) {
            this.cachedUltCdHeight[i] = heightPct;
            btn.cd.style.height = `${heightPct}%`;
          }
          const secs = ability.currentCooldown;
          const cdText = secs >= 10 ? `${Math.ceil(secs)}` : secs.toFixed(1);
          if (this.cachedUltCdText[i] !== cdText) {
            this.cachedUltCdText[i] = cdText;
            btn.cdText.textContent = cdText;
          }
          if (this.cachedUltLabelOpacity[i] !== 0.35) { this.cachedUltLabelOpacity[i] = 0.35; btn.label.style.opacity = '0.35'; }
        }
      }
    }

    const inDanger = ratio < 0.25;
    if (inDanger) {
      this.lowHpTime += deltaTime;
      const a = Math.round((0.08 + 0.1 * Math.max(0, Math.sin(this.lowHpTime * Math.PI * 1.8))) * 1000) / 1000;
      if (a !== this.cachedVignetteOpacity) {
        this.cachedVignetteOpacity = a;
        this.vignette.style.opacity = `${a}`;
      }
    } else {
      if (this.cachedVignetteOpacity !== 0) {
        this.cachedVignetteOpacity = 0;
        this.vignette.style.opacity = '0';
      }
      this.lowHpTime = 0;
    }
  }

  /** Flash the level pill on level-up (called by the gameplay state). */
  flashXpBar(): void { flashClass(this.levelPill.root, 'pill--pulse'); }

  /** Update the gold pill (called every frame by the gameplay state). */
  setGold(gold: number): void {
    if (gold === this.prevGold) return;
    if (this.prevGold >= 0 && gold > this.prevGold) flashClass(this.goldPill.root, 'pill--pulse');
    this.prevGold = gold;
    this.goldPill.setText(`🪙 ${gold}`);
  }

  setOnHorn(fn: () => void): void { this.onHorn = fn; }
  setHornVisible(visible: boolean): void {
    this.hornBtn.style.display = visible ? '' : 'none';
  }

  /** Open-character-profile callback (wired by the gameplay state). */
  setOnOpenCharacter(fn: () => void): void { this.onOpenCharacter = fn; }

  /** Populate + show the always-visible equipment strip (single-player only).
      Each cell shows the equipped piece's glyph + rarity color, or the empty
      slot glyph. Called at run start and after every equipment change. */
  setInventory(slots: GearSlotVM[]): void {
    this.inventoryStrip.style.display = '';
    for (let i = 0; i < this.inventoryCells.length; i++) {
      const cell = this.inventoryCells[i];
      const s = slots[i];
      if (!s) continue;
      const filled = !!s.name;
      cell.classList.toggle('gear-slot--empty', !filled);
      cell.style.setProperty('--accent', filled && s.rarity ? RARITY_COLOR[s.rarity] : '#3a3a46');
      const glyph = cell.firstElementChild as HTMLElement;
      if (glyph) glyph.textContent = s.glyph ?? SLOT_GLYPH[s.slot];
      cell.title = filled ? `${s.name}` : `${s.slot} (empty)`;
    }
  }

  // Stubs completed in later tasks (kept so the API exists from the start).
  pulseItem(id: ItemId): void { this.itemPulse[id] = true; }
  triggerUltimateByIndex(index: number): void { this.ultimateActivators[index]?.(); }

  dispose(): void {
    this.root.remove();
    this.vignette.remove();
  }

  // Helpers used by later tasks
  protected glyphFor(slot: PowerSlot): { glyph: string; color: string } {
    const tier = slot.def.tier;
    const glyph = tier === 'ultimate' ? '✪'
      : tier === 'fusion' ? '✦'
      : (POWER_GLYPH[slot.def.id] ?? ELEMENT_GLYPH[slot.def.element] ?? '?');
    const color = tier === 'ultimate' ? '#ffd24d'
      : tier === 'fusion' ? '#c060ff'
      : (ELEMENT_COLOR[slot.def.element] ?? '#fff');
    return { glyph, color };
  }
  protected cdFraction = cooldownFraction;
}
