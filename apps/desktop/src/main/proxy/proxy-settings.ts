/**
 * 应用代理配置的规范化、脱敏与补丁合并（纯逻辑，无 I/O）。
 *
 * 代理口令与 API Key 同级：它能被拿去连用户的内网代理，绝不下发给渲染层。
 * 读配置时抹掉口令、只留 `passwordConfigured` 标记；写配置时省略口令即沿用
 * 已存的那份，空串才表示清除——否则渲染层每次保存都得把明文口令回传一趟。
 */

import { isProxyProtocol, type ProxyProtocol } from "@vetta/ai";

export interface DesktopProxyConfig {
	enabled: boolean;
	protocol: ProxyProtocol;
	host: string;
	port: number;
	username: string;
	password: string;
}

/** 交给渲染层的形态：无口令，只说明「存过没有」。 */
export type DesktopProxyConfigSnapshot = Omit<DesktopProxyConfig, "password"> & {
	passwordConfigured: boolean;
};

/** 渲染层提交的补丁。省略 `password` 表示不改动已存的口令。 */
export type DesktopProxyConfigPatch = Partial<Omit<DesktopProxyConfig, "password">> & {
	password?: string;
};

export const DEFAULT_PROXY_CONFIG: DesktopProxyConfig = {
	enabled: false,
	protocol: "http",
	host: "",
	port: 7890,
	username: "",
	password: "",
};

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value.trim() : fallback;
}

/**
 * 端口保留原样（含 0 / 越界值），不在这里夹紧。
 * 校验属于 `resolveProxyConfig`，夹紧会把「用户填错了」悄悄变成「连到别的端口」。
 */
function asPort(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number.parseInt(value.trim(), 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

export function normalizeProxyConfig(value: unknown): DesktopProxyConfig {
	if (typeof value !== "object" || value === null) return { ...DEFAULT_PROXY_CONFIG };
	const input = value as Record<string, unknown>;
	return {
		enabled: input.enabled === true,
		protocol: isProxyProtocol(input.protocol) ? input.protocol : DEFAULT_PROXY_CONFIG.protocol,
		host: asString(input.host, DEFAULT_PROXY_CONFIG.host),
		port: asPort(input.port, DEFAULT_PROXY_CONFIG.port),
		username: asString(input.username, DEFAULT_PROXY_CONFIG.username),
		// 口令不 trim：前后空格可能是口令本身的一部分。
		password: typeof input.password === "string" ? input.password : DEFAULT_PROXY_CONFIG.password,
	};
}

export function redactProxyConfig(config: DesktopProxyConfig | undefined): DesktopProxyConfigSnapshot {
	const resolved = config ?? DEFAULT_PROXY_CONFIG;
	const { password, ...rest } = resolved;
	return { ...rest, passwordConfigured: password.length > 0 };
}

/** 把渲染层补丁合到现有配置上；`password` 缺省即保留原口令。 */
export function mergeProxyConfigPatch(current: DesktopProxyConfig | undefined, patch: unknown): DesktopProxyConfig {
	const base = current ?? DEFAULT_PROXY_CONFIG;
	if (typeof patch !== "object" || patch === null) return { ...base };
	const input = patch as Record<string, unknown>;
	return normalizeProxyConfig({
		...base,
		...input,
		password: typeof input.password === "string" ? input.password : base.password,
	});
}
