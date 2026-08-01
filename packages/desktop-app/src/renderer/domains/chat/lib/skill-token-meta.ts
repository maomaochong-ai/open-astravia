/**
 * skill 展示信息（图标 / 别名）的纯解析逻辑，口径与能力广场一致：
 * 图标只存在于市场目录（`MarketAbility.icon`），本地条目按 slug + type 认领；
 * 随 App 分发的内置 Skill 不在市场目录里，图标走 renderer 静态资源。
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
		(skill.source === "builtin" ? builtinSkillIconUrl(skill.name) : undefined)
	);
}

export interface SkillTokenMeta {
	label: string;
	icon?: string;
}

/** 行内 skill token 的展示表：slug → 别名 + 图标。 */
export function buildSkillTokenMetaMap(
	skills: readonly SkillInfo[],
	iconMap: SkillIconMap,
): ReadonlyMap<string, SkillTokenMeta> {
	const map = new Map<string, SkillTokenMeta>();
	for (const skill of skills) {
		// 文本流里的 token 只可能是 skill：scene 是硬展开，走 promptRef + 顶部胶囊。
		if (skill.type !== "skill") continue;
		if (map.has(skill.name)) continue;
		const icon = skillIconOf(iconMap, skill);
		map.set(skill.name, { label: skill.alias || skill.name, ...(icon ? { icon } : {}) });
	}
	return map;
}
