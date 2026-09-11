import { statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import type { InstalledPlugin } from "../../../preload/api-types/plugins.js";
import { resolvePluginPresentationIcon } from "../../../shared/ability-presentation.js";
import {
	loadAbilityPackagePresentation,
	type OpenMarketplacePresentation,
} from "../open-marketplace/open-marketplace-presentation.js";

export function installedPluginAssetUrl(plugin: InstalledPlugin, absolutePath: string): string {
	const pathFromRoot = relative(plugin.rootPath, absolutePath);
	if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
		throw new Error(`Plugin presentation asset escapes package root: ${absolutePath}`);
	}
	const relativePath = pathFromRoot.replace(/\\/g, "/");
	const resourcePath =
		plugin.source === "system" || plugin.devWatch
			? relativePath
			: `versions/${encodeURIComponent(plugin.activeVersion)}/${relativePath}`;
	const cacheVersion = plugin.devWatch
		? Math.trunc(statSync(absolutePath).mtimeMs).toString(36)
		: encodeURIComponent(plugin.activeVersion);
	return `vetta-plugin://${plugin.id}/${resourcePath}?v=${cacheVersion}`;
}

export function loadInstalledPluginPackagePresentation(plugin: InstalledPlugin): OpenMarketplacePresentation | null {
	return loadAbilityPackagePresentation(
		plugin.rootPath,
		{ type: "plugin", slug: plugin.id, version: plugin.activeVersion },
		plugin.activeVersion,
		(absolutePath) => installedPluginAssetUrl(plugin, absolutePath),
	);
}

export function resolveInstalledPluginPresentationIcon(
	plugin: InstalledPlugin,
	presentation = loadInstalledPluginPackagePresentation(plugin),
): string | undefined {
	return resolvePluginPresentationIcon({
		packageIcon: presentation?.icon,
		manifestIcon: plugin.iconUrl,
	});
}
