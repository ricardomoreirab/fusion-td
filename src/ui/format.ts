/** Pure formatting helpers shared by HUD components. No DOM, no Babylon. */

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

/** The wave-indicator label. Mirrors the legacy HeroHud wording. */
export function waveLabel(info?: WaveInfo): string {
  if (!info) return '';
  if (info.inProgress) return `WAVE ${info.wave} · ${info.enemiesAlive} LEFT`;
  if (info.wave === 0) return 'WAVE 1 STARTING';
  return `WAVE ${info.wave} CLEARED`;
}

/** Level pill text. */
export function levelLabel(level: number): string {
  return `LV ${level}`;
}
