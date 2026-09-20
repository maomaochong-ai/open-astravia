/**
 * 「这次模型请求该不该走应用代理」的唯一判定（纯逻辑，无 I/O）。
 */

import { type Api, supportsProviderFetchInjection } from "@vetta/ai";

export interface ProxyRoutingDecisionInput {
	/** 应用代理是否已配置并启用（含配置无效的情况——无效也要接管，好让请求显式失败）。 */
	readonly proxyActive: boolean;
	/** 供应商开关；`undefined` 表示跟随全局，即开启代理后默认走代理。 */
	readonly providerUseProxy: boolean | undefined;
	readonly api: Api;
}

export type ProxyRoutingDecision = "proxy" | "direct" | "unsupported-api";

/**
 * 默认走代理、按供应商排除，而不是默认直连、按供应商加入：用户打开「应用代理」
 * 的预期就是出网都经它，个别国内供应商绕回直连才是例外。环回地址的豁免不在
 * 这里判定——它是传输层的恒定行为，见 `shouldBypassProxy`。
 */
export function decideProxyRouting(input: ProxyRoutingDecisionInput): ProxyRoutingDecision {
	if (!input.proxyActive) return "direct";
	if (input.providerUseProxy === false) return "direct";
	// 厂商 SDK 自己发请求，注入的 fetch 到不了它——只能如实说不支持，
	// 不能让开关看着生效、请求却裸奔出去。
	if (!supportsProviderFetchInjection(input.api)) return "unsupported-api";
	return "proxy";
}
