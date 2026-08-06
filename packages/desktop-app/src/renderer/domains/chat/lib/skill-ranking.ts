import type { AppMonitorPromptRefUsageMap, SkillInfo } from "@preload/api";

/**
 * 类别权重：内置 > 插件贡献 > Vetta 原生 > 通用 Agent Skill 约定。
 *
 * source 取值来自 main 侧 SkillService.list：`builtin` 与 `plugin` 由它自己判定
 * （内置清单 / 插件贡献路径），其余透传 coding-agent 的 ResourceLoader——
 * `user` / `project` / `scene` / `market` 属 Vetta 原生，`agents-user` /
 * `agents-project` 是跨 agent 通用约定（`~/.agents/skills`）。
 */
const CATEGORY_WEIGHT: Record<string, number> = {
	builtin: 0,
	plugin: 1,
	user: 2,
	project: 2,
	scene: 2,
	market: 2,
	path: 2,
	"agents-user": 3,
	"agents-project": 3,
};

const UNKNOWN_CATEGORY_WEIGHT = 2;

export function skillCategoryWeight(source: string): number {
	return CATEGORY_WEIGHT[source] ?? UNKNOWN_CATEGORY_WEIGHT;
}

export interface SkillUsage {
	used: number;
	lastUsedAt: number;
}

const NO_USAGE: SkillUsage = { used: 0, lastUsedAt: 0 };

/**
 * 取某个 skill 的历史使用量。
 * app-monitor 的 key 是 `kind:name` 且 name 经过归一化（小写 + 截断 128），
 * 所以这里必须同样小写化后再查。
 */
export function lookupSkillUsage(usage: AppMonitorPromptRefUsageMap, skill: SkillInfo): SkillUsage {
	const kind = skill.type === "scene" ? "scene" : "skill";
	return usage[`${kind}:${skill.name.trim().toLowerCase().slice(0, 128)}`] ?? NO_USAGE;
}

/**
 * 命令面板的排序：调用次数优先，其次类别权重，再按最近使用与名称。
 *
 * 「次数最高优先级」是字面意思——用过的一定排在没用过的前面，即使它来自权重
 * 最低的通用目录；没用过的那批才退回按类别分层。
 */
export function sortSkillsForPanel(skills: readonly SkillInfo[], usage: AppMonitorPromptRefUsageMap): SkillInfo[] {
	return [...skills].sort((a, b) => {
		const usageA = lookupSkillUsage(usage, a);
		const usageB = lookupSkillUsage(usage, b);
		if (usageA.used !== usageB.used) return usageB.used - usageA.used;
		const weightA = skillCategoryWeight(a.source);
		const weightB = skillCategoryWeight(b.source);
		if (weightA !== weightB) return weightA - weightB;
		if (usageA.lastUsedAt !== usageB.lastUsedAt) return usageB.lastUsedAt - usageA.lastUsedAt;
		return (a.alias || a.name).localeCompare(b.alias || b.name);
	});
}

/** 面板过滤：按名称与别名匹配，大小写无关。 */
export function filterSkills(skills: readonly SkillInfo[], filter: string): SkillInfo[] {
	const query = filter.trim().toLowerCase();
	if (query === "") return [...skills];
	return skills.filter(
		(skill) => skill.name.toLowerCase().includes(query) || (skill.alias?.toLowerCase().includes(query) ?? false),
	);
}
