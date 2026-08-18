import { randomUUID } from "node:crypto";
import type { CapabilityAccessHandle, CapabilityAccessSessionFactory } from "@vetta/capability-sdk";
import { CAPABILITY_ERROR_CODES, CapabilityError } from "@vetta/capability-sdk";
import { type PluginAgentSettingsMethods, pluginAgentSettingsMethods } from "./domain/agent-settings.js";
import { type PluginAiMethods, pluginAiMethods } from "./domain/ai.js";
import { type PluginBatchTaskMethods, pluginBatchTaskMethods } from "./domain/batch-task.js";
import { type PluginDownloadMethods, pluginDownloadMethods } from "./domain/download.js";
import { type PluginGeneralSettingsMethods, pluginGeneralSettingsMethods } from "./domain/general-settings.js";
import { type PluginImMethods, pluginImMethods } from "./domain/im.js";
import { type PluginKnowledgeMethods, pluginKnowledgeMethods } from "./domain/knowledge.js";
import { type PluginMcpMethods, pluginMcpMethods } from "./domain/mcp.js";
import { type PluginMediaMethods, pluginMediaMethods } from "./domain/media.js";
import { type PluginModelMethods, pluginModelMethods } from "./domain/model.js";
import { type PluginProjectMethods, pluginProjectMethods } from "./domain/project.js";
import { type PluginSchedulerMethods, pluginSchedulerMethods } from "./domain/scheduler.js";
import { type PluginSessionMethods, pluginSessionMethods } from "./domain/session.js";
import { type PluginShortcutMethods, pluginShortcutMethods } from "./domain/shortcut.js";
import { type PluginSkillMethods, pluginSkillMethods } from "./domain/skill.js";
import { type PluginUpdaterMethods, pluginUpdaterMethods } from "./domain/updater.js";
import { type PluginWebhookMethods, pluginWebhookMethods } from "./domain/webhook.js";
import { type PluginArtifactMethods, pluginArtifactMethods } from "./foundation/artifacts.js";
import { type PluginFilesystemMethods, pluginFilesystemMethods } from "./foundation/filesystem.js";
import { type PluginGatewayMethods, pluginGatewayMethods } from "./foundation/gateway.js";
import { type PluginJobMethods, pluginJobMethods } from "./foundation/jobs.js";
import { type PluginNetworkMethods, pluginNetworkMethods } from "./foundation/network.js";
import { type PluginStorageMethods, pluginStorageMethods } from "./foundation/storage.js";
import { buildPluginCapabilityGrants } from "./grants.js";
import {
	PLUGIN_ID_PATTERN,
	type PluginCapabilityAdapterOptions,
	type PluginCapabilityRequirement,
	type PluginCapabilitySession,
	type PluginCapabilitySessionAccess,
} from "./types.js";

export interface PluginCapabilityAdapter
	extends PluginArtifactMethods,
		PluginFilesystemMethods,
		PluginJobMethods,
		PluginNetworkMethods,
		PluginGatewayMethods,
		PluginStorageMethods,
		PluginAiMethods,
		PluginAgentSettingsMethods,
		PluginGeneralSettingsMethods,
		PluginImMethods,
		PluginMediaMethods,
		PluginModelMethods,
		PluginMcpMethods,
		PluginProjectMethods,
		PluginSessionMethods,
		PluginSkillMethods,
		PluginShortcutMethods,
		PluginDownloadMethods,
		PluginUpdaterMethods,
		PluginBatchTaskMethods,
		PluginSchedulerMethods,
		PluginWebhookMethods,
		PluginKnowledgeMethods {}

/** Internal Plugin-system adapter. Plugin authors consume host-exposed capability APIs instead. */
export class PluginCapabilityAdapter implements PluginCapabilitySessionAccess {
	private readonly sessionIdByPlugin = new Map<string, string>();
	private readonly sessions = new Map<string, PluginCapabilitySession>();

	constructor(
		private readonly access: CapabilityAccessSessionFactory,
		private readonly options: PluginCapabilityAdapterOptions,
	) {}

	openSession(pluginId: string): string {
		if (!PLUGIN_ID_PATTERN.test(pluginId)) throw new Error(`Invalid plugin id: ${pluginId}`);
		const permissions = new Set(this.options.resolvePermissions(pluginId));
		const official = this.options.isOfficialPlugin(pluginId);
		const previousSessionId = this.sessionIdByPlugin.get(pluginId);
		if (previousSessionId) this.closeSession(previousSessionId);

		const sessionId = randomUUID();
		const grants = buildPluginCapabilityGrants(pluginId, permissions, official);
		const access = this.access.createSession({
			subject: {
				id: `system-adapter:plugin:${pluginId}`,
				sessionId,
			},
			grants,
		});
		this.sessions.set(sessionId, { access, pluginId });
		this.sessionIdByPlugin.set(pluginId, sessionId);
		return sessionId;
	}

	closeSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.access.revoke();
		this.sessions.delete(sessionId);
		if (this.sessionIdByPlugin.get(session.pluginId) === sessionId) {
			this.sessionIdByPlugin.delete(session.pluginId);
		}
		this.options.onSessionClosed?.(session.pluginId);
	}

	dispose(): void {
		for (const sessionId of [...this.sessions.keys()]) this.closeSession(sessionId);
	}

	assertOfficialSession(sessionId: string): void {
		this.session(sessionId, { official: true });
	}

	pluginIdForSession(sessionId: string, requirement: PluginCapabilityRequirement = {}): string {
		return this.session(sessionId, requirement).pluginId;
	}

	client(sessionId: string, requirement: PluginCapabilityRequirement): CapabilityAccessHandle["client"] {
		return this.session(sessionId, requirement).access.client;
	}

	session(sessionId: string, requirement: PluginCapabilityRequirement): PluginCapabilitySession {
		const session = this.sessions.get(sessionId);
		if (!session || session.access.isRevoked()) {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.SESSION_REVOKED, "Plugin capability session is not active");
		}
		if (requirement.official && !this.options.isOfficialPlugin(session.pluginId)) {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.ACCESS_DENIED, "Plugin official capability access denied");
		}
		if (
			requirement.permission !== undefined &&
			!this.options.resolvePermissions(session.pluginId).includes(requirement.permission)
		) {
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.ACCESS_DENIED,
				`Plugin capability permission denied: ${requirement.permission}`,
			);
		}
		return session;
	}
}

Object.assign(
	PluginCapabilityAdapter.prototype,
	pluginArtifactMethods,
	pluginFilesystemMethods,
	pluginJobMethods,
	pluginNetworkMethods,
	pluginGatewayMethods,
	pluginStorageMethods,
	pluginAiMethods,
	pluginAgentSettingsMethods,
	pluginGeneralSettingsMethods,
	pluginImMethods,
	pluginMediaMethods,
	pluginModelMethods,
	pluginMcpMethods,
	pluginProjectMethods,
	pluginSessionMethods,
	pluginSkillMethods,
	pluginShortcutMethods,
	pluginDownloadMethods,
	pluginUpdaterMethods,
	pluginBatchTaskMethods,
	pluginSchedulerMethods,
	pluginWebhookMethods,
	pluginKnowledgeMethods,
);
