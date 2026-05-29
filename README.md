# KTG — Kill the Goblins

A single-hero wave-survival arena game built with Babylon.js and TypeScript, inspired by Vampire Survivors. Pick a champion, fight off escalating goblin hordes in a circular arena, collect elemental power orbs, and spend gold between waves on upgrades.

## Core Gameplay

- **Champion select** before each run — Barbarian (melee axe), Ranger (elemental arrows), or Mage (magic spells). Each plays differently.
- **Single hero**, player-controlled via WASD (desktop) or virtual joystick (mobile).
- **Class-specific basic attack** — Barbarian: 360° axe spin; Ranger: arrow projectile; Mage: magic bolt.
- **4 power slots** — equip elemental powers. Mage spells and Ranger arrows auto-fire on cooldown; Barbarian enchantments are passive modifiers on every axe swing.
- **5 elements × 3 classes = 15 distinct powers**. Fire / Ice / Arcane / Physical / Storm, themed per class (e.g., fire = Fireball for Mage, Fire Arrow for Ranger, Flaming Edge enchant for Barbarian).
- **Element decorations** appear on the hero's weapon when equipped — flames around the axe, ice crystals on the bow, lightning on the staff orb.
- **Elite enemies** drop element-tagged power orbs on death, triggering a 3-card pause-time choice overlay.
- **Between-wave shop** — spend gold on Vitality, Swiftness, Reach, Power, Haste, Bulwark, or Quickness upgrades.
- **Class-specific manual ultimates** — Barbarian: Whirlwind + Smash. Ranger: Volley + Explosive Arrow. Mage: Meteor Strike + Frost Nova.
- Run ends when the hero dies. High score tracked via localStorage.

## Enemy Types

| Name | Notes |
|---|---|
| Basic (Goblin) | Standard melee enemy |
| Fast (Wraith) | High-speed, low HP, flying |
| Tank (Beetle) | Slow, heavy, high HP |
| Boss | Massive, high resist; appears every 10 waves |
| Splitting (Hydra) | Splits into 3 MiniEnemies on death |
| Healer (Shaman) | Heals nearby enemies |
| Shield (Paladin) | 30 HP regenerating shield |

## Controls

| Platform | Action | Control |
|---|---|---|
| Desktop | Move | WASD |
| Desktop | Pause | Space |
| Desktop | Meteor Strike | HUD button (M) |
| Desktop | Frost Nova | HUD button (F) |
| Mobile | Move | Virtual joystick (bottom-left) |
| Mobile | Meteor / Frost Nova | HUD buttons |

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

```bash
git clone https://github.com/yourusername/ktg.git
cd ktg
npm install
```

## Development

```bash
npm start
```

Starts a dev server at http://localhost:9000 with hot reloading.

## Building for Production

```bash
npm run build
```

Output goes to the `dist/` directory.

## Deploying to Cloudflare

The static build (`dist/`) plus the leaderboard Worker (`worker/index.ts`) deploy together via Wrangler:

```bash
npx wrangler login   # first time only
npm run deploy       # builds dist/ then runs `wrangler deploy`
```

`npm run preview` (`wrangler dev`) serves the assets + Worker + a local D1 database for end-to-end testing. The leaderboard's D1 schema lives in `worker/schema.sql`; apply it with `wrangler d1 execute fusion-td-leaderboard --remote --file=worker/schema.sql`.

## Project Structure

```
src/game/
  states/
    MenuState.ts              — main menu
    SurvivorsGameplayState.ts — core game loop (champion select → run → death)
    GameOverState.ts          — shows run summary (wave, kills, time, loadout)
  gameplay/
    HeroController.ts         — WASD/joystick input, follow camera, basic attack, HP
    Champion.ts               — hero mesh + animations (controlMode: 'ai'|'player')
    EnemyManager.ts           — enemy lifecycle, survivors-mode perimeter spawn
    WaveManager.ts            — wave scheduling, wave-cleared callback
    PlayerStats.ts            — gold, HP, shop stat multipliers
    PowerSlotManager.ts       — 4-slot power tracking, cooldowns, auto-fire
    PowerDrop.ts              — elemental orb: spawn, magnet, pickup
    EliteSpawner.ts           — elite visual treatment (scale, emissive, aura)
    AbilityManager.ts         — Meteor Strike + Frost Nova manual ultimates
    GameTypes.ts              — shared ElementType / EnemyType / StatusEffect enums
    enemies/                  — BasicEnemy, FastEnemy, TankEnemy, BossEnemy,
                                SplittingEnemy, HealerEnemy, ShieldEnemy, MiniEnemy
    powers/
      PowerDefinitions.ts     — catalog of 6 powers with per-level scaling
  ui/
    HeroHud.ts                — HP bar, gold, 4 slot icons with cooldown sweeps,
                                ultimate buttons, low-HP vignette
    ChampionSelectOverlay.ts  — 3-card champion picker at run start
    PowerChoiceOverlay.ts     — 3-card slow-mo overlay on orb pickup
    ReplaceSlotOverlay.ts     — secondary prompt when swapping a full slot
    BetweenWaveShopOverlay.ts — 6-item shop between waves
    EliteIndicators.ts        — off-screen elite direction arrows
    SurvivorsJoystick.ts      — virtual joystick for mobile
  rendering/
    StyleConstants.ts         — PALETTE color constants
    LowPolyMaterial.ts        — createLowPolyMaterial / createEmissiveMaterial helpers
  managers/
    StateManager.ts           — game-state machine
    AssetManager.ts           — asset loading
```

## Technologies

- [Babylon.js](https://www.babylonjs.com/) — 3D engine + GUI
- [TypeScript](https://www.typescriptlang.org/)
- [Webpack](https://webpack.js.org/)

## License

MIT License — see LICENSE for details.
