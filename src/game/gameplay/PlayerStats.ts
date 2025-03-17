export class PlayerStats {
    private health: number;
    private money: number = 999999; // Give unlimited money for testing
    private won: boolean = false;
    private unlimitedMoney: boolean = true; // Enable unlimited money for testing

    constructor(initialHealth: number, initialMoney: number) {
        this.health = initialHealth;
        // Always start with a large amount of money for testing
        this.money = 999999;
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
     * @param amount The amount to reduce health by
     */
    public takeDamage(amount: number): void {
        this.health = Math.max(0, this.health - amount);
    }

    /**
     * Get the current money
     */
    public getMoney(): number {
        // Always return a large amount if unlimited money is enabled
        return this.unlimitedMoney ? 999999 : this.money;
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
        // If unlimited money is enabled, always allow spending
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
     * Toggle unlimited money mode for testing
     */
    public toggleUnlimitedMoney(): void {
        this.unlimitedMoney = !this.unlimitedMoney;
    }
} 