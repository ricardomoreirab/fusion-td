import { GameUI } from '../GameUI';
import { Game } from '../../engine/Game';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';
import { AbilityManager } from '../../survivors/abilities/AbilityManager';
import { RunItems, ItemId } from '../../survivors/RunItems';
import { el } from '../dom';
import { makeMeter, MeterController } from '../primitives/Meter';
import { makeIconSlot, IconSlotController } from '../primitives/IconSlot';
import { iconEl, IconName, setIcon } from '../icons';
import { itemArtEl } from '../itemArt';
import { elementColor, elementIcon, POWER_ICON, TIER_COLOR, TIER_ICON } from '../elementMeta';
import { flashClass, onTap } from '../interaction';
import {
  cooldownFraction, waveTitle, enemiesLeftLabel, waveBannerLabel,
  clockLabel, levelLabel, WaveInfo,
} from '../format';
import { GearSlotVM } from '../overlays/CharacterProfile';
import { SLOT_ICON } from '../overlays/slotMeta';
import { EQUIP_SLOTS, RARITY_COLOR } from '../../survivors/items/ItemTypes';

// Icon/colour maps for the HUD. Every one of these used to be a platform
// emoji; they are now authored glyphs from src/ui/icons.ts.
const ITEM_ICON: Record<ItemId, IconName> = {
  extraLife: 'lifeRune', multishotCleave: 'cleave', knockback: 'impact',
  attackSpeed: 'bolt', elementalCore: 'gem',
};
const ITEM_COLOR: Record<ItemId, string> = {
  extraLife: '#46e05a', multishotCleave: '#ffd84a', knockback: '#4ea7ff', attackSpeed: '#fff080', elementalCore: '#ff5a2e',
};
const ITEM_IDS: ItemId[] = ['extraLife', 'multishotCleave', 'knockback', 'attackSpeed', 'elementalCore'];
/** Unowned item sockets recede into the bronze chrome instead of flashing grey. */
const ITEM_DORMANT = 'rgba(201, 162, 63, 0.42)';

const ULT_DISPLAY: Record<string, { icon: IconName; color: string }> = {
  meteor: { icon: 'meteor', color: '#e0632a' },
  frostNova: { icon: 'frostNova', color: '#4fb8e8' },
  whirlwind: { icon: 'whirlwind', color: '#67b6e6' },
  smash: { icon: 'smash', color: '#e08a4a' },
  multishot: { icon: 'multishot', color: '#7ad07a' },
  explosiveArrow: { icon: 'explosiveArrow', color: '#e88a4a' },
  dash: { icon: 'dash', color: '#b8c0d8' },
};

/** How long a centre-screen event banner stays up. Matches `banner-in`. */
const BANNER_MS = 2000;

export class Hud {
  private gameUI: GameUI;
  private game: Game | null;
  private abilityManager: AbilityManager | null;
  private runItems: RunItems | null = null;

  private root: HTMLDivElement;

  // Top-left vitals cluster.
  private hpMeter: MeterController;
  private xpMeter: MeterController;
  private medallion: HTMLDivElement;
  private medallionNum: HTMLDivElement;

  // Top-centre objective plate.
  private waveEl: HTMLDivElement;
  private leftEl: HTMLSpanElement;
  private clockEl: HTMLSpanElement;
  private killsEl: HTMLSpanElement;

  // Top-right purse.
  private purseEl: HTMLDivElement;
  private purseNum: HTMLSpanElement;

  // Centre-top event callout.
  private banner: HTMLDivElement;
  private bannerText: HTMLDivElement;
  private bannerTimer = 0;

  private powerSlots: IconSlotController[] = [];
  private itemSlots: Record<ItemId, IconSlotController | null> = {
    extraLife: null, multishotCleave: null, knockback: null, attackSpeed: null, elementalCore: null,
  };
  private prevCooldownRemaining: number[] = [-1, -1, -1, -1];
  private cachedPowerEmpty: (boolean | null)[] = [null, null, null, null];
  private cachedPowerIcon: (IconName | null)[] = [null, null, null, null];
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

  private ultButtons: { root: HTMLDivElement; label: HTMLDivElement; cdText: HTMLDivElement; id: string }[] = [];
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
  private prevWave = -1;
  private prevGold = -1;

  // Per-frame write caches — the last value actually written to the DOM for
  // each field, so unchanged frames skip the write entirely (style/textContent
  // writes force style recalc even when the value is identical). Always
  // rounded/formatted BEFORE comparison so sub-visible deltas don't defeat the
  // cache.
  private cachedClock: string | null = null;
  private cachedKills: string | null = null;
  private cachedLeft: string | null = null;
  private cachedHpFill = -1;
  private cachedHpText: string | null = null;
  private cachedDanger: boolean | null = null;
  private cachedLevelText: string | null = null;
  private cachedLevelFill = -1;
  private cachedWaveText: string | null = null;
  private cachedUltCd: (number | null)[] = [];
  private cachedUltCdText: (string | null)[] = [];
  private cachedUltLabelOpacity: (number | null)[] = [];
  private cachedVignetteOpacity = -1;

  constructor(gameUI: GameUI, abilityManager?: AbilityManager, game?: Game) {
    this.gameUI = gameUI;
    this.abilityManager = abilityManager ?? null;
    this.game = game ?? null;

    this.root = el('div', { class: 'hud' });
    gameUI.layer('hud').appendChild(this.root);

    // ── Top-left: who I am ────────────────────────────────────────────
    // Level medallion + the HP/XP rail stack read as one carved cluster,
    // replacing three chips scattered across a 1600px-wide top bar.
    this.medallionNum = el('div', { class: 'medallion__n', text: '1' });
    this.medallion = el('div', { class: 'medallion' }, [
      el('div', { class: 'medallion__tag', text: 'LV' }),
      this.medallionNum,
    ]);
    this.hpMeter = makeMeter('hp', 'heart');
    this.xpMeter = makeMeter('xp');
    const bars = el('div', { class: 'hud__bars' }, [this.hpMeter.root, this.xpMeter.root]);
    const vitals = el('div', { class: 'hud__vitals' }, [this.medallion, bars]);

    // Equipment strip, directly under the vitals (single-player). Hidden until
    // setInventory() is called; clicking it opens the character profile.
    this.inventoryStrip = el('div', {
      class: 'hud__inventory interactive',
      attrs: { role: 'button', title: 'Character (equipment)' },
    });
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const cell = el('div', { class: 'gear-slot gear-slot--empty' });
      cell.appendChild(el('div', { class: 'gear-slot__glyph' }, [iconEl(SLOT_ICON[EQUIP_SLOTS[i]])]));
      this.inventoryCells.push(cell);
      this.inventoryStrip.appendChild(cell);
    }
    this.inventoryStrip.style.display = 'none';
    onTap(this.inventoryStrip, () => this.onOpenCharacter());

    const zoneTL = el('div', { class: 'hud__zone hud__zone--tl' }, [vitals, this.inventoryStrip]);

    // ── Top-centre: what I'm fighting ─────────────────────────────────
    this.waveEl = el('div', { class: 'obj__wave', text: 'WAVE 1' });
    this.leftEl = el('span', { class: 'obj__num', text: '—' });
    this.clockEl = el('span', { class: 'obj__num obj__num--clock', text: '00:00' });
    this.killsEl = el('span', { class: 'obj__num', text: '0' });
    const objective = el('div', { class: 'hud__objective plate' }, [
      this.waveEl,
      el('div', { class: 'obj__rule' }),
      el('div', { class: 'obj__stat obj__stat--threat' }, [iconEl('claw'), this.leftEl]),
      el('div', { class: 'obj__rule' }),
      el('div', { class: 'obj__stat' }, [iconEl('clock'), this.clockEl]),
      el('div', { class: 'obj__rule obj__rule--kills' }),
      el('div', { class: 'obj__stat obj__stat--kills' }, [iconEl('skull'), this.killsEl]),
    ]);

    this.bannerText = el('div', { class: 'hud__banner-text' });
    this.banner = el('div', { class: 'hud__banner' }, [
      el('div', { class: 'hud__banner-rule' }),
      this.bannerText,
      el('div', { class: 'hud__banner-rule' }),
    ]);

    const zoneTC = el('div', { class: 'hud__zone hud__zone--tc' }, [objective, this.banner]);

    // ── Top-right: what I've earned ───────────────────────────────────
    this.purseNum = el('span', { class: 'hud__purse-n', text: '0' });
    this.purseEl = el('div', { class: 'hud__purse plate' }, [iconEl('coin'), this.purseNum]);

    const pauseBtn = el('div', { class: 'hud__pause plate interactive', attrs: { role: 'button', 'aria-label': 'Pause' } });
    this.pauseIcon = el('div', { class: 'hud__pause-icon' }, [iconEl('pause')]);
    pauseBtn.appendChild(this.pauseIcon);
    onTap(pauseBtn, () => this.togglePause());

    const zoneTR = el('div', { class: 'hud__zone hud__zone--tr' }, [this.purseEl, pauseBtn]);
    this.root.appendChild(el('div', { class: 'hud__topbar' }, [zoneTL, zoneTC, zoneTR]));

    // ── Bottom-left: 4 power slots over the run-item row ───────────────
    const bottomLeft = el('div', { class: 'hud__cluster hud__cluster--left' });
    const powerRow = el('div', { class: 'hud__row' });
    for (let i = 0; i < 4; i++) {
      const slot = makeIconSlot();
      this.powerSlots.push(slot);
      powerRow.appendChild(slot.root);
    }
    const itemRow = el('div', { class: 'hud__row hud__row--items' });
    for (const id of ITEM_IDS) {
      const slot = makeIconSlot('slot--item');
      slot.setIcon(ITEM_ICON[id], ITEM_DORMANT);
      slot.setAccent('#8a6d35');
      this.itemSlots[id] = slot;
      itemRow.appendChild(slot.root);
    }
    bottomLeft.append(powerRow, itemRow);
    this.root.appendChild(bottomLeft);

    // ── Bottom-right: ultimates ───────────────────────────────────────
    const bottomRight = el('div', { class: 'hud__cluster hud__cluster--right' });
    const ultDefs = this.resolveUltimateDefs();
    for (let i = 0; i < ultDefs.length; i++) {
      const def = ultDefs[i];
      const root = el('div', { class: 'ult slot interactive' });
      root.style.setProperty('--accent', def.color);
      const label = el('div', { class: 'ult__label slot__icon' }, [iconEl(def.icon)]);
      const cdText = el('div', { class: 'ult__cdtext' });
      root.append(label, el('div', { class: 'slot__cd' }), el('div', { class: 'slot__ring' }), cdText);
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
      this.ultButtons.push({ root, label, cdText, id: def.id });
      bottomRight.appendChild(root);
    }
    this.root.appendChild(bottomRight);

    // "Sound the horn" — starts the next wave during the merchant phase.
    this.hornBtn = el('div', { class: 'hud__horn plate interactive', attrs: { role: 'button' } });
    this.hornBtn.append(
      iconEl('swords'),
      el('div', { class: 'hud__horn-label', text: 'Next wave' }),
    );
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
    setIcon(this.pauseIcon, this.game.getIsPaused() ? 'play' : 'pause');
  }

  private resolveUltimateDefs(): { id: string; icon: IconName; color: string }[] {
    const fallback = [
      { id: 'meteor', icon: 'meteor' as IconName, color: '#e0632a' },
      { id: 'frostNova', icon: 'frostNova' as IconName, color: '#4fb8e8' },
    ];
    if (!this.abilityManager) return fallback;
    const ids = this.abilityManager.getRegisteredAbilityIds();
    if (ids.length === 0) return fallback;
    return ids.map(id => {
      const meta = ULT_DISPLAY[id];
      return { id, icon: meta?.icon ?? ('rune' as IconName), color: meta?.color ?? '#a08a5a' };
    });
  }

  /** Raise a transient centre-screen callout. `tone` picks the colour role. */
  showBanner(text: string, tone: 'gold' | 'danger' | 'arcane' = 'gold'): void {
    this.bannerText.textContent = text;
    this.banner.classList.remove('hud__banner--show', 'hud__banner--danger', 'hud__banner--arcane');
    void this.banner.offsetWidth; // restart the animation on a repeat call
    if (tone !== 'gold') this.banner.classList.add(`hud__banner--${tone}`);
    this.banner.classList.add('hud__banner--show');
    // Also clear on a timer: under `prefers-reduced-motion` the animation is
    // suppressed, so the class alone would leave the callout up forever.
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(
      () => this.banner.classList.remove('hud__banner--show'), BANNER_MS);
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
      const clock = clockLabel(runStats.timeS);
      if (clock !== this.cachedClock) {
        this.cachedClock = clock;
        this.clockEl.textContent = clock;
      }
      const kills = `${runStats.kills}`;
      if (kills !== this.cachedKills) {
        this.cachedKills = kills;
        this.killsEl.textContent = kills;
      }
    }

    const ratio = Math.max(0, hp.current / hp.max);
    const hpFill = Math.round(ratio * 1000) / 1000;
    if (hpFill !== this.cachedHpFill) {
      this.cachedHpFill = hpFill;
      this.hpMeter.setFill(hpFill);
    }
    const hpText = `${Math.ceil(hp.current)} / ${hp.max}`;
    if (hpText !== this.cachedHpText) {
      this.cachedHpText = hpText;
      this.hpMeter.setText(hpText);
    }
    if (this.prevHp >= 0 && hp.current < this.prevHp - 0.01) this.hpMeter.flashHit();
    this.prevHp = hp.current;

    const inDanger = ratio < 0.25;
    if (inDanger !== this.cachedDanger) {
      this.cachedDanger = inDanger;
      this.hpMeter.setDanger(inDanger);
    }

    const levelText = levelLabel(xp.level);
    if (levelText !== this.cachedLevelText) {
      this.cachedLevelText = levelText;
      this.medallionNum.textContent = levelText;
    }
    const levelFill = Math.round(xp.progress * 1000) / 1000;
    if (levelFill !== this.cachedLevelFill) {
      this.cachedLevelFill = levelFill;
      this.xpMeter.setFill(levelFill);
    }
    if (this.prevLevel >= 0 && xp.level > this.prevLevel) {
      flashClass(this.medallion, 'medallion--up');
      this.showBanner(`Level ${xp.level}`, 'arcane');
    }
    this.prevLevel = xp.level;

    const waveText = waveTitle(waveInfo);
    if (waveText !== this.cachedWaveText) {
      this.cachedWaveText = waveText;
      this.waveEl.textContent = waveText;
    }
    const leftText = enemiesLeftLabel(waveInfo);
    if (leftText !== this.cachedLeft) {
      this.cachedLeft = leftText;
      this.leftEl.textContent = leftText;
    }
    if (waveInfo) {
      // Announce both edges of the wave cycle: cleared, then the next start.
      const cleared = this.prevWaveInProgress && !waveInfo.inProgress;
      const started = !this.prevWaveInProgress && waveInfo.inProgress && waveInfo.wave !== this.prevWave;
      if (cleared || started) {
        const label = waveBannerLabel(waveInfo);
        if (label) this.showBanner(label, started ? 'danger' : 'gold');
      }
      this.prevWaveInProgress = waveInfo.inProgress;
      this.prevWave = waveInfo.wave;
    }

    // Power slots
    for (let i = 0; i < 4; i++) {
      const slot = slots[i];
      const ui = this.powerSlots[i];
      if (!slot) {
        if (this.cachedPowerEmpty[i] !== true) { this.cachedPowerEmpty[i] = true; ui.setEmpty(true); ui.setAccent('#8a6d35'); }
        if (this.cachedPowerIcon[i] !== 'socket') {
          this.cachedPowerIcon[i] = 'socket';
          this.cachedPowerColor[i] = 'rgba(201, 162, 63, 0.4)';
          ui.setIcon('socket', 'rgba(201, 162, 63, 0.4)');
        }
        if (this.cachedPowerLevel[i] !== 0) { this.cachedPowerLevel[i] = 0; ui.setLevel(0); }
        if (this.cachedPowerCdFrac[i] !== 0) { this.cachedPowerCdFrac[i] = 0; ui.setCooldown(0); }
        this.prevCooldownRemaining[i] = -1;
        continue;
      }
      if (this.cachedPowerEmpty[i] !== false) { this.cachedPowerEmpty[i] = false; ui.setEmpty(false); }
      const { icon, color } = this.iconFor(slot);
      if (this.cachedPowerIcon[i] !== icon || this.cachedPowerColor[i] !== color) {
        this.cachedPowerIcon[i] = icon;
        this.cachedPowerColor[i] = color;
        ui.setIcon(icon, color);
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
        ui.setIcon(ITEM_ICON[id], owned ? ITEM_COLOR[id] : ITEM_DORMANT);
        ui.setAccent(owned ? ITEM_COLOR[id] : '#8a6d35');
        ui.setEmpty(!owned);
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
          if (this.cachedUltCd[i] !== 0) { this.cachedUltCd[i] = 0; btn.root.style.setProperty('--cd', '0'); }
          if (this.cachedUltCdText[i] !== '') { this.cachedUltCdText[i] = ''; btn.cdText.textContent = ''; }
          if (this.cachedUltLabelOpacity[i] !== 1) { this.cachedUltLabelOpacity[i] = 1; btn.label.style.opacity = '1'; }
        } else {
          const frac = Math.round(this.cdFraction(ability.currentCooldown, ability.cooldown) * 1000) / 1000;
          if (this.cachedUltCd[i] !== frac) {
            this.cachedUltCd[i] = frac;
            btn.root.style.setProperty('--cd', `${frac}`);
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

  /** Flash the level medallion on level-up (called by the gameplay state). */
  flashXpBar(): void { flashClass(this.medallion, 'medallion--up'); }

  /** Update the purse (called every frame by the gameplay state). */
  setGold(gold: number): void {
    if (gold === this.prevGold) return;
    if (this.prevGold >= 0 && gold > this.prevGold) flashClass(this.purseEl, 'hud__purse--gain');
    this.prevGold = gold;
    this.purseNum.textContent = `${gold}`;
  }

  setOnHorn(fn: () => void): void { this.onHorn = fn; }
  setHornVisible(visible: boolean): void {
    this.hornBtn.style.display = visible ? '' : 'none';
  }

  /** Open-character-profile callback (wired by the gameplay state). */
  setOnOpenCharacter(fn: () => void): void { this.onOpenCharacter = fn; }

  /** Populate + show the always-visible equipment strip (single-player only).
      Each cell shows the equipped piece's icon + rarity color, or the empty
      slot icon. Called at run start and after every equipment change. */
  setInventory(slots: GearSlotVM[]): void {
    this.inventoryStrip.style.display = '';
    for (let i = 0; i < this.inventoryCells.length; i++) {
      const cell = this.inventoryCells[i];
      const s = slots[i];
      if (!s) continue;
      const filled = !!s.name;
      cell.classList.toggle('gear-slot--empty', !filled);
      cell.style.setProperty('--accent', filled && s.rarity ? RARITY_COLOR[s.rarity] : '#8a6d35');
      const glyph = cell.firstElementChild;
      if (glyph) {
        glyph.replaceChildren(s.glyph
          ? itemArtEl(s.id, s.glyph, s.name ?? '')
          : iconEl(SLOT_ICON[s.slot]));
      }
      cell.title = filled ? `${s.name}` : `${s.slot} (empty)`;
    }
  }

  pulseItem(id: ItemId): void { this.itemPulse[id] = true; }
  triggerUltimateByIndex(index: number): void { this.ultimateActivators[index]?.(); }

  dispose(): void {
    window.clearTimeout(this.bannerTimer);
    this.root.remove();
    this.vignette.remove();
  }

  protected iconFor(slot: PowerSlot): { icon: IconName; color: string } {
    const tier = slot.def.tier;
    if (tier === 'ultimate' || tier === 'fusion') {
      return { icon: TIER_ICON[tier], color: TIER_COLOR[tier] };
    }
    return {
      icon: POWER_ICON[slot.def.id] ?? elementIcon(slot.def.element),
      color: elementColor(slot.def.element),
    };
  }
  protected cdFraction = cooldownFraction;
}
