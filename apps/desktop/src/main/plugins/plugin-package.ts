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

export const VETTA_PLUGIN_PACKAGE_EXTENSION = ".vettapkg";
export const VETTA_PLUGIN_PACKAGE_MIME_TYPE = "application/vnd.vetta.plugin+zip";
const MAX_PLUGIN_MANIFEST_BYTES = 1024 * 1024;

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

/**
 * 带 reload token 的包内资源 URL：token 变化会让渲染进程丢弃已加载的旧远端（MF reloadBust），
 * 是「同一插件换了版本」在渲染层生效的唯一手段。
 */
export function installedPluginResourceUrl(
	pluginId: string,
	version: string,
	relativePath: string,
	reloadToken: string,
): string {
	return `${toInstalledPluginUrl(pluginId, version, relativePath)}&reload=${encodeURIComponent(reloadToken)}`;
}

/** manifest 决定的版本字段；用户态（启用、授权、安装时间）不在其中。 */
export type PluginVersionProjection = Pick<
	InstalledPlugin,
	| "name"
	| "version"
	| "pluginApiVersion"
	| "description"
	| "author"
	| "entryUrl"
	| "styleUrls"
	| "iconUrl"
	| "moduleFederation"
	| "agent"
	| "cliProviders"
	| "serviceProviders"
	| "guidingWords"
	| "defaultLocale"
	| "locales"
	| "permissions"
	| "allowedNetworkHosts"
	| "allowedBrowserHosts"
	| "declaredCommands"
>;

/**
 * manifest → InstalledPlugin 版本字段的唯一投射。
 *
 * 安装、重载、dev 链接三条路径原先各写一份，覆盖的字段集互不相同，manifest 新增字段必须
 * 在三处同步，漏一处就表现为「版本号变了、内容没变」。版本字段只从这里产出；调用方只提供
 * 「包内相对路径如何变成可加载 URL」，并自行决定用户态字段。
 */
export function projectPluginVersion(input: {
	manifest: PluginManifest;
	locales: PluginLocales;
	toResourceUrl: (relativePath: string) => string;
}): PluginVersionProjection {
	const { manifest, locales, toResourceUrl } = input;
	return {
		name: manifest.name,
		version: manifest.version,
		pluginApiVersion: manifest.pluginApiVersion,
		description: manifest.description,
		author: manifest.author,
		entryUrl: toResourceUrl(manifest.entry),
		styleUrls: (manifest.styles ?? []).map((style) => toResourceUrl(style)),
		iconUrl: resolvePluginIcon(manifest.icon, toResourceUrl),
		moduleFederation: manifest.moduleFederation,
		agent: manifest.agent,
		cliProviders: manifest.providers?.cli ?? [],
		serviceProviders: manifest.providers?.services ?? [],
		guidingWords: manifest.guidingWords,
		defaultLocale: manifest.defaultLocale ?? "zh",
		locales,
		permissions: effectivePluginPermissions(manifest.permissions ?? []),
		allowedNetworkHosts: manifest.network?.allowedHosts ?? [],
		allowedBrowserHosts: manifest.browser?.allowedHosts ?? [],
		declaredCommands: effectivePluginCommands(manifest.commands ?? []),
	};
}

/**
 * 装包即完整装配：新版本的资源 URL、贡献声明、locales 一次性换成新 manifest 的，
 * `activeVersion` 同步落到新版本。安装与「生效」曾经是两步（装完只改 version、留一个
 * pendingVersion 等调用方再调 reloadPlugin），任何忘了那一步的入口都会把旧代码挂在新版本号
 * 下跑，且重启不会自愈。保留下来的只有用户态：启用状态、已授予的权限与命令、首次安装时间。
 */
export function createInstalledPluginFromManifest(input: {
	manifest: PluginManifest;
	options?: PluginInstallOptions;
	previous?: InstalledPlugin;
	locales: PluginLocales;
	hostApiVersion: string;
	rootPath: string;
	reloadToken: string;
}): InstalledPlugin {
	const { manifest, options, previous, locales, hostApiVersion, rootPath, reloadToken } = input;
	if (!isPluginApiCompatible(hostApiVersion, manifest.pluginApiVersion)) {
		throw new Error(`Unsupported plugin API version: ${manifest.pluginApiVersion}`);
	}
	const now = new Date().toISOString();
	const projected = projectPluginVersion({
		manifest,
		locales,
		toResourceUrl: (path) => installedPluginResourceUrl(manifest.id, manifest.version, path, reloadToken),
	});
	const trustLevel: InstalledPlugin["trustLevel"] =
		options?.source === "remote" || options?.source === "npm" ? "community" : "local";
	// 升级不自动扩大授权：旧授权与新声明取交集，新增权限仍要用户在确认界面勾选。
	const grantedPermissions = Array.from(
		new Set(
			(options?.grantedPermissions ?? previous?.grantedPermissions ?? []).filter((permission) =>
				projected.permissions.includes(permission),
			),
		),
	);
	const grantedCommandNames = effectivePluginCommands(previous?.grantedCommandNames ?? []).filter((name) =>
		projected.declaredCommands.includes(name),
	);
	return {
		id: manifest.id,
		...projected,
		activeVersion: manifest.version,
		grantedPermissions,
		grantedCommandNames,
		enabled: options?.enable === true ? true : (previous?.enabled ?? false),
		required: false,
		installedAt: previous?.installedAt ?? now,
		updatedAt: now,
		source: options?.source ?? "archive",
		distribution: options?.source === "npm" ? options.npm : undefined,
		trustLevel,
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

/**
 * Read the identity and requested capabilities before installing a package.
 * The accepted layouts intentionally match findPluginManifest(): plugin.json
 * may be at the archive root or inside one top-level directory.
 */
export function readPluginManifestFromArchive(buffer: Buffer): PluginManifest {
	const archive = new AdmZip(buffer);
	const direct = archive.getEntry("plugin.json");
	if (direct && !direct.isDirectory) {
		if (direct.header.size > MAX_PLUGIN_MANIFEST_BYTES) throw new Error("plugin.json exceeds the 1 MB limit");
		return parsePluginManifest(JSON.parse(archive.readAsText(direct)) as unknown);
	}
	const entries = archive.getEntries();
	const directories = new Set(
		entries.flatMap((entry) => {
			const normalized = entry.entryName.replaceAll("\\", "/");
			const separator = normalized.indexOf("/");
			return separator > 0 ? [normalized.slice(0, separator)] : [];
		}),
	);
	const nested = entries.filter((entry) => !entry.isDirectory && /^[^/\\]+[/\\]plugin\.json$/u.test(entry.entryName));
	if (directories.size !== 1 || nested.length !== 1) {
		throw new Error("plugin.json not found at archive root");
	}
	if (nested[0].header.size > MAX_PLUGIN_MANIFEST_BYTES) {
		throw new Error("plugin.json exceeds the 1 MB limit");
	}
	return parsePluginManifest(JSON.parse(archive.readAsText(nested[0])) as unknown);
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
