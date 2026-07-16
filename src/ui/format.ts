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

/** Run-stats pill text: elapsed clock + kill tally (Vampire Survivors framing). */
export function runStatsLabel(timeS: number, kills: number): string {
  const total = Math.max(0, Math.floor(timeS));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const clock = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return `⏱ ${clock} · ☠ ${kills}`;
}
