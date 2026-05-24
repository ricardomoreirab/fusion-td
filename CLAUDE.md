# KTG — Kill the Goblins — Claude Code Project Notes

## Project summary

Vampire Survivors-style action game built with BabylonJS + TypeScript. Single hero, 4 power slots, wave-based, open circular arena. No test suite.

## Build commands

```bash
npm run build      # webpack production build → dist/
npx tsc --noEmit   # type-check only (trust this; not the IDE)
npm start          # dev server at localhost:9000
```

## Architecture

### Entry & state machine
- `src/game/Game.ts` — engine init, registers states (`menu`, `survivors`, `gameOver`).
- `src/game/managers/StateManager.ts` — `changeState()`, `getState()`, `registerState()`.

### Core game states
- `src/game/states/MenuState.ts` — main menu; "Play" button routes to `survivors`.
- `src/game/states/SurvivorsGameplayState.ts` — **primary game loop**; `enter()` shows champion select then calls `startRun(type)`. Orchestrates all systems. ~600 lines.
- `src/game/states/GameOverState.ts` — death screen; survivors path passes `SurvivorsRunSummary` via `setSurvivorsSummary()`.

### Hero systems
- `src/game/gameplay/Champion.ts` — hero mesh + animation + spin/attack FX. `controlMode: 'ai' | 'player'`. `setPlayerVelocity()`, `getPosition()`.
- `src/game/gameplay/champions/BarbarianBuilder.ts` — barbarian mesh construction (extracted from Champion.ts during the berserker refinement). Returns `BarbarianMeshParts`.
- `src/game/gameplay/HeroController.ts` — WASD + joystick input, top-down follow camera, basic auto-attack, HP tracking, death callback.
- `src/game/gameplay/HeroBasicAttack.ts` — projectile spawning for the hero's basic attack.

### Enemy systems
- `src/game/gameplay/EnemyManager.ts` — enemy lifecycle, `configureSurvivorsMode()`, `spawnSurvivorsEnemy()`, `setOnEliteDeath()`.
- `src/game/gameplay/enemies/Enemy.ts` — base enemy class. `seekTarget` field drives survivors-mode seek-hero AI. `contactDamagePerSecond`, `isElite`, `eliteDropElement`.
- Concrete enemies: `BasicEnemy`, `FastEnemy`, `TankEnemy`, `BossEnemy`, `SplittingEnemy`, `HealerEnemy`, `ShieldEnemy`, `MiniEnemy`.
- `src/game/gameplay/EliteSpawner.ts` — applies elite visual treatment (1.4× scale, emissive outline).

### Wave & economy
- `src/game/gameplay/WaveManager.ts` — wave scheduling; `setSpawnFn()` overrides spawn logic for survivors mode; `setOnWaveCleared()` triggers shop.
- `src/game/gameplay/PlayerStats.ts` — gold (`addGold/spendGold`), HP, shop multipliers (`powerDamageMultiplier`, `powerCooldownMultiplier`, `moveSpeedMultiplier`, `pickupRadiusMultiplier`, `damageReductionMultiplier`).

### Power system
- `src/game/gameplay/PowerSlotManager.ts` — 4 slots, cooldowns, auto-fire orchestration.
- `src/game/gameplay/powers/PowerDefinitions.ts` — 6 powers: Fireball (fire), Frost Shards (ice), Arcane Nova (arcane), Piercing Arrow (physical), Whirling Blades (physical), Lightning Chain (storm).
- `src/game/gameplay/PowerDrop.ts` — orb entity: spawn, magnet, pickup flash, `onPickup` callback.

### Manual ultimates
- `src/game/gameplay/AbilityManager.ts` — Meteor Strike (45s, click-to-target), Frost Nova (30s, instant). `triggerFrostNova()`, `triggerMeteorAtNearest()`. Constructed with `(game, enemyManager)`.

### UI modules
- `src/game/ui/HeroHud.ts` — HP bar, gold, 4 power-slot icons with cooldown sweeps, 2 ultimate buttons, low-HP red vignette pulse. `update(hp, gold, slots, deltaTime)`.
- `src/game/ui/ChampionSelectOverlay.ts` — 3-card champion picker.
- `src/game/ui/PowerChoiceOverlay.ts` — 3-card slow-mo orb pickup choice.
- `src/game/ui/ReplaceSlotOverlay.ts` — secondary slot-replacement prompt.
- `src/game/ui/BetweenWaveShopOverlay.ts` — 6-item between-wave shop.
- `src/game/ui/EliteIndicators.ts` — off-screen elite arrow indicators.
- `src/game/ui/SurvivorsJoystick.ts` — virtual joystick (mobile).

### Rendering helpers
- `src/game/rendering/StyleConstants.ts` — PALETTE color constants (Color3/Color4).
- `src/game/rendering/LowPolyMaterial.ts` — `createLowPolyMaterial`, `createEmissiveMaterial`, `makeFlatShaded`.

### Shared types
- `src/game/gameplay/GameTypes.ts` — `ElementType`, `EnemyType`, `StatusEffect` enums. Formerly in `towers/Tower.ts` (deleted).

## Deleted in Phase 5 (tower-placement era)

The following were removed when the game was redesigned from tower-defense to survivors:
- `src/game/states/GameplayState.ts`
- `src/game/gameplay/TowerManager.ts`
- `src/game/gameplay/towers/Tower.ts` (enums moved to `GameTypes.ts`)
- `src/game/gameplay/towers/TowerDefinitions.ts`
- `src/game/gameplay/towers/MedievalTowerDefs.ts`
- `src/game/gameplay/towers/ElementalTowerDefs.ts`
- `src/game/gameplay/towers/UpgradeTree.ts`
- `src/game/gameplay/towers/TowerVisualBuilder.ts`
- `src/game/gameplay/towers/abilities/TowerAbilitySystem.ts`
- `src/game/gameplay/towers/abilities/TowerAbility.ts`
- `src/game/ui/TowerPreviewRenderer.ts`

## Balance (current)

- Sell-back: **60%** of total cost.
- Upgrade stat multipliers: damage ×1.5, range ×1.25, fireRate ×1.15 (diminishing returns).
- Contact DPS: Basic 8/s, Fast 5/s, Tank 20/s, Boss 30/s.
- Slow cap: 80% max (speed never below 0.2× original).
- Freeze immunity: 3s after freeze ends. Stun immunity: 5s after stun ends.
- Power damage scaling: ×1.25 per level; cooldown: ×0.92 per level.

## Key design invariants

- All game state lives in `SurvivorsGameplayState`; it is fully reset on `exit()`.
- The `AdvancedDynamicTexture` (`this.ui`) is created in `enter()` and disposed in `exit()`.
- `startRun(championType)` is called AFTER the champion select; no gameplay objects exist before that.
- `GameOverState.setSurvivorsSummary(summary)` must be called BEFORE `changeState('gameOver')`.
- The `AbilityManager` for Fortify now heals the hero instead of boosting towers (towers are gone).
