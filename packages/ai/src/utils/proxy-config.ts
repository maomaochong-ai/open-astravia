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

/**
 * 本机与内网地址永不走代理：本地 Ollama / LM Studio、局域网模型服务、以及像
 * CLIProxyAPI 这样跑在 127.0.0.1 的桥接网关，绕一圈外网代理必然连不上。
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "::1", "[::1]", "0.0.0.0"]);

const LOCAL_HOSTNAME_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa"];

/**
 * 交给 shell、Go sidecar 与 node 侧 SDK 的 NO_PROXY。Go 的 httpproxy 认 CIDR；
 * 只认主机名的实现会忽略网段那几项，退化成仅豁免环回，不会误伤。
 */
export const NO_PROXY_HOSTS = "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,*.local";

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
	return isLocalHostname(hostname);
}

/** 主机名是否属于本机或内网。供设置页与传输层共用同一判据。 */
export function isLocalHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	if (LOCAL_HOSTNAMES.has(normalized)) return true;
	if (LOCAL_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true;
	if (isPrivateIpv4(normalized)) return true;
	return isPrivateIpv6(normalized);
}

function isPrivateIpv4(hostname: string): boolean {
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
	if (!match) return false;
	const octets = match.slice(1).map(Number);
	if (octets.some((octet) => octet > 255)) return false;
	const [a = 0, b = 0] = octets;
	// 127.0.0.0/8 环回、10/8、172.16/12、192.168/16 私网、169.254/16 链路本地。
	if (a === 127 || a === 10) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	return a === 169 && b === 254;
}

function isPrivateIpv6(hostname: string): boolean {
	const inner = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
	// fc00::/7 唯一本地、fe80::/10 链路本地。
	return /^f[cd][0-9a-f]{2}:/.test(inner) || /^fe[89ab][0-9a-f]:/.test(inner);
}
