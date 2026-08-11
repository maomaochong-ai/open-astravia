import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	isPluginApiCompatible,
	parsePluginCommandNames,
	parsePluginManifest,
	validatePluginRelativePath,
} from "@vetta-org/plugin-sdk/manifest";
import type { InstalledPlugin, PluginLocales, PluginManifest } from "../../preload/api-types/plugins.js";
import { readPluginLocales, resolvePluginIcon } from "./plugin-package.js";
import type { SystemPluginPreferenceStore } from "./plugin-registry-store.js";

interface SystemPluginCatalogLogger {
	warn(message: string, error?: unknown): void;
}

export interface SystemPluginCatalogDependencies {
	baseDir(): string;
	preferences: Pick<SystemPluginPreferenceStore, "read" | "write">;
	requiredPluginIds: ReadonlySet<string>;
	hostApiVersion: string;
	isPackaged: boolean;
	registerModeGate(pluginId: string): void;
	logger: SystemPluginCatalogLogger;
}

export class SystemPluginCatalog {
	private cache: InstalledPlugin[] | undefined;
	private readonly ids = new Set<string>();

	constructor(private readonly dependencies: SystemPluginCatalogDependencies) {}

	list(force = false): InstalledPlugin[] {
		if (this.cache && !force) return this.cache;
		const baseDir = this.dependencies.baseDir();
		const result: InstalledPlugin[] = [];
		this.ids.clear();
		if (existsSync(baseDir)) {
			const preferences = this.dependencies.preferences.read();
			for (const entry of readdirSync(baseDir)) {
				const dir = join(baseDir, entry);
				try {
					if (!statSync(dir).isDirectory()) continue;
					const manifestFile = join(dir, "plugin.json");
					if (!existsSync(manifestFile)) continue;
					const manifest = parsePluginManifest(JSON.parse(readFileSync(manifestFile, "utf-8")));
					if (!existsSync(join(dir, manifest.entry))) {
						this.dependencies.logger.warn(`discover: 跳过 ${manifest.id}：staging 缺少入口 (${manifest.entry})`);
						continue;
					}
					if (manifest.contributionMode?.hardIsolation) this.dependencies.registerModeGate(manifest.id);
					result.push(
						this.fromManifest(
							manifest,
							preferences[manifest.id]?.enabled ?? true,
							readPluginLocales(dir, this.dependencies.logger),
							preferences[manifest.id]?.disabledCommands ?? [],
						),
					);
					this.ids.add(manifest.id);
				} catch (error) {
					this.dependencies.logger.warn(`discover: 跳过 ${entry}：`, error);
				}
			}
		}
		this.cache = result;
		return result;
	}

	has(id: string): boolean {
		if (!this.cache) this.list();
		return this.ids.has(id);
	}

	setEnabled(id: string, enabled: boolean): InstalledPlugin {
		this.requireCurrent(id);
		if (!enabled && this.dependencies.requiredPluginIds.has(id)) {
			throw new Error(`Required system plugin cannot be disabled: ${id}`);
		}
		const preferences = this.dependencies.preferences.read();
		preferences[id] = { ...preferences[id], enabled };
		this.dependencies.preferences.write(preferences);
		return this.requireRefreshed(id);
	}

	grantCommands(id: string, names: string[]): InstalledPlugin {
		const current = this.requireCurrent(id);
		const requested = parsePluginCommandNames(names);
		const declared = new Set(current.declaredCommands);
		const preferences = this.dependencies.preferences.read();
		const previous = preferences[id]?.disabledCommands ?? [];
		const disabledCommands = previous.filter((name) => !requested.includes(name) && declared.has(name));
		preferences[id] = {
			enabled: preferences[id]?.enabled ?? current.enabled,
			disabledCommands,
		};
		this.dependencies.preferences.write(preferences);
		return this.requireRefreshed(id);
	}

	revokeCommands(id: string, names: string[]): InstalledPlugin {
		const current = this.requireCurrent(id);
		const requested = parsePluginCommandNames(names);
		const declared = new Set(current.declaredCommands);
		const preferences = this.dependencies.preferences.read();
		const previous = preferences[id]?.disabledCommands ?? [];
		const disabledCommands = Array.from(new Set([...previous, ...requested.filter((name) => declared.has(name))]));
		preferences[id] = {
			enabled: preferences[id]?.enabled ?? current.enabled,
			disabledCommands,
		};
		this.dependencies.preferences.write(preferences);
		return this.requireRefreshed(id);
	}

	rootPath(pluginId: string): string {
		return join(this.dependencies.baseDir(), pluginId);
	}

	private requireCurrent(id: string): InstalledPlugin {
		const current = this.list().find((plugin) => plugin.id === id);
		if (!current) throw new Error(`Plugin not found: ${id}`);
		return current;
	}

	private requireRefreshed(id: string): InstalledPlugin {
		const refreshed = this.list(true).find((plugin) => plugin.id === id);
		if (!refreshed) throw new Error(`Plugin not found: ${id}`);
		return refreshed;
	}

	private fromManifest(
		manifest: PluginManifest,
		enabled: boolean,
		locales: PluginLocales,
		disabledCommands: string[],
	): InstalledPlugin {
		if (!isPluginApiCompatible(this.dependencies.hostApiVersion, manifest.pluginApiVersion)) {
			throw new Error(`Unsupported plugin API version: ${manifest.pluginApiVersion}`);
		}
		const now = new Date().toISOString();
		const required = this.dependencies.requiredPluginIds.has(manifest.id);
		const declaredCommands = manifest.commands ?? [];
		return {
			id: manifest.id,
			name: manifest.name,
			version: manifest.version,
			activeVersion: manifest.version,
			pluginApiVersion: manifest.pluginApiVersion,
			runtime: manifest.runtime ?? "esm",
			entryUrl: this.toResourceUrl(manifest.id, manifest.entry, manifest.version),
			moduleFederation: manifest.moduleFederation,
			agent: manifest.agent,
			agent_mode: manifest.agent_mode,
			styleUrls: (manifest.styles ?? []).map((style) => this.toResourceUrl(manifest.id, style, manifest.version)),
			permissions: manifest.permissions ?? [],
			grantedPermissions: manifest.permissions ?? [],
			allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
			declaredCommands,
			grantedCommandNames: declaredCommands.filter((name) => !disabledCommands.includes(name)),
			settingsSchema: manifest.contributes?.settings,
			description: manifest.description,
			author: manifest.author,
			iconUrl: resolvePluginIcon(manifest.icon, (path) => this.toResourceUrl(manifest.id, path, manifest.version)),
			guidingWords: manifest.guidingWords,
			defaultLocale: manifest.defaultLocale ?? "zh",
			locales,
			enabled: required || enabled,
			required,
			installedAt: now,
			updatedAt: now,
			source: "system",
			trustLevel: "official",
			rootPath: this.rootPath(manifest.id),
		};
	}

	private toResourceUrl(pluginId: string, relativePath: string, version: string): string {
		const normalized = validatePluginRelativePath(relativePath, "path");
		const cacheVersion = this.dependencies.isPackaged
			? version
			: this.resourceCacheVersion(pluginId, normalized, version);
		return `vetta-plugin://${pluginId}/${normalized}?v=${encodeURIComponent(cacheVersion)}`;
	}

	private resourceCacheVersion(pluginId: string, relativePath: string, version: string): string {
		try {
			return `${version}-${Math.floor(statSync(join(this.rootPath(pluginId), relativePath)).mtimeMs)}`;
		} catch {
			return version;
		}
	}
}
