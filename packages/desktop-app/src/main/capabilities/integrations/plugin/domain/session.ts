import {
	DOMAIN_SESSION_CAPABILITIES,
	type SessionHistoryEntry,
	type SessionRuntimeProject,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginSessionMethods = {
	listSessions(this: PluginCapabilitySessionAccess, sessionId: string, cwd: string): Promise<SessionHistoryEntry[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SESSION_CAPABILITIES.LIST, { cwd });
	},

	listRuntimeProjects(this: PluginCapabilitySessionAccess, sessionId: string): Promise<SessionRuntimeProject[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SESSION_CAPABILITIES.LIST_RUNTIME_PROJECTS, {});
	},
};

export type PluginSessionMethods = typeof pluginSessionMethods;
