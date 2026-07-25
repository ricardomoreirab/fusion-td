/** Pure formatting helpers shared by HUD components. No DOM, no Three. */

export interface WaveInfo {
  wave: number;
  enemiesAlive: number;
  inProgress: boolean;
}

/** Clamp remaining/total to a 0..1 cooldown fraction. */
export function cooldownFraction(remaining: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, remaining / total));
}

/**
 * The wave title on the objective plate. Just the wave: "how many are left"
 * and the run clock are separate fields on the plate now, each with its own
 * icon and fixed-width numeric cell, so none of them can shove the others
 * sideways as their digit count changes.
 */
export function waveTitle(info?: WaveInfo): string {
  if (!info) return 'WAVE 1';
  return `WAVE ${Math.max(1, info.wave)}`;
}

/** The goblins-remaining count. Between waves there is nothing to count. */
export function enemiesLeftLabel(info?: WaveInfo): string {
  if (!info || !info.inProgress) return '—';
  return `${Math.max(0, info.enemiesAlive)}`;
}

/** The transient centre-screen callout for a wave state change, or null. */
export function waveBannerLabel(info?: WaveInfo): string | null {
  if (!info) return null;
  if (info.inProgress) return `Wave ${Math.max(1, info.wave)}`;
  if (info.wave === 0) return null;
  return `Wave ${info.wave} Cleared`;
}

/** Elapsed run clock: mm:ss, rolling into h:mm:ss past an hour. */
export function clockLabel(timeS: number): string {
  const total = Math.max(0, Math.floor(timeS));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Level number struck into the hero medallion. */
export function levelLabel(level: number): string {
  return `${Math.max(1, Math.floor(level))}`;
}
