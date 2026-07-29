import { describe, it, expect } from 'vitest';
import { PlayerStats } from '../src/survivors/PlayerStats';
import { RunItems } from '../src/survivors/RunItems';
import { LORD_TIER } from '../src/survivors/enemies/bossTiers';

// Minimal HeroController stub — RunItems only calls these on certain items.
const heroStub = { addReviveCharge() {}, updateBasicAttackSpeed() {} } as any;

describe('elementalCore', () => {
    it('drops from the Elemental Lord, wherever the Lord is', () => {
        // The Core is the Lord's own, so it lives at the Lord's tier rather than
        // at a fixed number — it moved from tier 5 to tier 6 with the boss.
        expect(RunItems.itemForTier(LORD_TIER)).toBe('elementalCore');
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
