import { AscensionContext, AscEnemy } from './AscensionContext';
// TYPE-ONLY: a value import would pull HeroBasicAttack's `three` dependency into
// this module and break its no-Three/no-DOM contract (and its unit tests).
import type { ArrowPolicy } from '../champions/HeroBasicAttack';

/**
 * Runs the behavioural (non-stat) Ascension node effects. Structural clone of
 * ItemEffectRuntime: Three-free and DOM-free, all world interaction through the
 * injected AscensionContext, driven by the gameplay state's existing hooks.
 *
 * Stat nodes do NOT come through here — they are folded from point counts by
 * foldAscensionStats(). This class owns everything conditional, per-hit, per-kill
 * or timed.
 *
 * Two rules every node in here obeys:
 *  - Every per-hit proc has a NAMED internal cooldown and, where it tracks
 *    per-enemy state, a PRUNED map. onBasicHit fires per enemy per frame during
 *    Whirlwind (which routes through the basic-attack pipeline) and again per
 *    ricochet bounce, so an unguarded proc is thousands of calls a second.
 *  - No allocation in the hot path: proximity goes through the context's counted
 *    visitors, never an array-returning query.
 */

// ── Tunables (named, mirroring the ItemEffectRuntime constant block) ─────────
export const STORMBOUND_KILLS = [12, 12, 8];
export const STORMBOUND_REFUND_S = [4, 8, 12];
export const RENDING_WINDS_DURATION_S = [5, 5, 8];
export const WOUND_CHEMISTRY_DURATION_S = [5, 5, 8];
export const OPEN_VEINS_FRAC = [0.006, 0.010, 0.015];
export const OPEN_VEINS_DURATION_S = [4, 4, 5];
export const OPEN_VEINS_HEAL_SHARE = 0.3;
export const EMBER_BONUS = [0.15, 0.25, 0.40];
export const EMBER_DETONATE_RADIUS = 2.5;
export const RAGE_ASCENDANT_MULT = [1.15, 1.25, 1.40];
export const RAGE_ASCENDANT_HP = 0.5;
export const BODYCHECK_FRAC = [0.9, 1.5, 2.2];
export const BODYCHECK_RADIUS = [3.6, 4.2, 5.0];
export const BODYCHECK_KNOCK = 4;
export const TREMOR_LANDING_FRAC = [0.10, 0.16, 0.24];
export const FAULT_LINE_RADIUS = 5;
export const FAULT_LINE_DURATION_S = [4, 5, 6];
export const FAULT_LINE_DPS = [12, 18, 26];
export const FAULT_LINE_CRAWL = 2;
export const BLOOD_RITE_EVERY_HITS = [5, 3, 3];
export const BLOOD_RITE_RADIUS = [3, 4.5, 5];
export const BLOOD_RITE_MAX_HP_FRAC = 0.08;
export const BLOOD_RITE_BURN_MULT = 2;
export const BLOOD_RITE_ICD_S = 1.5;
/** Per-enemy Blood Rite bookkeeping is pruned above this many tracked enemies. */
export const BLOOD_RITE_MAP_CAP = 96;

// ── Tempest ─────────────────────────────────────────────────────────────────
export const GALE_WW_RADIUS = [7.8, 8.6, 9.4];
export const GALE_REACH = [0.2, 0.4, 0.6];
export const FURY_PER_ENEMY = [0.015, 0.025, 0.035];
export const FURY_MAX_STACKS = [8, 8, 10];
export const FURY_RADIUS = 8;
/** The O(n) horde walk behind Unending Fury runs at most 4x/second. */
export const FURY_SAMPLE_S = 0.25;
export const FURY_EXTRA_REFUND_S = [0, 0, 0.4];
export const EYE_STORM_DR = [0.85, 0.72, 0.61];
export const EYE_STORM_HEAL_SHARE = 0.12;
export const CYCLONE_TICK_S = [0.26, 0.22, 0.18];
export const HURRICANE_DURATION_S = [6.2, 7.4, 8.6];
export const HURRICANE_MOVE_MULT = 1.25;
export const MAELSTROM_CEILING_S = [6.0, 10.0, 15.0];
export const MAELSTROM_PER_KILL_S = 0.35;
export const MAELSTROM_HARD_MAX_S = 23.6;
export const MAELSTROM_DAMAGE_MULT = 1.35;
export const ECHO_DURATION_S = [1.5, 2.2, 3.0];
export const ECHO_RADIUS_MULT = 0.7;
export const ECHO_SMASH_MULT = 0.6;

// ── Earthshaker ─────────────────────────────────────────────────────────────
export const AFTERSHOCK_EVERY = [6, 5, 4];
export const AFTERSHOCK_RADIUS = 4.5;
export const AFTERSHOCK_DAMAGE_FRAC = [0.6, 0.9, 1.3];
export const AFTERSHOCK_KNOCK = 3;
export const AFTERSHOCK_ENCHANT_CAP = 6;
export const SEISMIC_REACH_BONUS = [0.6, 1.2, 1.8];
export const SEISMIC_HALF_WIDTH = [1.7, 1.9, 2.1];
export const SEISMIC_SMASH_RADIUS = 13;
export const MOUNTAIN_DR = [0.90, 0.81, 0.73];
export const MOUNTAIN_MOVE = [0.96, 0.92, 0.885];
export const MOUNTAIN_AURA_RADIUS = 3;
export const MOUNTAIN_AURA_SLOW = 0.25;
export const MOUNTAIN_AURA_SLOW_DURATION_S = 0.5;
/** The only node that walks the horde from tick() — never every frame. */
export const MOUNTAIN_AURA_REFRESH_S = 0.25;
export const CRATER_DAMAGE_MULT = [1.6, 2.3, 3.2];
export const CRATER_COOLDOWN_S = [22, 19, 16];
export const CRATER_RADIUS = [11.5, 13, 15];
export const CRATER_PULSE_DELAY_S = 0.35;
export const CRATER_PULSE_DAMAGE_FRAC = 0.5;
export const CRATER_PULL_FORCE = 6;
export const STANDING_STONE_ARM_S = [4, 3, 2.5];
/** Sub-threshold damage neither consumes the charge nor resets the timer: the
 *  hero burn DoT routes through takeDamage EVERY FRAME, and without this a
 *  single FireBeetle would pin the timer at 0 for the rest of the run. */
export const STONE_MIN_HIT_FRAC = 0.02;
export const FISSURE_TRAVEL_S = [10, 13, 0];
export const FISSURE_TRAVEL_PER_POINT = 0.62;
/** = EnemyManager.ANIM_FULL_RATE_RADIUS. Past it the wave hits enemies posing at 30Hz. */
export const FISSURE_TRAVEL_CAP = 16;
export const FISSURE_DAMAGE_BONUS = [0.25, 0.50, 0.50];
export const FISSURE_HALF_WIDTH_PER_POINT = 0.05;
export const FISSURE_HALF_WIDTH_CAP = 3.0;

// ── Bloodsworn ──────────────────────────────────────────────────────────────
export const RUNEBLOODED_LEVEL_BONUS = 1;
export const RUNEBLOODED_STATUSED_BONUS = [0, 0.12, 0.12];
export const TWIN_LEVEL_BONUS = [1, 2, 3];
export const TWIN_REPEAT_CHANCE = [0.20, 0.35, 0.55];
export const WARD_CAP_FRAC = [0.15, 0.25, 0.40];
export const WARD_EXPLODE_RADIUS = 5;
/** MUST mirror `stat.perPoint` on the bloodthirst node def — a silent drift makes
 *  the below-40% doubling quietly WRONG rather than broken. Asserted in tests. */
export const BLOODTHIRST_PER_POINT = 0.03;
export const BLOODTHIRST_LOW_HP = 0.40;

// ── Ranger ──────────────────────────────────────────────────────────────────
/** Mirrors HeroBasicAttack.DEFAULT_ARROW_CAP — kept local so this module stays
 *  free of any runtime import from the Three-dependent attack code. Asserted
 *  equal in tests/ascensionScarcity.spec.ts. */
export const ARROW_CAP_BASE = 12;
export const SPLIT_NOCK_ARROWS = [1, 2, 3];
export const SPLIT_NOCK_STEP = 0.11;
export const SPLIT_NOCK_FAN_RAD = (22 * Math.PI) / 180;
export const FLETCH_BOUNCES = [1, 2, 3];
export const UNSPENT_EVERY = [6, 4, 3];
export const PUNCTURE_BODIES = [1, 2, 3];
export const PUNCTURE_FRAC = [0.75, 0.90, 1.10];
export const HIGH_GROUND_PIERCE = [1, 2, 3];
export const MOONLIT_RANGE = [22, 22, 30];
export const MOONLIT_SPEED = 40;
export const MOONLIT_PER_POINT = 0.02;
/** = the Deadeye path capacity, so the bonus is bounded at +48%. */
export const DEADEYE_PATH_CAP = 27;
export const UNSPENT_VOLLEY = 3;
export const FORKED_HOPS = [1, 2, 3];
export const FORKED_RADIUS_BONUS = [1, 2, 3];
export const SECOND_VOICE_AT = [8, 7, 6];
export const SECOND_VOICE_ICD_S = 1.5;
export const HOARFROST_DURATION_BONUS = [2, 4, 6];
export const FLETCH_RADIUS = [7, 8, 9];
export const BARBED_DURATION_S = [5, 5, 8];
export const HAIL_CHANCE = [0.25, 0.40, 0.60];
export const HAIL_ICD_S = 0.10;
export const SPLINTER_SEARCH_MULT = [1.15, 1.30, 1.50];
export const SECOND_NATURE_ARROW_WEIGHT = 1.5;
export const HUNDREDFOLD_DURATION_S = [6.2, 7.4, 8.6];
export const HUNDREDFOLD_COUNT = [40, 52, 66];
export const THOUSAND_CAP = [15, 18, 22];
export const THOUSAND_PER_ARROW = [0.06, 0.09, 0.12];
export const THOUSAND_RAMP_CAP = 1.5;
export const THOUSAND_DECAY_S = 1.2;
export const LONG_DRAW_RANGE = [11, 13, 15.5];
export const LONG_DRAW_SPEED = [26, 30, 34];
export const KEEN_EDGE_CRIT_DMG = [0.35, 0.60, 0.90];
export const MARK_DURATION_S = [6, 8, 10];
export const MARK_BONUS = [0.12, 0.20, 0.32];
export const STEADY_ARM_S = [0.8, 0.6, 0.5];
export const STEADY_DAMAGE = [0.25, 0.45, 0.70];
export const STEADY_MOVE_EPSILON = 0.05;
export const WIDOWMAKER_HP = [0.12, 0.18, 0.25];
export const WIDOWMAKER_REFUND_S = 1.5;
export const WIDOWMAKER_ICD_S = 0.25;
export const HIGH_GROUND_FRAC = [0.60, 0.45, 0.30];
export const HIGH_GROUND_BONUS = [0.30, 0.50, 0.75];
export const ONE_SHOT_COUNT = [6, 8, 10];
export const ONE_SHOT_MULT = [8, 12, 16];
export const HUNTERS_MARK_FRAC = [0.006, 0.010, 0.015];
export const HUNTERS_MARK_DURATION_S = [4, 4, 5];
export const BRIAR_RADIUS = 2.0;
export const BRIAR_DURATION_S = [4, 6, 8];
export const BRIAR_DPS = [30, 45, 65];
export const BRIAR_SLOW = [0.35, 0.50, 0.65];
export const LONG_STRIDE_DASH_CD = [5.8, 4.8, 3.9];
export const GRACE_WINDOW_S = [1.2, 1.8, 2.5];
export const GRACE_ATTACK_SPEED = [1.40, 1.65, 1.95];
export const GRACE_DR = [0.80, 0.70, 0.60];
export const WITHERING_RADIUS = [4, 6, 8];
export const FALLING_SKY_DURATION_S = [4.5, 6.0, 7.5];
export const UNSEEN_ARM_S = [2.5, 2.0, 1.5];
export const WILD_HUNT_WAKE_RADIUS = [1.6, 2.4, 2.4];
export const WILD_HUNT_WAKE_DURATION_S = [2, 3, 3];
export const WILD_HUNT_WAKE_DPS = [25, 40, 40];
export const WILD_HUNT_MOVE_MULT = 1.15;
export const WILD_HUNT_PER_POINT = 0.03;
export const WILD_HUNT_WAKE_ICD_S = 0.45;

// ── Mage ────────────────────────────────────────────────────────────────────
export const RESONANCE_BASE_CAP = 10;
export const RESONANCE_PER_STACK = [0.025, 0.04, 0.06];
export const RESONANCE_DECAY_S = 1.5;
export const CANTICLE_CAP = [16, 22, 28];
/** A cast grants 1 Resonance; a discharge costs 8. Forced casts must generate
 *  NONE or the loop diverges — this is the load-bearing convergence fact. */
export const CANTICLE_DISCHARGE_COST = 8;
export const CANTICLE_DISCHARGE_AT = 22;
export const CANTICLE_ICD_S = 1.2;
export const THUNDERHEAD_EVERY = [8, 6, 5];
export const THUNDERHEAD_HOPS = [8, 10, 12];
export const THUNDERHEAD_DAMAGE = [1.4, 1.8, 2.4];
export const THUNDERHEAD_RADIUS = 6;
export const BLINKSTORM_DETONATE = [1.2, 2.0, 3.2];
export const BLINKSTORM_RADIUS = [3.5, 4.5, 5.5];
export const BLINKSTORM_CD = [5.6, 4.5, 3.6];
export const STORMBORN_REFUND_PCT = [0.03, 0.05, 0.07];
export const UNTETHERED_MOVE = [1.35, 1.5, 1.7];
export const UNTETHERED_WINDOW_S = [2.0, 2.6, 3.2];
export const UNTETHERED_DR = [0.75, 0.60, 0.45];
export const RIMEBOUND_STACKS = [1, 1, 2];
export const RIMEBOUND_DURATION_S = [3, 5, 6];
export const KILLING_COLD_CHILL = [0.20, 0.35, 0.55];
export const KILLING_COLD_FROZEN = [0.35, 0.60, 0.95];
export const WHITE_SILENCE_CD = [25, 20, 16];
export const WHITE_SILENCE_FREEZE_S = [3.2, 3.9, 4.6];
export const SHATTERING_DAMAGE = [0.80, 1.30, 2.00];
export const SHATTERING_RADIUS = [3, 4, 5];
export const SHATTERING_MAX_LINKS = 3;
export const PATIENCE_DR = [0.80, 0.68, 0.55];
export const PATIENCE_RADIUS = [5, 6, 7.5];
export const ABSOLUTE_ZERO_NOVAS = [1, 2, 3];
export const HOARFROST_CRAWL = [1.5, 2.5, 3.5];
export const LONG_WINTER_STACKS = [1, 2, 3];
/** Arena-wide chill runs at 1 Hz. Per frame at wave 40 would be ~81,000 status
 *  applications a second. */
export const LONG_WINTER_INTERVAL_S = 1.0;
export const HOLLOW_MOUTH_FRAC = [0.005, 0.009, 0.014];
export const HOLLOW_MOUTH_DURATION_S = [4, 4, 5];
export const GRAVE_WEIGHT_RADIUS = [6, 7, 8];
export const GRAVE_WEIGHT_DAMAGE = [0.25, 0.40, 0.60];
export const STAR_FALLS_COUNT = [7, 9, 12];
export const STAR_FALLS_CD = [38, 32, 26];
export const STAR_FALLS_RADIUS = [4.8, 5.6, 6.4];
export const DEBT_HEAL_SHARE = [0.45, 0.60, 0.80];
export const DEBT_DR = [0.85, 0.75, 0.65];
export const DEBT_CURSED_NEEDED = 5;
export const COLLAPSE_EVERY = [10, 7, 5];
export const COLLAPSE_RADIUS = 4;
export const COLLAPSE_MAX_WELLS = 4;
/** Curse drains a % of MAX HP per second, so uncapped it trivialises bosses. */
export const HOLLOW_STAR_CURSE_CLAMP = 0.06;
export const HOLLOW_STAR_PER_POINT = 0.03;

/** Node ids of the Deadeye path — The Moonlit Lane r3 scales with the total. */
const DEADEYE_NODE_IDS = [
    'long-draw', 'keen-edge', 'puncture', 'mark-of-the-moon', 'the-still-breath',
    'widowmaker', 'the-high-ground', 'the-one-shot', 'the-moonlit-lane',
];

/** Node ids of the Hollow Star path — its capstone scales with the total. */
const HOLLOWSTAR_NODE_IDS = [
    'the-hollow-mouth', 'grave-weight', 'the-star-falls', 'dread', 'event-horizon',
    'the-debt', 'collapse', 'unmaking', 'the-hollow-star',
];

/** Node ids of the Wild Hunt path — its capstone scales with the total. */
const WILDHUNT_NODE_IDS = [
    'bodycheck-rng', 'hunters-mark', 'briar-trail', 'the-long-stride',
    'skirmishers-grace', 'withering', 'the-falling-sky', 'unseen', 'the-wild-hunt',
];

/** Node ids of the Earthshaker path — The Fissure r3 scales with the total. */
const EARTHSHAKER_NODE_IDS = [
    'tremorbound', 'bodycheck-bar', 'aftershock', 'seismic-reach',
    'weight-of-the-mountain', 'fault-line', 'crater-maker', 'standing-stone', 'the-fissure',
];

interface RiteEntry { hits: number; cd: number; }

export class AscensionRuntime {
    /** nodeId → points. Replaced wholesale on every recompute. */
    private points: ReadonlyMap<string, number> = new Map();

    // Per-node state.
    private stormboundKills = 0;
    private riteState = new Map<AscEnemy, RiteEntry>();
    private inDetonate = false;
    private swings = 0;
    /** Cached horde count for Unending Fury — the O(n) walk is throttled. */
    private furyNearby = 0;
    private furyTimer = 0;
    private auraTimer = 0;
    private craterPulseTimer = 0;
    private stoneTimer = 0;
    private stoneArmed = false;
    private wardPool = 0;
    private inWardBreak = false;
    private inEcho = false;
    /** Accumulated Eye of the Maelstrom channel extension for the CURRENT cast. */
    private maelstromExt = 0;
    /** Points in the Earthshaker path, refreshed on every setActivePoints. */
    private earthshakerPoints = 0;
    private wildHuntPoints = 0;
    // Ranger state
    private hailCd = 0;
    private steadyTimer = 0;
    private lastHeroX = 0;
    private lastHeroZ = 0;
    private graceTimer = 0;
    private unseenTimer = 0;
    private unseenArmed = false;
    private wakeTimer = 0;
    private widowCd = 0;
    /** The Thousand's cross-volley escalation, decayed in tick(). */
    private thousandRamp = 1;
    private thousandDecay = 0;
    // Mage state
    private resonance = 0;
    private resonanceDecay = 0;
    private casts = 0;
    private canticleCd = 0;
    private winterTimer = 0;
    private collapseKills = 0;
    private liveWells = 0;
    private debtUsedThisWave = false;
    private inShatter = false;
    private hollowStarPoints = 0;
    private wellRelease = 0;
    private wastedArrows = 0;
    private secondVoiceCd = 0;
    private deadeyePoints = 0;

    constructor(private ctx: AscensionContext) {}

    /** Called from applyLevelBonuses, beside the stat fold. */
    public setActivePoints(points: ReadonlyMap<string, number>): void {
        this.points = points;
        // The Fissure r3 scales with TOTAL points in its path; cache it here
        // rather than summing on every slash wave.
        let n = 0;
        for (const id of EARTHSHAKER_NODE_IDS) n += points.get(id) ?? 0;
        this.earthshakerPoints = n;
        let w = 0;
        for (const id of WILDHUNT_NODE_IDS) w += points.get(id) ?? 0;
        this.wildHuntPoints = w;
        let de = 0;
        for (const id of DEADEYE_NODE_IDS) de += points.get(id) ?? 0;
        this.deadeyePoints = de;
        let hs = 0;
        for (const id of HOLLOWSTAR_NODE_IDS) hs += points.get(id) ?? 0;
        this.hollowStarPoints = hs;
        // Forked Lightning is a RUN-WIDE chain bonus, installed once here rather
        // than read per hop. Cleared when the node is unowned so a fresh run
        // never inherits it (resetPowerEffects also nulls it at exit).
        const fl = (points.get('forked-lightning') ?? 0) - 1;
        this.ctx.setChainBonus(fl >= 0
            ? { extraHops: FORKED_HOPS[fl], radiusBonus: FORKED_RADIUS_BONUS[fl], split: fl >= 2 }
            : null);
    }

    /** The Moonlit Lane retargets the basic attack to the furthest enemy. */
    public targetFurthest(): boolean { return this.rank('the-moonlit-lane') >= 0; }

    /** Hoarfrost Crawl turns this runtime's ice zones into creeping ones. */
    private zoneCrawl(): { crawlSpeed: number; bonusDuration: number } | null {
        const r = this.rank('hoarfrost-crawl');
        return r >= 0
            ? { crawlSpeed: HOARFROST_CRAWL[r], bonusDuration: HOARFROST_DURATION_BONUS[r] }
            : null;
    }

    /** True while Whirlwind is channelling. */
    private get channelling(): boolean {
        return this.ctx.abilityTimeLeft('whirlwind') > 0;
    }

    /** Points in a node, 0 when unowned. */
    private p(nodeId: string): number { return this.points.get(nodeId) ?? 0; }
    /** Rank index (0..2) for the per-rank tunable arrays, or -1 when unowned. */
    private rank(nodeId: string): number { return this.p(nodeId) - 1; }

    public reset(): void {
        this.points = new Map();
        this.stormboundKills = 0;
        this.riteState.clear();
        this.inDetonate = false;
        this.swings = 0;
        this.furyNearby = 0;
        this.furyTimer = 0;
        this.auraTimer = 0;
        this.craterPulseTimer = 0;
        this.stoneTimer = 0;
        this.stoneArmed = false;
        this.wardPool = 0;
        this.inWardBreak = false;
        this.inEcho = false;
        this.maelstromExt = 0;
        this.earthshakerPoints = 0;
        this.wildHuntPoints = 0;
        this.hailCd = 0;
        this.steadyTimer = 0;
        this.graceTimer = 0;
        this.unseenTimer = 0;
        this.unseenArmed = false;
        this.wakeTimer = 0;
        this.widowCd = 0;
        this.thousandRamp = 1;
        this.thousandDecay = 0;
        this.resonance = 0;
        this.resonanceDecay = 0;
        this.casts = 0;
        this.canticleCd = 0;
        this.winterTimer = 0;
        this.collapseKills = 0;
        this.liveWells = 0;
        this.debtUsedThisWave = false;
        this.inShatter = false;
        this.hollowStarPoints = 0;
        this.wellRelease = 0;
        this.wastedArrows = 0;
        this.secondVoiceCd = 0;
        this.deadeyePoints = 0;
    }

    // ── Mage ────────────────────────────────────────────────────────────────

    /** Resonance ceiling, raised by the Canticle capstone. */
    private get resonanceCap(): number {
        const r = this.rank('the-endless-canticle');
        return r >= 0 ? CANTICLE_CAP[r] : RESONANCE_BASE_CAP;
    }

    /** Power-damage multiplier from Arc Resonance stacks. */
    public powerDamageMult(): number {
        const r = this.rank('arc-resonance');
        return r >= 0 ? 1 + RESONANCE_PER_STACK[r] * this.resonance : 1;
    }

    /**
     * A power was cast. Resonance is the mage's only resource, and it MUST
     * converge: one cast grants exactly 1, a Canticle discharge costs 8, and the
     * forced casts the discharge triggers do NOT route through here — so the loop
     * is bounded by the player's real cast rate and decays out of it.
     */
    public onPowerCast(): void {
        if (this.rank('arc-resonance') >= 0) {
            this.resonance = Math.min(this.resonanceCap, this.resonance + 1);
            this.resonanceDecay = RESONANCE_DECAY_S;
        }

        // Grave Weight: every cast drags nearby enemies in and deals a share again.
        const gw = this.rank('grave-weight');
        if (gw >= 0) {
            const h = this.ctx.heroPos();
            const dmg = this.ctx.basicDamage() * GRAVE_WEIGHT_DAMAGE[gw];
            this.ctx.forEachEnemyNear(h.x, h.z, GRAVE_WEIGHT_RADIUS[gw], (e) => {
                this.ctx.damage(e, dmg, 'arcane');
                this.ctx.knockback(e, h.x, h.z, -1.2 - gw * 0.8); // negative = pull in
            });
        }

        // Thunderhead: every Nth cast calls down a storm.
        const th = this.rank('thunderhead');
        if (th >= 0) {
            this.casts++;
            if (this.casts >= THUNDERHEAD_EVERY[th]) {
                this.casts = 0;
                const h = this.ctx.heroPos();
                const dmg = this.ctx.basicDamage() * THUNDERHEAD_DAMAGE[th];
                let hops = 0;
                this.ctx.ring(h.x, h.z, '#ffe040', THUNDERHEAD_RADIUS);
                this.ctx.forEachEnemyNear(h.x, h.z, THUNDERHEAD_RADIUS, (e) => {
                    if (hops++ >= THUNDERHEAD_HOPS[th]) return;
                    this.ctx.damage(e, dmg, 'storm');
                    this.ctx.fragile(e, 5);
                });
            }
        }

        // The Second Voice: at enough Resonance the cast echoes a DIFFERENT slot.
        const sv = this.rank('the-second-voice');
        if (sv >= 0 && this.secondVoiceCd <= 0 && this.resonance >= SECOND_VOICE_AT[sv]) {
            this.secondVoiceCd = SECOND_VOICE_ICD_S;
            this.ctx.castSlotFree(-1);
        }

        // The Endless Canticle r3: at high Resonance a cast force-fires every
        // autocast slot. It COSTS 8 Resonance and is ICD'd, so it cannot sustain.
        if (this.rank('the-endless-canticle') >= 2
            && this.resonance >= CANTICLE_DISCHARGE_AT && this.canticleCd <= 0) {
            this.resonance -= CANTICLE_DISCHARGE_COST;
            this.canticleCd = CANTICLE_ICD_S;
            this.ctx.forceCastAutocastSlots();
        }
    }

    // ── Ranger: the arrow policy ────────────────────────────────────────────

    /** Implemented as ONE object handed to HeroBasicAttack; every method is a
     *  scalar read of already-resolved point counts, so no allocation per arrow. */
    public arrowPolicy(): ArrowPolicy {
        return {
            bonusArrows: () => {
                const r = this.rank('split-nock');
                return r >= 0 ? SPLIT_NOCK_ARROWS[r] : 0;
            },
            arrowCountStep: () => {
                // Split Nock r3 and Second Nature r3 both make attack speed convert
                // to arrows faster. MIN, so they do not multiply into a firehose.
                let step = 0.15;
                if (this.rank('split-nock') >= 2) step = Math.min(step, SPLIT_NOCK_STEP);
                if (this.rank('second-nature') >= 2) step = Math.min(step, 0.15 / SECOND_NATURE_ARROW_WEIGHT);
                return step;
            },
            arrowCap: () => {
                const r = this.rank('the-thousand');
                return r >= 0 ? THOUSAND_CAP[r] : ARROW_CAP_BASE;
            },
            fanHalfAngleRad: () =>
                this.rank('split-nock') >= 2 ? SPLIT_NOCK_FAN_RAD : (10 * Math.PI) / 180,
            stackSurplusOnTargets: () => this.rank('splinter-salvo') >= 0,
            arrowDamageScale: () => {
                let m = this.thousandRamp;
                const st = this.rank('the-still-breath');
                if (st >= 0 && this.steadyTimer >= STEADY_ARM_S[st]) m *= 1 + STEADY_DAMAGE[st];
                // The High Ground rewards distance; approximated per-volley rather
                // than per-arrow so it costs one scalar read, not a distance test.
                const hg = this.rank('the-high-ground');
                if (hg >= 0) m *= 1 + HIGH_GROUND_BONUS[hg];
                // The Moonlit Lane r3: +2% per Deadeye point, bounded by the
                // path's own 27-point capacity (max +48%).
                if (this.rank('the-moonlit-lane') >= 2) {
                    m *= 1 + MOONLIT_PER_POINT * Math.min(this.deadeyePoints, DEADEYE_PATH_CAP);
                }
                return m;
            },
            rangeOverride: () => {
                // The Moonlit Lane's reach wins outright when owned; it is the
                // node that turns the basic attack into a lane.
                const ml = this.rank('the-moonlit-lane');
                if (ml >= 0) return MOONLIT_RANGE[ml];
                const r = this.rank('long-draw');
                return r >= 0 ? LONG_DRAW_RANGE[r] : 0;
            },
            speedOverride: () => {
                if (this.rank('the-moonlit-lane') >= 0) return MOONLIT_SPEED;
                const r = this.rank('long-draw');
                return r >= 0 ? LONG_DRAW_SPEED[r] : 0;
            },
            pierceCount: () => {
                // Puncture and The High Ground both grant bodies; MAX, never sum.
                const pu = this.rank('puncture');
                const hg = this.rank('the-high-ground');
                let n = 0;
                if (pu >= 0) n = Math.max(n, PUNCTURE_BODIES[pu]);
                if (hg >= 0) n = Math.max(n, HIGH_GROUND_PIERCE[hg]);
                // The Moonlit Lane r3 removes the cap: bounded by the lane length
                // and the struck-Set, not by a body count.
                if (this.rank('the-moonlit-lane') >= 2) n = Math.max(n, 99);
                return n;
            },
            pierceDamageFrac: () => {
                const pu = this.rank('puncture');
                return pu >= 0 ? PUNCTURE_FRAC[pu] : 1;
            },
            targetFurthest: () => this.rank('the-moonlit-lane') >= 0,
            bonusBounces: () => {
                const r = this.rank('whispering-fletch');
                return r >= 0 ? FLETCH_BOUNCES[r] : 0;
            },
            ricochetRadius: () => {
                const r = this.rank('whispering-fletch');
                return r >= 0 ? FLETCH_RADIUS[r] : 0;
            },
            onArrowExpired: (hitSomething) => {
                const r = this.rank('unspent-shafts');
                if (r < 0) return;
                // r3 counts a killing arrow as half a wasted one.
                if (hitSomething) { if (r >= 2) this.wastedArrows += 0.5; }
                else this.wastedArrows += 1;
                if (this.wastedArrows >= UNSPENT_EVERY[r]) {
                    this.wastedArrows = 0;
                    const h = this.ctx.heroPos();
                    const dmg = this.ctx.basicDamage();
                    let n = 0;
                    this.ctx.ring(h.x, h.z, '#e0e0e0', 2);
                    this.ctx.forEachEnemyNear(h.x, h.z, 12, (e) => {
                        if (n++ >= UNSPENT_VOLLEY) return;
                        this.ctx.damage(e, dmg, 'physical');
                    });
                }
            },
        };
    }

    // ── Pulled providers ────────────────────────────────────────────────────

    /**
     * Basic-attack damage multiplier contributed by ascension. Folded into the
     * hero's damageMultiplierProvider, never assigned onto PlayerStats — so
     * applyLevelBonuses cannot clobber it and no re-push is needed.
     */
    public damageBonusMult(): number {
        let m = 1;
        const r = this.rank('rage-ascendant');
        if (r >= 0 && this.ctx.heroHpFraction() < RAGE_ASCENDANT_HP) m *= RAGE_ASCENDANT_MULT[r];
        // Eye of the Maelstrom: Whirlwind ticks route through the basic-attack
        // pipeline, so this lands on the channel's own ticks — which is the point.
        if (this.rank('eye-of-the-maelstrom') >= 0 && this.channelling) m *= MAELSTROM_DAMAGE_MULT;
        return m;
    }

    /**
     * Multiplicative damage-reduction term, composed in ONE fixed clause order so
     * two nodes can never fight over it. Lower = tankier. The caller re-clamps.
     */
    public damageReductionMult(): number {
        let m = 1;
        const eye = this.rank('eye-of-the-storm');
        if (eye >= 0 && this.channelling) m *= EYE_STORM_DR[eye];
        const mtn = this.rank('weight-of-the-mountain');
        if (mtn >= 0) m *= MOUNTAIN_DR[mtn];
        const g = this.rank('skirmishers-grace');
        if (g >= 0 && this.graceTimer > 0) m *= GRACE_DR[g];
        // Untethered shares the post-dash window (the mage's dash is the blink).
        const ut = this.rank('untethered');
        if (ut >= 0 && this.graceTimer > 0) m *= UNTETHERED_DR[ut];
        const wp = this.rank('winters-patience');
        if (wp >= 0) m *= PATIENCE_DR[wp];
        const dbt = this.rank('the-debt');
        if (dbt >= 0) m *= DEBT_DR[dbt];
        return m;
    }

    /** Transient move-speed term, pulled inside getEffectiveMoveSpeed(). */
    public moveSpeedMult(): number {
        let m = 1;
        if (this.rank('hurricane-heart') >= 0 && this.channelling) m *= HURRICANE_MOVE_MULT;
        const mtn = this.rank('weight-of-the-mountain');
        if (mtn >= 0) m *= MOUNTAIN_MOVE[mtn];
        if (this.rank('the-wild-hunt') >= 0) m *= WILD_HUNT_MOVE_MULT;
        const ut = this.rank('untethered');
        if (ut >= 0 && this.graceTimer > 0) m *= UNTETHERED_MOVE[ut];
        return m;
    }

    /** Transient attack-speed term, pulled inside effectiveInterval. */
    public attackSpeedMult(): number {
        let m = 1;
        const r = this.rank('rage-ascendant');
        if (r >= 2 && this.ctx.heroHpFraction() < 0.30) m *= 1.4;
        const g = this.rank('skirmishers-grace');
        if (g >= 0 && this.graceTimer > 0) m *= GRACE_ATTACK_SPEED[g];
        return m;
    }

    /** Pulled per CAST — Unending Fury reads the horde standing around the hero
     *  at the moment the ability is used, so casting INTO the pile is a decision. */
    public ultCooldownMult(): number {
        const r = this.rank('unending-fury');
        if (r < 0) return 1;
        const stacks = Math.min(this.furyNearby, FURY_MAX_STACKS[r]);
        return Math.max(0.2, 1 - FURY_PER_ENEMY[r] * stacks);
    }

    /**
     * Per-ability tuning overrides. Resolved once per activation by AbilityManager.
     * Returns null when nothing is owned so the common path allocates nothing.
     */
    public abilityTuning(abilityId: string): Record<string, number> | null {
        if (abilityId === 'whirlwind') {
            const gale = this.rank('gale-force');
            const cyc = this.rank('cyclone-cadence');
            const hur = this.rank('hurricane-heart');
            if (gale < 0 && cyc < 0 && hur < 0) return null;
            const t: Record<string, number> = {};
            if (gale >= 0) t.radius = GALE_WW_RADIUS[gale];
            if (cyc >= 0) t.tickIntervalS = CYCLONE_TICK_S[cyc];
            if (hur >= 0) t.durationS = HURRICANE_DURATION_S[hur];
            return t;
        }
        if (abilityId === 'frostNova') {
            const ws = this.rank('white-silence');
            const az = this.rank('absolute-zero');
            if (ws < 0 && az < 0) return null;
            const t: Record<string, number> = {};
            if (ws >= 0) { t.cooldownS = WHITE_SILENCE_CD[ws]; t.durationS = WHITE_SILENCE_FREEZE_S[ws]; }
            if (az >= 0) t.count = ABSOLUTE_ZERO_NOVAS[az];
            return t;
        }
        if (abilityId === 'meteor') {
            const sf = this.rank('the-star-falls');
            if (sf < 0) return null;
            return {
                count: STAR_FALLS_COUNT[sf],
                cooldownS: STAR_FALLS_CD[sf],
                radius: STAR_FALLS_RADIUS[sf],
            };
        }
        if (abilityId === 'multishot') {
            const hf = this.rank('the-hundredfold');
            const os = this.rank('the-one-shot');
            if (hf < 0 && os < 0) return null;
            const t: Record<string, number> = {};
            if (hf >= 0) { t.durationS = HUNDREDFOLD_DURATION_S[hf]; t.count = HUNDREDFOLD_COUNT[hf]; }
            // The One Shot INVERTS the ult: few arrows, enormous each.
            if (os >= 0) { t.count = ONE_SHOT_COUNT[os]; t.damageMult = ONE_SHOT_MULT[os]; }
            return t;
        }
        if (abilityId === 'explosiveArrow') {
            const fs = this.rank('the-falling-sky');
            if (fs < 0) return null;
            return { durationS: FALLING_SKY_DURATION_S[fs] };
        }
        if (abilityId === 'dash') {
            const ls = this.rank('the-long-stride');
            return ls >= 0 ? { cooldownS: LONG_STRIDE_DASH_CD[ls] } : null;
        }
        if (abilityId === 'smash') {
            const cr = this.rank('crater-maker');
            const se = this.rank('seismic-reach');
            if (cr < 0 && se < 2) return null;
            const t: Record<string, number> = {};
            // MAX, never sum — two nodes write this field and summing would make
            // Smash arena-wide.
            const radii: number[] = [];
            if (cr >= 0) radii.push(CRATER_RADIUS[cr]);
            if (se >= 2) radii.push(SEISMIC_SMASH_RADIUS);
            if (radii.length) t.radius = Math.max(...radii);
            if (cr >= 0) { t.damageMult = CRATER_DAMAGE_MULT[cr]; t.cooldownS = CRATER_COOLDOWN_S[cr]; }
            return t;
        }
        return null;
    }

    // ── HeroBasicAttack mods (pulled) ───────────────────────────────────────

    public reachBonus(): number {
        let n = 0;
        const g = this.rank('gale-force');
        if (g >= 0) n += GALE_REACH[g];
        const s = this.rank('seismic-reach');
        if (s >= 0) n += SEISMIC_REACH_BONUS[s];
        return n;
    }

    public slashHalfWidth(base: number): number {
        let w = base;
        const s = this.rank('seismic-reach');
        if (s >= 0) w = Math.max(w, SEISMIC_HALF_WIDTH[s]);
        if (this.rank('the-fissure') >= 2) {
            w = Math.max(w, Math.min(FISSURE_HALF_WIDTH_CAP,
                1.5 + FISSURE_HALF_WIDTH_PER_POINT * this.earthshakerPoints));
        }
        return w;
    }

    public slashTravel(base: number): number {
        const r = this.rank('the-fissure');
        if (r < 0) return base;
        // Ranks 1-2 are flat; rank 3 becomes a ceiling raiser that scales with
        // every point already spent in the path, hard-capped at the LOD radius.
        const travel = r < 2
            ? FISSURE_TRAVEL_S[r]
            : Math.min(FISSURE_TRAVEL_CAP, FISSURE_TRAVEL_PER_POINT * this.earthshakerPoints);
        return Math.max(base, travel);
    }

    public slashDamageMult(): number {
        const r = this.rank('the-fissure');
        return r >= 0 ? 1 + FISSURE_DAMAGE_BONUS[r] : 1;
    }

    /** Cyclone Cadence r3 stops the channel flinging the horde out of its radius. */
    public suppressKnockback(): boolean {
        return this.rank('cyclone-cadence') >= 2 && this.channelling;
    }

    public enchantLevelBonus(): number {
        let n = 0;
        if (this.rank('runeblooded') >= 0) n += RUNEBLOODED_LEVEL_BONUS;
        const t = this.rank('twin-enchant');
        if (t >= 0) n += TWIN_LEVEL_BONUS[t];
        return n;
    }

    public enchantRepeatChance(): number {
        const t = this.rank('twin-enchant');
        return t >= 0 ? TWIN_REPEAT_CHANCE[t] : 0;
    }

    public enchantRepeatDistinct(): boolean {
        return this.rank('twin-enchant') >= 2;
    }

    // ── HeroController damage-pipeline providers ────────────────────────────

    /** Standing Stone. Consumes the charge when it returns true. */
    public tryNegate(): boolean {
        // Unseen (ranger) and Standing Stone (barbarian) share this slot.
        if (this.unseenArmed) {
            this.unseenArmed = false;
            this.unseenTimer = 0;
            const h = this.ctx.heroPos();
            this.ctx.ring(h.x, h.z, '#88a070', 3);
            return true;
        }
        const r = this.rank('standing-stone');
        if (r < 0) { this.unseenTimer = 0; return false; }
        if (!this.stoneArmed) { this.stoneTimer = 0; this.unseenTimer = 0; return false; }
        this.stoneArmed = false;
        this.stoneTimer = 0;
        const h = this.ctx.heroPos();
        this.ctx.ring(h.x, h.z, '#c9a23f', 3);
        return true;
    }

    /** The Debt r3: once per wave, survive a lethal hit at 1 HP. */
    public tryCheatDeath(): boolean {
        if (this.rank('the-debt') < 2 || this.debtUsedThisWave) return false;
        this.debtUsedThisWave = true;
        const h = this.ctx.heroPos();
        this.ctx.ring(h.x, h.z, '#a463ff', 8);
        this.ctx.forEachEnemyNear(h.x, h.z, 8, (e) => {
            this.ctx.damage(e, e.getMaxHealth() * 0.12, 'arcane');
        });
        return true;
    }

    /** Re-arm the once-per-wave effects. */
    public onWaveStart(): void { this.debtUsedThisWave = false; }

    /** Sanguine Ward. Returns the damage REMAINING after the pool absorbs. */
    public absorb(amount: number): number {
        if (this.wardPool <= 0) return amount;
        const used = Math.min(this.wardPool, amount);
        this.wardPool -= used;
        const left = amount - used;
        if (this.wardPool <= 0 && this.rank('sanguine-ward') >= 2 && !this.inWardBreak) {
            // The break explosion deals damage, which can kill, which reaches
            // onKill — and with the Maelstrom capstone, extendChannel. That chain
            // must not re-enter the hero's own damage filter.
            this.inWardBreak = true;
            const cap = this.ctx.heroMaxHp() * WARD_CAP_FRAC[this.rank('sanguine-ward')];
            const h = this.ctx.heroPos();
            this.ctx.ring(h.x, h.z, '#c8302a', WARD_EXPLODE_RADIUS);
            this.ctx.forEachEnemyNear(h.x, h.z, WARD_EXPLODE_RADIUS, (e) => {
                this.ctx.damage(e, cap, 'arcane');
            });
            this.inWardBreak = false;
        }
        return left;
    }

    /** Banked overheal feeds the ward pool. */
    public onHealOverflow(amount: number): void {
        const r = this.rank('sanguine-ward');
        if (r < 0) return;
        this.wardPool = Math.min(this.wardPool + amount, this.ctx.heroMaxHp() * WARD_CAP_FRAC[r]);
    }

    // ── Frame tick ──────────────────────────────────────────────────────────

    public tick(dt: number): void {
        // Unending Fury: the horde walk is O(n), so throttle it hard and cache.
        if (this.rank('unending-fury') >= 0) {
            this.furyTimer -= dt;
            if (this.furyTimer <= 0) {
                this.furyTimer = FURY_SAMPLE_S;
                const h = this.ctx.heroPos();
                this.furyNearby = this.ctx.enemiesNearCount(h.x, h.z, FURY_RADIUS);
            }
        }

        // Weight of the Mountain's slow aura — the ONLY node that walks the horde
        // from tick(), so it runs on a named interval, never per frame.
        const mtn = this.rank('weight-of-the-mountain');
        if (mtn >= 0) {
            this.auraTimer -= dt;
            if (this.auraTimer <= 0) {
                this.auraTimer = MOUNTAIN_AURA_REFRESH_S;
                const h = this.ctx.heroPos();
                // The rider widens the aura to the live channel radius.
                const radius = (this.rank('cyclone-cadence') >= 0 && this.channelling)
                    ? Math.max(MOUNTAIN_AURA_RADIUS, GALE_WW_RADIUS[Math.max(0, this.rank('gale-force'))])
                    : MOUNTAIN_AURA_RADIUS;
                this.ctx.forEachEnemyNear(h.x, h.z, radius, (e) => {
                    // Duration is 2x the refresh so the slow never gaps.
                    this.ctx.slow(e, MOUNTAIN_AURA_SLOW, MOUNTAIN_AURA_SLOW_DURATION_S);
                });
            }
        }

        // ── Ranger timers ──
        // The Still Breath: Steady builds while the hero holds position.
        if (this.rank('the-still-breath') >= 0) {
            const h = this.ctx.heroPos();
            const moved = Math.abs(h.x - this.lastHeroX) + Math.abs(h.z - this.lastHeroZ);
            this.steadyTimer = moved > STEADY_MOVE_EPSILON ? 0 : this.steadyTimer + dt;
            this.lastHeroX = h.x; this.lastHeroZ = h.z;
        }
        this.hailCd = Math.max(0, this.hailCd - dt);
        this.widowCd = Math.max(0, this.widowCd - dt);
        this.graceTimer = Math.max(0, this.graceTimer - dt);
        this.wakeTimer = Math.max(0, this.wakeTimer - dt);

        // The Thousand's cross-volley escalation decays rather than persisting.
        if (this.thousandRamp > 1) {
            this.thousandDecay -= dt;
            if (this.thousandDecay <= 0) this.thousandRamp = 1;
        }

        // Unseen arms after N seconds undamaged (shares the negate provider).
        const uns = this.rank('unseen');
        if (uns >= 0 && !this.unseenArmed) {
            this.unseenTimer += dt;
            if (this.unseenTimer >= UNSEEN_ARM_S[uns]) {
                this.unseenArmed = true;
                const h = this.ctx.heroPos();
                this.ctx.ring(h.x, h.z, '#88a070', 1.6);
            }
        }

        // The Wild Hunt: a burning briar wake while MOVING. Ends the instant you
        // stop, and is rate-limited so a sprint cannot carpet the arena in zones.
        const wh = this.rank('the-wild-hunt');
        if (wh >= 0 && this.wakeTimer <= 0) {
            const h = this.ctx.heroPos();
            const moved = Math.abs(h.x - this.lastHeroX) + Math.abs(h.z - this.lastHeroZ);
            if (moved > STEADY_MOVE_EPSILON) {
                this.wakeTimer = WILD_HUNT_WAKE_ICD_S;
                const scale = wh >= 2 ? 1 + WILD_HUNT_PER_POINT * this.wildHuntPoints : 1;
                const hc = this.zoneCrawl();
                this.ctx.zone(h.x, h.z, {
                    radius: WILD_HUNT_WAKE_RADIUS[wh],
                    durationS: WILD_HUNT_WAKE_DURATION_S[wh] + (hc ? hc.bonusDuration : 0),
                    tickDamage: WILD_HUNT_WAKE_DPS[wh] * scale * 0.5,
                    element: 'fire',
                    crawlToward: hc ? { x: h.x, z: h.z } : undefined,
                    crawlSpeed: hc ? hc.crawlSpeed : undefined,
                });
            }
            this.lastHeroX = h.x; this.lastHeroZ = h.z;
        }

        // ── Mage timers ──
        this.canticleCd = Math.max(0, this.canticleCd - dt);
        this.secondVoiceCd = Math.max(0, this.secondVoiceCd - dt);
        if (this.wellRelease > 0) {
            this.wellRelease -= dt;
            if (this.wellRelease <= 0 && this.liveWells > 0) this.liveWells--;
        }
        if (this.resonance > 0) {
            this.resonanceDecay -= dt;
            if (this.resonanceDecay <= 0) { this.resonance--; this.resonanceDecay = RESONANCE_DECAY_S; }
        }
        // The Long Winter: the aura IS the arena. Strictly 1 Hz — per frame at
        // wave 40 would be tens of thousands of status applications a second.
        const lw = this.rank('the-long-winter');
        if (lw >= 0) {
            this.winterTimer -= dt;
            if (this.winterTimer <= 0) {
                this.winterTimer = LONG_WINTER_INTERVAL_S;
                const stacks = LONG_WINTER_STACKS[lw];
                this.ctx.forEachEnemyAlive((e) => {
                    this.ctx.chill(e, LONG_WINTER_INTERVAL_S * 1.5, stacks);
                });
            }
        }

        // Standing Stone arms after N seconds without a MEANINGFUL hit.
        const stone = this.rank('standing-stone');
        if (stone >= 0 && !this.stoneArmed) {
            this.stoneTimer += dt;
            if (this.stoneTimer >= STANDING_STONE_ARM_S[stone]) {
                this.stoneArmed = true;
                const h = this.ctx.heroPos();
                this.ctx.ring(h.x, h.z, '#c9a23f', 1.6); // the "you are armed" tell
            }
        }

        // Crater Maker's second pulse. A countdown float, NOT a setTimeout — the
        // project pauses via animationsEnabled and a wall-clock timer would fire
        // through a pause and through exit().
        if (this.craterPulseTimer > 0) {
            this.craterPulseTimer -= dt;
            if (this.craterPulseTimer <= 0) {
                const cr = this.rank('crater-maker');
                const h = this.ctx.heroPos();
                const radius = CRATER_RADIUS[Math.max(0, cr)];
                const dmg = this.ctx.basicDamage() * CRATER_PULSE_DAMAGE_FRAC;
                this.ctx.ring(h.x, h.z, '#c9a23f', radius);
                this.ctx.forEachEnemyNear(h.x, h.z, radius, (e) => {
                    this.ctx.damage(e, dmg, 'physical');
                    // Negative force = pull INWARD, the signature of the 2nd pulse.
                    this.ctx.knockback(e, h.x, h.z, -CRATER_PULL_FORCE);
                });
            }
        }

        if (this.riteState.size === 0) return;
        // Decay the Blood Rite ICDs and prune dead/stale entries so the map can
        // never grow with the horde.
        for (const [enemy, entry] of this.riteState) {
            entry.cd -= dt;
            if (!enemy.isAlive()) this.riteState.delete(enemy);
        }
        if (this.riteState.size > BLOOD_RITE_MAP_CAP) {
            for (const [enemy, entry] of this.riteState) {
                if (entry.cd <= 0) this.riteState.delete(enemy);
                if (this.riteState.size <= BLOOD_RITE_MAP_CAP) break;
            }
        }
    }

    // ── Hooks ───────────────────────────────────────────────────────────────

    /**
     * Every basic-attack hit. NOTE this also fires once per enemy per Whirlwind
     * tick (whirlwind routes through applyAttackHitsInRadius) and again per
     * ricochet bounce, so everything here must be cheap and guarded.
     */
    public onBasicHit(enemy: AscEnemy, damage: number): void {
        if (!enemy.isAlive()) return;

        // Rending Winds / Wound Chemistry — Fragile stacks. Both apply one stack
        // per point; the underlying model accumulates them.
        const rw = this.rank('rending-winds');
        if (rw >= 0) {
            for (let i = 0; i <= rw; i++) this.ctx.fragile(enemy, RENDING_WINDS_DURATION_S[rw]);
        }
        const wc = this.rank('wound-chemistry');
        if (wc >= 0) {
            for (let i = 0; i <= wc; i++) this.ctx.fragile(enemy, WOUND_CHEMISTRY_DURATION_S[wc]);
        }

        // Open Veins — curse as a fraction of MAX HP, and heal a share of the
        // expected total (a flat estimate: the per-tick callback is host-only).
        const ov = this.rank('open-veins');
        if (ov >= 0) {
            const frac = OPEN_VEINS_FRAC[ov];
            const dur = OPEN_VEINS_DURATION_S[ov];
            this.ctx.curse(enemy, dur, frac);
            this.ctx.heal(enemy.getMaxHealth() * frac * dur * OPEN_VEINS_HEAL_SHARE);
        }

        // Ember Reservoir — bonus damage to burning targets.
        const er = this.rank('ember-reservoir');
        if (er >= 0 && this.ctx.hasStatus(enemy, 'burn')) {
            this.ctx.damage(enemy, damage * EMBER_BONUS[er], 'fire');
        }

        // Runeblooded r2+ — bonus vs ALREADY-STATUSED targets. Gated on the rank
        // BEFORE the four status probes, so an unowned node costs one compare.
        const rb = this.rank('runeblooded');
        if (rb >= 1) {
            if (this.ctx.hasStatus(enemy, 'burn') || this.ctx.hasStatus(enemy, 'curse')
                || this.ctx.hasStatus(enemy, 'chill') || this.ctx.hasStatus(enemy, 'fragile')) {
                this.ctx.damage(enemy, damage * RUNEBLOODED_STATUSED_BONUS[rb], 'physical');
            }
        }

        // Eye of the Storm — a share of every channel tick heals.
        const eye = this.rank('eye-of-the-storm');
        if (eye >= 0 && this.channelling) this.ctx.heal(damage * EYE_STORM_HEAL_SHARE);

        // Bloodthirst below 40% HP: heal the node's OWN lifesteal slice a second
        // time. HeroBasicAttack.applyHit already healed `dmg * lifestealPct` once,
        // of which this node contributed 0.03/point — so this doubles the node's
        // share and leaves equipment/RunItems lifesteal alone.
        const bt = this.p('bloodthirst');
        if (bt > 0 && this.ctx.heroHpFraction() < BLOODTHIRST_LOW_HP) {
            this.ctx.heal(damage * BLOODTHIRST_PER_POINT * bt);
        }

        // Tremorbound — shoved enemies take a slice of the hit again on landing.
        const tb = this.rank('tremorbound');
        if (tb >= 0) this.ctx.damage(enemy, damage * TREMOR_LANDING_FRAC[tb], 'physical');

        // ── Mage on-hit ──
        const rb2 = this.rank('rimebound');
        if (rb2 >= 0) this.ctx.chill(enemy, RIMEBOUND_DURATION_S[rb2], RIMEBOUND_STACKS[rb2]);
        const kc = this.rank('killing-cold');
        if (kc >= 0) {
            if (this.ctx.hasStatus(enemy, 'chill')) {
                this.ctx.damage(enemy, damage * KILLING_COLD_CHILL[kc], 'ice');
            }
        }
        const hmo = this.rank('the-hollow-mouth');
        if (hmo >= 0) {
            // The Hollow Star r2 scales curse with path points; the clamp is what
            // keeps a percent-of-max-HP drain from trivialising bosses.
            const scale = this.rank('the-hollow-star') >= 1
                ? 1 + HOLLOW_STAR_PER_POINT * this.hollowStarPoints : 1;
            const frac = Math.min(HOLLOW_STAR_CURSE_CLAMP, HOLLOW_MOUTH_FRAC[hmo] * scale);
            this.ctx.curse(enemy, HOLLOW_MOUTH_DURATION_S[hmo], frac);
            this.ctx.heal(enemy.getMaxHealth() * frac * HOLLOW_MOUTH_DURATION_S[hmo]
                * DEBT_HEAL_SHARE[Math.max(0, this.rank('the-debt'))]);
        }

        // ── Ranger on-hit ──
        const bs = this.rank('barbed-shafts');
        if (bs >= 0) {
            for (let i = 0; i <= bs; i++) this.ctx.fragile(enemy, BARBED_DURATION_S[bs]);
        }
        const hm = this.rank('hunters-mark');
        if (hm >= 0) {
            this.ctx.curse(enemy, HUNTERS_MARK_DURATION_S[hm], HUNTERS_MARK_FRAC[hm]);
            this.ctx.heal(enemy.getMaxHealth() * HUNTERS_MARK_FRAC[hm]
                * HUNTERS_MARK_DURATION_S[hm] * OPEN_VEINS_HEAL_SHARE);
        }
        const mk = this.rank('mark-of-the-moon');
        if (mk >= 0) this.ctx.damage(enemy, damage * MARK_BONUS[mk], 'arcane');
        const dr = this.rank('dread');
        if (dr >= 0 && this.ctx.hasStatus(enemy, 'curse')) {
            this.ctx.damage(enemy, damage * [0.20, 0.35, 0.55][dr], 'arcane');
        }
        // Widowmaker / Unmaking executes. ICD'd because onBasicHit fires per
        // ricochet bounce as well as per arrow.
        const wm = Math.max(this.rank('widowmaker'), this.rank('unmaking'));
        if (wm >= 0 && this.widowCd <= 0) {
            const max = enemy.getMaxHealth();
            if (max > 0 && enemy.getHealth() / max <= WIDOWMAKER_HP[wm]) {
                this.widowCd = WIDOWMAKER_ICD_S;
                this.ctx.damage(enemy, enemy.getHealth(), 'physical');
                if (wm >= 2) this.ctx.reduceAbilityCooldowns(WIDOWMAKER_REFUND_S);
            }
        }
        // The Thousand: each volley ratchets damage, hard-capped and decaying.
        const th = this.rank('the-thousand');
        if (th >= 2) {
            this.thousandRamp = Math.min(THOUSAND_RAMP_CAP,
                this.thousandRamp + THOUSAND_PER_ARROW[th] * 0.1);
            this.thousandDecay = THOUSAND_DECAY_S;
        }

        this.bloodRite(enemy);
    }

    /**
     * The Blood Rite capstone: every Nth hit on the SAME enemy consumes its rich
     * statuses and detonates. Guarded by a per-enemy ICD *and* a re-entrancy
     * flag — the detonation deals damage, which can re-enter onBasicHit.
     */
    private bloodRite(enemy: AscEnemy): void {
        const r = this.rank('the-blood-rite');
        if (r < 0 || this.inDetonate) return;

        let entry = this.riteState.get(enemy);
        if (!entry) { entry = { hits: 0, cd: 0 }; this.riteState.set(enemy, entry); }
        entry.hits++;
        if (entry.hits < BLOOD_RITE_EVERY_HITS[r] || entry.cd > 0) return;

        entry.hits = 0;
        entry.cd = BLOOD_RITE_ICD_S;

        const burnBurst = this.ctx.detonateStatus(enemy, 'burn');
        const pos = enemy.getPosition();
        const radius = BLOOD_RITE_RADIUS[r];
        const total = burnBurst * BLOOD_RITE_BURN_MULT
            + enemy.getMaxHealth() * BLOOD_RITE_MAX_HP_FRAC;

        this.inDetonate = true;
        this.ctx.ring(pos.x, pos.z, '#c8302a', radius);
        this.ctx.forEachEnemyNear(pos.x, pos.z, radius, (e) => {
            this.ctx.damage(e, total, 'arcane');
        });
        this.inDetonate = false;
    }

    /**
     * Once per SWING — one melee wave, one projectile volley, or one Whirlwind
     * tick. The swing counter IS the internal cooldown: a single integer, no map.
     */
    public onSwing(x: number, z: number): void {
        const r = this.rank('aftershock');
        if (r < 0) return;
        this.swings++;
        if (this.swings < AFTERSHOCK_EVERY[r]) return;
        this.swings = 0;

        const dmg = this.ctx.basicDamage() * AFTERSHOCK_DAMAGE_FRAC[r];
        // The Runeblooded rider makes the shockwave carry your enchantments, but
        // enchantment dispatch is expensive (Shock Chain alone runs nearest-enemy
        // scans per target), so it is capped.
        const enchant = this.rank('runeblooded') >= 0;
        let enchanted = 0;
        this.ctx.ring(x, z, '#c9a23f', AFTERSHOCK_RADIUS);
        this.ctx.forEachEnemyNear(x, z, AFTERSHOCK_RADIUS, (e) => {
            this.ctx.damage(e, dmg, 'physical');
            if (r >= 2) this.ctx.knockback(e, x, z, AFTERSHOCK_KNOCK);
            if (enchant && enchanted < AFTERSHOCK_ENCHANT_CAP) {
                enchanted++;
                this.ctx.applyEnchantments(e);
            }
        });
        // Stormbound's rider: the shockwave also advances its kill counter.
        if (this.rank('stormbound') >= 0) this.stormboundKills++;
    }

    /**
     * A NON-echo channel ended. AbilityManager suppresses this for echo effects,
     * so the chain is broken structurally; `inEcho` is a second belt-and-braces
     * layer in case a future caller ever fires this synchronously.
     */
    public onChannelEnd(abilityId: string): void {
        if (abilityId !== 'whirlwind' || this.inEcho) return;
        const r = this.rank('bladestorm-echo');
        if (r < 0) return;
        this.inEcho = true;
        try {
            this.ctx.castFreeWhirlwind(ECHO_DURATION_S[r], ECHO_RADIUS_MULT);
            if (r >= 2) this.ctx.castFreeSmash(ECHO_SMASH_MULT);
        } finally {
            this.inEcho = false;
        }
    }

    /** Every enemy death. */
    public onKill(x: number, z: number): void {
        // Eye of the Maelstrom — kills inside the radius extend the channel
        // ASYMPTOTICALLY. The (1 - ext/ceiling) factor IS the throttle: `add`
        // decays to 0 as ext approaches the ceiling, so a 40-kill Whirlwind tick
        // cannot run away. A hard cap backs it up independently.
        const ms = this.rank('eye-of-the-maelstrom');
        if (ms >= 0 && this.channelling) {
            const hero = this.ctx.heroPos();
            const galeR = this.rank('gale-force');
            const radius = galeR >= 0 ? GALE_WW_RADIUS[galeR] : 7;
            const dx = x - hero.x, dz = z - hero.z;
            if (dx * dx + dz * dz <= radius * radius) {
                const ceiling = MAELSTROM_CEILING_S[ms];
                const add = MAELSTROM_PER_KILL_S * (1 - this.maelstromExt / ceiling);
                if (add > 0) {
                    const projected = this.ctx.abilityTimeLeft('whirlwind') + add;
                    const hurR = this.rank('hurricane-heart');
                    const baseDur = hurR >= 0 ? HURRICANE_DURATION_S[hurR] : 5;
                    if (projected <= Math.min(MAELSTROM_HARD_MAX_S, baseDur + ceiling)) {
                        this.maelstromExt += add;
                        this.ctx.extendAbility('whirlwind', add);
                    }
                }
            }
        }

        // The Shattering: chilled/frozen kills detonate. Chains are hard-capped
        // and guarded, since the detonation itself can kill.
        const sh = this.rank('the-shattering');
        if (sh >= 0 && !this.inShatter) {
            this.inShatter = true;
            let links = 0;
            const dmg = this.ctx.basicDamage() * SHATTERING_DAMAGE[sh];
            this.ctx.ring(x, z, '#30cfff', SHATTERING_RADIUS[sh]);
            this.ctx.forEachEnemyNear(x, z, SHATTERING_RADIUS[sh], (e) => {
                if (links++ >= SHATTERING_MAX_LINKS * 4) return;
                this.ctx.damage(e, dmg, 'ice');
                this.ctx.chill(e, 4, 2);
            });
            this.inShatter = false;
        }
        // Storm-Born: kills refund a slice of every cooldown.
        const sbn = this.rank('storm-born');
        if (sbn >= 0) this.ctx.reduceAbilityCooldowns(STORMBORN_REFUND_PCT[sbn] * 10);
        // Collapse: every Nth kill opens a gravity well, hard-capped.
        const cl = this.rank('collapse');
        if (cl >= 0) {
            this.collapseKills++;
            if (this.collapseKills >= COLLAPSE_EVERY[cl] && this.liveWells < COLLAPSE_MAX_WELLS) {
                this.collapseKills = 0;
                this.liveWells++;
                const hc2 = this.zoneCrawl();
                this.ctx.zone(x, z, {
                    radius: COLLAPSE_RADIUS,
                    durationS: 3 + (hc2 ? hc2.bonusDuration : 0),
                    tickDamage: this.ctx.basicDamage() * 0.3, element: 'arcane',
                    crawlSpeed: hc2 ? hc2.crawlSpeed : undefined,
                });
                // The cap is released on a timer rather than tracked per zone.
                this.wellRelease = 3;
            }
        }

        // Hail of Steel: an arrow kill may loose a free arrow. The ICD is what
        // stops a chain reaction across a dying pack.
        const hs = this.rank('hail-of-steel');
        if (hs >= 0 && this.hailCd <= 0 && this.ctx.rng() < HAIL_CHANCE[hs]) {
            this.hailCd = HAIL_ICD_S;
            this.ctx.ring(x, z, '#e0e0e0', 1.4);
            this.ctx.forEachEnemyNear(x, z, 6, (e) => {
                this.ctx.damage(e, this.ctx.basicDamage(), 'physical');
            });
        }
        // Withering: a cursed death spreads its curse.
        const wi = this.rank('withering');
        if (wi >= 0) {
            const hmR = Math.max(0, this.rank('hunters-mark'));
            this.ctx.forEachEnemyNear(x, z, WITHERING_RADIUS[wi], (e) => {
                this.ctx.curse(e, HUNTERS_MARK_DURATION_S[hmR], HUNTERS_MARK_FRAC[hmR]);
            });
        }

        // Unending Fury r3 adds a further refund on top of the base per-kill one.
        const uf = this.rank('unending-fury');
        if (uf >= 0 && FURY_EXTRA_REFUND_S[uf] > 0) {
            this.ctx.reduceAbilityCooldowns(FURY_EXTRA_REFUND_S[uf]);
        }

        const sb = this.rank('stormbound');
        if (sb >= 0) {
            this.stormboundKills++;
            if (this.stormboundKills >= STORMBOUND_KILLS[sb]) {
                this.stormboundKills = 0;
                this.ctx.reduceAbilityCooldowns(STORMBOUND_REFUND_S[sb]);
                const h = this.ctx.heroPos();
                this.ctx.ring(h.x, h.z, '#ffe040', 3);
            }
        }
        // Ember Reservoir rank 3: burning kills detonate their remaining burn.
        if (this.rank('ember-reservoir') >= 2) {
            this.ctx.ring(x, z, '#ff6030', EMBER_DETONATE_RADIUS);
        }
    }

    /** Dash landing (fires from the dash override's onComplete). */
    public onDashLand(x: number, z: number): void {
        this.briarOnDash(x, z);
        // Skirmisher's Grace / Untethered share the post-dash window.
        const g = this.rank('skirmishers-grace');
        if (g >= 0) this.graceTimer = GRACE_WINDOW_S[g];
        const ut = this.rank('untethered');
        if (ut >= 0) this.graceTimer = Math.max(this.graceTimer, UNTETHERED_WINDOW_S[ut]);
        // Blinkstorm detonates where the mage lands.
        const bl = this.rank('blinkstorm');
        if (bl >= 0) {
            const dmg = this.ctx.basicDamage() * BLINKSTORM_DETONATE[bl];
            this.ctx.ring(x, z, '#ffe040', BLINKSTORM_RADIUS[bl]);
            this.ctx.forEachEnemyNear(x, z, BLINKSTORM_RADIUS[bl], (e) => {
                this.ctx.damage(e, dmg, 'storm');
            });
        }
        // Both classes' Bodycheck share one implementation.
        const r = Math.max(this.rank('bodycheck-bar'), this.rank('bodycheck-rng'));
        if (r < 0) return;
        const radius = BODYCHECK_RADIUS[r];
        const dmg = this.ctx.basicDamage() * BODYCHECK_FRAC[r];
        this.ctx.ring(x, z, '#c9a23f', radius);
        this.ctx.forEachEnemyNear(x, z, radius, (e) => {
            this.ctx.damage(e, dmg, 'physical');
            if (r >= 2) {
                this.ctx.fragile(e, 5);
                this.ctx.knockback(e, x, z, BODYCHECK_KNOCK);
            }
        });
    }

    /** Briar Trail lays a crawling strip where the dash lands. */
    private briarOnDash(x: number, z: number): void {
        const r = this.rank('briar-trail');
        if (r < 0) return;
        this.ctx.zone(x, z, {
            radius: BRIAR_RADIUS,
            durationS: BRIAR_DURATION_S[r],
            tickDamage: BRIAR_DPS[r] * 0.5,
            element: 'fire',
            crawlToward: { x, z },
            crawlSpeed: 2,
        });
    }

    /** An ultimate was activated. */
    public onUltActivate(abilityId: string): void {
        if (abilityId === 'whirlwind') {
            // A fresh channel starts a fresh extension budget.
            this.maelstromExt = 0;
            return;
        }
        if (abilityId !== 'smash') return;

        // Crater Maker r3: arm the inward-pulling second pulse.
        if (this.rank('crater-maker') >= 2) this.craterPulseTimer = CRATER_PULSE_DELAY_S;

        // Runeblooded r3: enchantments also fire on the first enemy Smash hits.
        if (this.rank('runeblooded') >= 2) {
            const h = this.ctx.heroPos();
            let done = false;
            this.ctx.forEachEnemyNear(h.x, h.z, 10, (e) => {
                if (done) return;
                done = true;
                this.ctx.applyEnchantments(e);
            });
        }

        const r = this.rank('fault-line');
        if (r < 0) return;
        const h = this.ctx.heroPos();
        // The fissure crawls toward the hero, so it stays relevant as the fight moves.
        this.ctx.zone(h.x, h.z, {
            radius: FAULT_LINE_RADIUS,
            durationS: FAULT_LINE_DURATION_S[r],
            tickDamage: FAULT_LINE_DPS[r] * 0.5, // tickIntervalS defaults to 0.5s
            element: 'fire',
            crawlToward: { x: h.x, z: h.z },
            crawlSpeed: FAULT_LINE_CRAWL,
        });
    }
}
