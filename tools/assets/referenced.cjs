'use strict';

/**
 * Single source of truth for "which files under assets/ does the game actually
 * load". Consumed by webpack.config.js (to build the dist/ copy allowlist) and
 * by tools/assets/optimize.mjs (to know which GLBs are worth optimizing).
 *
 * The list is DERIVED from the source tree rather than hand-maintained: a
 * hand-written allowlist drifts the moment someone adds an asset, and the
 * failure mode is a 404 at runtime. Scanning src/ for asset string literals
 * cannot drift, and reportMissing() turns a typo'd path into a build error
 * instead of a missing model.
 *
 * Two literal shapes are recognised:
 *   1. a whole path        - 'assets/audio/sfx/pickup.mp3'
 *   2. a { dir, file } pair - { dir: 'assets/blue-wizard/source/', file: 'blue_wizard.glb' }
 *      (SurvivorsGameplayState's champion/enemy GLB tables use this shape)
 *
 * Anything reachable only through a runtime-built path that neither shape can
 * see must be added to EXTRA_ASSETS below.
 */

const { readdirSync, statSync, readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const SOURCE_DIRS = ['src'];
const SOURCE_FILE = /\.(?:tsx?|jsx?|mjs|cjs|html|css)$/;

const ASSET_EXT = 'glb|gltf|bin|mp3|ogg|wav|m4a|png|jpe?g|webp|avif|svg|ktx2|dds|hdr|env|basis';
const WHOLE_PATH = new RegExp(`assets/[A-Za-z0-9_@.+\\-/]+\\.(?:${ASSET_EXT})`, 'g');
const DIR_FILE_PAIR = /dir\s*:\s*['"](assets\/[^'"]*)['"]\s*,\s*file\s*:\s*['"]([^'"]+)['"]/g;

/** Assets with no literal anywhere in src/. Keep empty if at all possible. */
const EXTRA_ASSETS = [];

function walk(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (SOURCE_FILE.test(entry.name)) out.push(full);
    }
    return out;
}

/**
 * @param {string} root repo root (absolute)
 * @returns {{ files: string[], missing: string[] }} repo-relative POSIX paths under assets/
 */
function discoverReferencedAssets(root) {
    const found = new Set(EXTRA_ASSETS);

    for (const dir of SOURCE_DIRS) {
        for (const file of walk(path.join(root, dir), [])) {
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(WHOLE_PATH)) found.add(match[0]);
            for (const [, dirPart, filePart] of text.matchAll(DIR_FILE_PAIR)) {
                found.add(`${dirPart.replace(/\/$/, '')}/${filePart}`);
            }
        }
    }

    const files = [...found].sort();
    const missing = files.filter(rel => !existsSync(path.join(root, rel)));
    return { files, missing };
}

/** Throw with the full list if any referenced asset is absent from disk. */
function reportMissing(missing) {
    if (!missing.length) return;
    throw new Error(
        `[assets] ${missing.length} referenced asset(s) missing from disk:\n  ${missing.join('\n  ')}`,
    );
}

/** Total bytes of a repo-relative file list. */
function totalBytes(root, files) {
    let bytes = 0;
    for (const rel of files) {
        try {
            bytes += statSync(path.join(root, rel)).size;
        } catch {
            /* missing files are reported separately */
        }
    }
    return bytes;
}

module.exports = { discoverReferencedAssets, reportMissing, totalBytes };
