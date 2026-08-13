import type { InstalledSkill } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";

export interface MergedSkill {
	name: string;
	alias: string;
	description: string;
	type: "skill" | "scene";
	version: string;
	author: string;
	tags: string[];
	category: string;
	/** 空=默认；solar:xxx-bold；或已解析绝对图 URL */
	icon?: string;
	/** 市场归档包 sha256，安装前校验用；自定义/本地技能与存量市场技能为空 */
	sha256?: string;
	installed: boolean;
	enabled: boolean;
	needsUpdate: boolean;
	localVersion?: string;
	isCustom?: boolean;
	/** 通用 Agent Skill（~/.agents/skills）或内置：只读展示，不可安装/卸载/启停。 */
	isAgent?: boolean;
	/**
	 * 来源标识（仅 agent/builtin 等 listSkills 结果会写入）。
	 * `agents-user` / `agents-project` 对应 ~/.agents/skills 兼容发现。
	 */
	source?: string;
	downloadCount: number;
	license: string;
}

// 渲染期解析为 t("group.uncategorized")（模块级常量不存中文）。
export const UNCATEGORIZED = "__uncategorized__";

/** 市场 scene 行 + 本地安装清单 → 场景卡片模型。 */
export function mergeScenes(market: MarketAbility[], manifest: Record<string, InstalledSkill>): MergedSkill[] {
	const merged = new Map<string, MergedSkill>();

	for (const entry of market) {
		if (entry.type !== "scene") continue;
		const local = manifest[entry.slug];
		const isMarketLocal = local?.source === "market";
		merged.set(entry.slug, {
			name: entry.slug,
			alias: entry.name,
			description: entry.description,
			type: "scene",
			version: entry.version,
			author: entry.author,
			tags: entry.tags,
			category: entry.category,
			icon: entry.icon || undefined,
			sha256: entry.sha256 || undefined,
			installed: isMarketLocal,
			enabled: isMarketLocal ? local.enabled : false,
			needsUpdate: isMarketLocal && local.version !== entry.version,
			localVersion: isMarketLocal ? local.version : undefined,
			downloadCount: entry.download_count,
			license: entry.license,
		});
	}

	// 本地已装但市场没有的场景：市场下架的存量条目，以及用户自己导入的自定义场景。
	for (const [name, local] of Object.entries(manifest)) {
		if (local.type !== "scene") continue;
		if (merged.has(name)) continue;
		merged.set(name, {
			name,
			alias: local.alias ?? "",
			description: local.source === "custom" ? local.description : (local.marketDescription ?? ""),
			type: "scene",
			version: local.version,
			author: "",
			tags: [],
			category: "",
			installed: true,
			enabled: local.enabled,
			needsUpdate: false,
			localVersion: local.version,
			isCustom: local.source === "custom",
			downloadCount: 0,
			license: "",
		});
	}

	return Array.from(merged.values());
}

export function groupByCategory(skills: MergedSkill[]): Map<string, MergedSkill[]> {
	const groups = new Map<string, MergedSkill[]>();
	for (const skill of skills) {
		const category = skill.category || UNCATEGORIZED;
		const group = groups.get(category);
		if (group) {
			group.push(skill);
		} else {
			groups.set(category, [skill]);
		}
	}
	for (const group of groups.values()) {
		group.sort((a, b) => {
			if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
			if (a.installed !== b.installed) return a.installed ? -1 : 1;
			// 同等安装态下按热度（下载量）降序，便于区分热门
			if (a.downloadCount !== b.downloadCount) return b.downloadCount - a.downloadCount;
			return a.name.localeCompare(b.name);
		});
	}
	return groups;
}
