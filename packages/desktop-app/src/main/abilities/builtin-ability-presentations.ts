import { join, relative } from "node:path";
import type { OpenMarketplaceDetail } from "../../preload/api-types/abilities.js";
import { getBuiltinSkillsDir, readBuiltinSkillsManifest } from "../builtin-skills.js";
import { getAppLogger } from "../logger.js";
import { discoverSystemPlugins } from "../plugins/plugin-store.js";
import { loadAbilityPackagePresentation } from "./open-marketplace/open-marketplace-presentation.js";

export type BuiltinAbilityPresentations = Record<string, OpenMarketplaceDetail>;

const log = getAppLogger("builtin-ability-presentations");

function pluginAssetUrl(pluginId: string, version: string, rootPath: string, absolutePath: string): string {
	const resourcePath = relative(rootPath, absolutePath).replace(/\\/g, "/");
	return `vetta-plugin://${pluginId}/${resourcePath}?v=${encodeURIComponent(version)}`;
}

/**
 * 运行时只聚合索引；详情真相源始终是各 Skill / 系统插件包根目录里的 ability.json。
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

	for (const plugin of discoverSystemPlugins()) {
		try {
			const presentation = loadAbilityPackagePresentation(
				plugin.rootPath,
				{ type: "plugin", slug: plugin.id, version: plugin.activeVersion },
				plugin.activeVersion,
				(absolutePath) => pluginAssetUrl(plugin.id, plugin.activeVersion, plugin.rootPath, absolutePath),
			);
			if (presentation) presentations[`plugin:${plugin.id}`] = presentation.detail;
		} catch (error) {
			log.warn(`plugin ${plugin.id} presentation ignored`, error);
		}
	}

	return presentations;
}
