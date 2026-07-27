const fs = require('fs');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { discoverReferencedAssets, reportMissing } = require('./tools/assets/referenced.cjs');

// Only the assets the game actually loads reach dist/. Copying assets/ wholesale
// shipped ~35 MB of dead weight - abandoned source models, duplicate landmark
// GLBs, and the loose <champion>/textures/ PNGs that are already embedded in the
// GLBs. The list is derived from src/ string literals so it cannot drift, and a
// referenced-but-missing file fails the build instead of 404-ing at runtime.
const { files: SHIPPED_ASSETS, missing } = discoverReferencedAssets(__dirname);
reportMissing(missing);

// assets/opt/<path-under-assets> holds the output of `npm run assets:optimize`
// (meshopt + KTX2, see tools/assets/optimize.mjs). Each optimized file is copied
// ONTO the original's dist path, so no runtime URL changes and an un-generated
// assets/opt/ simply ships the originals. Resolved here rather than via two
// overlapping copy patterns so the winner is deterministic.
const optPathFor = rel => path.join(__dirname, 'assets/opt', rel.slice('assets/'.length));
const hasOptimized = rel => rel.startsWith('assets/') && fs.existsSync(optPathFor(rel));
const OPTIMIZED = SHIPPED_ASSETS.filter(hasOptimized);
const AS_AUTHORED = new Set(SHIPPED_ASSETS.filter(rel => !hasOptimized(rel)));
const OPTIMIZED_SOURCES = new Set(OPTIMIZED.map(optPathFor));

// Webpack passes `argv.mode` from `--mode production|development` (or 'none').
// In production we drop the source map entirely — Cloudflare Workers caps
// each asset at 25 MiB and the v9 bundle's source map is ~25.3 MiB. Dev
// still gets a full source map for debugging.
// `webpack serve --env lan` (npm run start:lan) opens the dev server to other
// devices on the LAN, for testing on a real phone/tablet. Deliberately opt-in:
// the default `npm start` stays bound to loopback, so a dev server is never
// exposed to a shared network (a coffee-shop or office wifi) just by running it.
module.exports = (env, argv) => ({
  entry: './src/index.ts',
  mode: argv.mode || 'development',
  devtool: argv.mode === 'production' ? false : 'source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.woff2?$/,
        type: 'asset/resource',
        generator: { filename: 'fonts/[name][ext]' },
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    // Wipe stale build artifacts before each emit so e.g. a previously-
    // generated bundle.js.map can't linger and break Cloudflare's 25 MiB
    // per-asset deploy limit.
    clean: true,
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'src/index.html',
    }),
    new CopyWebpackPlugin({
      patterns: [
        // Referenced assets with no optimized counterpart (audio, item icons, and
        // any GLB assets:optimize hasn't been run over).
        {
          from: 'assets',
          to: 'assets',
          noErrorOnMissing: true,
          filter: abs => AS_AUTHORED.has(path.relative(__dirname, abs).split(path.sep).join('/')),
        },
        // Optimized GLBs, remapped onto the path the game requests.
        {
          from: 'assets/opt',
          to: 'assets',
          noErrorOnMissing: true,
          filter: abs => OPTIMIZED_SOURCES.has(abs),
        },
      ],
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    compress: true,
    port: 9000,
    // 0.0.0.0 rather than 'local-ipv4' so http://localhost:9000 keeps working
    // alongside the LAN address; binding only the LAN interface would take
    // loopback away.
    host: env && env.lan ? '0.0.0.0' : 'localhost',
    // The Host-header allowlist defaults to 'auto', which accepts only localhost
    // and the configured host - a request addressed to 192.168.x.x is rejected
    // with "Invalid Host header". Widened for LAN mode only; on the default
    // loopback bind it still blocks DNS-rebinding (a page on the open internet
    // pointing a hostname at 127.0.0.1 to reach this server through the browser).
    allowedHosts: env && env.lan ? 'all' : 'auto',
  },
}); 