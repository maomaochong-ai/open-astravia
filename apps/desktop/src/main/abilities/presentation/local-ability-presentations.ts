import { join } from "node:path";
import type { LocalAbilityPresentation, LocalAbilityPresentations } from "../../../preload/api-types/abilities.js";
import { getBuiltinSkillsDir, readBuiltinSkillsManifest } from "../../builtin-skills.js";
import { getAppLogger } from "../../logger.js";
import { listPlugins } from "../../plugins/plugin-catalog.js";
import { getSkillBaseDir, readSkillsManifest } from "../../skills/skill-service.js";
import { loadAbilityPackagePresentation } from "../open-marketplace/open-marketplace-presentation.js";
import {
	loadInstalledPluginPackagePresentation,
	resolveInstalledPluginPresentationIcon,
} from "./installed-plugin-presentation.js";

const log = getAppLogger("local-ability-presentations");

export interface LocalAbilityPresentationDependencies {
	readonly getBuiltinSkillsDir: typeof getBuiltinSkillsDir;
	readonly readBuiltinSkillsManifest: typeof readBuiltinSkillsManifest;
	readonly readSkillsManifest: typeof readSkillsManifest;
	readonly getSkillBaseDir: typeof getSkillBaseDir;
	readonly listPlugins: typeof listPlugins;
}

const defaultDependencies: LocalAbilityPresentationDependencies = {
	getBuiltinSkillsDir,
	readBuiltinSkillsManifest,
	readSkillsManifest,
	getSkillBaseDir,
	listPlugins,
};

function put(target: LocalAbilityPresentations, key: string, presentation: LocalAbilityPresentation | null): void {
	if (!presentation) return;
	target[key] = presentation;
}

/**
 * 本地已安装包的呈现索引。它是运行时派生读模型，事实源仍是各包的 ability.json、
 * plugin.json 与安装清单；单个包损坏只降级该条目，不阻断能力页。
 */
export function listLocalAbilityPresentations(
	dependencies: LocalAbilityPresentationDependencies = defaultDependencies,
): LocalAbilityPresentations {
	const presentations: LocalAbilityPresentations = {};
	const builtinRoot = dependencies.getBuiltinSkillsDir();
	if (builtinRoot) {
		for (const [slug, skill] of Object.entries(dependencies.readBuiltinSkillsManifest())) {
			try {
				put(
					presentations,
					`${skill.type}:${slug}`,
					loadAbilityPackagePresentation(
						join(builtinRoot, slug),
						{ type: skill.type, slug, version: skill.version },
						skill.version,
					),
				);
			} catch (error) {
				log.warn(`builtin skill ${slug} presentation ignored`, error);
			}
		}
	}

	for (const [slug, skill] of Object.entries(dependencies.readSkillsManifest())) {
		const type = skill.type === "scene" ? "scene" : "skill";
		try {
			put(
				presentations,
				`${type}:${slug}`,
				loadAbilityPackagePresentation(
					join(dependencies.getSkillBaseDir(type), slug),
					{ type, slug, version: skill.version },
					skill.version,
				),
			);
		} catch (error) {
			log.warn(`${type} ${slug} presentation ignored`, error);
		}
	}

	for (const plugin of dependencies.listPlugins()) {
		try {
			const packagePresentation = loadInstalledPluginPackagePresentation(plugin);
			const icon = resolveInstalledPluginPresentationIcon(plugin, packagePresentation);
			if (packagePresentation || icon) {
				put(presentations, `plugin:${plugin.id}`, {
					...(icon ? { icon } : {}),
					...(packagePresentation ? { detail: packagePresentation.detail } : {}),
				});
			}
		} catch (error) {
			log.warn(`plugin ${plugin.id} presentation ignored`, error);
			if (plugin.iconUrl) put(presentations, `plugin:${plugin.id}`, { icon: plugin.iconUrl });
		}
	}

	return presentations;
}
