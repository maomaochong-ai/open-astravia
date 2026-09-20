/**
 * 出站代理配置的解析与校验（纯逻辑，无 I/O）。
 *
 * 宿主把用户填的代理表单原样交过来，这里负责判定它到底意味着「直连」「经代理」
 * 还是「配置坏了」。坏配置必须显式失败：静默降级成直连会让用户以为出口 IP 被
 * 代理保护着，实际却在裸奔，这比报错危险得多。
 */

export const PROXY_PROTOCOLS = ["http", "https"] as const;

export type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

export interface ProxyConfig {
	readonly enabled: boolean;
	readonly protocol: ProxyProtocol;
	readonly host: string;
	readonly port: number;
	readonly username?: string;
	readonly password?: string;
}

export type ProxyConfigErrorReason = "invalid-protocol" | "invalid-host" | "invalid-port";

export type ProxyResolution =
	| { readonly mode: "direct" }
	| {
			/** 代理可用。`url` 含凭据，只能交给 dispatcher；对外展示用 `target`。 */
			readonly mode: "proxy";
			readonly url: string;
			readonly target: string;
	  }
	| { readonly mode: "invalid"; readonly reason: ProxyConfigErrorReason };

/** 环回地址永不走代理：本地 Ollama / LM Studio 这类端点绕一圈代理必然失败。 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const NO_PROXY_HOSTS = "localhost,127.0.0.1,::1";

export function isProxyProtocol(value: unknown): value is ProxyProtocol {
	return typeof value === "string" && (PROXY_PROTOCOLS as readonly string[]).includes(value);
}

/**
 * 主机名是否可用。拒掉的字符都是会改写最终代理 URL 语义的：`@` 能伪造凭据段，
 * `/ ? #` 能把 host 截断成别的地址，空白会被 URL 解析器静默吃掉。
 */
export function isValidProxyHost(host: string): boolean {
	const trimmed = host.trim();
	if (trimmed.length === 0) return false;
	if (/[\s/\\@#?%]/.test(trimmed)) return false;
	if (trimmed.startsWith("[") || trimmed.endsWith("]")) {
		const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : undefined;
		return inner !== undefined && isIpv6(inner);
	}
	// 裸 IPv6 之外，host 里不允许再出现冒号（那是端口的位置）。
	return !trimmed.includes(":") || isIpv6(trimmed);
}

export function isValidProxyPort(port: number): boolean {
	return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isIpv6(value: string): boolean {
	// URL 解析器是这里唯一权威的 IPv6 判定；自己写正则必然漏掉压缩写法。
	try {
		return new URL(`http://[${value}]`).hostname === `[${value.toLowerCase()}]`;
	} catch {
		return false;
	}
}

function bracketed(host: string): string {
	const trimmed = host.trim();
	if (trimmed.startsWith("[")) return trimmed;
	return isIpv6(trimmed) ? `[${trimmed}]` : trimmed;
}

/** 代理 URL。凭据必须 percent-encode，否则密码里的 `:@/` 会改写 URL 结构。 */
export function buildProxyUrl(config: ProxyConfig): string {
	const username = config.username ?? "";
	const password = config.password ?? "";
	const credentials =
		username === "" && password === "" ? "" : `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
	return `${config.protocol}://${credentials}${bracketed(config.host)}:${config.port}`;
}

export function resolveProxyConfig(config: ProxyConfig | undefined): ProxyResolution {
	if (!config?.enabled) return { mode: "direct" };
	if (!isProxyProtocol(config.protocol)) return { mode: "invalid", reason: "invalid-protocol" };
	if (!isValidProxyHost(config.host)) return { mode: "invalid", reason: "invalid-host" };
	if (!isValidProxyPort(config.port)) return { mode: "invalid", reason: "invalid-port" };
	return {
		mode: "proxy",
		url: buildProxyUrl(config),
		target: `${bracketed(config.host)}:${config.port}`,
	};
}

/** 目标地址是否豁免代理。解析不了的 URL 一律不豁免，交给上层照常报错。 */
export function shouldBypassProxy(targetUrl: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(targetUrl).hostname;
	} catch {
		return false;
	}
	const normalized = hostname.toLowerCase();
	if (LOOPBACK_HOSTNAMES.has(normalized)) return true;
	// 127.0.0.0/8 整段都是环回，不止 127.0.0.1。
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}
