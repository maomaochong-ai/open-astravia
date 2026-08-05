import {
	type CapabilityJsonValue,
	FOUNDATION_GATEWAY_CAPABILITIES,
	parseCapabilityJsonValue,
} from "../../../foundation.js";
import type { PluginCapabilitySessionAccess } from "../types.js";

/**
 * 网关调用只对 official（随包分发的 preset）插件开放，且不挂任何可声明权限。
 *
 * 风险性质不是越权——服务端的档位授权限定了可用模型，消耗的是用户自己的积分——
 * 而是插件偷跑烧光用户额度。在缺少插件签名与审核机制的前提下，「安装时用户确认」
 * 形同虚设，因此先按来源收口，等第三方生态成熟再考虑放开（ADR-0056）。
 */
export const pluginGatewayMethods = {
	requestGateway(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		request: unknown,
	): Promise<CapabilityJsonValue> {
		return this.client(sessionId, { official: true }).invoke(FOUNDATION_GATEWAY_CAPABILITIES.REQUEST, {
			request: parseCapabilityJsonValue(request),
		});
	},
};

export type PluginGatewayMethods = typeof pluginGatewayMethods;
