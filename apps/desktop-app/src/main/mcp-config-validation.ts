import type { McpConfigData, McpServerConfigData } from "../preload/api-types/mcp.js";

const COMMON_SERVER_KEYS = new Set([
	"type",
	"disabled",
	"autoApprove",
	"startupTimeout",
	"debug",
	"displayName",
	"description",
	"icon",
]);
const STDIO_SERVER_KEYS = new Set([...COMMON_SERVER_KEYS, "command", "args", "env", "cwd"]);
const HTTP_SERVER_KEYS = new Set([
	...COMMON_SERVER_KEYS,
	"url",
	"headers",
	"oauthClientId",
	"oauthDeviceFlow",
	"oauthScopes",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new Error(`Invalid ${path}.${key}`);
	}
}

function assertOptionalString(value: unknown, path: string, nonEmpty = false): void {
	if (value === undefined) return;
	if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
		throw new Error(`Invalid ${path}`);
	}
}

function assertOptionalBoolean(value: unknown, path: string): void {
	if (value !== undefined && typeof value !== "boolean") throw new Error(`Invalid ${path}`);
}

function assertOptionalStringArray(value: unknown, path: string): void {
	if (value === undefined) return;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Invalid ${path}`);
	}
}

function assertOptionalStringRecord(value: unknown, path: string): void {
	if (value === undefined) return;
	if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
		throw new Error(`Invalid ${path}`);
	}
}

function assertCommonServerConfig(server: Record<string, unknown>, path: string): void {
	assertOptionalBoolean(server.disabled, `${path}.disabled`);
	assertOptionalStringArray(server.autoApprove, `${path}.autoApprove`);
	if (
		server.startupTimeout !== undefined &&
		(typeof server.startupTimeout !== "number" ||
			!Number.isInteger(server.startupTimeout) ||
			server.startupTimeout < 1)
	) {
		throw new Error(`Invalid ${path}.startupTimeout`);
	}
	assertOptionalBoolean(server.debug, `${path}.debug`);
	assertOptionalString(server.displayName, `${path}.displayName`);
	assertOptionalString(server.description, `${path}.description`);
	assertOptionalString(server.icon, `${path}.icon`);
}

function assertServerConfig(value: unknown, path: string): asserts value is McpServerConfigData {
	if (!isRecord(value)) throw new Error(`Invalid ${path}`);
	assertCommonServerConfig(value, path);

	if (value.type === "http") {
		assertAllowedKeys(value, HTTP_SERVER_KEYS, path);
		assertOptionalString(value.url, `${path}.url`, true);
		if (value.url === undefined) throw new Error(`Invalid ${path}.url`);
		assertOptionalStringRecord(value.headers, `${path}.headers`);
		assertOptionalString(value.oauthClientId, `${path}.oauthClientId`);
		assertOptionalBoolean(value.oauthDeviceFlow, `${path}.oauthDeviceFlow`);
		assertOptionalString(value.oauthScopes, `${path}.oauthScopes`);
		return;
	}

	if (value.type !== undefined && value.type !== "stdio") throw new Error(`Invalid ${path}.type`);
	assertAllowedKeys(value, STDIO_SERVER_KEYS, path);
	assertOptionalString(value.command, `${path}.command`, true);
	if (value.command === undefined) throw new Error(`Invalid ${path}.command`);
	assertOptionalStringArray(value.args, `${path}.args`);
	assertOptionalStringRecord(value.env, `${path}.env`);
	assertOptionalString(value.cwd, `${path}.cwd`, true);
}

export function validateMcpConfig(value: unknown): McpConfigData {
	if (!isRecord(value) || Object.keys(value).some((key) => key !== "mcpServers")) {
		throw new Error("Invalid MCP config");
	}
	if (!isRecord(value.mcpServers)) throw new Error("Invalid MCP config.mcpServers");

	const mcpServers: Record<string, McpServerConfigData> = {};
	for (const [name, server] of Object.entries(value.mcpServers)) {
		if (name.trim().length === 0) throw new Error("Invalid MCP server name");
		assertServerConfig(server, `MCP server '${name}'`);
		mcpServers[name] = server;
	}

	return { mcpServers };
}
