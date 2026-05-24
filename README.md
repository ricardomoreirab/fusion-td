# Fusion TD - Vampire Survivors Style Arena Game

A single-hero wave-survival game built with Babylon.js and TypeScript, inspired by Vampire Survivors. Pick a champion, fight off endless waves of enemies in a circular arena, collect elemental power orbs, and spend gold between waves on stat upgrades.

## Core Gameplay

- **Champion select** before each run — choose from Knight, Ranger, or Mage, each with unique stats and a starting power.
- **Single hero**, player-controlled via WASD or virtual joystick (mobile).
- **Auto-attack** fires continuously at the nearest enemy.
- **4 power slots** — equip elemental powers that auto-fire on cooldown. Powers level up when you collect duplicate orbs.
- **Elemental powers**: Fireball (Fire), Frost Shards (Ice), Arcane Nova (Arcane), Piercing Arrow (Physical), Whirling Blades (Physical), Lightning Chain (Storm).
- **Elite enemies** drop element-tagged power orbs on death, triggering a 3-card slow-motion choice overlay.
- **Between-wave shop** — spend gold on Vitality, Swiftness, Magnetism, Power, Haste, or Bulwark upgrades.
- **Manual ultimates** — Meteor Strike (45s cooldown) and Frost Nova (30s cooldown), shown in the HUD.
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
git clone https://github.com/yourusername/fusion-td.git
cd fusion-td
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

## Deploying to Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

Or connect the GitHub repository to Vercel for automatic deployments.

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
