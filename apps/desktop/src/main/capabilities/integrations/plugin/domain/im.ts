import {
	DOMAIN_IM_CAPABILITIES,
	type ImLogEntry,
	type ImRuntimeStatus,
	type ImStatusSnapshot,
} from "@vetta/capability-sdk";
import { parseImAgentModelKey } from "../helpers.js";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginImMethods = {
	getImStatus(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ImStatusSnapshot> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_IM_CAPABILITIES.GET_STATUS, {});
	},

	listImLogs(this: PluginCapabilitySessionAccess, sessionId: string, limit: number): Promise<ImLogEntry[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_IM_CAPABILITIES.LIST_LOGS, { limit });
	},

	setImEnabled(this: PluginCapabilitySessionAccess, sessionId: string, enabled: boolean): Promise<ImRuntimeStatus> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_IM_CAPABILITIES.SET_ENABLED, { enabled });
	},

	restartIm(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ImRuntimeStatus> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_IM_CAPABILITIES.RESTART, {});
	},

	setImAgentModel(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		modelKey: string | null,
		reasoningLevel?: string,
	): Promise<ImRuntimeStatus> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_IM_CAPABILITIES.SET_AGENT_MODEL, {
			agentModel: modelKey === null ? null : parseImAgentModelKey(modelKey, reasoningLevel),
		});
	},
};

export type PluginImMethods = typeof pluginImMethods;
