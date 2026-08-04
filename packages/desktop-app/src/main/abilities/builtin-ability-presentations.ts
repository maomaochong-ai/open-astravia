import { join, relative } from "node:path";
import type { OpenMarketplaceDetail } from "../../preload/api-types/abilities.js";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { getBuiltinSkillsDir, readBuiltinSkillsManifest } from "../builtin-skills.js";
import { getAppLogger } from "../logger.js";
import { listPlugins } from "../plugins/plugin-store.js";
import { loadAbilityPackagePresentation } from "./open-marketplace/open-marketplace-presentation.js";

export type BuiltinAbilityPresentations = Record<string, OpenMarketplaceDetail>;

const log = getAppLogger("builtin-ability-presentations");

function pluginAssetUrl(plugin: InstalledPlugin, absolutePath: string): string {
	const relativePath = relative(plugin.rootPath, absolutePath).replace(/\\/g, "/");
	const resourcePath =
		plugin.source === "system" || plugin.devWatch
			? relativePath
			: `versions/${encodeURIComponent(plugin.activeVersion)}/${relativePath}`;
	const cacheVersion = plugin.devWatch ? "dev" : encodeURIComponent(plugin.activeVersion);
	return `vetta-plugin://${plugin.id}/${resourcePath}?v=${cacheVersion}`;
}

/**
 * 运行时只聚合索引；详情真相源始终是各 Skill / 已安装插件包根目录里的 ability.json。
 * 单个包介绍损坏不应阻断能力页或应用启动，构建检查负责在发布前拦截。
 */
export function listBuiltinAbilityPresentations(): BuiltinAbilityPresentations {
	const presentations: BuiltinAbilityPresentations = {};
	const skillsRoot = getBuiltinSkillsDir();
	if (skillsRoot) {
		for (const [slug, skill] of Object.entries(readBuiltinSkillsManifest())) {
			try {
				const sourceDir = join(skillsRoot, slug);
				const presentation = loadAbilityPackagePresentation(
					sourceDir,
					{ type: skill.type, slug, version: skill.version },
					skill.version,
				);
				if (presentation) presentations[`${skill.type}:${slug}`] = presentation.detail;
			} catch (error) {
				log.warn(`skill ${slug} presentation ignored`, error);
			}
		}
	}

	for (const plugin of listPlugins()) {
		try {
			const presentation = loadAbilityPackagePresentation(
				plugin.rootPath,
				{ type: "plugin", slug: plugin.id, version: plugin.activeVersion },
				plugin.activeVersion,
				(absolutePath) => pluginAssetUrl(plugin, absolutePath),
			);
			if (presentation) presentations[`plugin:${plugin.id}`] = presentation.detail;
		} catch (error) {
			log.warn(`plugin ${plugin.id} presentation ignored`, error);
		}
	}

	return presentations;
}
