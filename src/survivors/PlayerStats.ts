/**
 * PlayerStats - Manages player economy, health, and tracking statistics.
 *
 * === BALANCE DESIGN NOTES ===
 *
 * Starting Money: 300
 *   - Allows 6 basic towers (50 each) for a wide defense, OR
 *   - 2 elemental towers (125 each) + 1 basic for a focused strategy, OR
 *   - 1 sniper (200) + 2 basic (100) for a single strong anchor
 *   - This gives players meaningful first choices without being overwhelming
 *
 * Starting Health: 120
 *   - Forgiving enough to survive a few early mistakes during the tutorial phase
 *   - Each basic enemy deals 10 damage, so 12 leaked basics = death
 *   - Each fast enemy deals 5 damage, so 24 leaked fasts = death
 *   - Each tank deals 20 damage, so 6 leaked tanks = death
 *   - Bosses deal 50 damage, so leaking even 2 bosses is critical
 *
 * Max Health: 120
 *   - Health cannot be healed above this value
 *   - Perfect wave bonuses heal 5 HP per wave, giving sustain without overhealing
 *   - This keeps tension: health is a finite resource that rewards careful play
 *
 * Sell Value: 60% of total investment (set in Tower.ts)
 *   - Repositioning costs 40% of your investment
 *   - Not so punishing that players are afraid to experiment
 *   - Not so generous that constant repositioning is optimal
 *
 * Upgrade Multiplier: 1.5x per level (set in Tower.ts)
 *   - Level 1 upgrade costs 100% of tower cost
 *   - Level 2 upgrade costs 150% of tower cost
 *   - Level 3 upgrade costs 225% of tower cost
 *   - Encourages upgrading existing towers rather than always buying new ones
 */
export class PlayerStats {
    private health: number;
    private maxHealth: number;
    private money: number;
    private won: boolean = false;
    private unlimitedMoney: boolean = false; // Disable unlimited money by default

    // Tracking stats
    private totalKills: number = 0;
    private totalMoneyEarned: number = 0;
    private towersBuilt: number = 0;
    private wavesCompleted: number = 0;
    private totalDamageDealt: number = 0;
    private totalDamageTaken: number = 0;
    private perfectWaves: number = 0;
    private gameStartTime: number = 0;

    // ── Survivors-mode hero stats ───────────────────────────────────────────
    /** Extra max HP from shop Vitality purchases */
    public bonusMaxHealth: number = 0;
    /** Cumulative move-speed multiplier (1.0 = base) */
    public moveSpeedMultiplier: number = 1.0;
    /** Cumulative basic-attack range multiplier (Reach shop item + run perks) */
    public attackRangeMultiplier: number = 1.0;
    /** Multiplier applied to all power damage (Power shop item) */
    public powerDamageMultiplier: number = 1.0;
    /** Multiplier applied to all power cooldowns (Haste shop item; lower = faster) */
    public powerCooldownMultiplier: number = 1.0;
    /** Multiplier applied to incoming contact damage (Bulwark item; lower = tankier) */
    public damageReductionMultiplier: number = 1.0;
    /** Multiplier applied to basic attack speed (Haste shop item + attackSpeed run-item; higher = faster) */
    public basicAttackSpeedMultiplier: number = 1.0;
    /** Fraction of damage dealt that is healed back to the hero (lifesteal item). */
    public lifestealPct: number = 0;
    /** For ranged classes: extra projectiles per basic attack. For barbarian: extra follow-up spins. */
    public extraAttacks: number = 0;
    /** World units pushed radially away from the hero on each basic-attack hit. */
    public knockbackOnHit: number = 0;
    /** Chance (0..1) for any damage dealt to crit. */
    public critChance: number = 0;
    /** Multiplier applied on a crit. Base 1.5×, each Savagery purchase adds +0.05. */
    public critDamageMultiplier: number = 1.5;
    /** How many times each shop item has been purchased */
    public purchaseCounts: Record<string, number> = {};

    public getPurchaseCount(itemId: string): number {
        return this.purchaseCounts[itemId] ?? 0;
    }

    public incrementPurchase(itemId: string): void {
        this.purchaseCounts[itemId] = (this.purchaseCounts[itemId] ?? 0) + 1;
    }

    // ── Gold API aliases (survivors mode uses "gold" terminology) ──────────
    public getGold(): number        { return this.getMoney(); }
    public addGold(n: number): void { this.addMoney(n); }
    public spendGold(n: number): boolean { return this.spendMoney(n); }

    constructor(health: number = 120, money: number = 300) {
        this.health = health;
        this.maxHealth = health; // Max health equals starting health
        this.money = money;
        this.gameStartTime = performance.now();
    }

    /**
     * Get the current health
     */
    public getHealth(): number {
        return this.health;
    }

    /**
     * Get the maximum health
     */
    public getMaxHealth(): number {
        return this.maxHealth;
    }

    /**
     * Set the health to a new value (clamped between 0 and maxHealth)
     * @param health The new health value
     */
    public setHealth(health: number): void {
        this.health = Math.max(0, Math.min(health, this.maxHealth));
    }

    /**
     * Reduce health by a specified amount
     * @param damage The amount to reduce health by
     */
    public takeDamage(damage: number): void {
        const actualDamage = Math.max(0, damage);
        this.health = Math.max(0, this.health - actualDamage);
        this.totalDamageTaken += actualDamage;
    }

    /**
     * Get the current money
     */
    public getMoney(): number {
        // Always return a large amount in unlimited mode
        return this.unlimitedMoney ? 9999 : this.money;
    }

    /**
     * Add money to the player
     * @param amount The amount to add
     */
    public addMoney(amount: number): void {
        if (!this.unlimitedMoney) {
            this.money += amount;
        }
        this.totalMoneyEarned += amount;
    }

    /**
     * Spend money if the player has enough
     * @param amount The amount to spend
     * @returns True if the money was spent, false if not enough money
     */
    public spendMoney(amount: number): boolean {
        // In unlimited mode, always return true without deducting money
        if (this.unlimitedMoney) {
            return true;
        }

        if (this.money >= amount) {
            this.money -= amount;
            return true;
        }
        return false;
    }

    /**
     * Toggle unlimited money mode
     * @param enabled Whether unlimited money should be enabled
     */
    public setUnlimitedMoney(enabled: boolean): void {
        this.unlimitedMoney = enabled;
    }

    /**
     * Check if unlimited money is enabled
     */
    public hasUnlimitedMoney(): boolean {
        return this.unlimitedMoney;
    }

    /**
     * Check if the player has won
     */
    public hasWon(): boolean {
        return this.won;
    }

    /**
     * Set whether the player has won
     * @param won Whether the player has won
     */
    public setWon(won: boolean): void {
        this.won = won;
    }

    /**
     * Heal the player by a specified amount, capped at maxHealth.
     * @param amount The amount to heal
     */
    public heal(amount: number): void {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }

    // =====================================================================
    // === TRACKING METHODS ===
    // =====================================================================

    public addKill(): void {
        this.totalKills++;
    }

    public addTowerBuilt(): void {
        this.towersBuilt++;
    }

    public addWaveCompleted(): void {
        this.wavesCompleted++;
    }

    public addPerfectWave(): void {
        this.perfectWaves++;
    }

    public addDamageDealt(amount: number): void {
        this.totalDamageDealt += amount;
    }

    public getTotalKills(): number {
        return this.totalKills;
    }

    public getTotalMoneyEarned(): number {
        return this.totalMoneyEarned;
    }

    public getTowersBuilt(): number {
        return this.towersBuilt;
    }

    public getWavesCompleted(): number {
        return this.wavesCompleted;
    }

    public getPerfectWaves(): number {
        return this.perfectWaves;
    }

    public getTotalDamageDealt(): number {
        return this.totalDamageDealt;
    }

    public getTotalDamageTaken(): number {
        return this.totalDamageTaken;
    }

    public getTimePlayed(): number {
        return (performance.now() - this.gameStartTime) / 1000;
    }
}
