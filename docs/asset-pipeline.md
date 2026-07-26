# Asset pipeline

How art gets from `assets/` into `dist/`, and what the build does to it on the way.

## The three moving parts

`tools/assets/referenced.cjs` derives the list of assets the game actually loads by scanning `src/` for asset string literals.
It recognises whole paths (`'assets/audio/sfx/pickup.mp3'`) and the `{ dir, file }` pairs that `SurvivorsGameplayState`'s champion and enemy GLB tables use.
Both `webpack.config.js` and `tools/assets/optimize.mjs` consume it, so the ship list can never drift from the code.
A referenced path that does not exist on disk fails the build rather than 404-ing at runtime.

`tools/assets/optimize.mjs` (`npm run assets:optimize`) reads those GLBs and writes optimized copies to `assets/opt/`, mirroring the path under `assets/`.
Originals stay in place as the source of truth and are never modified.

`webpack.config.js` copies each referenced asset into `dist/assets/`, preferring the `assets/opt/` copy when one exists and mapping it onto the original's path.
Nothing at runtime knows the difference, and a missing `assets/opt/` just means the originals ship.
It is the only route into `dist/assets/`: a second copy pattern used to ship `src/assets/` wholesale, which would have let anything dropped there reach `dist/` without passing the allowlist, and it was removed once the three 0-byte placeholder PNGs it carried were deleted.

```
assets/miya-.../source/miya.glb          ─┐
                                          ├─→ dist/assets/miya-.../source/miya.glb
assets/opt/miya-.../source/miya.glb      ─┘   (the opt copy wins)
```

## What optimize.mjs does, and what it deliberately does not

Only four transforms run:

- **KTX2 (ETC1S/BasisLZ) texture compression** — the VRAM win.
  A 2048² RGBA PNG costs 16 MB of VRAM once decoded; the same data as GPU blocks is ~2 MB.
- **`EXT_meshopt_compression`** at gltf-transform's default `high` level — the byte win.
  These character rigs are 55-70% animation data (Aulus is 1155 KB of keyframes in a 2077 KB file), and meshopt's quaternion and exponential filters are what compress keyframe tracks.
- **`simplify()` for the six landmark props only**, at ratio 0.4 with a 1% error bound.
  Never for skinned characters.
- **A 512² texture cap for the six landmark props only**, applied in `toPng` before the KTX2 encode so nothing resamples an already-blocked image.
  The props ship 1024² Color + ORM + NormalGL each and are static, fogged background dressing; under the orthographic iso camera a monolith covers roughly a fifth of the screen height even at maximum zoom, so 1024² is several times more texel density than the framebuffer resolves.
  Halving costs 4x the pixels and takes the six props from 2699 KB to 1434 KB, with the same 4x cut in VRAM.
  Measured against the 1024² renders under identical lighting, mean absolute pixel difference is 0.3-1.7/255 with the whole prop filling a 900² frame, and 0.7/255 on the monolith at maximum in-game zoom.
  Dimensions are floored to a multiple of 4 because ETC1S encodes 4x4 blocks and pads anything else.
  Characters and enemies are excluded — they are the thing the player looks at.

It never runs gltf-transform's blanket `optimize()` preset.
That preset's prune / join / palette / dedup steps merge nodes and rewrite names, and two invariants forbid it:

1. THREE binds animation tracks by node **name**. One rename and the model loads without error and T-poses forever.
2. Code looks up materials by name — `Champion` tints Aulus's `_weapon` material, enemies tint per-instance materials on hit.

`assertStructurePreserved()` enforces both after every transform, comparing node, material and animation-clip name sets plus skin and joint counts.
It has already caught one real regression: gltf-transform's default per-mesh quantization volume clones a shared skin once per mesh, which took the goblin merchant from 1 skin / 24 joints to 4 / 96.
The pipeline uses `quantizationVolume: 'scene'` for that reason, at a cost of 8 bytes.

## Verifying

```bash
npm run assets:verify
```

Parses the original and the optimized GLB with the real three.js `GLTFLoader`, plays every clip on both, samples bone world positions at four phases per clip, and reports the largest deviation as a fraction of the model's bounding-box diagonal.
Quantization noise lands around 0.01-0.16%; a broken binding lands two orders of magnitude higher because the bone simply never moves.
Textures are stripped from both sides first — KTX2 needs a live WebGL context to transcode, and this check is about skeletons.

## Toolchain

KTX2 encoding needs the `ktx` CLI from KhronosGroup/KTX-Software.
**There is no Homebrew formula** — `brew install ktx` does not exist.
`optimize.mjs` bootstraps it automatically into `node_modules/.cache/ktx-software/` from the official GitHub release: on macOS it expands the signed `.pkg` with `pkgutil --expand-full`, which needs no root; on Linux it untars the `.tar.bz2`.

Override with `KTX_BIN=/path/to/ktx`, or put `ktx` on `PATH`.
If the tool cannot be obtained the script falls back to `EXT_texture_webp`, which still cuts download but **not** VRAM — WebP decodes to uncompressed RGBA on the GPU.
`--no-ktx` forces that path.

## Runtime loaders

`src/engine/three/assets.ts` wires both decoders.

The meshopt decoder is attached at module scope; it is self-contained WASM with no renderer dependency.
The KTX2 transcoder is attached by `configureAssetLoaders(renderer)`, which `Game.start()` calls immediately after the `RendererHost` exists.
That ordering is required: `KTX2Loader.detectSupport()` asks the live GL context which compressed formats it can transcode into, and without it every KTX2 texture throws.
`loadContainer()` waits on that configuration, bounded by a timeout so a boot path that never configures surfaces a normal load error instead of a permanently pending loading screen.

There is deliberately **no `setTranscoderPath()`**.
Left empty, `KTX2Loader` resolves the Basis transcoder through `new URL('…/basis_transcoder.wasm', import.meta.url)`, which webpack rewrites into a content-hashed emitted asset.
A hand-copied transcoder directory would ship the same 515 KB binary a second time and would break under a non-root `publicPath`.

`configureAssetLoaders` also fires `prewarmTranscoder()`, which transcodes a 369-byte 4x4 ETC1S KTX2 embedded as base64 in the module.
That is the only way to drive the loader's cold path to completion from outside: the public `init()` stops at "wasm fetched, worker factory registered", and the Worker itself, the 515 KB transcoder copy into it, and `initializeBasis()` all wait for a first transcode job.
The cold path is **latency, not main-thread blocking** — isolated, it costs 52 ms on localhost, 479 ms on emulated fast 4G and 1765 ms on slow 4G, against 0.4 ms per texture once warm, and never produces a task long enough for the longtask observer to see.
Left lazy it lands inside the first GLB load, where its two requests queue behind the champion and enemy GLBs, so no texture decodes until nearly every asset has downloaded; measured on fast 4G, the first champion texture became ready 8.5 s after the tap and all 52 followed in a 95 ms burst.
Prewarmed it fetches during boot, the first texture is ready at 2.4 s and the last at 8.2 s.
It is fire-and-forget and silent by contract: every failure mode leaves the lazy path exactly as it was, so a broken prewarm can only cost the boot two wasted requests.

## Regenerating

```bash
npm run assets:optimize            # all referenced GLBs
npm run assets:optimize -- --filter=aulus
npm run assets:optimize -- --force  # ignore the up-to-date check
npm run assets:verify
npm run build
```

`assets/opt/` is tracked in git, matching the convention already used by `assets/items/icons/` and `assets/world/props/opt/`.
That keeps `npm run deploy` reproducible from a clean checkout without a toolchain.
Webpack reads the filesystem at config time, so restart the dev server after regenerating.
