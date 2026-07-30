import type { SettingsTab } from "@shared/store/atoms";

export type SettingsTabLabelKey =
	| "tabAccount"
	| "tabGeneral"
	| "tabAppearance"
	| "tabContext"
	| "tabModels"
	| "tabIm"
	| "tabWebhook"
	| "tabArchive"
	| "tabShortcuts"
	| "tabAppshot"
	| "tabEnvironment"
	| "tabPlugins"
	| "tabKnowledge"
	| "tabPet"
	| "tabPermissions";

export interface SettingsTabRegistration {
	key: SettingsTab;
	label: string;
	labelKey: SettingsTabLabelKey;
	icon: string;
	personalOnly?: boolean;
	requireAuth?: boolean;
	macOnly?: boolean;
	/** 侧栏标签显示 BETA 徽标 */
	beta?: boolean;
}

export interface SettingsSectionRegistration {
	id: string;
	tab: SettingsTab;
	title: string;
	titleKey?: string;
}

export const SETTINGS_TABS: readonly SettingsTabRegistration[] = [
	{ key: "account", label: "账户", labelKey: "tabAccount", icon: "icon-[mdi--account-outline]", requireAuth: true },
	{ key: "general", label: "通用设置", labelKey: "tabGeneral", icon: "icon-[mdi--cog-outline]" },
	{ key: "appearance", label: "外观", labelKey: "tabAppearance", icon: "icon-[mdi--palette-outline]" },
	{ key: "context", label: "Agent配置", labelKey: "tabContext", icon: "icon-[mdi--robot-outline]" },
	{ key: "models", label: "模型配置", labelKey: "tabModels", icon: "icon-[mdi--brain]" },
	// MCP 管理已迁至侧栏「扩展 → 连接器」
	{ key: "im", label: "Claw", labelKey: "tabIm", icon: "icon-[mdi--message-text-outline]" },
	{ key: "webhook", label: "消息推送", labelKey: "tabWebhook", icon: "icon-[mdi--webhook]" },
	// { key: "team", label: "团队管理", labelKey: "tabTeam", icon: "icon-[mdi--account-group-outline]", personalOnly: true },
	{ key: "archive", label: "已归档", labelKey: "tabArchive", icon: "icon-[mdi--archive-outline]" },
	{ key: "shortcuts", label: "快捷键", labelKey: "tabShortcuts", icon: "icon-[mdi--keyboard-outline]" },
	{
		key: "appshot",
		label: "应用快照",
		labelKey: "tabAppshot",
		icon: "icon-[mdi--monitor-screenshot]",
		macOnly: true,
	},
	{ key: "environment", label: "应用环境", labelKey: "tabEnvironment", icon: "icon-[mdi--package-variant-closed]" },
	{ key: "plugins", label: "插件设置", labelKey: "tabPlugins", icon: "icon-[mdi--puzzle-outline]" },
	{
		key: "knowledge",
		label: "知识库设置",
		labelKey: "tabKnowledge",
		icon: "icon-[mdi--database-outline]",
	},
	{ key: "pet", label: "Vetta Vivi", labelKey: "tabPet", icon: "icon-[mdi--paw-outline]" },
	{
		key: "permissions",
		label: "权限管理",
		labelKey: "tabPermissions",
		icon: "icon-[mdi--shield-lock-outline]",
		macOnly: true,
	},
] as const;

export const SETTINGS_SECTIONS = [
	{ tab: "general", id: "general-basics", title: "基础", titleKey: "section_general-basics" },
	{ tab: "general", id: "general-app", title: "应用", titleKey: "section_general-app" },
	{ tab: "general", id: "general-developer", title: "开发者", titleKey: "section_general-developer" },
	{ tab: "appearance", id: "appearance-mode", title: "外观模式", titleKey: "section_appearance-mode" },
	{ tab: "appearance", id: "appearance-ui-theme", title: "界面主题", titleKey: "section_appearance-ui-theme" },
	{ tab: "appearance", id: "appearance-cursor", title: "鼠标指针", titleKey: "section_appearance-cursor" },
	{ tab: "appearance", id: "appearance-theme", title: "主题", titleKey: "section_appearance-theme" },
	{ tab: "appearance", id: "appearance-sidebar", title: "侧边栏样式", titleKey: "section_appearance-sidebar" },
	{ tab: "appearance", id: "appearance-language", title: "语言", titleKey: "section_appearance-language" },
	{ tab: "account", id: "account-profile", title: "个人信息", titleKey: "section_account-profile" },
	{ tab: "team", id: "team-management", title: "团队管理", titleKey: "section_team-management" },
	{ tab: "team", id: "team-my-teams", title: "我的团队", titleKey: "section_team-my-teams" },
	{ tab: "team", id: "team-detail-info", title: "团队详情", titleKey: "section_team-detail-info" },
	{ tab: "team", id: "team-members", title: "成员列表", titleKey: "section_team-members" },
	{ tab: "models", id: "models-thinking", title: "思考模式", titleKey: "section_models-thinking" },
	{ tab: "models", id: "models-preset-providers", title: "预设服务商", titleKey: "section_models-preset-providers" },
	{ tab: "models", id: "models-providers", title: "服务商", titleKey: "section_models-providers" },
	{ tab: "mcp", id: "mcp-remote-list", title: "远程 MCP", titleKey: "section_mcp-remote-list" },
	{ tab: "mcp", id: "mcp-remote-available", title: "可添加的远程 MCP", titleKey: "section_mcp-remote-available" },
	{ tab: "mcp", id: "mcp-builtin-list", title: "推荐 MCP", titleKey: "section_mcp-builtin-list" },
	{ tab: "mcp", id: "mcp-builtin-available", title: "可添加的推荐 MCP", titleKey: "section_mcp-builtin-available" },
	{ tab: "mcp", id: "mcp-server-list", title: "自定义 MCP", titleKey: "section_mcp-server-list" },
	{
		tab: "mcp",
		id: "mcp-server-list-builtin",
		title: "已添加的 MCP",
		titleKey: "section_mcp-server-list-builtin",
	},
	{ tab: "mcp", id: "mcp-json", title: "编辑 JSON", titleKey: "section_mcp-json" },
	{ tab: "environment", id: "environment-runtime", title: "运行时", titleKey: "section_environment-runtime" },
	{ tab: "environment", id: "environment-mirrors", title: "镜像源", titleKey: "section_environment-mirrors" },
	{ tab: "permissions", id: "permissions-system", title: "系统权限", titleKey: "section_permissions-system" },
	{ tab: "im", id: "imbridge-basics", title: "基础", titleKey: "section_imbridge-basics" },
	{ tab: "im", id: "imbridge-channels", title: "消息渠道", titleKey: "section_imbridge-channels" },
	{ tab: "im", id: "imbridge-status", title: "状态与日志", titleKey: "section_imbridge-status" },
	{ tab: "im", id: "imbridge-logs", title: "实时日志", titleKey: "section_imbridge-logs" },
	{ tab: "webhook", id: "webhook-channels", title: "渠道列表", titleKey: "section_webhook-channels" },
	{ tab: "shortcuts", id: "shortcuts-global", title: "全局快捷键", titleKey: "section_shortcuts-global" },
	{ tab: "shortcuts", id: "shortcuts-quickpanel", title: "快捷面板", titleKey: "section_shortcuts-quickpanel" },
	{ tab: "appshot", id: "appshot-gesture", title: "触发快捷键", titleKey: "section_appshot-gesture" },
	{ tab: "appshot", id: "appshot-permissions", title: "权限", titleKey: "section_appshot-permissions" },
	{ tab: "archive", id: "archived-list", title: "归档列表", titleKey: "section_archived-list" },
	{ tab: "context", id: "agent-personalization", title: "个性化", titleKey: "section_agent-personalization" },
	{ tab: "context", id: "agent-images", title: "图片", titleKey: "section_agent-images" },
	{ tab: "context", id: "agent-experimental", title: "扩展功能", titleKey: "section_agent-experimental" },
	{ tab: "knowledge", id: "knowledge-processing", title: "后台加工", titleKey: "section_knowledge-processing" },
	{ tab: "knowledge", id: "knowledge-actions", title: "手动操作", titleKey: "section_knowledge-actions" },
	{ tab: "pet", id: "pet-display", title: "显示与窗口", titleKey: "section_pet-display" },
	{ tab: "pet", id: "pet-decoration", title: "桌宠装饰", titleKey: "section_pet-decoration" },
	{ tab: "pet", id: "pet-bubble", title: "气泡样式", titleKey: "section_pet-bubble" },
	{ tab: "pet", id: "pet-developer", title: "开发调试", titleKey: "section_pet-developer" },
] as const satisfies readonly SettingsSectionRegistration[];

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
export type RegisteredSettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION = Object.fromEntries(SETTINGS_SECTIONS.map((section) => [section.id, section])) as {
	[K in SettingsSectionId]: Extract<RegisteredSettingsSection, { id: K }>;
};

export function getSettingsSections(): readonly SettingsSectionRegistration[] {
	return SETTINGS_SECTIONS;
}

export function getSettingsSectionsByTab(tab: SettingsTab): SettingsSectionRegistration[] {
	return SETTINGS_SECTIONS.filter((section) => section.tab === tab);
}

export function findSettingsSection(id: string): SettingsSectionRegistration | undefined {
	return SETTINGS_SECTIONS.find((section) => section.id === id);
}
