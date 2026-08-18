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
	private readonly sessionIdsByPlugin = new Map<string, Set<string>>();
	private readonly sessions = new Map<string, PluginCapabilitySession>();

	constructor(
		private readonly access: CapabilityAccessSessionFactory,
		private readonly options: PluginCapabilityAdapterOptions,
	) {}

	openSession(pluginId: string, ownerId = "direct"): string {
		if (!PLUGIN_ID_PATTERN.test(pluginId)) throw new Error(`Invalid plugin id: ${pluginId}`);
		if (!ownerId.trim()) throw new Error("Plugin capability session owner id is required");
		// 同一 renderer 文档内的新旧 activation 需要重叠到事务式发布完成；新文档则没有
		// 机会替旧文档执行 cleanup，打开首个 session 时直接回收其遗留授权。
		for (const existingSessionId of this.sessionIdsByPlugin.get(pluginId) ?? []) {
			const existing = this.sessions.get(existingSessionId);
			if (existing && existing.ownerId !== ownerId) this.closeSession(existingSessionId);
		}
		const permissions = new Set(this.options.resolvePermissions(pluginId));
		const official = this.options.isOfficialPlugin(pluginId);
		const sessionId = randomUUID();
		const grants = buildPluginCapabilityGrants(pluginId, permissions, official);
		const access = this.access.createSession({
			subject: {
				id: `system-adapter:plugin:${pluginId}`,
				sessionId,
			},
			grants,
		});
		this.sessions.set(sessionId, { access, ownerId, pluginId });
		const pluginSessionIds = this.sessionIdsByPlugin.get(pluginId) ?? new Set<string>();
		pluginSessionIds.add(sessionId);
		this.sessionIdsByPlugin.set(pluginId, pluginSessionIds);
		return sessionId;
	}

	closeSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.access.revoke();
		this.sessions.delete(sessionId);
		const pluginSessionIds = this.sessionIdsByPlugin.get(session.pluginId);
		pluginSessionIds?.delete(sessionId);
		if (pluginSessionIds?.size === 0) this.sessionIdsByPlugin.delete(session.pluginId);
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
