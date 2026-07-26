import { el } from '../dom';
import { iconEl } from '../icons';

/** One boss's state for a frame. Built into a reused struct by the caller — the
 *  controller must not retain the object past the `sync` call. */
export interface BossBarEntry {
  /** Stable enemy id. Identity for row reuse; a twin gets its own row. */
  id: number;
  name: string;
  health: number;
  maxHealth: number;
  enraged: boolean;
}

export interface BossBarController {
  root: HTMLDivElement;
  /** Reconcile the visible rows against the live bosses, in order. */
  sync(bosses: readonly BossBarEntry[]): void;
  dispose(): void;
}

/** Rows past this are dropped — the arena never has more than a boss plus its
 *  twin, and an unbounded stack would march down over the play area. */
const MAX_ROWS = 3;

interface Row {
  root: HTMLDivElement;
  name: HTMLDivElement;
  fill: HTMLDivElement;
  ghost: HTMLDivElement;
  pct: HTMLSpanElement;
  /** Last values written, so a 60 Hz sync only touches the DOM on a change. */
  lastId: number;
  lastName: string;
  lastFill: number;
  lastPct: string;
  lastEnraged: boolean;
}

function makeRow(): Row {
  const name = el('div', { class: 'bossbar__name' });
  const pct = el('span', { class: 'bossbar__pct' });
  const enrageTag = el('div', { class: 'bossbar__tag' }, [iconEl('claw'), 'Enraged']);

  const ghost = el('div', { class: 'bossbar__ghost' });
  const fill = el('div', { class: 'bossbar__fill' });
  const track = el('div', { class: 'bossbar__track' }, [
    ghost, fill, el('div', { class: 'bossbar__ticks' }),
  ]);

  const root = el('div', { class: 'bossbar__row' }, [
    el('div', { class: 'bossbar__head' }, [name, enrageTag, pct]),
    track,
  ]);

  return {
    root, name, fill, ghost, pct,
    lastId: -1, lastName: '', lastFill: -1, lastPct: '', lastEnraged: false,
  };
}

/**
 * The screen-space boss plate: a wide segmented health bar under the objective
 * plate, the way a boss encounter is normally framed. It replaced the in-world
 * bar that floated over the boss model — that one competed with the boss's own
 * ground telegraphs, shrank with camera zoom, and vanished entirely whenever the
 * boss was off-screen, which is exactly when you most want to know how the fight
 * is going.
 *
 * Rows are keyed by enemy id and REUSED across frames: a tier-3/4 boss spawns a
 * twin, so the stack has to grow and shrink without rebuilding DOM at 60 Hz.
 * Every write is diffed against the last value for the same reason.
 *
 * The damage-lag ghost is the same trick `Meter` uses — two layers get the same
 * width and the ghost's delayed CSS transition trails it, so a burst reads as an
 * amount torn off rather than a bar that is merely shorter. No per-frame JS.
 */
export function makeBossBar(): BossBarController {
  const root = el('div', { class: 'bossbar' });
  const rows: Row[] = [];

  return {
    root,

    sync(bosses) {
      const n = Math.min(bosses.length, MAX_ROWS);

      // Grow the pool on demand; rows are never destroyed, only hidden, so a
      // boss dying and another spawning costs no allocation.
      while (rows.length < n) {
        const row = makeRow();
        rows.push(row);
        root.appendChild(row.root);
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (i >= n) {
          if (row.root.style.display !== 'none') row.root.style.display = 'none';
          row.lastId = -1;
          continue;
        }
        const b = bosses[i];
        if (row.root.style.display === 'none') row.root.style.display = '';

        // A row reassigned to a different boss must not inherit the previous
        // one's damage-lag ghost — that would show the new boss losing HP it
        // never had. Snap both layers by clearing the cached fill.
        const reassigned = row.lastId !== b.id;
        if (reassigned) {
          row.lastId = b.id;
          row.lastFill = -1;
          // Remove + reflow + re-add, or the second boss to use this row gets no
          // entry animation (the class is already on the element).
          row.root.classList.remove('bossbar__row--enter');
          void row.root.offsetWidth;
          row.root.classList.add('bossbar__row--enter');
          row.ghost.style.transition = 'none';
        }

        if (row.lastName !== b.name) {
          row.lastName = b.name;
          row.name.textContent = b.name;
        }

        const ratio = b.maxHealth > 0
          ? Math.max(0, Math.min(1, b.health / b.maxHealth))
          : 0;
        const fill = Math.round(ratio * 1000) / 1000;
        if (fill !== row.lastFill) {
          row.lastFill = fill;
          const pct = `${fill * 100}%`;
          row.fill.style.width = pct;
          row.ghost.style.width = pct;
        }
        if (reassigned) {
          // Re-enable the lag only after this frame's snap has been committed.
          void row.ghost.offsetWidth;
          row.ghost.style.transition = '';
        }

        const pctText = `${Math.ceil(ratio * 100)}%`;
        if (pctText !== row.lastPct) {
          row.lastPct = pctText;
          row.pct.textContent = pctText;
        }

        if (b.enraged !== row.lastEnraged) {
          row.lastEnraged = b.enraged;
          row.root.classList.toggle('bossbar__row--enraged', b.enraged);
        }
      }
    },

    dispose() {
      rows.length = 0;
      root.remove();
    },
  };
}
