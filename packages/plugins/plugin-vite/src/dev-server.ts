import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	listPluginManifestResources,
	parsePluginManifest,
	type PluginManifest,
} from "@vetta-org/plugin-sdk/manifest";
import { type FSWatcher, watch } from "chokidar";
import { createServer, type ViteDevServer } from "vite";
import { emitVettaPluginDevEvent, setVettaPluginDevEventListener, type VettaPluginDevEvent } from "./dev-events.js";

export interface VettaPluginDevServer {
	pluginId: string;
	entryUrl: string;
	origin: string;
	close(): Promise<void>;
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

async function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const handleReady = () => {
			watcher.off("error", handleError);
			resolvePromise();
		};
		const handleError = (error: unknown) => {
			watcher.off("ready", handleReady);
			reject(error);
		};
		watcher.once("ready", handleReady);
		watcher.once("error", handleError);
	});
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
		await Promise.all([server.listen(), waitForWatcherReady(resourceWatcher)]);
		origin = resolveServerOrigin(server);
		entryUrl = `${origin}/mf-manifest.json`;
		await assertDevEntryAvailable(entryUrl);
	} catch (error) {
		if (refreshTimer) clearTimeout(refreshTimer);
		setVettaPluginDevEventListener(undefined);
		await Promise.all([resourceWatcher.close(), server.close()]);
		throw error;
	}
	const readyEvent: VettaPluginDevEvent = { type: "ready", pluginId: manifest.id, entryUrl, origin };
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
