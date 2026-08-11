import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	listPluginManifestResources,
	parsePluginManifest,
	type PluginManifest,
} from "@vetta-org/plugin-sdk/manifest";
import { watch } from "chokidar";
import { createServer, isCSSRequest, type ViteDevServer } from "vite";
import { VETTA_PLUGIN_DEV_ENTRY_ID } from "./dev-vite-plugins.js";
import {
	emitVettaPluginDevEvent,
	setVettaPluginDevEventListener,
	type VettaPluginDevEvent,
	VETTA_PLUGIN_DEV_PROTOCOL_VERSION,
} from "./dev-events.js";
import { hasOpaqueResourceQuery } from "./request-query.js";

export interface VettaPluginDevServer {
	pluginId: string;
	entryUrl: string;
	origin: string;
	close(): Promise<void>;
}

function debugDevServer(message: string): void {
	if (process.env.VETTA_PLUGIN_DEV_DEBUG === "1") {
		process.stderr.write(`[vetta-plugin dev] ${message}\n`);
	}
}

async function readManifest(rootDir: string): Promise<PluginManifest> {
	const manifestPath = resolve(rootDir, "plugin.json");
	const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
	return parsePluginManifest(raw);
}

function isInsidePath(candidate: string, root: string): boolean {
	const pathFromRoot = relative(root, candidate);
	return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function isPluginProjectModule(candidate: string, rootDir: string): boolean {
	if (!isInsidePath(candidate, rootDir)) return false;
	const pathFromRoot = relative(rootDir, candidate);
	return pathFromRoot.split(/[\\/]/u, 1)[0] !== "node_modules";
}

async function collectWatchedResourceRoots(rootDir: string, manifest: PluginManifest): Promise<string[]> {
	const resources = listPluginManifestResources(manifest).filter(
		(resource) => resource.field !== "entry" && resource.field !== "styles",
	);
	const paths = [resolve(rootDir, "plugin.json"), resolve(rootDir, "locales")];
	for (const resource of resources) {
		const resourcePath = resolve(rootDir, resource.path);
		if (resource.kind === "file") {
			paths.push(resourcePath);
			continue;
		}
		try {
			const resourceStat = await stat(resourcePath);
			paths.push(resourceStat.isDirectory() ? resourcePath : dirname(resourcePath));
		} catch {
			paths.push(resourcePath);
		}
	}
	return paths;
}

async function findAvailablePort(): Promise<number> {
	return new Promise<number>((resolvePromise, reject) => {
		const probe = createNetServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (address === null || typeof address === "string") {
				probe.close();
				reject(new Error("Could not allocate a plugin dev server port"));
				return;
			}
			probe.close((error) => {
				if (error) reject(error);
				else resolvePromise(address.port);
			});
		});
	});
}

function resolveServerOrigin(server: ViteDevServer): string {
	const localUrl = server.resolvedUrls?.local[0];
	if (!localUrl) throw new Error("Vite dev server did not expose a local URL");
	return localUrl.endsWith("/") ? localUrl.slice(0, -1) : localUrl;
}

function resolveViteConfigFile(rootDir: string): string | undefined {
	for (const fileName of ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]) {
		const configPath = resolve(rootDir, fileName);
		if (existsSync(configPath)) return configPath;
	}
	return undefined;
}

function assertDevPluginsConfigured(server: ViteDevServer): void {
	if (!server.config.plugins.some((plugin) => plugin.name === "vetta-plugin-dev-runtime")) {
		throw new Error("Vite config must include vettaPluginFederation() to enable the plugin development runtime");
	}
}

async function assertDevEntryAvailable(entryUrl: string): Promise<void> {
	const response = await fetch(entryUrl);
	if (!response.ok) {
		throw new Error(`Plugin dev entry is unavailable: ${entryUrl} returned HTTP ${response.status}`);
	}
	await response.body?.cancel();
}

async function assertDevModuleGraphAvailable(server: ViteDevServer, rootDir: string): Promise<void> {
	const environment = server.environments.client;
	const pendingUrls = [VETTA_PLUGIN_DEV_ENTRY_ID];
	const transformedUrls = new Set<string>();
	while (pendingUrls.length > 0) {
		const moduleUrl = pendingUrls.pop();
		if (moduleUrl === undefined || transformedUrls.has(moduleUrl)) continue;
		transformedUrls.add(moduleUrl);
		debugDevServer(`transforming ${moduleUrl}`);
		try {
			const result = await environment.transformRequest(moduleUrl);
			if (result === null) throw new Error("Vite returned no transform result");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Plugin development module failed to transform (${moduleUrl}): ${message}`);
		}
		if (hasOpaqueResourceQuery(moduleUrl)) continue;
		const module = await environment.moduleGraph.getModuleByUrl(moduleUrl);
		if (!module) throw new Error(`Plugin development module is missing from the Vite graph: ${moduleUrl}`);
		// A CSS transform already resolves its @imports and produces the browser
		// update module. Plugin processors such as Tailwind may attach scanned
		// source files to importedModules even though the browser never imports
		// them, so they must not become independent JavaScript probes.
		if (isCSSRequest(moduleUrl)) continue;
		for (const importedModule of module.importedModules) {
			if (importedModule.file && isPluginProjectModule(importedModule.file, rootDir)) {
				pendingUrls.push(importedModule.url);
			}
		}
	}
	debugDevServer(`transformed ${transformedUrls.size} plugin modules`);
}

export async function startVettaPluginDevServer(
	rootDir: string,
	onEvent: (event: VettaPluginDevEvent) => void,
): Promise<VettaPluginDevServer> {
	process.env.VETTA_PLUGIN_DEV_SERVER = "1";
	setVettaPluginDevEventListener(onEvent);

	let manifest = await readManifest(rootDir);
	let watchedResourceRoots = await collectWatchedResourceRoots(rootDir, manifest);
	const port = await findAvailablePort();
	const server = await createServer({
		root: rootDir,
		configFile: resolveViteConfigFile(rootDir),
		logLevel: "silent",
		server: {
			host: "127.0.0.1",
			port,
			strictPort: true,
			cors: true,
			hmr: { overlay: false },
		},
	});
	debugDevServer("vite server created");
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	const resourceWatcher = watch(watchedResourceRoots, { ignoreInitial: true });
	resourceWatcher.on("error", (error) => {
		emitVettaPluginDevEvent({
			type: "error",
			pluginId: manifest.id,
			message: error instanceof Error ? error.message : String(error),
		});
	});
	resourceWatcher.on("all", (_event, changedPath) => {
		const absolutePath = resolve(changedPath);
		if (!watchedResourceRoots.some((watchedPath) => isInsidePath(absolutePath, watchedPath))) return;
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			void (async () => {
				try {
					if (absolutePath === resolve(rootDir, "plugin.json")) {
						manifest = await readManifest(rootDir);
						const nextWatchedResourceRoots = await collectWatchedResourceRoots(rootDir, manifest);
						const removedRoots = watchedResourceRoots.filter((path) => !nextWatchedResourceRoots.includes(path));
						if (removedRoots.length > 0) await resourceWatcher.unwatch(removedRoots);
						resourceWatcher.add(nextWatchedResourceRoots);
						watchedResourceRoots = nextWatchedResourceRoots;
					}
					emitVettaPluginDevEvent({
						type: "update",
						pluginId: manifest.id,
						reason: "resource",
						path: relative(rootDir, absolutePath).replaceAll("\\", "/"),
					});
				} catch (error) {
					emitVettaPluginDevEvent({
						type: "error",
						pluginId: manifest.id,
						message: error instanceof Error ? error.message : String(error),
					});
				}
			})();
		}, 80);
	});

	let origin: string;
	let entryUrl: string;
	try {
		assertDevPluginsConfigured(server);
		debugDevServer("starting vite listener");
		await server.listen();
		debugDevServer("vite listener ready");
		origin = resolveServerOrigin(server);
		entryUrl = `${origin}/mf-manifest.json`;
		debugDevServer(`probing ${entryUrl}`);
		await assertDevEntryAvailable(entryUrl);
		debugDevServer("probing plugin module graph");
		await assertDevModuleGraphAvailable(server, rootDir);
		debugDevServer("plugin entry ready");
	} catch (error) {
		if (refreshTimer) clearTimeout(refreshTimer);
		setVettaPluginDevEventListener(undefined);
		await Promise.all([resourceWatcher.close(), server.close()]);
		throw error;
	}
	const readyEvent: VettaPluginDevEvent = {
		type: "ready",
		protocolVersion: VETTA_PLUGIN_DEV_PROTOCOL_VERSION,
		pluginId: manifest.id,
		entryUrl,
		origin,
	};
	onEvent(readyEvent);

	return {
		pluginId: manifest.id,
		entryUrl,
		origin,
		async close() {
			if (refreshTimer) clearTimeout(refreshTimer);
			setVettaPluginDevEventListener(undefined);
			await Promise.all([resourceWatcher.close(), server.close()]);
		},
	};
}
