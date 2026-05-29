import { GameUI } from '../GameUI';
import { Game } from '../../engine/Game';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';
import { AbilityManager } from '../../survivors/abilities/AbilityManager';
import { RunItems, ItemId } from '../../survivors/RunItems';
import { el } from '../dom';
import { makePill, PillController } from '../primitives/Pill';
import { makeIconSlot, IconSlotController } from '../primitives/IconSlot';
import { flashClass, onTap } from '../interaction';
import { cooldownFraction, waveLabel, goldLabel, WaveInfo } from '../format';

// Copied verbatim from HeroHud.ts — keep in sync until HeroHud is deleted.
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
  lifesteal: '♥︎', multishotCleave: '✦', knockback: '➤', attackSpeed: '⚡︎',
};
const ITEM_COLOR: Record<ItemId, string> = {
  lifesteal: '#ff2a40', multishotCleave: '#ffd84a', knockback: '#4ea7ff', attackSpeed: '#fff080',
};
const ITEM_IDS: ItemId[] = ['lifesteal', 'multishotCleave', 'knockback', 'attackSpeed'];

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
  private goldPill: PillController;

  private powerSlots: IconSlotController[] = [];
  private itemSlots: Record<ItemId, IconSlotController | null> = {
    lifesteal: null, multishotCleave: null, knockback: null, attackSpeed: null,
  };
  private prevCooldownRemaining: number[] = [-1, -1, -1, -1];
  private itemPulse: Record<ItemId, boolean> = {
    lifesteal: false, multishotCleave: false, knockback: false, attackSpeed: false,
  };

  private ultButtons: { root: HTMLDivElement; label: HTMLDivElement; cd: HTMLDivElement; cdText: HTMLDivElement; id: string }[] = [];
  private ultimateActivators: (() => void)[] = [];

  private pauseIcon!: HTMLDivElement;
  private vignette!: HTMLDivElement;
  private lowHpTime = 0;

  // diff trackers
  private prevHp = -1;
  private prevGold = -1;
  private prevWaveInProgress = false;

  constructor(gameUI: GameUI, abilityManager?: AbilityManager, game?: Game) {
    this.gameUI = gameUI;
    this.abilityManager = abilityManager ?? null;
    this.game = game ?? null;

    this.root = el('div', { class: 'hud' });
    gameUI.layer('hud').appendChild(this.root);

    // Top bar: [HP | wave | gold]
    const topBar = el('div', { class: 'hud__topbar' });
    this.hpPill = makePill('hp');
    this.wavePill = makePill('wave');
    this.goldPill = makePill('gold');
    topBar.append(this.hpPill.root, this.wavePill.root, this.goldPill.root);
    this.root.appendChild(topBar);

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
    for (const def of ultDefs) {
      const root = el('div', { class: 'ult slot interactive' });
      root.style.setProperty('--accent', def.color);
      const label = el('div', { class: 'ult__label', text: def.glyph });
      const cd = el('div', { class: 'slot__cd' });
      const cdText = el('div', { class: 'ult__cdtext' });
      root.append(label, cd, cdText);
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

    // Pause button (top-right, left of gold).
    const pauseBtn = el('div', { class: 'hud__pause interactive', attrs: { role: 'button' } });
    this.pauseIcon = el('div', { class: 'hud__pause-icon', text: '⏸' });
    pauseBtn.appendChild(this.pauseIcon);
    onTap(pauseBtn, () => {
      if (!this.game) return;
      this.game.togglePause();
      this.pauseIcon.textContent = this.game.getIsPaused() ? '▶' : '⏸';
    });
    this.root.appendChild(pauseBtn);

    // Low-HP vignette lives on the fx layer.
    this.vignette = el('div', { class: 'hud__vignette' });
    this.gameUI.layer('fx').appendChild(this.vignette);
  }

  setRunItems(runItems: RunItems): void { this.runItems = runItems; }

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
    gold: number,
    slots: (PowerSlot | null)[],
    deltaTime = 0,
    waveInfo?: WaveInfo,
  ): void {
    const ratio = Math.max(0, hp.current / hp.max);
    this.hpPill.setFill(ratio);
    this.hpPill.setText(`❤ ${Math.ceil(hp.current)} / ${hp.max}`);
    if (this.prevHp >= 0 && hp.current < this.prevHp - 0.01) {
      flashClass(this.hpPill.root, 'pill--flash-dmg');
    }
    this.prevHp = hp.current;

    this.goldPill.setText(goldLabel(gold));
    if (this.prevGold >= 0 && gold > this.prevGold) {
      flashClass(this.goldPill.root, 'pill--pulse');
    }
    this.prevGold = gold;

    this.wavePill.setText(waveLabel(waveInfo));
    if (waveInfo && this.prevWaveInProgress && !waveInfo.inProgress) {
      flashClass(this.wavePill.root, 'pill--flash-clear');
    }
    if (waveInfo) this.prevWaveInProgress = waveInfo.inProgress;

    // Power slots
    for (let i = 0; i < 4; i++) {
      const slot = slots[i];
      const ui = this.powerSlots[i];
      if (!slot) {
        ui.setEmpty(true);
        ui.setIcon('+', '#666');
        ui.setLevel(0);
        ui.setCooldown(0);
        this.prevCooldownRemaining[i] = -1;
        continue;
      }
      ui.setEmpty(false);
      const { glyph, color } = this.glyphFor(slot);
      ui.setIcon(glyph, color);
      ui.setAccent(color);
      ui.setLevel(slot.state.level);
      const total = slot.def.cooldownFor(slot.state);
      const remaining = Math.max(0, slot.state.cooldownRemaining);
      ui.setCooldown(this.cdFraction(remaining, total));
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
      ui.setIcon(ITEM_GLYPH[id], owned ? ITEM_COLOR[id] : '#3a3a46');
      ui.setAccent(owned ? ITEM_COLOR[id] : '#3a3a46');
      ui.setLevel(stacks);
      if (this.itemPulse[id]) { ui.pulseReady(); this.itemPulse[id] = false; }
    }

    if (this.abilityManager) {
      const ids = this.abilityManager.getRegisteredAbilityIds();
      for (let i = 0; i < this.ultButtons.length; i++) {
        const btn = this.ultButtons[i];
        const ability = ids[i] ? this.abilityManager.getAbility(ids[i]) : null;
        if (!ability) continue;
        if (ability.isReady) {
          btn.cd.style.height = '0%';
          btn.cdText.textContent = '';
          btn.label.style.opacity = '1';
        } else {
          btn.cd.style.height = `${this.cdFraction(ability.currentCooldown, ability.cooldown) * 100}%`;
          const secs = ability.currentCooldown;
          btn.cdText.textContent = secs >= 10 ? `${Math.ceil(secs)}` : secs.toFixed(1);
          btn.label.style.opacity = '0.35';
        }
      }
    }

    const inDanger = ratio < 0.25;
    if (inDanger) {
      this.lowHpTime += deltaTime;
      const a = 0.08 + 0.1 * Math.max(0, Math.sin(this.lowHpTime * Math.PI * 1.8));
      this.vignette.style.opacity = `${a}`;
    } else {
      this.vignette.style.opacity = '0';
      this.lowHpTime = 0;
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
