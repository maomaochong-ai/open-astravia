/**
 * 浏览器工具的宿主侧门禁（PreToolUse Hook 的纯决策核心）。
 *
 * 为什么门禁在这里而不是交给 agent-browser：
 * - `--allowed-domains` 与 `--profile` / `--auto-connect` 在上游是互斥的，而这两种浏览器
 *   来源正是本插件仅有的两种模式，所以上游的域名围栏对我们永远不可用。
 * - `--confirm-actions` 的交互确认走 TTY，而 MCP server 是宿主 spawn 的无 TTY 子进程，
 *   上游会一律自动拒绝。
 *
 * 因此这里做**确定性判定**：命中即 block 并给出可操作的理由，让模型把话转述给用户，
 * 用户去面板改白名单后重试。不做逐次弹窗——handler 有超时，用户不在电脑前会把整轮拖死。
 */

/**
 * 宿主给插件 MCP server 的运行时名：`plugin-<pluginId>-<localName>`。
 * localName 是 `.mcp.json` 里的 `chrome`，改那边必须同步改这里。
 */
export const MCP_RUNTIME_NAME = "plugin-browser-chrome";

/** 把 agent-browser 的 MCP 工具名转成宿主可见的工具名。 */
export function hostToolName(tool: string): string {
	return `mcp_${MCP_RUNTIME_NAME}_${tool}`;
}

/** 带 URL 参数、可能导致导航的工具 → 参数名。 */
const URL_ARGUMENT_BY_TOOL: Readonly<Record<string, string>> = {
	agent_browser_open: "url",
	agent_browser_read: "url",
	agent_browser_tab_new: "url",
	agent_browser_pushstate: "url",
	agent_browser_vitals: "url",
	agent_browser_chat: "url",
	agent_browser_record_start: "url",
	agent_browser_record_restart: "url",
	agent_browser_auth_save: "url",
};

/** 危险动作工具 → action-policy 类别。daemon 侧也会拒，这里只是给出更好的理由文本。 */
const DANGEROUS_TOOLS: Readonly<Record<string, "eval" | "download" | "upload">> = {
	agent_browser_eval: "eval",
	agent_browser_download: "download",
	agent_browser_wait_for_download: "download",
	agent_browser_upload: "upload",
};

/** Hook 注册时用的 `toolNames`：只订阅这些工具，避免每次任意工具调用都往 renderer 打一次 IPC。 */
export const GUARDED_HOST_TOOL_NAMES: readonly string[] = [
	...Object.keys(URL_ARGUMENT_BY_TOOL),
	...Object.keys(DANGEROUS_TOOLS),
].map(hostToolName);

export interface BrowserGuardConfig {
	allowedDomains: readonly string[];
	denyEval: boolean;
	denyDownload: boolean;
	denyUpload: boolean;
}

export type BrowserGuardBlockCode = "domain-not-allowed" | "invalid-url" | "action-denied";

export type BrowserGuardDecision =
	| { action: "continue" }
	| { action: "block"; reason: string; code: BrowserGuardBlockCode };

/** 从宿主工具名还原 agent-browser 的原始工具名；不属于本插件则返回 null。 */
export function toAgentBrowserTool(hostName: string): string | null {
	const prefix = `mcp_${MCP_RUNTIME_NAME}_`;
	return hostName.startsWith(prefix) ? hostName.slice(prefix.length) : null;
}

/**
 * 规范化待检查的 URL 的 host。
 *
 * agent-browser 的 `read` 明确会把裸 host 补成 https，`open` 实践上同理，所以这里也必须
 * 容忍无 scheme 的输入——否则「open example.com」会被当成非法 URL 拦掉。
 */
export function extractHost(raw: string): string | null {
	const text = raw.trim();
	if (text.length === 0) return null;
	const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) ? text : `https://${text}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}
	// about:blank / data: / blob: 没有 host，不是外部导航，交给 action-policy 管。
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	return url.hostname.toLowerCase();
}

/**
 * 白名单匹配：精确域名，或 `*.example.com` 前缀通配（同时匹配裸域，与上游语义一致）。
 * 端口和大小写不参与判定，`hostname` 已经把它们剥掉 / 统一。
 */
export function matchesAllowedDomain(host: string, patterns: readonly string[]): boolean {
	return patterns.some((pattern) => {
		if (pattern.startsWith("*.")) {
			const bare = pattern.slice(2);
			return host === bare || host.endsWith(`.${bare}`);
		}
		return host === pattern;
	});
}

function readStringArgument(input: unknown, key: string): string | undefined {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
	const value = (input as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

/** 对一次工具调用做判定。`hostName` 是宿主可见工具名（`mcp_<runtime>_<tool>`）。 */
export function evaluateBrowserToolCall(
	hostName: string,
	input: unknown,
	config: BrowserGuardConfig,
): BrowserGuardDecision {
	const tool = toAgentBrowserTool(hostName);
	if (!tool) return { action: "continue" };

	const category = DANGEROUS_TOOLS[tool];
	if (category !== undefined) {
		const denied =
			(category === "eval" && config.denyEval) ||
			(category === "download" && config.denyDownload) ||
			(category === "upload" && config.denyUpload);
		if (denied) {
			return {
				action: "block",
				code: "action-denied",
				reason: `浏览器操作插件禁止了「${category}」类动作。如需放行，请让用户在「浏览器操作」设置中关闭对应开关。`,
			};
		}
	}

	if (config.allowedDomains.length === 0) return { action: "continue" };

	const urlKey = URL_ARGUMENT_BY_TOOL[tool];
	if (urlKey === undefined) return { action: "continue" };
	const raw = readStringArgument(input, urlKey);
	// 省略 url 是合法的（例如 open 不带 url 只启动浏览器、read 读当前页），不算越界。
	if (raw === undefined || raw.trim().length === 0) return { action: "continue" };

	const host = extractHost(raw);
	if (host === null) {
		return {
			action: "block",
			code: "invalid-url",
			reason: `无法解析目标地址 ${raw}；域名白名单开启时只允许 http(s) 地址。`,
		};
	}
	if (matchesAllowedDomain(host, config.allowedDomains)) return { action: "continue" };
	return {
		action: "block",
		code: "domain-not-allowed",
		reason: `${host} 不在浏览器操作插件的域名白名单内，已拦截。请告知用户：如确需访问，在「浏览器操作」设置中把该域名加入白名单后重试。`,
	};
}
