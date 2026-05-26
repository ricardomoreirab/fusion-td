#!/usr/bin/env python3
"""
One-shot restructure script — moves files into the new layout proposed in
HANDOFF.md and rewrites every relative import to point at the new locations.

Run from repo root: `python3 scripts/restructure.py`

This script is destructive (uses `git mv`). Run on a clean working tree.
"""

from __future__ import annotations
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# (src_relative_to_repo, dst_relative_to_repo)
MOVES: list[tuple[str, str]] = [
    # ── engine: cross-mode infrastructure ────────────────────────────────────
    ('src/game/Game.ts',                          'src/engine/Game.ts'),
    ('src/game/managers/AssetManager.ts',         'src/engine/AssetManager.ts'),
    ('src/game/managers/StateManager.ts',         'src/engine/StateManager.ts'),
    ('src/game/states/GameState.ts',              'src/engine/GameState.ts'),
    ('src/game/rendering/LowPolyMaterial.ts',     'src/engine/rendering/LowPolyMaterial.ts'),
    ('src/game/rendering/MaterialCache.ts',       'src/engine/rendering/MaterialCache.ts'),
    ('src/game/rendering/ProceduralGrass.ts',     'src/engine/rendering/ProceduralGrass.ts'),
    ('src/game/rendering/ProceduralGrassTexture.ts', 'src/engine/rendering/ProceduralGrassTexture.ts'),
    ('src/game/rendering/StyleConstants.ts',      'src/engine/rendering/StyleConstants.ts'),
    ('src/game/rendering/ProjectilePool.ts',      'src/engine/rendering/ProjectilePool.ts'),

    # ── survivors: mode-specific ─────────────────────────────────────────────
    ('src/game/states/SurvivorsGameplayState.ts', 'src/survivors/SurvivorsGameplayState.ts'),
    ('src/game/gameplay/Map.ts',                  'src/survivors/Map.ts'),
    ('src/game/gameplay/LevelConfig.ts',          'src/survivors/LevelConfig.ts'),
    ('src/game/gameplay/HeroController.ts',       'src/survivors/HeroController.ts'),
    ('src/game/gameplay/PlayerStats.ts',          'src/survivors/PlayerStats.ts'),
    ('src/game/gameplay/RunItems.ts',             'src/survivors/RunItems.ts'),
    ('src/game/gameplay/WaveManager.ts',          'src/survivors/WaveManager.ts'),
    ('src/game/gameplay/DamageNumberManager.ts',  'src/survivors/DamageNumberManager.ts'),
    ('src/game/gameplay/GameTypes.ts',            'src/survivors/GameTypes.ts'),
    ('src/game/gameplay/ItemDrop.ts',             'src/survivors/ItemDrop.ts'),
    ('src/game/gameplay/WaveStatus.ts',           'src/survivors/WaveStatus.ts'),

    # powers
    ('src/game/gameplay/PowerSlotManager.ts',     'src/survivors/powers/PowerSlotManager.ts'),
    ('src/game/gameplay/powers/PowerDefinitions.ts', 'src/survivors/powers/PowerDefinitions.ts'),
    ('src/game/gameplay/PowerDrop.ts',            'src/survivors/powers/PowerDrop.ts'),

    # abilities
    ('src/game/gameplay/AbilityManager.ts',       'src/survivors/abilities/AbilityManager.ts'),

    # champions
    ('src/game/gameplay/Champion.ts',             'src/survivors/champions/Champion.ts'),
    ('src/game/gameplay/champions/BarbarianBuilder.ts', 'src/survivors/champions/BarbarianBuilder.ts'),
    ('src/game/gameplay/HeroBasicAttack.ts',      'src/survivors/champions/HeroBasicAttack.ts'),

    # enemies
    ('src/game/gameplay/EnemyManager.ts',         'src/survivors/enemies/EnemyManager.ts'),
    ('src/game/gameplay/EliteSpawner.ts',         'src/survivors/enemies/EliteSpawner.ts'),
    ('src/game/gameplay/enemies/BasicEnemy.ts',   'src/survivors/enemies/BasicEnemy.ts'),
    ('src/game/gameplay/enemies/BossEnemy.ts',    'src/survivors/enemies/BossEnemy.ts'),
    ('src/game/gameplay/enemies/Enemy.ts',        'src/survivors/enemies/Enemy.ts'),
    ('src/game/gameplay/enemies/FastEnemy.ts',    'src/survivors/enemies/FastEnemy.ts'),
    ('src/game/gameplay/enemies/HealerEnemy.ts',  'src/survivors/enemies/HealerEnemy.ts'),
    ('src/game/gameplay/enemies/MilestoneBoss.ts','src/survivors/enemies/MilestoneBoss.ts'),
    ('src/game/gameplay/enemies/MiniEnemy.ts',    'src/survivors/enemies/MiniEnemy.ts'),
    ('src/game/gameplay/enemies/ShieldEnemy.ts',  'src/survivors/enemies/ShieldEnemy.ts'),
    ('src/game/gameplay/enemies/SplittingEnemy.ts','src/survivors/enemies/SplittingEnemy.ts'),
    ('src/game/gameplay/enemies/TankEnemy.ts',    'src/survivors/enemies/TankEnemy.ts'),

    # survivors-specific UI
    ('src/game/ui/HeroHud.ts',                    'src/survivors/ui/HeroHud.ts'),
    ('src/game/ui/ChampionSelectOverlay.ts',      'src/survivors/ui/ChampionSelectOverlay.ts'),
    ('src/game/ui/PowerChoiceOverlay.ts',         'src/survivors/ui/PowerChoiceOverlay.ts'),
    ('src/game/ui/ReplaceSlotOverlay.ts',         'src/survivors/ui/ReplaceSlotOverlay.ts'),
    ('src/game/ui/BetweenWaveShopOverlay.ts',     'src/survivors/ui/BetweenWaveShopOverlay.ts'),
    ('src/game/ui/EliteIndicators.ts',            'src/survivors/ui/EliteIndicators.ts'),
    ('src/game/ui/SurvivorsJoystick.ts',          'src/survivors/ui/SurvivorsJoystick.ts'),

    # ── menu ─────────────────────────────────────────────────────────────────
    ('src/game/states/MenuState.ts',              'src/menu/MenuState.ts'),

    # ── game-over ────────────────────────────────────────────────────────────
    ('src/game/states/GameOverState.ts',          'src/game-over/GameOverState.ts'),

    # ── shared/ui ────────────────────────────────────────────────────────────
    ('src/game/ui/HudStyle.ts',                   'src/shared/ui/HudStyle.ts'),
    ('src/game/ui/responsive.ts',                 'src/shared/ui/responsive.ts'),
    ('src/game/ui/PauseScreen.ts',                'src/shared/ui/PauseScreen.ts'),
]


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO_ROOT, check=True, **kwargs)


def preflight():
    """Ensure clean working tree and that every source exists exactly once."""
    out = subprocess.run(
        ['git', 'status', '--porcelain'], cwd=REPO_ROOT,
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    # Allow untracked-only state (e.g. this very script in scripts/ is untracked).
    # Reject any staged or unstaged modifications under src/.
    bad_lines = [l for l in out.splitlines() if not l.startswith('??') and 'src/' in l]
    if bad_lines:
        print('Working tree has src/ modifications. Commit or stash first.', file=sys.stderr)
        for b in bad_lines:
            print(' ', b, file=sys.stderr)
        sys.exit(1)

    missing = [src for src, _ in MOVES if not (REPO_ROOT / src).exists()]
    if missing:
        print('Missing source files:', file=sys.stderr)
        for m in missing:
            print(f'  - {m}', file=sys.stderr)
        sys.exit(1)

    # Detect overlap (two sources targeting same destination)
    targets: dict[str, str] = {}
    for src, dst in MOVES:
        if dst in targets:
            print(f'DUPLICATE TARGET: {targets[dst]} and {src} both map to {dst}',
                  file=sys.stderr)
            sys.exit(1)
        targets[dst] = src


def move_files():
    """git mv every source → destination, creating parent dirs first."""
    for src, dst in MOVES:
        dst_path = REPO_ROOT / dst
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        run(['git', 'mv', src, dst])
        print(f'  moved  {src}  →  {dst}')


# ─── Import rewriting ─────────────────────────────────────────────────────────
# We resolve each `from '...'` / `import('...')` to an absolute repo path,
# look up the moved-to path, and rebuild a relative import from the NEW
# location of the importer.

# Matches: from 'X', from "X", import('X'), import("X")
IMPORT_PATTERN = re.compile(r"""(\bfrom\s+|import\s*\(\s*)(['"])([^'"]+)\2""")


def build_move_map() -> dict[str, str]:
    """Map absolute old-path → absolute new-path (both without .ts ext)."""
    m: dict[str, str] = {}
    for src, dst in MOVES:
        old_abs = str((REPO_ROOT / src).resolve()).removesuffix('.ts')
        new_abs = str((REPO_ROOT / dst).resolve()).removesuffix('.ts')
        m[old_abs] = new_abs
    return m


def resolve_import_existing(importer_dir: Path, spec: str) -> Path | None:
    """Resolve a relative import to a file that currently exists on disk."""
    if not spec.startswith('.'):
        return None
    candidate_base = (importer_dir / spec).resolve()
    for cand in (candidate_base.with_suffix('.ts'), candidate_base / 'index.ts'):
        if cand.exists():
            return cand
    return None


def resolve_import_candidate(importer_dir: Path, spec: str) -> Path | None:
    """Resolve a relative import to its theoretical .ts path WITHOUT checking
       existence. Used to look targets up in the move map when the file no
       longer exists at the old location."""
    if not spec.startswith('.'):
        return None
    candidate = (importer_dir / spec).resolve()
    return candidate.with_suffix('.ts')


def make_relative(importer_path: Path, target_path: Path) -> str:
    """Build a './...'/'../...' relative path (no .ts extension)."""
    rel = os.path.relpath(target_path, importer_path.parent)
    rel = rel.removesuffix('.ts')
    # Convert any backslashes (Windows) to forward slashes
    rel = rel.replace(os.sep, '/')
    # Ensure it starts with './' or '../'
    if not rel.startswith('.'):
        rel = './' + rel
    return rel


def rewrite_imports():
    """Walk every .ts file (in its NEW location) and rewrite relative imports."""
    move_map = build_move_map()  # abs_old → abs_new (no .ts)
    abs_to_new: dict[str, str] = {}
    for old_abs, new_abs in move_map.items():
        # Also record the inverse: from any importer, an import that USED to
        # resolve to `old_abs` should now resolve to `new_abs`.
        abs_to_new[old_abs] = new_abs

    # Collect every .ts file under src/ AND under tests/.
    ts_files: list[Path] = []
    for root in ('src', 'tests'):
        for p in (REPO_ROOT / root).rglob('*.ts'):
            ts_files.append(p)

    changed_files = 0
    changed_lines = 0
    for f in ts_files:
        original = f.read_text(encoding='utf-8')
        importer_dir = f.parent

        # For each import in this file, resolve → look up in move_map → rewrite.
        # Find this file's OLD location (if it was moved) so we can resolve
        # its imports from where they USED to live. Imports in already-existing
        # files (e.g. tests/) resolve from their unchanged location.
        rel_in_repo = f.relative_to(REPO_ROOT).as_posix()
        old_importer_dir = importer_dir
        for old_p, new_p in MOVES:
            if new_p == rel_in_repo:
                old_importer_dir = (REPO_ROOT / old_p).parent
                break

        def replace(match: re.Match[str]) -> str:
            nonlocal changed_lines
            head, quote, spec = match.group(1), match.group(2), match.group(3)
            # Package imports — leave alone.
            if not spec.startswith('.'):
                return match.group(0)

            # Pass 1: try resolving as the file exists right now (sibling
            # imports that weren't broken by the move).
            cand_existing = resolve_import_existing(importer_dir, spec)
            if cand_existing is not None:
                key = str(cand_existing).removesuffix('.ts')
                target = Path(abs_to_new.get(key, key) + '.ts')
                new_rel = make_relative(f, target)
                if new_rel == spec:
                    return match.group(0)
                changed_lines += 1
                return f'{head}{quote}{new_rel}{quote}'

            # Pass 2: file no longer exists at the spec'd location. Resolve
            # from the importer's OLD directory (where the spec used to point
            # at a real file) and look up the move map.
            cand_old = resolve_import_candidate(old_importer_dir, spec)
            if cand_old is None:
                return match.group(0)
            key = str(cand_old).removesuffix('.ts')
            if key not in abs_to_new:
                # Old target wasn't moved either — probably already broken.
                return match.group(0)
            target = Path(abs_to_new[key] + '.ts')
            new_rel = make_relative(f, target)
            if new_rel == spec:
                return match.group(0)
            changed_lines += 1
            return f'{head}{quote}{new_rel}{quote}'

        new_text = IMPORT_PATTERN.sub(replace, original)
        if new_text != original:
            f.write_text(new_text, encoding='utf-8')
            changed_files += 1

    print(f'Rewrote imports in {changed_files} files, {changed_lines} import lines updated.')


def main():
    args = sys.argv[1:]
    rewrite_only = '--rewrite-only' in args
    if not rewrite_only:
        preflight()
        print('Moving files…')
        move_files()
    print('Rewriting imports…')
    rewrite_imports()
    print('Done. Run: npx tsc --noEmit && npm test && npm run build')


if __name__ == '__main__':
    main()
