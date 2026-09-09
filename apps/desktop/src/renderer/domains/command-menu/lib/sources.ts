import type { InstalledPlugin, SkillInfo } from "@preload/api";
import { pathBasename } from "@shared/lib/utils";
import type { Project, RegisteredWorkspaceView } from "@shared/store/atoms";
import { sessionDisplayLabel } from "@shared/store/atoms";
import { resolveDesktopSessionOpenTarget } from "@/shared/session-access";
import type { DesktopSessionSearchResult } from "@/shared/session-search";
import {
	filterVisibleSettingsTabs,
	type RegisteredSettingsSection,
	SETTINGS_SECTIONS,
	SETTINGS_TABS,
	type SettingsTabLabelKey,
	type SettingsTabVisibilityContext,
} from "../../settings/registry";
import type { CommandMenuEntry } from "../types";

/**
 * 五个数据源到 Command Menu 条目的适配层，全部是纯函数：入参是已经取好的数据，
 * 出参是条目数组，文案由调用方注入。取数与导航副作用都不在这里。
 */

/**
 * 设置目录用到的 i18n key 联合。保持字面量而非 string：i18next 的键是有类型的，
 * 放宽成 string 会让 `t()` 失去校验，改错一个 key 只能在运行时看到原样回显。
 */
export type CommandMenuSettingsLabelKey = SettingsTabLabelKey | NonNullable<RegisteredSettingsSection["titleKey"]>;

/** 会被重定向到能力页的设置 section（ADR-0049），从目录里剔除，避免"点了跳到别处"。 */
const REDIRECTED_SETTINGS_TAB = "mcp";

export interface CommandMenuSourceLabels {
	readonly sessionTypes: Readonly<Record<DesktopSessionSearchResult["sourceKind"], string>>;
	readonly sessionUnavailable: string;
	readonly settingsGroupHint: string;
	readonly abilitySkill: string;
	readonly abilityScene: string;
	readonly abilityPlugin: string;
	readonly searchMarketplace: string;
}

export function buildProjectEntries(projects: readonly Project[]): CommandMenuEntry[] {
	return projects.map((project, index) => ({
		id: `project:${project.cwd}`,
		groupKey: "projects",
		title: project.name?.trim() || pathBasename(project.cwd),
		subtitle: project.cwd,
		icon: project.isDefault ? "icon-[solar--chat-round-line-linear]" : "icon-[solar--folder-linear]",
		// 侧栏已经按最近使用排好序，沿用它的次序即可，不另造一套。
		order: index,
		action: { kind: "openProject", cwd: project.cwd },
	}));
}

export function buildSessionEntries(
	results: readonly DesktopSessionSearchResult[],
	labels: CommandMenuSourceLabels,
): CommandMenuEntry[] {
	return results.map((result, index) => {
		const unavailable = resolveDesktopSessionOpenTarget(result.session.access) === "unavailable";
		return {
			id: `session:${result.session.path}`,
			groupKey: "sessions",
			title: sessionDisplayLabel(result.session),
			subtitle: result.sourceName?.trim() || pathBasename(result.sourceCwd),
			icon: "icon-[solar--chat-line-linear]",
			badge: labels.sessionTypes[result.sourceKind],
			disabled: unavailable,
			disabledReason: unavailable ? labels.sessionUnavailable : undefined,
			// 后端已按活跃时间倒序推送，保持原序即"越近越靠前"。
			order: index,
			action: { kind: "openSession", result },
		};
	});
}

/**
 * 设置项取 section 粒度（~40 条）：`/settings/$tab?section=<id>` 是既有深链，
 * 落地后会自动切标签、滚动到位并播一次呼吸高亮，不需要新造导航能力。
 */
export function buildSettingsEntries(
	visibility: SettingsTabVisibilityContext,
	translate: (key: CommandMenuSettingsLabelKey) => string,
): CommandMenuEntry[] {
	const visibleTabs = filterVisibleSettingsTabs(SETTINGS_TABS, visibility);
	const tabByKey = new Map(visibleTabs.map((tab) => [tab.key, tab]));

	const entries: CommandMenuEntry[] = [];
	for (const [index, section] of SETTINGS_SECTIONS.entries()) {
		if (section.tab === REDIRECTED_SETTINGS_TAB) continue;
		// 平台 / 账号维度不可见的标签，其 section 也不该被搜到：点进去只会落到兜底标签。
		const tab = tabByKey.get(section.tab);
		if (!tab) continue;
		const titleKey: CommandMenuSettingsLabelKey | undefined = section.titleKey;
		entries.push({
			id: `settings:${section.id}`,
			groupKey: "settings",
			// 先取到局部再判空：直接对 `section.titleKey` 分支会让 TS 把回退分支里的
			// section 收窄成 never（当前每条都带 titleKey，但契约上它是可选的）。
			title: titleKey ? translate(titleKey) : section.title,
			subtitle: translate(tab.labelKey),
			icon: tab.icon,
			order: index,
			action: { kind: "openSettingsSection", tab: section.tab, section: section.id },
		});
	}
	return entries;
}

export function buildWorkspaceViewEntries(
	views: readonly RegisteredWorkspaceView[],
	/** label 可能是 `%catalogKey%`，解析需要归属插件的目录，故整条 view 传进来。 */
	resolveLabel: (view: RegisteredWorkspaceView) => string,
): CommandMenuEntry[] {
	return views.map((view, index) => ({
		id: `workspace:${view.pluginId}/${view.viewId}`,
		groupKey: "workspaceViews",
		title: resolveLabel(view),
		subtitle: view.pluginName,
		icon: view.icon || "icon-[solar--widget-linear]",
		order: index,
		action: { kind: "openWorkspaceView", pluginId: view.pluginId, viewId: view.viewId },
	}));
}

/**
 * 只收本地已装能力，不碰市场目录——`listOpenMarketplaces()` 对 autoUpdate 源仍会
 * 走网络，挂在 ⌘K 上代价不可接受。市场由恒定置底的逃生行承接。
 *
 * 条目动作统一是「跳能力页并预填名称」而不是直接开详情抽屉：详情需要 catalog id，
 * 而它的合成规则（台账 catalogId 回退、市场 id、本地 id）散在 build-ability-items
 * 里，在这里重造一遍必然与之漂移。
 */
export function buildInstalledAbilityEntries(
	installed: { readonly skills: readonly SkillInfo[]; readonly plugins: readonly InstalledPlugin[] },
	labels: CommandMenuSourceLabels,
): CommandMenuEntry[] {
	const entries: CommandMenuEntry[] = [];
	let order = 0;
	for (const skill of installed.skills) {
		const title = skill.alias?.trim() || skill.name;
		entries.push({
			id: `ability:skill:${skill.name}`,
			groupKey: "abilities",
			title,
			subtitle: skill.description || undefined,
			icon: skill.type === "scene" ? "icon-[solar--clapperboard-play-linear]" : "icon-[solar--magic-stick-3-linear]",
			badge: skill.type === "scene" ? labels.abilityScene : labels.abilitySkill,
			order: order++,
			action: { kind: "openAbilities", query: title },
		});
	}
	for (const plugin of installed.plugins) {
		entries.push({
			id: `ability:plugin:${plugin.id}`,
			groupKey: "abilities",
			title: plugin.name,
			subtitle: plugin.id,
			icon: "icon-[solar--plug-circle-linear]",
			badge: labels.abilityPlugin,
			order: order++,
			action: { kind: "openAbilities", query: plugin.name },
		});
	}
	return entries;
}

/**
 * 能力市场逃生行：恒定置底、不参与匹配打分。面板内只能搜到已装能力，这一行把
 * "搜市场"降级成一次回车跳转，而不是把远端目录的异步态与失败态搬进 ⌘K。
 */
export function buildMarketplaceEscapeEntry(query: string, labels: CommandMenuSourceLabels): CommandMenuEntry {
	return {
		id: "ability:marketplace-search",
		groupKey: "abilities",
		title: labels.searchMarketplace,
		icon: "icon-[solar--shop-2-linear]",
		order: Number.MAX_SAFE_INTEGER,
		pinnedToBottom: true,
		action: { kind: "openAbilities", query: query.trim() || undefined },
	};
}
