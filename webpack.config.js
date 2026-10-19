//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const production = process.argv.includes('production');

// Dev builds transpile only and type-check in a separate process so rebuilds are not blocked on tsc
const tsRule = (/** @type {string} */ configFile) => ({
	test: /\.ts$/,
	exclude: /node_modules/,
	use: [{ loader: 'ts-loader', options: { configFile, transpileOnly: !production } }],
});
const typeChecker = (/** @type {string} */ configFile) => production
	? []
	: [new ForkTsCheckerWebpackPlugin({ typescript: { configFile } })];

/** @type WebpackConfig */
const common = {
	mode: 'none', // `--mode production` overrides this when packaging
	entry: { extension: './src/extension.ts' },
	output: {
		filename: '[name].js',
		libraryTarget: 'commonjs',
		devtoolModuleFilenameTemplate: '../../[resource-path]',
	},
	devtool: 'cheap-module-source-map', // `--devtool hidden-source-map` overrides this when packaging
	cache: { type: 'filesystem' },
	performance: { hints: false },
	infrastructureLogging: { level: 'log' }, // required by the problem matchers
};

/** @type WebpackConfig */
const nodeConfig = {
	...common,
	name: 'node',
	target: 'node',
	output: { ...common.output, path: path.join(__dirname, 'dist', 'node') },
	resolve: {
		extensions: ['.ts', '.js'],
		// Prefer CommonJS entries: `import * as x` / `require(x)` of an ES-module build yields a namespace object, not the class (e.g. turndown)
		mainFields: ['main', 'module'],
		// Optional native modules that jsdom and node-fetch probe for; jsdom checks require.resolve first, so externals would break it
		alias: { canvas: false, encoding: false },
	},
	externals: {
		vscode: 'commonjs vscode',
		// level loads a native addon, so it is shipped in node_modules instead of being bundled
		level: 'commonjs level',
		// optional ws dependencies, already wrapped in try/catch by ws
		bufferutil: 'commonjs bufferutil',
		'utf-8-validate': 'commonjs utf-8-validate',
	},
	module: {
		rules: [tsRule('tsconfig.json')],
	},
	plugins: [...typeChecker('tsconfig.json')],
};

/** @type WebpackConfig */
const webConfig = {
	...common,
	name: 'web',
	target: 'webworker',
	output: { ...common.output, path: path.join(__dirname, 'dist', 'web') },
	resolve: {
		// `foo.web.ts` replaces `foo.ts` in the web bundle
		extensions: ['.web.ts', '.ts', '.web.js', '.js'],
		mainFields: ['browser', 'module', 'main'],
		alias: {
			// jsdom is desktop-only; callers already handle the resulting failure
			jsdom: false,
		},
		fallback: {
			path: require.resolve('path-browserify'),
		},
	},
	externals: { vscode: 'commonjs vscode' },
	module: {
		rules: [tsRule('tsconfig.web.json')],
	},
	plugins: [
		...typeChecker('tsconfig.web.json'),
		new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }), // web extensions must be a single bundle
		new webpack.ProvidePlugin({ process: 'process/browser' }),
	],
};

module.exports = [nodeConfig, webConfig];
