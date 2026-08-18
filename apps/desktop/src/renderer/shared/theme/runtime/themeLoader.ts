import { createInstance, type ModuleFederation } from "@module-federation/enhanced/runtime";
import type { DesktopThemePackage } from "@preload/api";
import type { ThemeModule } from "@vetta/theme-sdk";
import { createThemeRuntimeShared } from "./themeSharedModules";

interface ThemeModuleExports {
	default?: ThemeModule;
	theme?: ThemeModule;
}

interface LoadedThemePackage {
	module: ThemeModule;
	dispose(): void;
}

let host: ModuleFederation | undefined;
const registeredEntries = new Map<string, string>();
const moduleLoadCache = new Map<string, Promise<ThemeModule>>();

function formatMs(start: number): string {
	return `${(performance.now() - start).toFixed(1)}ms`;
}

function cacheKey(theme: DesktopThemePackage): string {
	return `${theme.id}@${theme.version}:${theme.entryUrl}`;
}

function getHost(): ModuleFederation {
	host ??= createInstance({
		name: "vetta_theme_host",
		remotes: [],
		shared: createThemeRuntimeShared(),
		shareStrategy: "loaded-first",
	});
	return host;
}

function loadStyles(theme: DesktopThemePackage): () => void {
	const elements = theme.styleUrls.map((url) => {
		const start = performance.now();
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = url;
		link.dataset.themePackage = theme.id;
		link.addEventListener(
			"load",
			() => {
				console.debug(`[theme-runtime] style loaded "${theme.id}" href=${url} elapsed=${formatMs(start)}`);
			},
			{ once: true },
		);
		link.addEventListener(
			"error",
			() => {
				console.warn(`[theme-runtime] style failed "${theme.id}" href=${url} elapsed=${formatMs(start)}`);
			},
			{ once: true },
		);
		document.head.append(link);
		return link;
	});
	return () => {
		for (const element of elements) element.remove();
	};
}

async function loadThemeModule(theme: DesktopThemePackage): Promise<ThemeModule> {
	const key = cacheKey(theme);
	const cached = moduleLoadCache.get(key);
	if (cached) {
		const cacheStart = performance.now();
		console.debug(`[theme-runtime] module cache hit "${theme.id}" key=${key}`);
		return cached.finally(() => {
			console.debug(`[theme-runtime] module cache resolved "${theme.id}" elapsed=${formatMs(cacheStart)}`);
		});
	}

	const promise = loadThemeModuleUncached(theme);
	moduleLoadCache.set(key, promise);
	try {
		return await promise;
	} catch (error) {
		moduleLoadCache.delete(key);
		throw error;
	}
}

async function loadThemeModuleUncached(theme: DesktopThemePackage): Promise<ThemeModule> {
	const totalStart = performance.now();
	console.info(`[theme-runtime] module load start "${theme.id}" entry=${theme.entryUrl}`);

	const hostStart = performance.now();
	const federationHost = getHost();
	console.debug(`[theme-runtime] module host ready "${theme.id}" elapsed=${formatMs(hostStart)}`);

	const remote = {
		name: theme.moduleFederation.remoteName,
		alias: theme.id,
		entry: theme.entryUrl,
	};
	const registerStart = performance.now();
	const previousEntry = registeredEntries.get(remote.name);
	federationHost.registerRemotes(
		[remote],
		previousEntry === undefined ? undefined : { force: previousEntry !== remote.entry },
	);
	registeredEntries.set(remote.name, remote.entry);
	console.debug(
		`[theme-runtime] remote registered "${theme.id}" remote=${remote.name} force=${previousEntry !== undefined && previousEntry !== remote.entry} elapsed=${formatMs(registerStart)}`,
	);

	const expose = theme.moduleFederation.expose.replace(/^\.\//, "");
	const remoteStart = performance.now();
	const exports = await federationHost.loadRemote<ThemeModuleExports>(`${remote.name}/${expose}`, { from: "runtime" });
	console.debug(`[theme-runtime] loadRemote complete "${theme.id}" expose=${expose} elapsed=${formatMs(remoteStart)}`);

	const module = exports?.default ?? exports?.theme;
	if (!module || module.meta?.id !== theme.id) {
		throw new Error(`Theme module "${theme.id}" did not export a matching ThemeModule`);
	}
	console.info(`[theme-runtime] module load complete "${theme.id}" elapsed=${formatMs(totalStart)}`);
	return module;
}

export async function loadThemePackage(theme: DesktopThemePackage): Promise<LoadedThemePackage> {
	const start = performance.now();
	console.info(`[theme-runtime] loadThemePackage start "${theme.id}" entry=${theme.entryUrl}`);
	const module = await loadThemeModule(theme);
	const styleStart = performance.now();
	const disposeStyles = loadStyles(theme);
	console.debug(
		`[theme-runtime] styles appended "${theme.id}" count=${theme.styleUrls.length} elapsed=${formatMs(styleStart)}`,
	);
	console.info(`[theme-runtime] loadThemePackage complete "${theme.id}" elapsed=${formatMs(start)}`);
	return { module, dispose: disposeStyles };
}
