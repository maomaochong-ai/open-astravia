import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

export const MCP_SERVER_TYPES = {
	STDIO: "stdio",
	HTTP: "http",
} as const;

const mcpEmptyInputType = Type.Object({}, { additionalProperties: false });

const mcpServerTypeType = Type.Union([Type.Literal(MCP_SERVER_TYPES.STDIO), Type.Literal(MCP_SERVER_TYPES.HTTP)]);

const mcpStringMapType = Type.Record(Type.String(), Type.String());

const mcpServerSummaryType = Type.Object(
	{
		name: Type.String(),
		type: mcpServerTypeType,
		disabled: Type.Boolean(),
		command: Type.Optional(Type.String()),
		url: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const mcpServerDetailType = Type.Object(
	{
		name: Type.String(),
		type: mcpServerTypeType,
		command: Type.Optional(Type.String()),
		args: Type.Optional(Type.Array(Type.String())),
		env: Type.Optional(mcpStringMapType),
		cwd: Type.Optional(Type.String()),
		url: Type.Optional(Type.String()),
		headers: Type.Optional(mcpStringMapType),
		disabled: Type.Boolean(),
		autoApprove: Type.Optional(Type.Array(Type.String())),
		startupTimeout: Type.Optional(Type.Number()),
		debug: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const mcpServerNameInputType = Type.Object(
	{
		name: Type.String({ pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

const mcpServerCommonUpsertFields = {
	disabled: Type.Optional(Type.Boolean()),
	autoApprove: Type.Optional(Type.Array(Type.String())),
	startupTimeout: Type.Optional(Type.Integer({ minimum: 1 })),
	debug: Type.Optional(Type.Boolean()),
};

/** stdio upsert: type may be omitted (defaults to stdio at the service layer) or explicit "stdio". */
const mcpStdioServerUpsertDataType = Type.Object(
	{
		type: Type.Optional(Type.Literal(MCP_SERVER_TYPES.STDIO)),
		command: Type.Optional(Type.String()),
		args: Type.Optional(Type.Array(Type.String())),
		env: Type.Optional(mcpStringMapType),
		cwd: Type.Optional(Type.String()),
		...mcpServerCommonUpsertFields,
	},
	{ additionalProperties: false },
);

/** http upsert: type must be "http"; stdio-only fields are rejected via additionalProperties. */
const mcpHttpServerUpsertDataType = Type.Object(
	{
		type: Type.Literal(MCP_SERVER_TYPES.HTTP),
		url: Type.Optional(Type.String()),
		headers: Type.Optional(mcpStringMapType),
		...mcpServerCommonUpsertFields,
	},
	{ additionalProperties: false },
);

// HTTP first so `{ type: "http", ... }` does not fall through to the optional-type stdio branch.
const mcpServerUpsertDataType = Type.Union([mcpHttpServerUpsertDataType, mcpStdioServerUpsertDataType]);

const mcpServerUpsertInputType = Type.Object(
	{
		name: Type.String({ pattern: "\\S" }),
		data: mcpServerUpsertDataType,
	},
	{ additionalProperties: false },
);

const mcpServerSetEnabledInputType = Type.Object(
	{
		name: Type.String({ pattern: "\\S" }),
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export type McpServerType = Static<typeof mcpServerTypeType>;
export type McpServerSummary = Readonly<Static<typeof mcpServerSummaryType>>;
export type McpServerDetail = Readonly<Static<typeof mcpServerDetailType>>;
export type McpStdioServerUpsertData = Readonly<Static<typeof mcpStdioServerUpsertDataType>>;
export type McpHttpServerUpsertData = Readonly<Static<typeof mcpHttpServerUpsertDataType>>;
export type McpServerUpsertData = Readonly<Static<typeof mcpServerUpsertDataType>>;
export type McpServerNameInput = Readonly<Static<typeof mcpServerNameInputType>>;
export type McpServerUpsertInput = Readonly<Static<typeof mcpServerUpsertInputType>>;
export type McpServerSetEnabledInput = Readonly<Static<typeof mcpServerSetEnabledInputType>>;

const mcpEmptyInputSchema = defineCapabilityInputSchema(mcpEmptyInputType);
const mcpServerListOutputSchema = defineCapabilityOutputSchema(Type.Array(mcpServerSummaryType), { clean: true });
const mcpServerNameInputSchema = defineCapabilityInputSchema(mcpServerNameInputType, { clean: true });
const mcpServerDetailOutputSchema = defineCapabilityOutputSchema(mcpServerDetailType, { clean: true });
// No clean on upsert: invalid cross-type fields (e.g. http + command) must fail, not be stripped.
const mcpServerUpsertInputSchema = defineCapabilityInputSchema(mcpServerUpsertInputType);
const mcpServerSetEnabledInputSchema = defineCapabilityInputSchema(mcpServerSetEnabledInputType, { clean: true });
const mcpNoOutputSchema = defineCapabilityNoOutputSchema();

export const DOMAIN_MCP_CAPABILITIES = {
	LIST_SERVERS: defineCapability<Record<string, never>, McpServerSummary[]>({
		id: "cap.domain.vetta.mcp.server.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mcpEmptyInputSchema,
		output: mcpServerListOutputSchema,
	}),
	GET_SERVER: defineCapability<McpServerNameInput, McpServerDetail>({
		id: "cap.domain.vetta.mcp.server.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mcpServerNameInputSchema,
		output: mcpServerDetailOutputSchema,
	}),
	UPSERT_SERVER: defineCapability<McpServerUpsertInput, McpServerDetail>({
		id: "cap.domain.vetta.mcp.server.upsert",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mcpServerUpsertInputSchema,
		output: mcpServerDetailOutputSchema,
	}),
	SET_SERVER_ENABLED: defineCapability<McpServerSetEnabledInput, undefined>({
		id: "cap.domain.vetta.mcp.server.set-enabled",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mcpServerSetEnabledInputSchema,
		output: mcpNoOutputSchema,
	}),
	REMOVE_SERVER: defineCapability<McpServerNameInput, undefined>({
		id: "cap.domain.vetta.mcp.server.remove",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: mcpServerNameInputSchema,
		output: mcpNoOutputSchema,
	}),
} as const;

export const DOMAIN_MCP_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_MCP_CAPABILITIES));
