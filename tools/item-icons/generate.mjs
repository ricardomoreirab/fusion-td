/**
 * Batch Tripo generation for the item catalogue.
 *
 *   node tools/item-icons/generate.mjs            # every id missing a GLB
 *   node tools/item-icons/generate.mjs gorefang…  # only the named ids
 *
 * Idempotent: an id that already has a GLB under art-source/items/<id>/ is
 * skipped, so a run interrupted by a credit ceiling can simply be re-run after
 * a top-up. Requires TRIPO_API_KEY (the repo .env carries it).
 */
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC_DIR = join(ROOT, 'art-source/items');
const CONCURRENCY = Number(process.env.TRIPO_CONCURRENCY) || 4;

const SKILL = [
    join(homedir(), '.claude/skills/threejs-3d-generator/scripts/threejs_3d_asset.py'),
    join(homedir(), '.codex/skills/threejs-3d-generator/scripts/threejs_3d_asset.py'),
    join(homedir(), '.agents/skills/threejs-3d-generator/scripts/threejs_3d_asset.py'),
].find(existsSync);

if (!SKILL) {
    console.error('threejs-3d-generator script not found on the skill path ladder.');
    process.exit(1);
}
if (!process.env.TRIPO_API_KEY) {
    console.error('TRIPO_API_KEY is unset. Run with:  set -a; . ./.env; set +a; node tools/item-icons/generate.mjs');
    process.exit(1);
}

const spec = JSON.parse(await readFile(join(import.meta.dirname, 'prompts.json'), 'utf8'));
const requested = process.argv.slice(2);

async function alreadyHasGlb(id) {
    const dir = join(SRC_DIR, id);
    if (!existsSync(dir)) return false;
    return (await readdir(dir)).some(f => f.endsWith('.glb'));
}

// Rarity priority: Tripo credit is finite, so the items a player actually
// chases (mythic weapons, unique set pieces) must be generated before commons.
// Rarity is read from the catalogue rather than duplicated here.
const RARITY_RANK = { mythic: 0, unique: 1, legendary: 2, epic: 3, rare: 4, common: 5 };
const catalogSrc = await readFile(join(ROOT, 'src/survivors/items/ItemCatalog.ts'), 'utf8');
const rarityById = new Map(
    [...catalogSrc.matchAll(/\{ id: '([^']+)',[\s\S]*?rarity: '([a-z]+)'/g)].map(m => [m[1], m[2]]),
);
const rankOf = (id) => RARITY_RANK[rarityById.get(id)] ?? 9;

const ids = (requested.length ? requested : Object.keys(spec.items))
    .filter(id => spec.items[id] || (console.warn(`unknown id: ${id}`), false))
    .sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));

const todo = [];
for (const id of ids) if (!(await alreadyHasGlb(id))) todo.push(id);

console.log(`${ids.length} requested · ${ids.length - todo.length} already generated · ${todo.length} to generate`);
const byRarity = todo.reduce((a, id) => (a[rarityById.get(id) ?? '?'] = (a[rarityById.get(id) ?? '?'] ?? 0) + 1, a), {});
console.log('order:', Object.entries(byRarity).sort((x, y) => RARITY_RANK[x[0]] - RARITY_RANK[y[0]])
    .map(([r, n]) => `${r} ${n}`).join(' → '));
if (!todo.length) process.exit(0);

function generate(id) {
    const outDir = join(SRC_DIR, id);
    const args = [
        SKILL, 'text',
        '--prompt', `${spec.items[id]}, ${spec._style}`,
        '--negative-prompt', spec._negative,
        '--model-version', 'v3.1-20260211',
        '--texture-quality', 'detailed',
        '--geometry-quality', 'detailed',
        '--wait', '--download', '--out-dir', outDir,
    ];
    return new Promise(async (done) => {
        await mkdir(outDir, { recursive: true });
        const p = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '', out = '';
        p.stderr.on('data', d => { err += d; });
        // Keep stdout: it carries the Tripo task id, which is the only way to
        // recover a task whose credits were spent before the run was killed.
        p.stdout.on('data', d => { out += d; });
        p.on('close', (code) => {
            if (code === 0) console.log(`  ✓ ${id}`);
            else {
                const taskId = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
                console.log(`  ✗ ${id} — ${err.trim().split('\n').pop() ?? `exit ${code}`}`
                    + (taskId ? `  [task ${taskId} — recover with: threejs_3d_asset.py download ${taskId}]` : ''));
            }
            done({ id, ok: code === 0, err });
        });
    });
}

// Bounded worker pool — Tripo tolerates parallel tasks, but a 51-wide fan-out
// buries a credit-ceiling 403 under fifty other failures.
const queue = [...todo];
const results = [];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) results.push(await generate(queue.shift()));
}));

const failed = results.filter(r => !r.ok);
const broke = failed.find(r => /code.{0,4}2010|enough credit/i.test(r.err));
console.log(`\n${results.length - failed.length}/${results.length} generated.`);
if (broke) {
    console.log('OUT OF TRIPO CREDIT — top up, then re-run this command; finished items are skipped.');
} else if (failed.length) {
    console.log(`failed: ${failed.map(r => r.id).join(', ')} — re-run to retry just those.`);
}
console.log('Next: npm run icons:items  (bake the GLBs to WebP icons)');
