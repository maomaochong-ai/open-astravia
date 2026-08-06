import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";
import { CAPABILITY_JSON_VALUE_TYPE, type CapabilityJsonValue } from "./json.js";

/**
 * Vetta 服务端网关调用（ADR-0056）。
 *
 * 与 `foundation.network.request` 的区别：调用方只给出 **相对 `/api/v1` 的路径**，
 * 服务端地址与登录凭据都由宿主解析注入，调用方拿不到 token、也拼不出指向其它
 * 接口的绝对 URL。把 JWT 交给插件进程等于开放全部 `/api/v1` 的越权面，因此不
 * 提供「取 token 自己拼」的口子。
 *
 * 领域无关：这里只负责「带着当前登录身份打服务端」，不含任何图像/模型语义。
 */
const gatewayRequestInputType = Type.Object({ request: CAPABILITY_JSON_VALUE_TYPE });

export type GatewayRequestInput = Readonly<Static<typeof gatewayRequestInputType>>;

const gatewayRequestInputSchema = defineCapabilityInputSchema(gatewayRequestInputType, { clean: true });
const gatewayRequestOutputSchema = defineCapabilityOutputSchema(CAPABILITY_JSON_VALUE_TYPE);

export const FOUNDATION_GATEWAY_CAPABILITIES = {
	REQUEST: defineCapability<GatewayRequestInput, CapabilityJsonValue>({
		id: "cap.foundation.vetta.gateway.request",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: gatewayRequestInputSchema,
		output: gatewayRequestOutputSchema,
	}),
} as const;

export const FOUNDATION_GATEWAY_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(FOUNDATION_GATEWAY_CAPABILITIES),
);
