const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// Webpack passes `argv.mode` from `--mode production|development` (or 'none').
// In production we drop the source map entirely — Cloudflare Workers caps
// each asset at 25 MiB and the v9 bundle's source map is ~25.3 MiB. Dev
// still gets a full source map for debugging.
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
        { from: 'src/assets', to: 'assets', noErrorOnMissing: true },
        // Root-level 3D model folders (e.g. assets/elven-archer-in-the-forest/) — ship them
        // straight to dist/assets/ so SceneLoader can fetch by absolute URL at runtime.
        { from: 'assets', to: 'assets', noErrorOnMissing: true },
      ],
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    compress: true,
    port: 9000,
  },
}); 