/** 浏览器实例来源。 */
export type BrowserSource = "managed" | "attach";

export interface BrowserPluginSettings {
	browserSource: BrowserSource;
	headed: boolean;
	/** 逗号/换行分隔的导航域名范围；空 = 插件清单允许的全部域名。 */
	allowedDomains: string;
	maxOutput: number;
}

export const DEFAULT_BROWSER_SETTINGS: BrowserPluginSettings = {
	browserSource: "managed",
	headed: true,
	allowedDomains: "",
	maxOutput: 20_000,
};

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

/** 把宿主设置页的原始值收窄成插件内部使用的强类型设置。 */
export function normalizeBrowserSettings(raw: Readonly<Record<string, unknown>>): BrowserPluginSettings {
	return {
		browserSource: raw.browserSource === "attach" ? "attach" : "managed",
		headed: asBoolean(raw.headed, DEFAULT_BROWSER_SETTINGS.headed),
		allowedDomains: asString(raw.allowedDomains, DEFAULT_BROWSER_SETTINGS.allowedDomains),
		maxOutput: asMaxOutput(raw.maxOutput),
	};
}

/** 将用户设置转换为本次 session 的收窄范围；宿主仍会校验它没有超出 manifest 授权。 */
export function parseAllowedHosts(value: string): string[] {
	const entries = value
		.split(/[,\n]/)
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	if (entries.length === 0) return ["*"];
	return [...new Set(entries)];
}
