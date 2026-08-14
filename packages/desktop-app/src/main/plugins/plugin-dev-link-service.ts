import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	isPluginApiCompatible,
	parsePluginManifest,
	validatePluginId,
	validatePluginRelativePath,
} from "@vetta-org/plugin-sdk/manifest";
import type {
	InstalledPlugin,
	PluginDevWatchState,
	PluginLocales,
	PluginManifest,
	PluginsChangedEvent,
} from "../../preload/api-types/plugins.js";
import { normalizePluginDevServerUrls } from "./plugin-dev-protocol.js";
import { readPluginLocales, resolvePluginIcon } from "./plugin-package.js";
import { effectivePluginCommands, effectivePluginPermissions } from "./plugin-permission-policy.js";

interface PluginDevLink {
	projectDir: string;
	manifest: PluginManifest;
	locales: PluginLocales;
	reloadToken: string;
	ephemeral: boolean;
	entryUrl?: string;
	origin?: string;
	status: PluginDevWatchState["status"];
	error?: string;
}

interface PluginDevLinkLogger {
	warn(message: string, error?: unknown): void;
}

export interface PluginDevLinkServiceDependencies {
	getBasePlugin(pluginId: string): InstalledPlugin | undefined;
	broadcast(event: PluginsChangedEvent): void;
	hostApiVersion: string;
	logger: PluginDevLinkLogger;
}

export interface SetPluginDevLinkOptions {
	/** Allow an explicitly selected development project to exist without a persisted install record. */
	allowUninstalled?: boolean;
}

export class PluginDevLinkService {
	private readonly links = new Map<string, PluginDevLink>();
	private readonly ephemeralPlugins = new Map<string, InstalledPlugin>();

	constructor(private readonly dependencies: PluginDevLinkServiceDependencies) {}

	set(id: string, projectDir: string, options: SetPluginDevLinkOptions = {}): InstalledPlugin {
		validatePluginId(id);
		const resolvedDir = resolve(projectDir);
		const manifest = this.readManifest(resolvedDir, id);
		let plugin = this.getPlugin(id);
		if (!plugin && options.allowUninstalled) {
			plugin = this.createEphemeralPlugin(resolvedDir, manifest);
			this.ephemeralPlugins.set(id, plugin);
		}
		if (!plugin) throw new Error(`Plugin not installed (apply it once before enabling hot reload): ${id}`);
		this.links.set(id, {
			projectDir: resolvedDir,
			manifest,
			locales: readPluginLocales(resolvedDir, this.dependencies.logger),
			reloadToken: Date.now().toString(),
			ephemeral: this.ephemeralPlugins.has(id),
			status: "starting",
		});
		this.dependencies.broadcast({ pluginIds: [id], reload: false, reason: "dev-status" });
		return this.apply(plugin);
	}

	clear(id: string, broadcast = true): void {
		const changed = this.links.delete(id) || this.ephemeralPlugins.delete(id);
		if (!changed) return;
		this.ephemeralPlugins.delete(id);
		if (broadcast) this.dependencies.broadcast({ pluginIds: [id], reason: "dev-update" });
	}

	has(id: string): boolean {
		return this.links.has(id);
	}

	getProjectDir(id: string): string | undefined {
		return this.links.get(id)?.projectDir;
	}

	listEphemeral(): readonly InstalledPlugin[] {
		return [...this.ephemeralPlugins.values()];
	}

	refresh(id: string): InstalledPlugin {
		const link = this.requireLink(id);
		link.manifest = this.readManifest(link.projectDir, id);
		link.locales = readPluginLocales(link.projectDir, this.dependencies.logger);
		link.reloadToken = Date.now().toString();
		link.status = "running";
		link.error = undefined;
		const plugin = this.getPlugin(id);
		if (!plugin) throw new Error(`Plugin not found: ${id}`);
		this.dependencies.broadcast({ pluginIds: [id], reason: "dev-update" });
		return this.apply(plugin);
	}

	setServer(id: string, entryUrl: string, origin: string): InstalledPlugin {
		const link = this.requireLink(id);
		const serverUrls = normalizePluginDevServerUrls(entryUrl, origin);
		link.entryUrl = serverUrls.entryUrl;
		link.origin = serverUrls.origin;
		link.status = "running";
		link.error = undefined;
		link.manifest = this.readManifest(link.projectDir, id);
		link.locales = readPluginLocales(link.projectDir, this.dependencies.logger);
		const plugin = this.getPlugin(id);
		if (!plugin) throw new Error(`Plugin not found: ${id}`);
		this.dependencies.broadcast({ pluginIds: [id], reason: "dev-ready" });
		return this.apply(plugin);
	}

	deactivate(id: string, error: string): InstalledPlugin | undefined {
		const link = this.links.get(id);
		if (!link) return undefined;
		link.entryUrl = undefined;
		link.origin = undefined;
		link.status = "error";
		link.error = error;
		const plugin = this.getPlugin(id);
		this.dependencies.broadcast({ pluginIds: [id], reason: "dev-update" });
		return plugin ? this.apply(plugin) : undefined;
	}

	setStatus(id: string, status: PluginDevWatchState["status"], error?: string): void {
		const link = this.links.get(id);
		if (!link) return;
		link.status = status;
		link.error = error;
		this.dependencies.broadcast({ pluginIds: [id], reload: false, reason: "dev-status" });
	}

	apply(plugin: InstalledPlugin): InstalledPlugin {
		const link = this.links.get(plugin.id);
		if (!link) return plugin;
		const devWatch: PluginDevWatchState = {
			projectDir: link.projectDir,
			entryUrl: link.entryUrl,
			origin: link.origin,
			status: link.status,
			error: link.error,
		};
		if (!link.entryUrl || !link.origin) {
			return {
				...plugin,
				enabled: link.ephemeral ? false : plugin.enabled,
				devWatch,
			};
		}
		const manifest = link.manifest;
		const permissions = effectivePluginPermissions(manifest.permissions ?? [], plugin.trustLevel);
		const declaredCommands = effectivePluginCommands(manifest.commands ?? [], plugin.trustLevel);
		const grantedPermissions = effectivePluginPermissions(
			Array.from(new Set([...plugin.grantedPermissions, ...permissions])),
			plugin.trustLevel,
		);
		const grantedCommandNames = effectivePluginCommands(
			Array.from(new Set([...(plugin.grantedCommandNames ?? []), ...declaredCommands])),
			plugin.trustLevel,
		);
		return {
			...plugin,
			name: manifest.name,
			version: manifest.version,
			pluginApiVersion: manifest.pluginApiVersion,
			description: manifest.description,
			author: manifest.author,
			runtime: manifest.runtime ?? "esm",
			entryUrl: link.entryUrl ?? toDevPluginUrl(plugin.id, manifest.entry, link.reloadToken),
			moduleFederation: manifest.moduleFederation,
			agent: manifest.agent,
			styleUrls: link.entryUrl
				? []
				: (manifest.styles ?? []).map((style) => toDevPluginUrl(plugin.id, style, link.reloadToken)),
			iconUrl: resolvePluginIcon(manifest.icon, (path) => toDevPluginUrl(plugin.id, path, link.reloadToken)),
			guidingWords: manifest.guidingWords,
			defaultLocale: manifest.defaultLocale ?? "zh",
			locales: link.locales,
			permissions,
			grantedPermissions,
			allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
			declaredCommands,
			grantedCommandNames,
			settingsSchema: manifest.contributes?.settings,
			rootPath: link.projectDir,
			enabled: link.ephemeral ? true : plugin.enabled,
			devWatch,
		};
	}

	private getPlugin(id: string): InstalledPlugin | undefined {
		return this.dependencies.getBasePlugin(id) ?? this.ephemeralPlugins.get(id);
	}

	private requireLink(id: string): PluginDevLink {
		const link = this.links.get(id);
		if (!link) throw new Error(`Plugin is not dev-linked: ${id}`);
		return link;
	}

	private readManifest(projectDir: string, expectedId: string): PluginManifest {
		const manifestFile = resolve(projectDir, "plugin.json");
		if (!existsSync(manifestFile)) throw new Error(`plugin.json not found in ${projectDir}`);
		const manifest = parsePluginManifest(JSON.parse(readFileSync(manifestFile, "utf-8")));
		if (manifest.id !== expectedId) {
			throw new Error(`Project plugin id mismatch: expected ${expectedId}, got ${manifest.id}`);
		}
		return manifest;
	}

	private createEphemeralPlugin(projectDir: string, manifest: PluginManifest): InstalledPlugin {
		if (!isPluginApiCompatible(this.dependencies.hostApiVersion, manifest.pluginApiVersion)) {
			throw new Error(`Unsupported plugin API version: ${manifest.pluginApiVersion}`);
		}
		const now = new Date().toISOString();
		const permissions = effectivePluginPermissions(manifest.permissions ?? [], "local");
		return {
			id: manifest.id,
			name: manifest.name,
			version: manifest.version,
			activeVersion: manifest.version,
			pluginApiVersion: manifest.pluginApiVersion,
			runtime: manifest.runtime ?? "esm",
			entryUrl: toDevPluginUrl(manifest.id, manifest.entry, now),
			moduleFederation: manifest.moduleFederation,
			agent: manifest.agent,
			styleUrls: (manifest.styles ?? []).map((style) => toDevPluginUrl(manifest.id, style, now)),
			permissions,
			grantedPermissions: permissions,
			allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
			declaredCommands: [],
			grantedCommandNames: [],
			settingsSchema: manifest.contributes?.settings,
			description: manifest.description,
			author: manifest.author,
			iconUrl: resolvePluginIcon(manifest.icon, (path) => toDevPluginUrl(manifest.id, path, now)),
			guidingWords: manifest.guidingWords,
			defaultLocale: manifest.defaultLocale ?? "zh",
			locales: readPluginLocales(projectDir, this.dependencies.logger),
			enabled: true,
			required: false,
			installedAt: now,
			updatedAt: now,
			source: "archive",
			trustLevel: "local",
			rootPath: projectDir,
		};
	}
}

function toDevPluginUrl(pluginId: string, relativePath: string, token: string): string {
	const normalized = validatePluginRelativePath(relativePath, "path");
	return `vetta-plugin://${pluginId}/${normalized}?v=dev&reload=${token}`;
}
