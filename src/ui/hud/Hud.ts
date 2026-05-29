import { GameUI } from '../GameUI';
import { Game } from '../../engine/Game';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';
import { AbilityManager } from '../../survivors/abilities/AbilityManager';
import { RunItems, ItemId } from '../../survivors/RunItems';
import { el } from '../dom';
import { makePill, PillController } from '../primitives/Pill';
import { flashClass } from '../interaction';
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

export class Hud {
  private gameUI: GameUI;
  private game: Game | null;
  private abilityManager: AbilityManager | null;
  private runItems: RunItems | null = null;

  private root: HTMLDivElement;
  private hpPill: PillController;
  private wavePill: PillController;
  private goldPill: PillController;

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
  }

  setRunItems(runItems: RunItems): void { this.runItems = runItems; }

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
  }

  // Stubs completed in later tasks (kept so the API exists from the start).
  pulseItem(_id: ItemId): void { /* Task 15 */ }
  triggerUltimateByIndex(_index: number): void { /* Task 16 */ }

  dispose(): void {
    this.root.remove();
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
