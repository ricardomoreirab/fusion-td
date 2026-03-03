import { PlayerStats } from './PlayerStats';

export interface ScoreData {
    score: number;
    waves: number;
    kills: number;
    perfectWaves: number;
    timePlayed: number;
    date: string;
}

const STORAGE_KEY = 'fusionTD_highScore';

export class ScoreManager {
    /**
     * Calculate score from player stats and wave count
     * Formula: waves * 100 + kills * 10 + perfectWaves * 500
     */
    public static calculateScore(stats: PlayerStats, wavesCompleted: number): number {
        return wavesCompleted * 100
            + stats.getTotalKills() * 10
            + stats.getPerfectWaves() * 500;
    }

    /**
     * Get saved high score from localStorage
     */
    public static getHighScore(): ScoreData | null {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                return JSON.parse(data) as ScoreData;
            }
        } catch (e) {
            // localStorage not available or corrupted
        }
        return null;
    }

    /**
     * Save score if it's a new high score. Returns true if it's a new record.
     */
    public static saveIfHighScore(stats: PlayerStats, wavesCompleted: number): { isNewRecord: boolean, score: number } {
        const score = this.calculateScore(stats, wavesCompleted);
        const existing = this.getHighScore();

        const isNewRecord = !existing || score > existing.score;

        if (isNewRecord) {
            const data: ScoreData = {
                score,
                waves: wavesCompleted,
                kills: stats.getTotalKills(),
                perfectWaves: stats.getPerfectWaves(),
                timePlayed: stats.getTimePlayed(),
                date: new Date().toISOString()
            };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            } catch (e) {
                // localStorage not available
            }
        }

        return { isNewRecord, score };
    }
}
