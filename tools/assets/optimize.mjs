/**
 * assets:optimize — build optimized copies of every runtime GLB into assets/opt/,
 * mirroring the original relative path. Originals under assets/ stay the source of
 * truth and are never modified.
 *
 * webpack maps assets/opt/<rel> onto dist/assets/<rel>, so the optimized file
 * replaces the original at the URL the game already requests. No runtime path
 * changes anywhere, and a missing assets/opt/ just means the original ships.
 *
 * ── Transforms (deliberately targeted; NEVER the blanket optimize() preset) ────
 * The preset's prune/join/palette/dedup steps merge nodes and rewrite names, and
 * this codebase has two hard invariants that forbid it:
 *   a. THREE binds animation tracks by node NAME — one rename and the model
 *      silently T-poses (see CLAUDE.md "GLB clones must not rename descendants").
 *   b. Code looks up materials by name (Champion tints Aulus's '_weapon' material).
 * So only these run:
 *   • KTX2 (ETC1S/BasisLZ) texture compression — the VRAM win. A 2048² RGBA PNG
 *     costs 16 MB of VRAM decoded; the same data as ETC1S→BC7/ASTC is ~2 MB.
 *   • EXT_meshopt_compression at gltf-transform's default 'high' level — the byte
 *     win. These character rigs are 55-70% animation data (Aulus: 1155 KB of
 *     25 clips in a 2077 KB file), and meshopt's quaternion/exponential filters
 *     are what compress keyframe tracks.
 *   • simplify() for the six background landmark props ONLY. Never for skinned
 *     characters.
 *
 * ── Toolchain ─────────────────────────────────────────────────────────────────
 * KTX2 encoding needs the `ktx` CLI from KhronosGroup/KTX-Software. There is no
 * Homebrew formula (`brew install ktx` does not exist), so this script bootstraps
 * it automatically into node_modules/.cache/ktx-software/ from the official
 * GitHub release (macOS .pkg expanded with pkgutil — no root needed; Linux
 * .tar.bz2). Override with KTX_BIN=/path/to/ktx, or put `ktx` on PATH.
 * If the tool cannot be obtained, textures fall back to EXT_texture_webp, which
 * still cuts download but NOT VRAM (WebP decodes to uncompressed RGBA on the GPU).
 *
 * Usage:
 *   npm run assets:optimize                 # all referenced GLBs
 *   npm run assets:optimize -- --filter=aulus
 *   npm run assets:optimize -- --force      # ignore the up-to-date check
 *   npm run assets:optimize -- --no-ktx     # WebP path, skip KTX2 entirely
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dequantize, getTextureColorSpace, meshopt, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { discoverReferencedAssets, reportMissing } = require('./referenced.cjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_ROOT = join(ROOT, 'assets/opt');
const KTX_CACHE = join(ROOT, 'node_modules/.cache/ktx-software');
const KTX_VERSION = '4.4.2';

const args = process.argv.slice(2);
const FILTER = (args.find(a => a.startsWith('--filter=')) ?? '').slice('--filter='.length);
const FORCE = args.includes('--force');
const NO_KTX = args.includes('--no-ktx');

/** Background landmarks: static, fogged, far from the camera. */
const PROP_DIR = 'assets/world/props/opt/';

/** Reduction target for landmark props. bone_pile alone is 38.7k triangles. */
const SIMPLIFY = { ratio: 0.4, error: 0.01, lockBorder: false };

/**
 * ETC1S quality per asset class and texture role, measured rather than guessed.
 *
 * Character/portrait maps are 256²-2048² albedo viewed at close range, and even
 * at qlevel 190 a 256² map is only ~22 KB, so quality is nearly free there.
 *
 * Prop maps are 1024² Color + ORM + NormalGL on fogged background landmarks, and
 * their absolute cost is what decides whether KTX2 pays for itself. Measured on
 * monolith: qlevel 96 gives 172+144+52 = 368 KB vs 287 KB for the incoming WebP,
 * where qlevel 190/230 gives 504 KB. The 81 KB/prop premium buys an ~8x VRAM cut
 * (3 x 1024² RGBA + mips is ~16.8 MB per prop uncompressed, ~2.1 MB as blocks).
 *
 * UASTC was measured and rejected for props: the monolith normal map alone is
 * 460 KB as UASTC+zstd against 48 KB as ETC1S.
 */
const ETC1S = {
    model: { color: { qlevel: 190, clevel: 3 }, nonColor: { qlevel: 230, clevel: 4 } },
    prop: { color: { qlevel: 96, clevel: 3 }, nonColor: { qlevel: 96, clevel: 3 } },
};

/** Per-asset codec escalation, keyed by the repo-relative GLB path. */
const TEXTURE_OVERRIDES = {};

// ── ktx CLI bootstrap ────────────────────────────────────────────────────────

function tryRun(bin, env) {
    try {
        execFileSync(bin, ['--version'], { stdio: 'pipe', env: { ...process.env, ...env } });
        return true;
    } catch {
        return false;
    }
}

function bootstrapKtx() {
    const { platform, arch } = process;
    const cachedBin = join(KTX_CACHE, 'bin/ktx');
    const cachedEnv = { DYLD_LIBRARY_PATH: join(KTX_CACHE, 'lib'), LD_LIBRARY_PATH: join(KTX_CACHE, 'lib') };

    if (process.env.KTX_BIN && tryRun(process.env.KTX_BIN, {})) return { bin: process.env.KTX_BIN, env: {} };
    if (tryRun('ktx', {})) return { bin: 'ktx', env: {} };
    if (existsSync(cachedBin) && tryRun(cachedBin, cachedEnv)) return { bin: cachedBin, env: cachedEnv };

    const base = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}`;
    const staging = join(tmpdir(), `ktx-bootstrap-${process.pid}`);
    console.log(`[ktx] not found — bootstrapping v${KTX_VERSION} into ${relative(ROOT, KTX_CACHE)}`);
    try {
        mkdirSync(staging, { recursive: true });
        mkdirSync(join(KTX_CACHE, 'bin'), { recursive: true });
        mkdirSync(join(KTX_CACHE, 'lib'), { recursive: true });

        if (platform === 'darwin') {
            const url = `${base}-Darwin-${arch === 'arm64' ? 'arm64' : 'x86_64'}.pkg`;
            const pkg = join(staging, 'ktx.pkg');
            execFileSync('curl', ['-sL', '--fail', '-o', pkg, url], { stdio: 'inherit' });
            execFileSync('pkgutil', ['--expand-full', pkg, join(staging, 'x')], { stdio: 'inherit' });
            const p = join(staging, 'x', `KTX-Software-${KTX_VERSION}-Darwin-${arch === 'arm64' ? 'arm64' : 'x86_64'}`);
            execFileSync('cp', [join(`${p}-tools.pkg`, 'Payload/usr/local/bin/ktx'), join(KTX_CACHE, 'bin/')]);
            execFileSync('sh', ['-c', `cp -a "${p}-library.pkg/Payload/usr/local/lib/"libktx* "${join(KTX_CACHE, 'lib')}/"`]);
        } else if (platform === 'linux') {
            const url = `${base}-Linux-${arch === 'arm64' ? 'arm64' : 'x86_64'}.tar.bz2`;
            const tar = join(staging, 'ktx.tar.bz2');
            execFileSync('curl', ['-sL', '--fail', '-o', tar, url], { stdio: 'inherit' });
            execFileSync('tar', ['-xjf', tar, '-C', staging], { stdio: 'inherit' });
            execFileSync('sh', ['-c', `cp "${staging}"/*/usr/local/bin/ktx "${join(KTX_CACHE, 'bin')}/"`]);
            execFileSync('sh', ['-c', `cp -a "${staging}"/*/usr/local/lib/libktx* "${join(KTX_CACHE, 'lib')}/"`]);
        } else {
            throw new Error(`no bootstrap recipe for ${platform}/${arch}`);
        }
        execFileSync('chmod', ['+x', cachedBin]);
        if (tryRun(cachedBin, cachedEnv)) return { bin: cachedBin, env: cachedEnv };
        throw new Error('bootstrapped binary did not run');
    } catch (err) {
        console.warn(`[ktx] bootstrap failed (${err.message}). Falling back to EXT_texture_webp.`);
        console.warn('[ktx] To fix: install KTX-Software manually and re-run with KTX_BIN=/path/to/ktx.');
        return null;
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}

// ── texture encoding ─────────────────────────────────────────────────────────

async function toPng(bytes) {
    const image = sharp(Buffer.from(bytes));
    const stats = await image.stats();
    const meta = await image.metadata();
    const opaque = stats.isOpaque || !meta.hasAlpha;
    const png = await sharp(Buffer.from(bytes))
        .toColourspace('srgb')
        [opaque ? 'removeAlpha' : 'ensureAlpha']()
        .png({ compressionLevel: 0 })
        .toBuffer();
    return { png, opaque, width: meta.width, height: meta.height };
}

async function encodeKtx2(ktx, bytes, { srgb, codec, klass }) {
    const { png, opaque } = await toPng(bytes);
    const dir = join(tmpdir(), `ktx-enc-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const inFile = join(dir, 'in.png');
    const outFile = join(dir, 'out.ktx2');
    writeFileSync(inFile, png);

    const format = `R8G8B8${opaque ? '' : 'A8'}_${srgb ? 'SRGB' : 'UNORM'}`;
    const tuning = ETC1S[klass][srgb ? 'color' : 'nonColor'];
    const encodeArgs = codec === 'uastc'
        ? ['--encode', 'uastc', '--uastc-quality', '2', '--zstd', '18']
        : ['--encode', 'basis-lz', '--qlevel', String(tuning.qlevel), '--clevel', String(tuning.clevel)];

    try {
        execFileSync(ktx.bin, [
            'create',
            '--format', format,
            '--assign-tf', srgb ? 'srgb' : 'linear',
            '--generate-mipmap',
            ...encodeArgs,
            inFile, outFile,
        ], { stdio: 'pipe', env: { ...process.env, ...ktx.env } });
        return new Uint8Array(readFileSync(outFile));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function encodeWebp(bytes) {
    const { png, opaque } = await toPng(bytes);
    const out = await sharp(png).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
    return { bytes: new Uint8Array(out), opaque };
}

/**
 * Replace every texture's image with a compressed equivalent, in place. Texture
 * and material NAMES are untouched — only the payload and mimeType change.
 */
async function compressTextures(doc, ktx, codec, klass) {
    const root = doc.getRoot();
    const textures = root.listTextures();
    if (!textures.length) return { before: 0, after: 0, format: 'none' };

    const before = textures.reduce((a, t) => a + (t.getImage()?.byteLength ?? 0), 0);
    let usedKtx = false;
    let usedWebp = false;

    for (const texture of textures) {
        const image = texture.getImage();
        if (!image) continue;
        const srgb = getTextureColorSpace(texture) === 'srgb';
        if (ktx) {
            try {
                texture.setImage(await encodeKtx2(ktx, image, { srgb, codec, klass }));
                texture.setMimeType('image/ktx2');
                usedKtx = true;
                continue;
            } catch (err) {
                console.warn(`    ktx encode failed for "${texture.getName()}" (${err.message.trim().split('\n')[0]}) — using webp`);
            }
        }
        const webp = await encodeWebp(image);
        texture.setImage(webp.bytes);
        texture.setMimeType('image/webp');
        usedWebp = true;
    }

    if (usedKtx) doc.createExtension(KHRTextureBasisu).setRequired(true);
    if (usedWebp) doc.createExtension(EXTTextureWebP).setRequired(true);

    const after = root.listTextures().reduce((a, t) => a + (t.getImage()?.byteLength ?? 0), 0);
    return { before, after, format: usedKtx ? (usedWebp ? 'ktx2+webp' : 'ktx2') : 'webp' };
}

// ── model stats (the invariant check runs on these) ──────────────────────────

function snapshot(doc) {
    const root = doc.getRoot();
    let tris = 0;
    for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
            tris += Math.floor(count / 3);
        }
    }
    return {
        tris,
        nodes: root.listNodes().map(n => n.getName()).sort(),
        materials: root.listMaterials().map(m => m.getName()).sort(),
        animations: root.listAnimations().map(a => a.getName()).sort(),
        skins: root.listSkins().length,
        joints: root.listSkins().reduce((a, s) => a + s.listJoints().length, 0),
    };
}

/**
 * Hard gate on the two invariants a bad transform would break silently.
 * A node or material rename here means a T-posed model or an untintable weapon
 * in game, with nothing but a console warning at runtime.
 */
function assertStructurePreserved(rel, before, after) {
    const diff = (a, b, label) => {
        const missing = a.filter(x => !b.includes(x));
        const added = b.filter(x => !a.includes(x));
        if (missing.length || added.length) {
            throw new Error(
                `${rel}: ${label} changed — this breaks name-based binding.\n` +
                `  removed: ${missing.join(', ') || '(none)'}\n  added: ${added.join(', ') || '(none)'}`,
            );
        }
    };
    diff(before.nodes, after.nodes, 'node names');
    diff(before.materials, after.materials, 'material names');
    diff(before.animations, after.animations, 'animation clip names');
    if (before.skins !== after.skins || before.joints !== after.joints) {
        throw new Error(`${rel}: skin/joint count changed (${before.skins}/${before.joints} → ${after.skins}/${after.joints})`);
    }
}

// ── main ─────────────────────────────────────────────────────────────────────

const fmt = bytes => `${(bytes / 1024).toFixed(0)} KB`;
const pct = (from, to) => `${from > 0 ? (((to - from) / from) * 100).toFixed(0) : '0'}%`;

async function main() {
    const { files, missing } = discoverReferencedAssets(ROOT);
    reportMissing(missing);

    let glbs = files.filter(f => f.endsWith('.glb'));
    if (FILTER) glbs = glbs.filter(f => f.includes(FILTER));
    if (!glbs.length) {
        console.log('[assets] nothing to optimize');
        return;
    }

    const ktx = NO_KTX ? null : bootstrapKtx();
    if (ktx) console.log(`[ktx] using ${ktx.bin === 'ktx' ? 'ktx (PATH)' : relative(ROOT, ktx.bin)}`);

    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    await MeshoptSimplifier.ready;

    const io = new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

    const rows = [];
    for (const rel of glbs) {
        const src = join(ROOT, rel);
        const dst = join(OUT_ROOT, rel.replace(/^assets\//, ''));
        const srcSize = statSync(src).size;

        if (!FORCE && existsSync(dst) && statSync(dst).mtimeMs > statSync(src).mtimeMs) {
            rows.push({ rel, srcSize, dstSize: statSync(dst).size, note: 'cached' });
            continue;
        }

        const isProp = rel.startsWith(PROP_DIR);
        process.stdout.write(`[opt] ${rel} … `);

        const doc = await io.read(src);
        const before = snapshot(doc);

        const tex = await compressTextures(doc, ktx, TEXTURE_OVERRIDES[rel] ?? 'etc1s', isProp ? 'prop' : 'model');

        if (isProp) {
            // Props arrive already quantized (KHR_mesh_quantization); simplify needs
            // float positions, and meshopt re-quantizes afterwards.
            await doc.transform(dequantize());
            await doc.transform(simplify({ simplifier: MeshoptSimplifier, ...SIMPLIFY }));
        }

        // quantizationVolume 'scene' rather than the 'mesh' default: a per-mesh
        // volume needs a per-mesh dequantization transform, and for a skin shared
        // by several meshes that means CLONING the skin once per mesh (the goblin
        // merchant went 1 skin/24 joints → 4 skins/96 joints, i.e. four bone
        // textures per instance instead of one). Output size is within 8 bytes.
        await doc.transform(meshopt({ encoder: MeshoptEncoder, quantizationVolume: 'scene' }));

        const after = snapshot(doc);
        if (!isProp) assertStructurePreserved(rel, before, after);
        else assertStructurePreserved(rel, { ...before, tris: 0 }, { ...after, tris: 0 });

        mkdirSync(dirname(dst), { recursive: true });
        await io.write(dst, doc);

        const dstSize = statSync(dst).size;
        rows.push({
            rel,
            srcSize,
            dstSize,
            tris: [before.tris, after.tris],
            tex: `${tex.format} ${fmt(tex.before)}→${fmt(tex.after)}`,
        });
        console.log(`${fmt(srcSize)} → ${fmt(dstSize)} (${pct(srcSize, dstSize)})`);
    }

    rows.sort((a, b) => b.srcSize - a.srcSize);
    const totalSrc = rows.reduce((a, r) => a + r.srcSize, 0);
    const totalDst = rows.reduce((a, r) => a + r.dstSize, 0);

    console.log('\n  original     optimized    delta    triangles          textures');
    console.log('  ' + '─'.repeat(96));
    for (const r of rows) {
        const tris = r.tris ? `${r.tris[0]}→${r.tris[1]}` : '';
        console.log(
            `  ${fmt(r.srcSize).padStart(9)}  ${fmt(r.dstSize).padStart(10)}  ${pct(r.srcSize, r.dstSize).padStart(6)}   ${tris.padEnd(16)}  ${r.tex ?? r.note ?? ''}   ${r.rel}`,
        );
    }
    console.log('  ' + '─'.repeat(96));
    console.log(`  ${fmt(totalSrc).padStart(9)}  ${fmt(totalDst).padStart(10)}  ${pct(totalSrc, totalDst).padStart(6)}   TOTAL over ${rows.length} GLBs\n`);
    console.log(`Output: ${relative(ROOT, OUT_ROOT)}/  (webpack maps these onto dist/assets/<original path>)`);
}

main().catch(err => {
    console.error(`\n[assets:optimize] ${err.stack ?? err.message}`);
    process.exit(1);
});
