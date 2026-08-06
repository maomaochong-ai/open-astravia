import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

export const IM_TRANSPORTS = {
	FEISHU: "feishu",
	WECHAT: "wechat",
} as const;

export const IM_TRANSPORT_STATUSES = {
	OFFLINE: "offline",
	CONNECTING: "connecting",
	ONLINE: "online",
	ERROR: "error",
	AWAITING_BIND: "awaiting_bind",
} as const;

export const IM_LOG_LEVELS = {
	DEBUG: "debug",
	INFO: "info",
	WARN: "warn",
	ERROR: "error",
} as const;

const imEmptyInputType = Type.Object({}, { additionalProperties: false });

const imTransportType = Type.Union([Type.Literal(IM_TRANSPORTS.FEISHU), Type.Literal(IM_TRANSPORTS.WECHAT)]);

const imTransportStatusType = Type.Union([
	Type.Literal(IM_TRANSPORT_STATUSES.OFFLINE),
	Type.Literal(IM_TRANSPORT_STATUSES.CONNECTING),
	Type.Literal(IM_TRANSPORT_STATUSES.ONLINE),
	Type.Literal(IM_TRANSPORT_STATUSES.ERROR),
	Type.Literal(IM_TRANSPORT_STATUSES.AWAITING_BIND),
]);

const imLogLevelType = Type.Union([
	Type.Literal(IM_LOG_LEVELS.DEBUG),
	Type.Literal(IM_LOG_LEVELS.INFO),
	Type.Literal(IM_LOG_LEVELS.WARN),
	Type.Literal(IM_LOG_LEVELS.ERROR),
]);

const imAgentModelOutputType = Type.Object(
	{
		provider: Type.String(),
		model: Type.String(),
		reasoningLevel: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const imAgentModelInputType = Type.Object(
	{
		provider: Type.String({ pattern: "\\S" }),
		model: Type.String({ pattern: "\\S" }),
		reasoningLevel: Type.Optional(Type.String({ pattern: "\\S" })),
	},
	{ additionalProperties: false },
);

const imRuntimeStatusType = Type.Object(
	{
		transport: imTransportStatusType,
		lastError: Type.Optional(Type.String()),
		lastErrorAt: Type.Optional(Type.String()),
		activeSessions: Type.Number(),
		sidecarPid: Type.Optional(Type.Number()),
		sidecarStartedAt: Type.Optional(Type.String()),
		consecutiveStartFailures: Type.Number(),
		binaryPath: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const imStatusSnapshotType = Type.Object(
	{
		enabled: Type.Boolean(),
		transport: imTransportType,
		agentModel: Type.Union([imAgentModelOutputType, Type.Null()]),
		wechatBound: Type.Boolean(),
		feishuAppId: Type.Union([Type.String(), Type.Null()]),
		runtime: imRuntimeStatusType,
	},
	{ additionalProperties: false },
);

const imLogEntryType = Type.Object(
	{
		level: imLogLevelType,
		msg: Type.String(),
		time: Type.String(),
		fields: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	},
	{ additionalProperties: false },
);

const imLogsOutputType = Type.Array(imLogEntryType);

const imLogListInputType = Type.Object(
	{
		limit: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

const imEnabledInputType = Type.Object(
	{
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const imAgentModelSettingInputType = Type.Object(
	{
		agentModel: Type.Union([imAgentModelInputType, Type.Null()]),
	},
	{ additionalProperties: false },
);

export type ImTransport = Static<typeof imTransportType>;
export type ImTransportStatus = Static<typeof imTransportStatusType>;
export type ImLogLevel = Static<typeof imLogLevelType>;
export type ImAgentModel = Readonly<Static<typeof imAgentModelOutputType>>;
export type ImRuntimeStatus = Readonly<Static<typeof imRuntimeStatusType>>;
export type ImStatusSnapshot = Readonly<Static<typeof imStatusSnapshotType>>;
export type ImLogEntry = Readonly<Static<typeof imLogEntryType>>;
export type ImLogListInput = Readonly<Static<typeof imLogListInputType>>;
export type ImEnabledInput = Readonly<Static<typeof imEnabledInputType>>;
export type ImAgentModelSettingInput = Readonly<Static<typeof imAgentModelSettingInputType>>;

const imEmptyInputSchema = defineCapabilityInputSchema(imEmptyInputType);
const imStatusSnapshotOutputSchema = defineCapabilityOutputSchema(imStatusSnapshotType, { clean: true });
const imLogListInputSchema = defineCapabilityInputSchema(imLogListInputType, { clean: true });
const imLogsOutputSchema = defineCapabilityOutputSchema(imLogsOutputType, { clean: true });
const imEnabledInputSchema = defineCapabilityInputSchema(imEnabledInputType, { clean: true });
const imRuntimeStatusOutputSchema = defineCapabilityOutputSchema(imRuntimeStatusType, { clean: true });
const imAgentModelSettingInputSchema = defineCapabilityInputSchema(imAgentModelSettingInputType, { clean: true });

export const DOMAIN_IM_CAPABILITIES = {
	GET_STATUS: defineCapability<Record<string, never>, ImStatusSnapshot>({
		id: "cap.domain.vetta.im.status.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: imEmptyInputSchema,
		output: imStatusSnapshotOutputSchema,
	}),
	LIST_LOGS: defineCapability<ImLogListInput, ImLogEntry[]>({
		id: "cap.domain.vetta.im.log.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: imLogListInputSchema,
		output: imLogsOutputSchema,
	}),
	SET_ENABLED: defineCapability<ImEnabledInput, ImRuntimeStatus>({
		id: "cap.domain.vetta.im.enabled.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: imEnabledInputSchema,
		output: imRuntimeStatusOutputSchema,
	}),
	RESTART: defineCapability<Record<string, never>, ImRuntimeStatus>({
		id: "cap.domain.vetta.im.restart",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: imEmptyInputSchema,
		output: imRuntimeStatusOutputSchema,
	}),
	SET_AGENT_MODEL: defineCapability<ImAgentModelSettingInput, ImRuntimeStatus>({
		id: "cap.domain.vetta.im.agent-model.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: imAgentModelSettingInputSchema,
		output: imRuntimeStatusOutputSchema,
	}),
} as const;

export const DOMAIN_IM_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_IM_CAPABILITIES));
