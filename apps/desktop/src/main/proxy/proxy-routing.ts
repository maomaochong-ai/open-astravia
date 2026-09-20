/**
 * 「这次模型请求该不该走应用代理」的唯一判定（纯逻辑，无 I/O）。
 */

import { type Api, supportsProviderFetchInjection } from "@vetta/ai";
import { shouldBypassProxy } from "@vetta/ai/proxy";

export interface ProxyRoutingDecisionInput {
	/** 应用代理是否已配置并启用（含配置无效的情况——无效也要接管，好让请求显式失败）。 */
	readonly proxyActive: boolean;
	/** 供应商开关；`undefined` 表示跟随全局，即开启代理后默认走代理。 */
	readonly providerUseProxy: boolean | undefined;
	readonly api: Api;
	/** 供应商的上游地址；本机与内网地址恒定直连。 */
	readonly baseUrl: string | undefined;
}

export type ProxyRoutingDecision =
	/** 走代理。由进程级全局 dispatcher 兜住，不需要注入。 */
	| "proxy"
	/** 用户显式排除。需要注入直连 fetch 才能把全局代理盖掉。 */
	| "direct"
	/** 上游就在本机或内网，绕代理出去必然连不上：恒定直连，开关无意义。 */
	| "always-local"
	/** 厂商 SDK 自己发请求，够不到注入的传输：只能跟随全局，无法单独排除。 */
	| "follows-global";

/**
 * 默认走代理、按供应商排除，而不是默认直连、按供应商加入：用户打开「应用代理」
 * 的预期就是出网都经它，个别国内供应商绕回直连才是例外。
 */
export function decideProxyRouting(input: ProxyRoutingDecisionInput): ProxyRoutingDecision {
	if (!input.proxyActive) return "direct";
	// 本机/内网先判：这一跳根本没出网，走不走代理由不得开关，也由不得 SDK 支不支持。
	// CLIProxyAPI 这类跑在 127.0.0.1 的桥接网关就落在这里——它自己怎么出网是它的事。
	if (input.baseUrl && shouldBypassProxy(input.baseUrl)) return "always-local";
	// 支持性先于用户开关：拿不到注入传输的 API，开关拨到哪边都改变不了它的去向，
	// 只能如实说「跟随全局」，不能让界面显得排除成功了。
	if (!supportsProviderFetchInjection(input.api)) return "follows-global";
	if (input.providerUseProxy === false) return "direct";
	return "proxy";
}
