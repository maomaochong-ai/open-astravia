import { DOMAIN_PROJECT_CAPABILITIES, type ProjectEntry, type ProjectListResult } from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginProjectMethods = {
	listProjects(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ProjectListResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_PROJECT_CAPABILITIES.LIST, {});
	},

	createProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		name: string,
		path?: string,
	): Promise<ProjectEntry> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_PROJECT_CAPABILITIES.CREATE, { name, path });
	},

	openProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		path: string,
		name?: string,
	): Promise<ProjectEntry> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_PROJECT_CAPABILITIES.OPEN, { path, name });
	},

	renameProject(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		path: string,
		name: string,
	): Promise<ProjectEntry> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_PROJECT_CAPABILITIES.RENAME, { path, name });
	},

	archiveProject(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_PROJECT_CAPABILITIES.ARCHIVE, { path });
	},

	unarchiveProject(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_PROJECT_CAPABILITIES.UNARCHIVE, { path });
	},

	removeProject(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_PROJECT_CAPABILITIES.REMOVE, { path });
	},
};

export type PluginProjectMethods = typeof pluginProjectMethods;
