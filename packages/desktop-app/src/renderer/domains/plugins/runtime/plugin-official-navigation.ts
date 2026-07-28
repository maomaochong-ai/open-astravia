import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";
import { isAppearanceUiThemeEnabled } from "../../../../shared/feature-flags";
import {
	SETTINGS_SECTIONS,
	SETTINGS_TABS,
	type SettingsSectionRegistration,
	type SettingsTabRegistration,
} from "../../settings/registry";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";

interface StaticNavigationTarget {
	id: string;
	title: string;
	description: string;
	hashPath: string;
	aliases: readonly string[];
}

const STATIC_TARGETS: readonly StaticNavigationTarget[] = [
	{
		id: "chat",
		title: "对话",
		description: "主对话页，用于和 agent 交流。",
		hashPath: "/",
		aliases: ["主页", "首页", "聊天", "会话", "agent 对话"],
	},
	{
		id: "automation",
		title: "自动化",
		description: "定时自动化任务页面。",
		hashPath: "/automation",
		aliases: ["定时任务", "计划任务", "scheduler", "cron"],
	},
	{
		id: "batch-tasks",
		title: "批量任务",
		description: "批量执行多个目标目录任务的页面。",
		hashPath: "/batch-tasks",
		aliases: ["批处理", "批量执行", "batch"],
	},
	{
		id: "skills",
		title: "能力",
		description: "能力页：Skill / 场景 / MCP / 插件 / 能力套装统一管理。",
		hashPath: "/abilities",
		aliases: ["技能", "能力", "扩展", "skill marketplace", "技能广场", "场景", "abilities"],
	},
	{
		id: "plugins",
		title: "插件",
		description: "插件已并入能力页，按类型筛选即可。",
		hashPath: "/abilities",
		aliases: ["插件", "plugin", "plugins"],
	},
	{
		id: "connectors",
		title: "连接器",
		description: "MCP 连接器管理，为 AI 接入外部工具。",
		hashPath: "/abilities",
		aliases: ["MCP", "mcp", "MCP 管理", "连接器", "connectors"],
	},
	{
		id: "settings",
		title: "设置",
		description: "设置首页，默认打开通用设置。",
		hashPath: "/settings/general",
		aliases: ["配置", "偏好设置", "preferences"],
	},
];

function normalizeTarget(value: string): string {
	return value.trim().toLowerCase();
}

function isSettingsSectionVisible(section: SettingsSectionRegistration): boolean {
	if (section.id === "appearance-ui-theme") return isAppearanceUiThemeEnabled();
	// 桌宠装饰分区暂隐藏（与 PetSettingsView.showDecorationSection=false 对齐）
	if (section.id === "pet-decoration") return false;
	return true;
}

function getVisibleSettingsSections(): readonly SettingsSectionRegistration[] {
	return SETTINGS_SECTIONS.filter(isSettingsSectionVisible);
}

function getSettingsTabsByKey(): Map<string, SettingsTabRegistration> {
	return new Map(SETTINGS_TABS.map((tab) => [tab.key, tab]));
}

function getSettingsSectionsById(): Map<string, SettingsSectionRegistration> {
	return new Map(getVisibleSettingsSections().map((section) => [section.id, section]));
}

function buildSettingsHashPath(tab: string, section?: string): string {
	const search = new URLSearchParams();
	if (section) {
		search.set("section", section);
		search.set("nav", String(Date.now()));
	}
	const query = search.toString();
	return `/settings/${encodeURIComponent(tab)}${query ? `?${query}` : ""}`;
}

/**
 * 连接器已并入能力页（ADR-0049），该页按能力条目组织、不再有可定位的 section，
 * 故不带 section/nav 查询参数——它们此处无人消费。
 */
function buildConnectorsHashPath(): string {
	return "/abilities";
}

function isMcpSettingsTarget(tabKey?: string, section?: SettingsSectionRegistration): boolean {
	return tabKey === "mcp" || section?.tab === "mcp";
}

function buildSettingsCatalog(): unknown {
	const settingsTabs = SETTINGS_TABS.map((tab) => ({
		id: tab.key,
		title: tab.label,
		target: { type: "open", target: "settings", tab: tab.key },
		visibility: {
			...(tab.personalOnly ? { personalOnly: true } : {}),
			...(tab.requireAuth ? { requireAuth: true } : {}),
			...(tab.macOnly ? { macOnly: true } : {}),
		},
		sections: getVisibleSettingsSections()
			.filter((section) => section.tab === tab.key)
			.map((section) => ({
				id: section.id,
				title: section.title,
				target: { type: "open", target: section.id },
			})),
	}));
	const connectorsTab = {
		id: "mcp",
		title: "连接器",
		target: { type: "open", target: "connectors" },
		location: "能力 → 连接器",
		sections: getVisibleSettingsSections()
			.filter((section) => section.tab === "mcp")
			.map((section) => ({
				id: section.id,
				title: section.title,
				target: { type: "open", target: section.id },
			})),
	};
	return [...settingsTabs, connectorsTab];
}

export function getOfficialNavigationHelp(): unknown {
	return {
		type: "help",
		description:
			"navigation.query help 返回本目录（只读、不弹授权）。打开页面请用 navigation.open：从 catalog 选 target/tab/section，不要直接拼接 window.location.hash。",
		operations: [
			{
				type: "help",
				action: "navigation.query",
				description: "返回可导航页面、设置页分类和设置子项目录（只读）。",
				input: { type: "help" },
			},
			{
				type: "open",
				action: "navigation.open",
				description:
					"打开页面。普通页面传 target；设置页可传 target=settings + tab/section，也可直接把设置分类 id 或设置子项 id 作为 target。",
				input: { type: "open", target: "models-providers" },
			},
		],
		catalog: {
			pages: STATIC_TARGETS.map((target) => ({
				id: target.id,
				title: target.title,
				description: target.description,
				aliases: [...target.aliases],
				target: { type: "open", target: target.id },
			})),
			settings: {
				pageId: "settings",
				layout: "左侧是设置分类列表，右侧是当前分类的细分设置项。",
				usage: "用户提到具体设置时，优先匹配 settings.sections[].id；只提到大类时匹配 settings[].id。",
				tabs: buildSettingsCatalog(),
			},
		},
	};
}

export function resolveOfficialNavigationOpen(input: { target: string; tab?: string; section?: string }): {
	hashPath: string;
	resolved: unknown;
} {
	const target = normalizeTarget(input.target);
	const staticTarget = STATIC_TARGETS.find((candidate) => candidate.id === target);
	if (staticTarget && staticTarget.id !== "settings") {
		return {
			hashPath: staticTarget.hashPath,
			resolved: {
				kind: "page",
				id: staticTarget.id,
				title: staticTarget.title,
			},
		};
	}

	const tabsByKey = getSettingsTabsByKey();
	const sectionsById = getSettingsSectionsById();
	const sectionId = input.section ? normalizeTarget(input.section) : undefined;
	const explicitSection = sectionId ? sectionsById.get(sectionId) : undefined;
	const targetSection = sectionsById.get(target);
	const targetTab = tabsByKey.get(target);

	if (input.section && !explicitSection) {
		const sectionIds = [...getSettingsSectionsById().keys()];
		throw new Error(
			`Refused navigation.open before user approval: unknown settings section=${JSON.stringify(input.section)}. Available section ids (sample): ${sectionIds
				.slice(0, 20)
				.map((id) => JSON.stringify(id))
				.join(", ")}.`,
		);
	}

	if (target === "mcp" || isMcpSettingsTarget(input.tab ? normalizeTarget(input.tab) : undefined, explicitSection)) {
		const section = explicitSection?.tab === "mcp" ? explicitSection : undefined;
		return {
			hashPath: buildConnectorsHashPath(),
			resolved: {
				kind: section ? "connectors-section" : "connectors",
				tab: "mcp",
				tabTitle: "连接器",
				...(section ? { section: section.id, sectionTitle: section.title } : {}),
			},
		};
	}

	if (targetSection) {
		if (targetSection.tab === "mcp") {
			return {
				hashPath: buildConnectorsHashPath(),
				resolved: {
					kind: "connectors-section",
					tab: "mcp",
					tabTitle: "连接器",
					section: targetSection.id,
					sectionTitle: targetSection.title,
				},
			};
		}
		const tab = tabsByKey.get(targetSection.tab);
		return {
			hashPath: buildSettingsHashPath(targetSection.tab, targetSection.id),
			resolved: {
				kind: "settings-section",
				tab: targetSection.tab,
				tabTitle: tab?.label ?? targetSection.tab,
				section: targetSection.id,
				sectionTitle: targetSection.title,
			},
		};
	}

	if (target === "settings" || targetTab) {
		const tabKey = input.tab ? normalizeTarget(input.tab) : (targetTab?.key ?? explicitSection?.tab ?? "general");
		if (isMcpSettingsTarget(tabKey, explicitSection)) {
			const section = explicitSection?.tab === "mcp" ? explicitSection : undefined;
			return {
				hashPath: buildConnectorsHashPath(),
				resolved: {
					kind: section ? "connectors-section" : "connectors",
					tab: "mcp",
					tabTitle: "连接器",
					...(section ? { section: section.id, sectionTitle: section.title } : {}),
				},
			};
		}
		const tab = tabsByKey.get(tabKey);
		if (!tab) {
			const tabIds = [...tabsByKey.keys(), "mcp"];
			throw new Error(
				`Refused navigation.open before user approval: unknown settings tab=${JSON.stringify(input.tab ?? tabKey)}. Available tabs: ${tabIds
					.map((id) => JSON.stringify(id))
					.join(", ")}.`,
			);
		}
		if (explicitSection && explicitSection.tab !== tab.key) {
			throw new Error(
				`Refused navigation.open before user approval: section ${JSON.stringify(explicitSection.id)} belongs to tab ${JSON.stringify(explicitSection.tab)}, not ${JSON.stringify(tab.key)}.`,
			);
		}
		return {
			hashPath: buildSettingsHashPath(tab.key, explicitSection?.id),
			resolved: {
				kind: explicitSection ? "settings-section" : "settings-tab",
				tab: tab.key,
				tabTitle: tab.label,
				...(explicitSection ? { section: explicitSection.id, sectionTitle: explicitSection.title } : {}),
			},
		};
	}

	const pageIds = STATIC_TARGETS.map((item) => item.id);
	const tabIds = [...tabsByKey.keys(), "mcp"];
	throw new Error(
		`Refused navigation.open before user approval: unknown target=${JSON.stringify(input.target)}. Page targets: ${pageIds
			.map((id) => JSON.stringify(id))
			.join(", ")}. Settings tabs: ${tabIds.map((id) => JSON.stringify(id)).join(", ")}.`,
	);
}

export function openOfficialHashPath(hashPath: string): void {
	window.location.hash = `#${hashPath}`;
}

export function createOfficialNavigationApi(capabilitySessionId: string): PluginOfficialApi["navigation"] {
	return {
		help: () => pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, () => getOfficialNavigationHelp()),
		resolveOpen: (input) =>
			pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, () => resolveOfficialNavigationOpen(input)),
		open: (input) =>
			pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, async () => {
				const target = resolveOfficialNavigationOpen(input);
				openOfficialHashPath(target.hashPath);
				return { type: "open", resolved: target.resolved };
			}),
	};
}
