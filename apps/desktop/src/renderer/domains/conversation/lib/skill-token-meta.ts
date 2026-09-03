/**
 * skill 展示信息（图标 / 别名）的纯解析逻辑，口径与能力广场一致：
 * 1. 市场目录（`MarketAbility.icon`，含开源市场）按 slug + type 认领；
 * 2. 列表项自带 `skill.icon`（插件贡献 skill 填宿主插件 iconUrl）；
 * 3. 随 App 分发的内置 Skill 走 renderer 静态资源。
 *
 * 与 React/IPC 解耦住在 lib：命令区、消息气泡、输入框胶囊共用同一份口径。
 */
import type { SkillInfo } from "@preload/api";
import { builtinSkillIconUrl } from "@shared/lib/builtin-skill-icons";

/** 键为 `${type}:${slug}`：本地清单里 skill 与 scene 同命名空间，同名不同类型不能互相认领。 */
export type SkillIconMap = ReadonlyMap<string, string>;

export function skillIconOf(map: SkillIconMap, skill: SkillInfo): string | undefined {
	return (
		map.get(`${skill.type}:${skill.name}`) ??
		skill.icon ??
		(skill.source === "builtin" ? builtinSkillIconUrl(skill.name) : undefined)
	);
}

export interface SkillTokenMeta {
	label: string;
	icon?: string;
}

/** 行内 skill / scene token 的展示表：`${type}:${slug}` → 别名 + 图标。 */
export function buildSkillTokenMetaMap(
	skills: readonly SkillInfo[],
	iconMap: SkillIconMap,
): ReadonlyMap<string, SkillTokenMeta> {
	const map = new Map<string, SkillTokenMeta>();
	for (const skill of skills) {
		if (skill.type !== "skill" && skill.type !== "scene") continue;
		const key = `${skill.type}:${skill.name}`;
		if (map.has(key)) continue;
		const icon = skillIconOf(iconMap, skill);
		map.set(key, { label: skill.alias || skill.name, ...(icon ? { icon } : {}) });
	}
	return map;
}
