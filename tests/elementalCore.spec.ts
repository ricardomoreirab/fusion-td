import { describe, it, expect } from 'vitest';
import { PlayerStats } from '../src/survivors/PlayerStats';
import { RunItems } from '../src/survivors/RunItems';

// Minimal HeroController stub — RunItems only calls these on certain items.
const heroStub = { addReviveCharge() {}, updateBasicAttackSpeed() {} } as any;

describe('elementalCore', () => {
    it('drops at boss tier 5', () => {
        expect(RunItems.itemForTier(5)).toBe('elementalCore');
    });
    it('multiplies power damage ×10 per stack', () => {
        const ps = new PlayerStats();
        const ri = new RunItems(ps, 'mage', heroStub);
        ps.powerDamageMultiplier = 1;
        ri.grant('elementalCore');
        expect(ps.powerDamageMultiplier).toBeCloseTo(10, 5);
        expect(ri.getStacks('elementalCore')).toBe(1);
    });
});
