import { DOMAIN_MCP_CAPABILITIES, type McpServerDetail, type McpServerSummary } from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginMcpMethods = {
	listMcpServers(this: PluginCapabilitySessionAccess, sessionId: string): Promise<McpServerSummary[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MCP_CAPABILITIES.LIST_SERVERS, {});
	},

	getMcpServer(this: PluginCapabilitySessionAccess, sessionId: string, name: string): Promise<McpServerDetail> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MCP_CAPABILITIES.GET_SERVER, { name });
	},

	upsertMcpServer(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		name: string,
		data: unknown,
	): Promise<McpServerDetail> {
		const input = DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER.parseInput({ name, data });
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER, input);
	},

	setMcpServerEnabled(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		name: string,
		enabled: boolean,
	): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MCP_CAPABILITIES.SET_SERVER_ENABLED, {
			name,
			enabled,
		});
	},

	removeMcpServer(this: PluginCapabilitySessionAccess, sessionId: string, name: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_MCP_CAPABILITIES.REMOVE_SERVER, { name });
	},
};

export type PluginMcpMethods = typeof pluginMcpMethods;
