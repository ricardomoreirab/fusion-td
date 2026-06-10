import type { DamageReportMsg } from '../../net/Protocol';

/** Guest-side queue of damage reports to flush to the host each frame. */
export class DamageRouter {
    private pending: DamageReportMsg[] = [];

    report(enemyId: number, amount: number, element: string, sourceHeroId: number): void {
        this.pending.push({ t: 'damageReport', enemyId, amount, element, sourceHeroId });
    }

    drain(): DamageReportMsg[] {
        const out = this.pending;
        this.pending = [];
        return out;
    }
}

/** Host-side validation: enemy must exist and (if a source position is given) be
 *  within maxRangeSq of it. A loose anti-bug/anti-lag check, not anti-cheat. */
export function validateDamageReport(
    report: DamageReportMsg,
    enemyPos: { x: number; z: number } | null,
    maxRangeSq: number,
    sourcePos?: { x: number; z: number },
): boolean {
    if (!enemyPos) return false;
    if (!sourcePos) return true;
    const dx = enemyPos.x - sourcePos.x, dz = enemyPos.z - sourcePos.z;
    return dx * dx + dz * dz <= maxRangeSq;
}
