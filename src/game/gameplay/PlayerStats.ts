export class PlayerStats {
    private health: number;
    private money: number;
    private won: boolean = false;
    private unlimitedMoney: boolean = true; // Enable unlimited money by default

    constructor(health: number = 100, money: number = 9999) {
        this.health = health;
        this.money = money;
    }

    /**
     * Get the current health
     */
    public getHealth(): number {
        return this.health;
    }

    /**
     * Set the health to a new value
     * @param health The new health value
     */
    public setHealth(health: number): void {
        this.health = Math.max(0, health);
    }

    /**
     * Reduce health by a specified amount
     * @param damage The amount to reduce health by
     */
    public takeDamage(damage: number): void {
        this.health = Math.max(0, this.health - damage);
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

    public heal(amount: number): void {
        this.health = Math.min(100, this.health + amount);
    }
} 