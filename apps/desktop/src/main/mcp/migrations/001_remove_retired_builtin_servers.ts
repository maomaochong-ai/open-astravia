import type { FileMigration } from "@vetta/toolkit/file-migrations";
import type { McpConfigData, McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { validateMcpConfig } from "../../mcp-config-validation.js";

const MCP_CONFIG_PATH = "agent/mcp.json";
const ABILITY_LEDGER_PATH = "abilities.json";
const RETIRED_SERVER_NAMES = ["notion", "figma", "github"] as const;

function isRetiredBuiltinServer(name: string, server: McpServerConfigData): boolean {
	switch (name) {
		case "notion":
			return server.type === "http" && server.url === "https://mcp.notion.com/mcp";
		case "figma":
			return (
				server.type !== "http" &&
				server.command === "npx" &&
				server.args?.join("\0") === ["-y", "figma-developer-mcp", "--stdio"].join("\0")
			);
		case "github":
			return server.type === "http" && server.url === "https://api.githubcopilot.com/mcp/";
		default:
			return false;
	}
}

export function removeRetiredBuiltinMcpServers(config: McpConfigData): {
	readonly config: McpConfigData;
	readonly removedNames: readonly string[];
} {
	const removedNames: string[] = [];
	const mcpServers = { ...config.mcpServers };
	for (const name of RETIRED_SERVER_NAMES) {
		const server = mcpServers[name];
		if (!server || !isRetiredBuiltinServer(name, server)) continue;
		delete mcpServers[name];
		removedNames.push(name);
	}
	return {
		config: removedNames.length === 0 ? config : { mcpServers },
		removedNames,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function removeRetiredLedgerEntries(value: unknown, removedNames: readonly string[]): unknown {
	if (!isRecord(value)) return value;
	const source = isRecord(value.entries) ? value.entries : value;
	const entries = { ...source };
	let changed = false;
	for (const name of removedNames) {
		const key = `mcp:${name}`;
		if (!(key in entries)) continue;
		delete entries[key];
		changed = true;
	}
	if (!changed) return value;
	return source === value ? entries : { ...value, entries };
}

/**
 * Removes the three retired app-shipped MCP presets once. The exact name and
 * runtime signature are both required so an unrelated custom server survives.
 */
export const removeRetiredBuiltinMcpServersMigration: FileMigration = {
	version: 1,
	id: "remove-retired-builtin-mcp-servers",
	async migrate(context) {
		const rawConfig = await context.readJson(MCP_CONFIG_PATH);
		let removedNames: readonly string[] = [];
		if (rawConfig !== null) {
			const result = removeRetiredBuiltinMcpServers(validateMcpConfig(rawConfig));
			removedNames = result.removedNames;
			if (result.removedNames.length > 0) await context.writeJson(MCP_CONFIG_PATH, result.config);
		}

		const ledger = await context.readJson(ABILITY_LEDGER_PATH);
		const nextLedger = removeRetiredLedgerEntries(ledger, removedNames);
		if (nextLedger !== ledger) await context.writeJson(ABILITY_LEDGER_PATH, nextLedger);

		for (const name of removedNames) {
			await context.remove(`agent/mcp-auth/${name}.json`);
		}
	},
};
