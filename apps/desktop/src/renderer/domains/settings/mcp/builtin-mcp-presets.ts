import type { McpServerConfigData, McpStdioServerConfigData } from "@preload/api.js";

/** settings 命名空间下、内置 MCP 可用的 i18n key（须与 locales 同步扩展） */
export type BuiltinMcpLabelKey =
	| "mcpPresets.canva.displayName"
	| "mcpPresets.canva.description"
	| "mcpPresets.slack.displayName"
	| "mcpPresets.slack.description"
	| "mcpPresets.gmail.displayName"
	| "mcpPresets.gmail.description"
	| "mcpPresets.googleCalendar.displayName"
	| "mcpPresets.googleCalendar.description"
	| "mcpPresets.googleDrive.displayName"
	| "mcpPresets.googleDrive.description";

export type BuiltinMcpSecretLabelKey =
	| "mcpPresets.secrets.slackBotToken"
	| "mcpPresets.secrets.slackTeamId"
	| "mcpPresets.secrets.googleClientId"
	| "mcpPresets.secrets.googleClientSecret"
	| "mcpPresets.secrets.gdriveCredentialsPath";

export type BuiltinMcpGuideKey =
	| "mcpPresets.guides.slack"
	| "mcpPresets.guides.gmail"
	| "mcpPresets.guides.googleCalendar"
	| "mcpPresets.guides.googleDrive"
	| "mcpPresets.guides.canva";

/** 添加/配置时需要用户填写的密钥或标识 */
export interface BuiltinMcpSecretField {
	/** 写入 mcpServers[].env 的键名 */
	envKey: string;
	/** 内置预设使用 i18n key，市场 MCP 使用定义文件提供的 label。 */
	labelKey?: BuiltinMcpSecretLabelKey;
	label?: string;
	/** 是否必填 */
	required?: boolean;
	/** 输入框用 password */
	secret?: boolean;
	placeholder?: string;
	/** 官方获取密钥/凭证的页面，一键在浏览器打开 */
	helpUrl?: string;
	/**
	 * 写入 headers/env 时的值模板，`{value}` 替换为用户输入。
	 * 用于形如 `Bearer {value}` 的鉴权头；缺省时直接写入原值。
	 */
	valueTemplate?: string;
}

/** MCP 安装预设：内置项与市场 MCP 参数表单共用，不自动写入 mcp.json，也不预装依赖。 */
export interface BuiltinMcpPreset {
	/** 稳定 id，用于图标文件名与 i18n key */
	id: string;
	/** 写入 mcp.json 的默认 key */
	name: string;
	/** 内置项使用 public/mcp 文件名，市场项直接使用已解析 iconUrl。 */
	iconFile?: string;
	iconUrl?: string;
	displayNameKey?: BuiltinMcpLabelKey;
	descriptionKey?: BuiltinMcpLabelKey;
	displayName?: string;
	description?: string;
	config: McpStdioServerConfigData | Extract<McpServerConfigData, { type: "http" }>;
	/** 需要用户提供的密钥；有则添加前弹出表单 */
	secrets?: readonly BuiltinMcpSecretField[];
	/** 弹窗内展示的「怎么获取」简短步骤（i18n，可用换行） */
	setupGuideKey?: BuiltinMcpGuideKey;
	setupGuide?: string;
	/** 总览型帮助链接（弹窗顶部「打开说明」） */
	setupHelpUrl?: string;
	/** 市场定义显式声明是否需要浏览器授权；缺省保持内置预设原有推断。 */
	browserAuth?: boolean;
	/**
	 * 市场定义声明的二维码登录步骤；状态与二维码都由上游 HTTP API 提供。
	 */
	postInstallSetup?: { kind: "http-qrcode" };
	/** args 中用于回退识别的包名片段 */
	packageHint?: string;
}

const MCP_ICON_BASE = "./mcp";

export const BUILTIN_MCP_PRESETS: readonly BuiltinMcpPreset[] = [
	{
		id: "canva",
		name: "canva",
		iconFile: "canva.webp",
		displayNameKey: "mcpPresets.canva.displayName",
		descriptionKey: "mcpPresets.canva.description",
		// 官方设计侧远程 MCP；经 mcp-remote 接入，首次连接浏览器 OAuth（无需粘贴 Key）
		packageHint: "mcp.canva.com",
		setupGuideKey: "mcpPresets.guides.canva",
		setupHelpUrl: "https://www.canva.com/help/mcp-agent-setup/",
		config: {
			command: "npx",
			args: ["-y", "mcp-remote", "https://mcp.canva.com/mcp"],
		},
	},
	{
		id: "slack",
		name: "slack",
		iconFile: "slack.webp",
		displayNameKey: "mcpPresets.slack.displayName",
		descriptionKey: "mcpPresets.slack.description",
		packageHint: "@modelcontextprotocol/server-slack",
		setupGuideKey: "mcpPresets.guides.slack",
		setupHelpUrl: "https://api.slack.com/apps",
		config: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-slack"],
		},
		secrets: [
			{
				envKey: "SLACK_BOT_TOKEN",
				labelKey: "mcpPresets.secrets.slackBotToken",
				required: true,
				secret: true,
				placeholder: "xoxb-…",
				helpUrl: "https://api.slack.com/apps",
			},
			{
				envKey: "SLACK_TEAM_ID",
				labelKey: "mcpPresets.secrets.slackTeamId",
				required: true,
				secret: false,
				placeholder: "T0…",
				helpUrl: "https://api.slack.com/methods/auth.test",
			},
		],
	},
	{
		id: "gmail",
		name: "gmail",
		iconFile: "gmail.webp",
		displayNameKey: "mcpPresets.gmail.displayName",
		descriptionKey: "mcpPresets.gmail.description",
		packageHint: "@gongrzhe/server-gmail-autoauth-mcp",
		setupGuideKey: "mcpPresets.guides.gmail",
		setupHelpUrl: "https://console.cloud.google.com/apis/credentials",
		config: {
			command: "npx",
			args: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
		},
		// 默认靠浏览器 OAuth，不弹密钥表单；高级凭证可在添加后用钥匙图标填写
	},
	{
		id: "google-calendar",
		name: "google-calendar",
		iconFile: "google-calendar.webp",
		displayNameKey: "mcpPresets.googleCalendar.displayName",
		descriptionKey: "mcpPresets.googleCalendar.description",
		packageHint: "@cocal/google-calendar-mcp",
		setupGuideKey: "mcpPresets.guides.googleCalendar",
		setupHelpUrl: "https://console.cloud.google.com/apis/credentials",
		config: {
			command: "npx",
			args: ["-y", "@cocal/google-calendar-mcp"],
		},
		secrets: [
			{
				envKey: "GOOGLE_CLIENT_ID",
				labelKey: "mcpPresets.secrets.googleClientId",
				required: true,
				secret: false,
				helpUrl: "https://console.cloud.google.com/apis/credentials",
			},
			{
				envKey: "GOOGLE_CLIENT_SECRET",
				labelKey: "mcpPresets.secrets.googleClientSecret",
				required: true,
				secret: true,
				helpUrl: "https://console.cloud.google.com/apis/credentials",
			},
		],
	},
	{
		id: "google-drive",
		name: "google-drive",
		iconFile: "google-drive.webp",
		displayNameKey: "mcpPresets.googleDrive.displayName",
		descriptionKey: "mcpPresets.googleDrive.description",
		packageHint: "@modelcontextprotocol/server-gdrive",
		setupGuideKey: "mcpPresets.guides.googleDrive",
		setupHelpUrl: "https://console.cloud.google.com/apis/credentials",
		config: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-gdrive"],
		},
		// 首次连接多走 OAuth；凭证路径为可选高级项，添加后用钥匙配置
	},
];

export function builtinMcpIconUrl(iconFile: string): string {
	return `${MCP_ICON_BASE}/${iconFile}`;
}

export function resolveMcpPresetIconUrl(preset: BuiltinMcpPreset): string {
	if (preset.iconUrl?.trim()) return preset.iconUrl.trim();
	return preset.iconFile ? builtinMcpIconUrl(preset.iconFile) : "";
}

export function resolveMcpPresetDisplayName(
	preset: BuiltinMcpPreset,
	translate: (key: BuiltinMcpLabelKey) => string,
): string {
	if (preset.displayName?.trim()) return preset.displayName.trim();
	return preset.displayNameKey ? translate(preset.displayNameKey) : preset.name;
}

export function resolveMcpPresetDescription(
	preset: BuiltinMcpPreset,
	translate: (key: BuiltinMcpLabelKey) => string,
): string {
	if (preset.description?.trim()) return preset.description.trim();
	return preset.descriptionKey ? translate(preset.descriptionKey) : "";
}

export function getBuiltinMcpPresetByName(name: string): BuiltinMcpPreset | undefined {
	return BUILTIN_MCP_PRESETS.find((preset) => preset.name === name);
}

export function getBuiltinMcpPresetById(id: string): BuiltinMcpPreset | undefined {
	return BUILTIN_MCP_PRESETS.find((preset) => preset.id === id);
}

/** 是否为内置预设对应的已添加条目（按 name 命中，或按包名特征回退匹配）。 */
export function isBuiltinMcpServer(name: string, config: McpServerConfigData): boolean {
	if (getBuiltinMcpPresetByName(name)) return true;
	return matchBuiltinMcpPreset(name, config) !== undefined;
}

export function matchBuiltinMcpPreset(name: string, config: McpServerConfigData): BuiltinMcpPreset | undefined {
	const byName = getBuiltinMcpPresetByName(name);
	if (byName) return byName;

	if (config.type === "http") {
		// 只拿「已配置条目的 url」去对 packageHint；不能再用 preset.config.url.includes(hint)
		// —— 后者对 Notion 等预设恒真，会把广场上任意 HTTP MCP 都误匹配成 Notion。
		const url = config.url ?? "";
		return BUILTIN_MCP_PRESETS.find(
			(preset) => Boolean(preset.packageHint) && preset.config.type === "http" && url.includes(preset.packageHint!),
		);
	}
	const args = config.args?.join(" ") ?? "";
	return BUILTIN_MCP_PRESETS.find((preset) => preset.packageHint && args.includes(preset.packageHint));
}

/** 远程 HTTP MCP：走 OAuth 浏览器授权（无必填密钥） */
export function presetUsesOAuth(preset: BuiltinMcpPreset): boolean {
	if (preset.config.type !== "http") return false;
	return preset.browserAuth ?? !presetRequiresSecrets(preset);
}

/**
 * 已添加条目是否应按 OAuth 连接器展示（待授权 / 去授权 / 断开）。
 * 仅内置 OAuth 预设（如 Notion 官方远程 MCP）为 true；
 * 广场上免密钥的 HTTP MCP（如网页搜索）不提示授权。
 */
export function serverUsesOAuth(name: string, config: McpServerConfigData): boolean {
	if (config.type !== "http") return false;
	// 配置了 headers 时通常是静态密钥，不走 OAuth UI
	if (config.headers && Object.keys(config.headers).some((k) => config.headers?.[k]?.trim())) {
		return false;
	}
	const preset = matchBuiltinMcpPreset(name, config);
	return Boolean(preset && presetUsesOAuth(preset));
}

/** 有配置图标时返回 URL；否则 null（UI 使用默认 SVG）。 */
export function resolveMcpIcon(name: string, config: McpServerConfigData): string | null {
	const preset = matchBuiltinMcpPreset(name, config);
	if (preset) return resolveMcpPresetIconUrl(preset);
	const icon = config.icon?.trim();
	if (icon) return icon;
	return null;
}

export function buildBuiltinMcpServerConfig(
	preset: BuiltinMcpPreset,
	labels: { displayName: string; description: string },
	secretValues?: Record<string, string>,
): McpServerConfigData {
	const env: Record<string, string> = { ...(preset.config.type === "http" ? {} : preset.config.env) };
	if (secretValues) {
		for (const [key, value] of Object.entries(secretValues)) {
			const trimmed = value.trim();
			if (!trimmed) continue;
			const template = preset.secrets?.find((field) => field.envKey === key)?.valueTemplate;
			env[key] = template ? template.replace("{value}", trimmed) : trimmed;
		}
	}
	const base = { ...preset.config, displayName: labels.displayName, description: labels.description };
	if (Object.keys(env).length === 0) return base;
	if (base.type === "http") {
		if (base.managedRuntimeId) return { ...base, managedRuntimeEnv: env };
		return { ...base, headers: { ...base.headers, ...env } };
	}
	return { ...base, env: { ...base.env, ...env } };
}

/** 已配置条目是否缺少必填密钥 */
export function missingRequiredSecrets(preset: BuiltinMcpPreset, config: McpServerConfigData): BuiltinMcpSecretField[] {
	const secrets = preset.secrets?.filter((field) => field.required) ?? [];
	if (secrets.length === 0) return [];
	const env =
		config.type === "http" ? (config.managedRuntimeId ? config.managedRuntimeEnv : config.headers) : config.env;
	return secrets.filter((field) => !env?.[field.envKey]?.trim());
}

/** 把存储值按模板还原成用户原始输入（用于回填编辑框）；不匹配时原样返回。 */
function stripSecretTemplate(stored: string, template?: string): string {
	if (!template) return stored;
	const [prefix, suffix] = template.split("{value}");
	if (prefix !== undefined && suffix !== undefined && stored.startsWith(prefix) && stored.endsWith(suffix)) {
		return stored.slice(prefix.length, stored.length - suffix.length);
	}
	return stored;
}

export function existingSecretValues(preset: BuiltinMcpPreset, config: McpServerConfigData): Record<string, string> {
	const env =
		config.type === "http" ? (config.managedRuntimeId ? config.managedRuntimeEnv : config.headers) : config.env;
	const values: Record<string, string> = {};
	for (const field of preset.secrets ?? []) {
		const current = env?.[field.envKey];
		if (current) values[field.envKey] = stripSecretTemplate(current, field.valueTemplate);
	}
	return values;
}

/** 添加前必须粘贴密钥 */
export function presetRequiresSecrets(preset: BuiltinMcpPreset): boolean {
	return preset.secrets?.some((field) => field.required) ?? false;
}

/**
 * 添加后首次使用走浏览器登录，无需先填 Key。
 * （有 setup 说明、且没有必填密钥）
 */
export function presetUsesBrowserAuth(preset: BuiltinMcpPreset): boolean {
	return preset.browserAuth ?? (Boolean(preset.setupGuideKey) && !presetRequiresSecrets(preset));
}
