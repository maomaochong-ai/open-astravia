import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";
import { normalizeMarketplaceSourcePath } from "./marketplace-schema.js";

type PluginAbilityManifest = Extract<MarketplaceAbilityManifest, { type: "plugin" }>;

export interface OpenMarketplacePluginConfig {
	[key: string]: unknown;
	api_version: string;
	permissions: string[];
	commands: string[];
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid open marketplace plugin ${field}`);
	return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
		throw new Error(`Invalid open marketplace plugin ${field}`);
	}
	return Array.from(new Set(value.map((entry) => (entry as string).trim())));
}

function resolvePackageFile(sourceDir: string, path: string, field: string): string {
	const normalized = normalizeMarketplaceSourcePath(path);
	const target = resolve(sourceDir, normalized);
	const pathFromSource = relative(sourceDir, target);
	if (
		pathFromSource === ".." ||
		pathFromSource.startsWith(`..${sep}`) ||
		isAbsolute(pathFromSource) ||
		!existsSync(target) ||
		!statSync(target).isFile()
	) {
		throw new Error(`Open marketplace plugin ${field} is missing or outside the package: ${path}`);
	}
	return target;
}

export function validateOpenMarketplacePlugin(
	sourceDir: string,
	ability: PluginAbilityManifest,
): OpenMarketplacePluginConfig {
	if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
		throw new Error(`Open marketplace plugin directory is missing: ${ability.source.path}`);
	}
	const manifestPath = resolvePackageFile(sourceDir, "plugin.json", "manifest");
	const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Invalid open marketplace plugin manifest");
	}
	const manifest = raw as Record<string, unknown>;
	const id = requireString(manifest.id, "id");
	const version = requireString(manifest.version, "version");
	if (id !== ability.slug) throw new Error(`Open marketplace plugin id does not match ability slug: ${id}`);
	if (version !== ability.version) {
		throw new Error(`Open marketplace plugin version does not match ability version: ${version}`);
	}
	requireString(manifest.name, "name");
	const apiVersion = requireString(manifest.pluginApiVersion, "pluginApiVersion");
	resolvePackageFile(sourceDir, requireString(manifest.entry, "entry"), "entry");
	for (const style of stringArray(manifest.styles, "styles")) resolvePackageFile(sourceDir, style, "style");
	return {
		api_version: apiVersion,
		permissions: stringArray(manifest.permissions, "permissions"),
		commands: stringArray(manifest.commands, "commands"),
	};
}

export function createOpenMarketplacePluginArchive(sourceDir: string): Buffer {
	const archive = new AdmZip();
	archive.addLocalFolder(sourceDir);
	return archive.toBuffer();
}
