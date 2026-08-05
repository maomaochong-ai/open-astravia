import { federation, type ModuleFederationOptions } from "@module-federation/vite";
import type { Plugin, PluginOption } from "vite";
import {
	createVettaPluginDevPlugins,
	isVettaPluginDevServer,
	VETTA_PLUGIN_DEV_ENTRY_ID,
} from "./dev-vite-plugins.js";
import { type CreateVettaPluginPackageOptions, createVettaPluginPackage } from "./pack.js";
import { createPluginStyleScopePlugin } from "./style-scope.js";

export interface VettaPluginPackageOptions extends Omit<CreateVettaPluginPackageOptions, "rootDir" | "distDir"> {
	enabled?: boolean;
}

export interface VettaPluginFederationOptions {
	name: string;
	expose?: string;
	entry?: string;
	manifestFileName?: string;
	remoteEntryFileName?: string;
	shared?: ModuleFederationOptions["shared"];
	package?: boolean | VettaPluginPackageOptions;
}

export function createVettaPluginFederationConfig(options: VettaPluginFederationOptions): ModuleFederationOptions {
	const expose = options.expose ?? "./plugin";
	const entry = options.entry ?? "./src/index.tsx";
	return {
		name: options.name,
		filename: options.remoteEntryFileName ?? "remoteEntry.js",
		exposes: {
			[expose]: entry,
		},
		manifest: {
			fileName: options.manifestFileName ?? "mf-manifest.json",
		},
		dts: false,
		shared: {
			"@vetta-org/plugin-sdk": {
				singleton: true,
				import: false,
				requiredVersion: "*",
			},
			react: {
				singleton: true,
				import: false,
				requiredVersion: "*",
			},
			"react-dom": {
				singleton: true,
				import: false,
				requiredVersion: "*",
			},
			// Match host plugin-shared-modules (tldraw remotes may require this subpath).
			"react-dom/client": {
				singleton: true,
				import: false,
				requiredVersion: "*",
			},
			// Host design-system primitives; runtime provided by desktop-app share scope.
			"@vetta/ui": {
				singleton: true,
				import: false,
				requiredVersion: "*",
			},
			...options.shared,
		},
	};
}

function createBuildDefaultsPlugin(entry: string): Plugin {
	return {
		name: "vetta-plugin-build-defaults",
		apply: "build",
		config() {
			return {
				build: {
					rollupOptions: {
						input: entry,
						// Host-provided singletons (see desktop-app plugin-shared-modules + vetta-host protocol).
						external: ["@vetta-org/plugin-sdk", "@vetta/ui"],
						output: {
							assetFileNames(assetInfo) {
								return assetInfo.names.some((name) => name.endsWith(".css"))
									? "style.css"
									: "assets/[name]-[hash][extname]";
							},
							paths: {
								"@vetta-org/plugin-sdk": "vetta-host://plugin-sdk",
								"@vetta/ui": "vetta-host://ui",
							},
						},
					},
				},
			};
		},
	};
}

function createPackagePlugin(options: VettaPluginPackageOptions): Plugin {
	let rootDir = "";
	let distDir = "";
	let buildFailed = false;

	return {
		name: "vetta-plugin-package",
		apply: "build",
		buildStart() {
			buildFailed = false;
		},
		buildEnd(error) {
			buildFailed = error !== undefined;
		},
		configResolved(config) {
			rootDir = config.root;
			distDir = config.build.outDir;
		},
		async closeBundle() {
			if (options.enabled === false || buildFailed) {
				return;
			}
			const result = await createVettaPluginPackage({
				...options,
				rootDir,
				distDir,
			});
			console.log(`[vetta-plugin-vite] Wrote ${result.outputPath} with ${result.files.length} runtime files`);
		},
	};
}

export function vettaPluginFederation(options: VettaPluginFederationOptions): PluginOption[] {
	const packageOptions = typeof options.package === "object" ? options.package : {};
	const entry = options.entry ?? "./src/index.tsx";
	const devServer = isVettaPluginDevServer();
	const plugins: PluginOption[] = [
		...(devServer ? createVettaPluginDevPlugins(entry) : []),
		createBuildDefaultsPlugin(entry),
		...federation({
			...createVettaPluginFederationConfig(options),
			exposes: {
				[options.expose ?? "./plugin"]: devServer ? VETTA_PLUGIN_DEV_ENTRY_ID : entry,
			},
		}),
		createPluginStyleScopePlugin(),
	];
	// 兼容旧宿主的 build-watch 流程：增量构建时不重复打 zip。
	if (options.package !== false && process.env.VETTA_PLUGIN_DEV_WATCH !== "1") {
		plugins.push(createPackagePlugin(packageOptions));
	}
	return plugins;
}
