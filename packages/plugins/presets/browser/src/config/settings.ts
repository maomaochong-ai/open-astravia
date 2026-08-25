/**
 * 插件设置的收窄与快照。
 *
 * 事实源是宿主设置页（`plugin.json` 的 `contributes.settings`），但真正消费配置的是 MCP
 * wrapper —— 一个独立进程，读不到 `ctx.settings`。所以 renderer 把设置收窄成一份**策略快照**
 * 写进插件存储，wrapper 再把它物化成 agent-browser 的原生配置。
 *
 * 为什么物化不在这里做：快照里不含任何绝对路径。宿主给插件命令的环境变量只透传固定白名单，
 * 不包含 `VETTA_HOME` / `VETTA_CONFIG_DIR`，renderer 因此无法可靠算出插件数据目录；而 wrapper
 * 拿到的是完整 `process.env`。路径解析归 wrapper，策略归这里，两边不互相猜。
 */

/** 浏览器实例来源。 */
export type BrowserSource = "managed" | "attach";

/** 写进 `runtime.json` 的策略快照；wrapper 与 Hook 共用同一份定义。 */
export interface BrowserPluginSettings {
	browserSource: BrowserSource;
	headed: boolean;
	/** 逗号/换行分隔的域名白名单；空 = 不限制。设置项没有数组类型，只能用字符串承载。 */
	allowedDomains: string;
	denyEval: boolean;
	denyDownload: boolean;
	denyUpload: boolean;
	toolsProfile: string;
	maxOutput: number;
}

export const DEFAULT_BROWSER_SETTINGS: BrowserPluginSettings = {
	browserSource: "managed",
	headed: true,
	allowedDomains: "",
	denyEval: true,
	denyDownload: false,
	denyUpload: true,
	toolsProfile: "core",
	maxOutput: 20_000,
};

/** 插件存储内的快照文件名；`scripts/lib/paths.mjs` 里的 `runtime.json` 与此一致。 */
export const RUNTIME_SNAPSHOT_FILE = "runtime.json";

const MIN_MAX_OUTPUT = 2_000;
const MAX_MAX_OUTPUT = 500_000;

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

/** 设置页的 number 输入在未填时是 undefined，填错时可能是字符串。 */
function asMaxOutput(value: unknown): number {
	const raw = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(raw)) return DEFAULT_BROWSER_SETTINGS.maxOutput;
	return Math.min(MAX_MAX_OUTPUT, Math.max(MIN_MAX_OUTPUT, Math.floor(raw)));
}

const KNOWN_TOOL_PROFILES = new Set([
	"core",
	"default",
	"network",
	"state",
	"storage",
	"auth",
	"debug",
	"diagnostics",
	"tabs",
	"frames",
	"react",
	"web",
	"mobile",
	"ios",
	"all",
	"full",
]);

/**
 * `--tools` 支持逗号组合。用户可能填出未知 profile，那会让 agent-browser 启动失败并让整个
 * 工具面消失——比默默退回 core 严重得多，所以这里 fail-safe 回落。
 */
export function normalizeToolsProfile(raw: unknown): string {
	const text = typeof raw === "string" ? raw : "";
	const parts = text
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter((part) => KNOWN_TOOL_PROFILES.has(part));
	return parts.length > 0 ? [...new Set(parts)].join(",") : "core";
}

/** 把宿主设置页的原始值收窄成插件内部使用的强类型设置。 */
export function normalizeBrowserSettings(raw: Readonly<Record<string, unknown>>): BrowserPluginSettings {
	return {
		browserSource: raw.browserSource === "attach" ? "attach" : "managed",
		headed: asBoolean(raw.headed, DEFAULT_BROWSER_SETTINGS.headed),
		allowedDomains: asString(raw.allowedDomains, DEFAULT_BROWSER_SETTINGS.allowedDomains),
		denyEval: asBoolean(raw.denyEval, DEFAULT_BROWSER_SETTINGS.denyEval),
		denyDownload: asBoolean(raw.denyDownload, DEFAULT_BROWSER_SETTINGS.denyDownload),
		denyUpload: asBoolean(raw.denyUpload, DEFAULT_BROWSER_SETTINGS.denyUpload),
		toolsProfile: normalizeToolsProfile(raw.toolsProfile),
		maxOutput: asMaxOutput(raw.maxOutput),
	};
}

/** 把逗号/空白/换行分隔的白名单文本解析成规范化域名列表。 */
export function parseAllowedDomains(raw: string): string[] {
	return [
		...new Set(
			raw
				.split(/[\s,;]+/)
				.map((part) => part.trim().toLowerCase())
				.filter((part) => part.length > 0),
		),
	];
}
