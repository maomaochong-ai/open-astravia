import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

export const WEBHOOK_KINDS = {
	FEISHU: "feishu",
	DINGTALK: "dingtalk",
} as const;

export const WEBHOOK_MESSAGE_LEVELS = {
	INFO: "info",
	WARN: "warn",
	ERROR: "error",
	SUCCESS: "success",
} as const;

const webhookEmptyInputType = Type.Object({}, { additionalProperties: false });

const webhookKindType = Type.Union([Type.Literal(WEBHOOK_KINDS.FEISHU), Type.Literal(WEBHOOK_KINDS.DINGTALK)]);

const webhookMessageLevelType = Type.Union([
	Type.Literal(WEBHOOK_MESSAGE_LEVELS.INFO),
	Type.Literal(WEBHOOK_MESSAGE_LEVELS.WARN),
	Type.Literal(WEBHOOK_MESSAGE_LEVELS.ERROR),
	Type.Literal(WEBHOOK_MESSAGE_LEVELS.SUCCESS),
]);

const webhookNonBlankInputStringType = Type.String({ pattern: "\\S" });

const webhookFeishuOptionsType = Type.Object(
	{
		mentionAll: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const webhookDingtalkOptionsType = Type.Object(
	{
		mentionAll: Type.Optional(Type.Boolean()),
		atMobiles: Type.Optional(Type.Array(Type.String())),
		keyword: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const webhookEndpointType = Type.Object(
	{
		id: Type.String(),
		kind: webhookKindType,
		name: Type.String(),
		enabled: Type.Boolean(),
		createdAt: Type.String(),
		updatedAt: Type.String(),
		urlMask: Type.Optional(Type.String()),
		hasSignSecret: Type.Optional(Type.Boolean()),
		feishu: Type.Optional(webhookFeishuOptionsType),
		dingtalk: Type.Optional(webhookDingtalkOptionsType),
	},
	{ additionalProperties: false },
);

const webhookProviderDescriptorType = Type.Object(
	{
		kind: webhookKindType,
		displayName: Type.String(),
		iconClass: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

/** Create allows empty display name (legacy); webhookUrl must be non-blank. */
const webhookCreateDataType = Type.Object(
	{
		kind: webhookKindType,
		name: Type.String(),
		webhookUrl: webhookNonBlankInputStringType,
		signSecret: Type.Optional(Type.String()),
		enabled: Type.Optional(Type.Boolean()),
		feishu: Type.Optional(webhookFeishuOptionsType),
		dingtalk: Type.Optional(webhookDingtalkOptionsType),
	},
	{ additionalProperties: false },
);

/**
 * Partial update. `signSecret: ""` is valid (explicit clear).
 * `minProperties: 1` rejects empty patches; undefined keys are stripped when clean is enabled.
 */
const webhookUpdateDataType = Type.Object(
	{
		name: Type.Optional(webhookNonBlankInputStringType),
		enabled: Type.Optional(Type.Boolean()),
		webhookUrl: Type.Optional(webhookNonBlankInputStringType),
		signSecret: Type.Optional(Type.String()),
		feishu: Type.Optional(webhookFeishuOptionsType),
		dingtalk: Type.Optional(webhookDingtalkOptionsType),
	},
	{ additionalProperties: false, minProperties: 1 },
);

const webhookMessageType = Type.Object(
	{
		title: Type.Optional(Type.String()),
		text: Type.String(),
		level: Type.Optional(webhookMessageLevelType),
	},
	{ additionalProperties: false },
);

const webhookSendResultType = Type.Object(
	{
		ok: Type.Boolean(),
		error: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const webhookIdInputType = Type.Object(
	{
		id: webhookNonBlankInputStringType,
	},
	{ additionalProperties: false },
);

const webhookCreateInputType = Type.Object(
	{
		data: webhookCreateDataType,
	},
	{ additionalProperties: false },
);

const webhookUpdateInputType = Type.Object(
	{
		id: webhookNonBlankInputStringType,
		data: webhookUpdateDataType,
	},
	{ additionalProperties: false },
);

const webhookSetEnabledInputType = Type.Object(
	{
		id: webhookNonBlankInputStringType,
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const webhookSendInputType = Type.Object(
	{
		id: webhookNonBlankInputStringType,
		message: webhookMessageType,
	},
	{ additionalProperties: false },
);

export type WebhookKind = Static<typeof webhookKindType>;
export type WebhookMessageLevel = Static<typeof webhookMessageLevelType>;
export type WebhookFeishuOptions = Readonly<Static<typeof webhookFeishuOptionsType>>;
export type WebhookDingtalkOptions = Readonly<Static<typeof webhookDingtalkOptionsType>>;
export type WebhookEndpoint = Readonly<Static<typeof webhookEndpointType>>;
export type WebhookProviderDescriptor = Readonly<Static<typeof webhookProviderDescriptorType>>;
export type WebhookCreateData = Readonly<Static<typeof webhookCreateDataType>>;
export type WebhookUpdateData = Readonly<Static<typeof webhookUpdateDataType>>;
export type WebhookMessage = Readonly<Static<typeof webhookMessageType>>;
export type WebhookSendResult = Readonly<Static<typeof webhookSendResultType>>;
export type WebhookIdInput = Readonly<Static<typeof webhookIdInputType>>;
export type WebhookCreateInput = Readonly<Static<typeof webhookCreateInputType>>;
export type WebhookUpdateInput = Readonly<Static<typeof webhookUpdateInputType>>;
export type WebhookSetEnabledInput = Readonly<Static<typeof webhookSetEnabledInputType>>;
export type WebhookSendInput = Readonly<Static<typeof webhookSendInputType>>;

const webhookEmptyInputSchema = defineCapabilityInputSchema(webhookEmptyInputType);
const webhookEndpointsOutputSchema = defineCapabilityOutputSchema(Type.Array(webhookEndpointType), { clean: true });
const webhookProvidersOutputSchema = defineCapabilityOutputSchema(Type.Array(webhookProviderDescriptorType), {
	clean: true,
});
const webhookCreateInputSchema = defineCapabilityInputSchema(webhookCreateInputType, { clean: true });
const webhookEndpointOutputSchema = defineCapabilityOutputSchema(webhookEndpointType, { clean: true });
// clean strips `name: undefined` while keeping `signSecret: ""` for explicit secret clear.
const webhookUpdateInputSchema = defineCapabilityInputSchema(webhookUpdateInputType, { clean: true });
const webhookIdInputSchema = defineCapabilityInputSchema(webhookIdInputType, { clean: true });
const webhookSetEnabledInputSchema = defineCapabilityInputSchema(webhookSetEnabledInputType, { clean: true });
const webhookSendResultOutputSchema = defineCapabilityOutputSchema(webhookSendResultType, { clean: true });
const webhookSendInputSchema = defineCapabilityInputSchema(webhookSendInputType, { clean: true });
const webhookNoOutputSchema = defineCapabilityNoOutputSchema();

export const DOMAIN_WEBHOOK_CAPABILITIES = {
	LIST_ENDPOINTS: defineCapability<Record<string, never>, WebhookEndpoint[]>({
		id: "cap.domain.vetta.webhook.endpoint.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookEmptyInputSchema,
		output: webhookEndpointsOutputSchema,
	}),
	LIST_PROVIDERS: defineCapability<Record<string, never>, WebhookProviderDescriptor[]>({
		id: "cap.domain.vetta.webhook.provider.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookEmptyInputSchema,
		output: webhookProvidersOutputSchema,
	}),
	CREATE_ENDPOINT: defineCapability<WebhookCreateInput, WebhookEndpoint>({
		id: "cap.domain.vetta.webhook.endpoint.create",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookCreateInputSchema,
		output: webhookEndpointOutputSchema,
	}),
	UPDATE_ENDPOINT: defineCapability<WebhookUpdateInput, WebhookEndpoint>({
		id: "cap.domain.vetta.webhook.endpoint.update",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookUpdateInputSchema,
		output: webhookEndpointOutputSchema,
	}),
	DELETE_ENDPOINT: defineCapability<WebhookIdInput, undefined>({
		id: "cap.domain.vetta.webhook.endpoint.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookIdInputSchema,
		output: webhookNoOutputSchema,
	}),
	SET_ENABLED: defineCapability<WebhookSetEnabledInput, WebhookEndpoint>({
		id: "cap.domain.vetta.webhook.endpoint.set-enabled",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookSetEnabledInputSchema,
		output: webhookEndpointOutputSchema,
	}),
	TEST_ENDPOINT: defineCapability<WebhookIdInput, WebhookSendResult>({
		id: "cap.domain.vetta.webhook.endpoint.test",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookIdInputSchema,
		output: webhookSendResultOutputSchema,
	}),
	SEND_MESSAGE: defineCapability<WebhookSendInput, WebhookSendResult>({
		id: "cap.domain.vetta.webhook.endpoint.send",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: webhookSendInputSchema,
		output: webhookSendResultOutputSchema,
	}),
} as const;

export const DOMAIN_WEBHOOK_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_WEBHOOK_CAPABILITIES));
