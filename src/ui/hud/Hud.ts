import { GameUI } from '../GameUI';
import { Game } from '../../engine/Game';
import { PowerSlot } from '../../survivors/powers/PowerSlotManager';
import { AbilityManager } from '../../survivors/abilities/AbilityManager';
import { RunItems, ItemId } from '../../survivors/RunItems';
import { el } from '../dom';
import { makeMeter, MeterController } from '../primitives/Meter';
import { makeBossBar, BossBarController, BossBarEntry } from './BossBar';
import { makeIconSlot, IconSlotController } from '../primitives/IconSlot';
import { iconEl, IconName, setIcon } from '../icons';
import { GameSettings } from '../../shared/GameSettings';
import { elementColor, elementIcon, POWER_ICON, TIER_COLOR, TIER_ICON } from '../elementMeta';
import { flashClass, onTap } from '../interaction';
import {
  cooldownFraction, waveTitle, enemiesLeftLabel, waveBannerLabel,
  clockLabel, levelLabel, WaveInfo,
} from '../format';

// Icon/colour maps for the HUD. Every one of these used to be a platform
// emoji; they are now authored glyphs from src/ui/icons.ts.
const ITEM_ICON: Record<ItemId, IconName> = {
  extraLife: 'lifeRune', multishotCleave: 'cleave', knockback: 'impact', ricochet: 'ricochet',
  attackSpeed: 'bolt', verdantHeart: 'heart', elementalCore: 'gem',
};
const ITEM_COLOR: Record<ItemId, string> = {
  extraLife: '#46e05a', multishotCleave: '#ffd84a', knockback: '#4ea7ff', ricochet: '#4ea7ff',
  attackSpeed: '#fff080', verdantHeart: '#5ce04a', elementalCore: '#ff5a2e',
};
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
  private ascBtn: HTMLDivElement;
  private ascBadge: HTMLDivElement;
  private onOpenAscension: (() => void) | null = null;
  private cachedAscPoints = -1;
  private cachedAscShown = false;

  // Top-centre objective plate.
  private waveEl: HTMLDivElement;
  private leftEl: HTMLSpanElement;
  private clockEl: HTMLSpanElement;
  private killsEl: HTMLSpanElement;

  // Top-right purse.
  private purseEl: HTMLDivElement;
  private purseNum: HTMLSpanElement;

  // Screen-space boss health plate (empty and hidden with no boss alive).
  private bossBar: BossBarController;

  // Centre-top event callout.
  private banner: HTMLDivElement;
  private bannerText: HTMLDivElement;
  private bannerTimer = 0;

  private powerSlots: IconSlotController[] = [];
  /** The item sockets this champion can own, in boss-tier order (the tier-3
   *  socket is Knockback or Ricochet depending on class). */
  private readonly itemRow: ItemId[];
  private itemSlots: Record<ItemId, IconSlotController | null> = {
    extraLife: null, multishotCleave: null, knockback: null, ricochet: null, attackSpeed: null, verdantHeart: null, elementalCore: null,
  };
  private prevCooldownRemaining: number[] = [-1, -1, -1, -1];
  private cachedPowerEmpty: (boolean | null)[] = [null, null, null, null];
  private cachedPowerIcon: (IconName | null)[] = [null, null, null, null];
  private cachedPowerColor: (string | null)[] = [null, null, null, null];
  /** Out-param for iconFor() — one struct instead of a literal per slot per frame. */
  private readonly iconOut: { icon: IconName; color: string } = { icon: 'socket', color: '' };
  private cachedPowerLevel: (number | null)[] = [null, null, null, null];
  private cachedPowerCdFrac: number[] = [-1, -1, -1, -1];
  private itemPulse: Record<ItemId, boolean> = {
    extraLife: false, multishotCleave: false, knockback: false, ricochet: false, attackSpeed: false, verdantHeart: false, elementalCore: false,
  };
  private cachedItemOwned: Record<ItemId, boolean | null> = {
    extraLife: null, multishotCleave: null, knockback: null, ricochet: null, attackSpeed: null, verdantHeart: null, elementalCore: null,
  };
  private cachedItemStacks: Record<ItemId, number | null> = {
    extraLife: null, multishotCleave: null, knockback: null, ricochet: null, attackSpeed: null, verdantHeart: null, elementalCore: null,
  };

  private ultButtons: { root: HTMLDivElement; label: HTMLDivElement; cdText: HTMLDivElement; id: string }[] = [];
  private ultimateActivators: (() => void)[] = [];

  private pauseIcon!: HTMLDivElement;
  private vignette!: HTMLDivElement;
  private hornBtn!: HTMLDivElement;
  private onHorn: () => void = () => {};
  private lowHpTime = 0;

  /** Opens the character sheet — wired to the level medallion. Set by the
      gameplay state; single-player only, so the medallion is inert in co-op. */
  private onOpenCharacter: (() => void) | null = null;

  // diff trackers
  private prevHp = -1;
  private prevLevel = -1;
  private prevWaveInProgress = false;
  private prevLastStand = false;
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

  constructor(gameUI: GameUI, abilityManager?: AbilityManager, game?: Game, championType?: string) {
    this.gameUI = gameUI;
    this.abilityManager = abilityManager ?? null;
    this.game = game ?? null;
    this.itemRow = RunItems.itemRowForClass(championType ?? 'barbarian');

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
    // Ascension entry point. Hidden until the hero caps, then it is the only
    // way in on touch — the `t` hotkey does not exist on a phone.
    this.ascBadge = el('div', { class: 'asc-btn__badge' });
    this.ascBtn = el('div', {
      class: 'asc-btn',
      attrs: { role: 'button', 'aria-label': 'Ascension' },
    }, [iconEl('rune'), el('span', { class: 'asc-btn__label', text: 'ASC' }), this.ascBadge]);
    this.ascBtn.style.display = 'none';
    onTap(this.ascBtn, () => this.onOpenAscension?.());

    const vitals = el('div', { class: 'hud__vitals' }, [this.medallion, bars, this.ascBtn]);

    // The medallion is the character-sheet button. The equipment strip that
    // used to sit under the vitals is gone — the shop's gear ledger covers
    // "what am I wearing" at the moment it matters, so the HUD no longer pays
    // six permanent tiles for it.
    onTap(this.medallion, () => this.onOpenCharacter?.());

    const zoneTL = el('div', { class: 'hud__zone hud__zone--tl' }, [vitals]);

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

    // Speaker toggle — same chrome as the pause button beside it. Writes the
    // persisted setting; Game's GameSettings subscription applies the mute.
    const soundBtn = el('div', { class: 'hud__pause plate interactive', attrs: { role: 'button', 'aria-label': 'Toggle sound' } });
    const soundIcon = el('div', { class: 'hud__pause-icon' });
    soundBtn.appendChild(soundIcon);
    const syncSoundIcon = (): void => {
      setIcon(soundIcon, GameSettings.getSoundOn() ? 'sound' : 'soundOff');
    };
    onTap(soundBtn, () => {
      GameSettings.setSoundOn(!GameSettings.getSoundOn());
      syncSoundIcon();
    });
    syncSoundIcon();

    const pauseBtn = el('div', { class: 'hud__pause plate interactive', attrs: { role: 'button', 'aria-label': 'Pause' } });
    this.pauseIcon = el('div', { class: 'hud__pause-icon' }, [iconEl('pause')]);
    pauseBtn.appendChild(this.pauseIcon);
    onTap(pauseBtn, () => this.togglePause());

    const zoneTR = el('div', { class: 'hud__zone hud__zone--tr' }, [this.purseEl, soundBtn, pauseBtn]);
    this.root.appendChild(el('div', { class: 'hud__topbar' }, [zoneTL, zoneTC, zoneTR]));

    // ── Boss plate ─────────────────────────────────────────────────────
    // Appended to the HUD root, NOT to zoneTC: the top bar is a flex row and a
    // bar this wide inside it would shove the flanking zones outward.
    this.bossBar = makeBossBar();
    this.root.appendChild(this.bossBar.root);

    // ── Bottom-left: 4 power slots over the run-item row ───────────────
    const bottomLeft = el('div', { class: 'hud__cluster hud__cluster--left' });
    const powerRow = el('div', { class: 'hud__row' });
    for (let i = 0; i < 4; i++) {
      const slot = makeIconSlot();
      this.powerSlots.push(slot);
      powerRow.appendChild(slot.root);
    }
    const itemRow = el('div', { class: 'hud__row hud__row--items' });
    for (const id of this.itemRow) {
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
    xp: { level: number; progress: number; ascUnlocked?: boolean; ascLevel?: number; ascPoints?: number },
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

    // Ascension button — appears once the hero caps, badge shows unspent points.
    // Both writes sit behind cached diffs so this costs nothing at 60Hz.
    const ascShown = !!xp.ascUnlocked && !!this.onOpenAscension;
    if (ascShown !== this.cachedAscShown) {
      this.cachedAscShown = ascShown;
      this.ascBtn.style.display = ascShown ? '' : 'none';
    }
    if (ascShown) {
      const pts = xp.ascPoints ?? 0;
      if (pts !== this.cachedAscPoints) {
        this.cachedAscPoints = pts;
        this.ascBadge.textContent = pts > 0 ? String(pts) : '';
        this.ascBadge.style.display = pts > 0 ? 'block' : 'none';
        this.ascBtn.classList.toggle('asc-btn--pending', pts > 0);
      }
    }

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
      // The last stand begins mid-wave (the instant the final boss dies), so it
      // trips neither edge and needs its own one-shot.
      const lastStand = !!waveInfo.lastStand;
      if (lastStand && !this.prevLastStand) {
        this.showBanner(waveBannerLabel(waveInfo) ?? 'Last Stand', 'danger');
      } else if (cleared || started) {
        const label = waveBannerLabel(waveInfo);
        if (label) this.showBanner(label, started ? 'danger' : 'gold');
      }
      this.prevLastStand = lastStand;
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
      this.iconFor(slot, this.iconOut);
      const icon = this.iconOut.icon;
      const color = this.iconOut.color;
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
    for (const id of this.itemRow) {
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

  /** Open-character-profile callback (wired by the gameplay state). Also marks
      the level medallion as an interactive control — it stays inert wherever
      there is no character sheet to open (co-op). */
  /** Wire the Ascension tree button. Single-player only, like the character
   *  sheet — the button stays hidden until the hero reaches the level cap. */
  setOnOpenAscension(fn: () => void): void {
    this.onOpenAscension = fn;
  }

  setOnOpenCharacter(fn: () => void): void {
    this.onOpenCharacter = fn;
    this.medallion.classList.add('interactive', 'medallion--clickable');
    this.medallion.setAttribute('role', 'button');
    this.medallion.setAttribute('title', 'Character sheet');
  }

  pulseItem(id: ItemId): void { this.itemPulse[id] = true; }
  triggerUltimateByIndex(index: number): void { this.ultimateActivators[index]?.(); }

  /** Reconcile the boss plate against the live boss-tier enemies. Called every
   *  frame with a caller-owned reused array; pass an empty one to clear it. */
  syncBosses(bosses: readonly BossBarEntry[]): void {
    this.bossBar.sync(bosses);
  }

  dispose(): void {
    window.clearTimeout(this.bannerTimer);
    this.bossBar.dispose();
    this.root.remove();
    this.vignette.remove();
  }

  /** Icon + accent for a power slot, written into the caller-owned `out` struct
   *  (this runs for every equipped slot every frame). */
  protected iconFor(slot: PowerSlot, out: { icon: IconName; color: string }): void {
    const tier = slot.def.tier;
    if (tier === 'ultimate' || tier === 'fusion') {
      out.icon = TIER_ICON[tier];
      out.color = TIER_COLOR[tier];
      return;
    }
    out.icon = POWER_ICON[slot.def.id] ?? elementIcon(slot.def.element);
    out.color = elementColor(slot.def.element);
  }
  protected cdFraction = cooldownFraction;
}
