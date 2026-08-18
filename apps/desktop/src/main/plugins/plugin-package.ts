import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	isPluginApiCompatible,
	isPluginPassthroughIconRef,
	listPluginManifestResources,
	parsePluginManifest,
	validatePluginRelativePath,
	validatePluginVersion,
} from "@vetta-org/plugin-sdk/manifest";
import AdmZip from "adm-zip";
import type {
	InstalledPlugin,
	PluginInstallOptions,
	PluginLocaleCatalog,
	PluginLocales,
	PluginManifest,
} from "../../preload/api-types/plugins.js";
import { effectivePluginCommands, effectivePluginPermissions } from "./plugin-permission-policy.js";

interface PluginPackageLogger {
	warn(message: string, error?: unknown): void;
}

export function resolvePluginIcon(
	icon: string | undefined,
	toUrl: (relativePath: string) => string,
): string | undefined {
	if (!icon) return undefined;
	return isPluginPassthroughIconRef(icon) ? icon : toUrl(icon);
}

export function readPluginLocales(dir: string, logger: PluginPackageLogger): PluginLocales {
	const localesDir = join(dir, "locales");
	if (!existsSync(localesDir)) return {};
	const result: PluginLocales = {};
	for (const file of readdirSync(localesDir)) {
		if (!file.endsWith(".json")) continue;
		const lang = file.slice(0, -".json".length);
		try {
			const parsed: unknown = JSON.parse(readFileSync(join(localesDir, file), "utf-8"));
			if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
			const catalog: PluginLocaleCatalog = {};
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === "string") catalog[key] = value;
			}
			result[lang] = catalog;
		} catch (error) {
			logger.warn(`locales: 跳过 ${file}（${dir}）：`, error);
		}
	}
	return result;
}

export function versionedPluginPath(version: string, relativePath: string): string {
	validatePluginVersion(version);
	return `versions/${encodeURIComponent(version)}/${validatePluginRelativePath(relativePath, "path")}`;
}

export function toInstalledPluginUrl(pluginId: string, version: string, relativePath: string): string {
	const normalized = validatePluginRelativePath(relativePath, "path");
	return `vetta-plugin://${pluginId}/${versionedPluginPath(version, normalized)}?v=${encodeURIComponent(version)}`;
}

export function createInstalledPluginFromManifest(input: {
	manifest: PluginManifest;
	options?: PluginInstallOptions;
	previous?: InstalledPlugin;
	locales: PluginLocales;
	hostApiVersion: string;
	rootPath: string;
}): InstalledPlugin {
	const { manifest, options, previous, locales, hostApiVersion, rootPath } = input;
	if (!isPluginApiCompatible(hostApiVersion, manifest.pluginApiVersion)) {
		throw new Error(`Unsupported plugin API version: ${manifest.pluginApiVersion}`);
	}
	const now = new Date().toISOString();
	const activeVersion = previous?.activeVersion ?? manifest.version;
	const entryUrl = previous?.entryUrl ?? toInstalledPluginUrl(manifest.id, activeVersion, manifest.entry);
	const styleUrls =
		previous?.styleUrls ??
		(manifest.styles ?? []).map((style) => toInstalledPluginUrl(manifest.id, activeVersion, style));
	const trustLevel: InstalledPlugin["trustLevel"] =
		options?.source === "remote" || options?.source === "npm" ? "community" : "local";
	const permissions = effectivePluginPermissions(manifest.permissions ?? [], trustLevel);
	const grantedPermissions = Array.from(
		new Set(
			(options?.grantedPermissions ?? previous?.grantedPermissions ?? []).filter((permission) =>
				permissions.includes(permission),
			),
		),
	);
	const iconUrl = previous
		? previous.iconUrl
		: resolvePluginIcon(manifest.icon, (path) => toInstalledPluginUrl(manifest.id, activeVersion, path));
	const declaredCommands = effectivePluginCommands(manifest.commands ?? [], trustLevel);
	const grantedCommandNames = effectivePluginCommands(previous?.grantedCommandNames ?? [], trustLevel);
	return {
		id: manifest.id,
		name: manifest.name,
		version: manifest.version,
		activeVersion,
		pluginApiVersion: manifest.pluginApiVersion,
		runtime: previous?.runtime ?? manifest.runtime ?? "esm",
		entryUrl,
		moduleFederation: previous?.moduleFederation ?? manifest.moduleFederation,
		agent: previous?.agent ?? manifest.agent,
		styleUrls,
		permissions,
		grantedPermissions,
		allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
		declaredCommands,
		grantedCommandNames,
		settingsSchema: manifest.contributes?.settings,
		description: manifest.description,
		author: manifest.author,
		iconUrl,
		guidingWords: manifest.guidingWords,
		defaultLocale: manifest.defaultLocale ?? "zh",
		locales,
		enabled: options?.enable === true ? true : (previous?.enabled ?? false),
		required: false,
		installedAt: previous?.installedAt ?? now,
		updatedAt: now,
		source: options?.source ?? "archive",
		distribution: options?.source === "npm" ? options.npm : undefined,
		trustLevel,
		availableVersion: previous && previous.version !== manifest.version ? manifest.version : undefined,
		pendingVersion: previous && previous.version !== manifest.version ? manifest.version : undefined,
		rootPath,
	};
}

export async function extractPluginArchive(buffer: Buffer, targetDir: string): Promise<void> {
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	new AdmZip(buffer).extractAllTo(targetDir, true);
}

export async function findPluginManifest(extractDir: string): Promise<{ manifest: PluginManifest; sourceDir: string }> {
	const directManifest = join(extractDir, "plugin.json");
	if (existsSync(directManifest)) {
		return {
			manifest: parsePluginManifest(JSON.parse(readFileSync(directManifest, "utf-8"))),
			sourceDir: extractDir,
		};
	}
	const entries = await readdir(extractDir);
	const directories = entries
		.map((entry) => join(extractDir, entry))
		.filter((entryPath) => statSync(entryPath).isDirectory());
	if (directories.length === 1) {
		const nestedManifest = join(directories[0], "plugin.json");
		if (existsSync(nestedManifest)) {
			return {
				manifest: parsePluginManifest(JSON.parse(readFileSync(nestedManifest, "utf-8"))),
				sourceDir: directories[0],
			};
		}
	}
	throw new Error("plugin.json not found at archive root");
}

export function validatePluginPackageResources(sourceDir: string, manifest: PluginManifest): void {
	for (const resource of listPluginManifestResources(manifest)) {
		const resourcePath = resolve(sourceDir, resource.path);
		const relativePath = relative(sourceDir, resourcePath);
		if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
			throw new Error(`Plugin resource is outside package root: ${resource.field}`);
		}
		if (!existsSync(resourcePath)) {
			throw new Error(`Plugin resource is missing: ${resource.field} (${resource.path})`);
		}
		const info = statSync(resourcePath);
		if (resource.kind === "file" && !info.isFile()) {
			throw new Error(`Plugin resource must be a file: ${resource.field} (${resource.path})`);
		}
		if (resource.kind === "file-or-directory" && !info.isFile() && !info.isDirectory()) {
			throw new Error(`Plugin resource is invalid: ${resource.field} (${resource.path})`);
		}
	}
}

export async function copyPluginPackage(
	sourceDir: string,
	pluginsBaseDir: string,
	pluginId: string,
	version: string,
): Promise<void> {
	validatePluginVersion(version);
	const targetDir = join(pluginsBaseDir, pluginId, "versions", version);
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(dirname(targetDir), { recursive: true });
	await cp(sourceDir, targetDir, { recursive: true });
}
