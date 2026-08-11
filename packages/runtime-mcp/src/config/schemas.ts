import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { McpConfig } from "../protocol/index.js";

const LegacyStringMapSchema = Type.Union([
	Type.Record(Type.String(), Type.Unknown()),
	Type.Array(Type.Unknown()),
	Type.Null(),
]);

const McpServerCommonConfigProperties = {
	disabled: Type.Optional(Type.Boolean()),
	autoApprove: Type.Optional(Type.Array(Type.Unknown())),
	startupTimeout: Type.Optional(Type.Number()),
	debug: Type.Optional(Type.Boolean()),
	displayName: Type.Optional(Type.Unknown()),
	description: Type.Optional(Type.Unknown()),
};

export const McpStdioServerConfigSchema = Type.Object(
	{
		...McpServerCommonConfigProperties,
		type: Type.Optional(Type.Literal("stdio")),
		command: Type.String({ minLength: 1 }),
		args: Type.Optional(Type.Array(Type.Unknown())),
		env: Type.Optional(LegacyStringMapSchema),
		cwd: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export const McpHttpServerConfigSchema = Type.Object(
	{
		...McpServerCommonConfigProperties,
		type: Type.Literal("http"),
		url: Type.String({ minLength: 1 }),
		headers: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
		oauthClientId: Type.Optional(Type.Unknown()),
		oauthDeviceFlow: Type.Optional(Type.Unknown()),
		oauthScopes: Type.Optional(Type.Unknown()),
	},
	{ additionalProperties: true },
);

export const McpServerConfigSchema = Type.Union([McpStdioServerConfigSchema, McpHttpServerConfigSchema]);

export const McpConfigSchema = Type.Object(
	{
		mcpServers: Type.Union([Type.Record(Type.String(), McpServerConfigSchema), Type.Array(McpServerConfigSchema)]),
	},
	{ additionalProperties: true },
);

export type McpConfigSchemaValue = Static<typeof McpConfigSchema>;

/** Parse disk JSON while preserving the legacy field-level error contract. */
export function parseMcpConfig(value: unknown): McpConfig {
	if (Value.Check(McpConfigSchema, value)) return value as McpConfig;
	throwCompatibleConfigError(value);
	throw new Error("Invalid MCP config: schema validation failed");
}

function throwCompatibleConfigError(value: unknown): void {
	if (!isObject(value)) throw new Error("Invalid MCP config: must be an object");
	const servers = value.mcpServers;
	if (!servers || typeof servers !== "object") {
		throw new Error("Invalid MCP config: missing 'mcpServers' object");
	}
	for (const [name, config] of Object.entries(servers)) validateServerConfig(name, config);
}

function validateServerConfig(name: string, value: unknown): void {
	if (!isObject(value)) throw new Error(`Invalid server config for '${name}': must be an object`);
	const type = value.type ?? "stdio";
	if (type !== "stdio" && type !== "http") {
		throw new Error(`Invalid server config for '${name}': 'type' must be "stdio" or "http"`);
	}
	if (type === "http") {
		if (!value.url || !Value.Check(Type.String(), value.url)) {
			throw new Error(`Invalid server config for '${name}': missing or invalid 'url'`);
		}
		if (value.headers !== undefined && (!isObject(value.headers) || Array.isArray(value.headers))) {
			throw new Error(`Invalid server config for '${name}': 'headers' must be an object`);
		}
	} else {
		if (!value.command || !Value.Check(Type.String(), value.command)) {
			throw new Error(`Invalid server config for '${name}': missing or invalid 'command'`);
		}
		if (value.args !== undefined && !Value.Check(Type.Array(Type.Unknown()), value.args)) {
			throw new Error(`Invalid server config for '${name}': 'args' must be an array`);
		}
		if (value.env !== undefined && typeof value.env !== "object") {
			throw new Error(`Invalid server config for '${name}': 'env' must be an object`);
		}
		if (value.cwd !== undefined && !Value.Check(Type.String(), value.cwd)) {
			throw new Error(`Invalid server config for '${name}': 'cwd' must be a string`);
		}
	}
	if (value.disabled !== undefined && !Value.Check(Type.Boolean(), value.disabled)) {
		throw new Error(`Invalid server config for '${name}': 'disabled' must be a boolean`);
	}
	if (value.autoApprove !== undefined && !Value.Check(Type.Array(Type.Unknown()), value.autoApprove)) {
		throw new Error(`Invalid server config for '${name}': 'autoApprove' must be an array`);
	}
	if (value.startupTimeout !== undefined && !Value.Check(Type.Number(), value.startupTimeout)) {
		throw new Error(`Invalid server config for '${name}': 'startupTimeout' must be a number`);
	}
	if (value.debug !== undefined && !Value.Check(Type.Boolean(), value.debug)) {
		throw new Error(`Invalid server config for '${name}': 'debug' must be a boolean`);
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
