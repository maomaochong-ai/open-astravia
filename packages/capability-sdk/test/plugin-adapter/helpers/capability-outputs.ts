import type { CapabilityId } from "../../../src/contracts.js";
import {
	DOMAIN_AGENT_SETTINGS_CAPABILITIES,
	DOMAIN_BATCH_TASK_CAPABILITIES,
	DOMAIN_DOWNLOAD_CAPABILITIES,
	DOMAIN_GENERAL_SETTINGS_CAPABILITIES,
	DOMAIN_IM_CAPABILITIES,
	DOMAIN_KNOWLEDGE_CAPABILITIES,
	DOMAIN_MCP_CAPABILITIES,
	DOMAIN_MEDIA_CAPABILITIES,
	DOMAIN_MODEL_CAPABILITIES,
	DOMAIN_PROJECT_CAPABILITIES,
	DOMAIN_QUICK_PANEL_CAPABILITIES,
	DOMAIN_SCHEDULER_CAPABILITIES,
	DOMAIN_SESSION_CAPABILITIES,
	DOMAIN_SHORTCUT_CAPABILITIES,
	DOMAIN_SKILL_CAPABILITIES,
	DOMAIN_UPDATER_CAPABILITIES,
	DOMAIN_WEBHOOK_CAPABILITIES,
} from "../../../src/domain.js";
import {
	FOUNDATION_ARTIFACT_CAPABILITIES,
	FOUNDATION_FILESYSTEM_CAPABILITIES,
	FOUNDATION_JOB_CAPABILITIES,
	FOUNDATION_NETWORK_CAPABILITIES,
	FOUNDATION_STORAGE_CAPABILITIES,
} from "../../../src/foundation.js";

function foundationOutput(capabilityId: CapabilityId): unknown {
	if (capabilityId === FOUNDATION_ARTIFACT_CAPABILITIES.PERSIST.id) {
		return {
			type: "storage-blob",
			id: "blob",
			url: "vetta-media://local/blob",
			mimeType: "image/png",
			sizeBytes: 5,
		};
	}
	if (capabilityId === FOUNDATION_ARTIFACT_CAPABILITIES.RELEASE.id) return undefined;
	if (capabilityId === FOUNDATION_JOB_CAPABILITIES.GET.id || capabilityId === FOUNDATION_JOB_CAPABILITIES.CANCEL.id) {
		return {
			id: "job-1",
			domain: "media",
			operation: "generate",
			status: "succeeded",
			artifacts: [],
		};
	}
	if (capabilityId === FOUNDATION_FILESYSTEM_CAPABILITIES.READ_DIRECTORY.id) return [];
	if (capabilityId === FOUNDATION_FILESYSTEM_CAPABILITIES.READ_FILE.id) {
		return { content: "data", encoding: "utf8" };
	}
	if (capabilityId === FOUNDATION_FILESYSTEM_CAPABILITIES.STAT.id) return null;
	if (capabilityId === FOUNDATION_FILESYSTEM_CAPABILITIES.LIST_FILES_RECURSIVE.id) return [];
	if (capabilityId === FOUNDATION_NETWORK_CAPABILITIES.REQUEST.id) {
		return { status: 200, headers: {}, body: { ok: true } };
	}
	if (capabilityId === FOUNDATION_STORAGE_CAPABILITIES.READ_JSON.id) return { ok: true };
	if (capabilityId === FOUNDATION_STORAGE_CAPABILITIES.LIST.id) return ["records/item.json"];
	if (capabilityId === FOUNDATION_STORAGE_CAPABILITIES.READ_FILE.id) return "ZGF0YQ==";
	if (
		capabilityId === FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB.id ||
		capabilityId === FOUNDATION_STORAGE_CAPABILITIES.GET_BLOB_REF.id
	) {
		return { id: "blob", url: "vetta-media://local/blob", mimeType: "image/png" };
	}
	if (capabilityId === FOUNDATION_STORAGE_CAPABILITIES.READ_BLOB.id) {
		return { data: "ZGF0YQ==", mimeType: "image/png" };
	}
	return undefined;
}

function domainOutput(capabilityId: CapabilityId): unknown {
	if (capabilityId === DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.id) {
		return [
			{
				id: "desktop-app:vetta",
				ownerId: "desktop-app",
				protocolVersion: 4,
				capabilities: [{ operation: "generate", kind: "image", modes: ["text-to-image", "image-to-image"] }],
			},
		];
	}
	if (capabilityId === DOMAIN_MEDIA_CAPABILITIES.SUBMIT.id) {
		return {
			id: "job-1",
			domain: "media",
			operation: "generate",
			status: "succeeded",
			artifacts: [],
		};
	}
	if (
		capabilityId === DOMAIN_AGENT_SETTINGS_CAPABILITIES.GET_EXPERIMENTAL.id ||
		capabilityId === DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL.id
	) {
		return { vettaCli: true, promptPrediction: false, agentSkills: true };
	}
	if (capabilityId === DOMAIN_GENERAL_SETTINGS_CAPABILITIES.GET.id) {
		return {
			workspacePath: "C:/workspace",
			defaultExecutionMode: "full-access",
			notificationsEnabled: true,
			debugMode: false,
			sandbox: { status: "available", backend: "windows-host", platform: "win32" },
		};
	}
	if (capabilityId === DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_NOTIFICATIONS.id) return { enabled: false };
	if (capabilityId === DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_DEFAULT_EXECUTION_MODE.id) {
		return { mode: "sandbox" };
	}
	if (capabilityId === DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_WORKSPACE.id) return { path: "C:/next" };
	const imRuntime = { transport: "online", activeSessions: 1, consecutiveStartFailures: 0 };
	if (capabilityId === DOMAIN_IM_CAPABILITIES.GET_STATUS.id) {
		return {
			enabled: true,
			transport: "feishu",
			agentModel: { provider: "openai", model: "gpt-5" },
			wechatBound: false,
			feishuAppId: "app-id",
			runtime: imRuntime,
		};
	}
	if (capabilityId === DOMAIN_IM_CAPABILITIES.LIST_LOGS.id) {
		return [{ level: "info", msg: "started", time: "2026-07-24T00:00:00.000Z" }];
	}
	if (
		capabilityId === DOMAIN_IM_CAPABILITIES.SET_ENABLED.id ||
		capabilityId === DOMAIN_IM_CAPABILITIES.RESTART.id ||
		capabilityId === DOMAIN_IM_CAPABILITIES.SET_AGENT_MODEL.id
	) {
		return imRuntime;
	}
	if (capabilityId === DOMAIN_MODEL_CAPABILITIES.LIST.id) {
		return {
			defaultModel: "openai/gpt-5",
			providers: [
				{
					id: "openai",
					displayName: "OpenAI",
					hasApiKey: true,
					modelCount: 1,
					models: [{ id: "gpt-5", reasoning: true }],
				},
			],
		};
	}
	if (capabilityId === DOMAIN_MODEL_CAPABILITIES.GET_CONFIG.id) {
		return {
			defaultModel: "openai/gpt-5",
			providers: { openai: { apiKey: "***", models: [{ id: "gpt-5" }] } },
		};
	}
	if (capabilityId === DOMAIN_MODEL_CAPABILITIES.GET_PROVIDER.id) {
		return { provider: "openai", apiKey: "***", models: [{ id: "gpt-5" }] };
	}
	if (capabilityId === DOMAIN_MODEL_CAPABILITIES.PROBE.id) return { ok: true };
	if (capabilityId === DOMAIN_MODEL_CAPABILITIES.SET_DEFAULT.id) return { defaultModel: "openai/gpt-5" };
	if (capabilityId === DOMAIN_MODEL_CAPABILITIES.UPSERT_PROVIDER.id) {
		return { apiKey: "***", models: [{ id: "gpt-5" }] };
	}
	if (capabilityId === DOMAIN_MCP_CAPABILITIES.LIST_SERVERS.id) {
		return [{ name: "web", type: "http", disabled: false, url: "https://mcp.example.com" }];
	}
	if (
		capabilityId === DOMAIN_MCP_CAPABILITIES.GET_SERVER.id ||
		capabilityId === DOMAIN_MCP_CAPABILITIES.UPSERT_SERVER.id
	) {
		return {
			name: "web",
			type: "http",
			disabled: false,
			url: "https://mcp.example.com",
			headers: { Authorization: "***" },
		};
	}
	if (
		capabilityId === DOMAIN_BATCH_TASK_CAPABILITIES.LIST_PROJECTS.id ||
		capabilityId === DOMAIN_BATCH_TASK_CAPABILITIES.GET_PROJECT.id ||
		capabilityId === DOMAIN_BATCH_TASK_CAPABILITIES.CREATE_PROJECT.id ||
		capabilityId === DOMAIN_BATCH_TASK_CAPABILITIES.UPDATE_PROJECT.id
	) {
		const project = {
			id: "C:/workspace/Batch",
			name: "Batch",
			prompt: "Process",
			executionMode: "full-access",
			concurrency: 2,
			notifyEnabled: false,
			timeoutMinutes: 60,
			tasks: [],
			createdAt: 1,
			updatedAt: 1,
		};
		return capabilityId === DOMAIN_BATCH_TASK_CAPABILITIES.LIST_PROJECTS.id ? [project] : project;
	}
	if (Object.values(DOMAIN_BATCH_TASK_CAPABILITIES).some((capability) => capability.id === capabilityId)) {
		return {
			status: "accepted",
			projectId: "C:/workspace/Batch",
			affectedTaskIds: ["task"],
			queuedTaskIds: [],
		};
	}
	if (capabilityId === DOMAIN_PROJECT_CAPABILITIES.LIST.id) {
		return { workspacePath: "C:/workspace", projects: [], archivedProjects: [] };
	}
	if (capabilityId === DOMAIN_SESSION_CAPABILITIES.LIST.id) {
		return [
			{
				id: "session",
				path: "C:/workspace/.vetta/sessions/session.jsonl",
				cwd: "C:/workspace",
				firstMessage: "hello",
				modifiedAt: 1,
			},
		];
	}
	if (capabilityId === DOMAIN_SESSION_CAPABILITIES.LIST_RUNTIME_PROJECTS.id) {
		return [{ cwd: "C:/workspace", sessionCount: 1 }];
	}
	if (capabilityId === DOMAIN_SKILL_CAPABILITIES.LIST.id) {
		return [{ name: "review", description: "Review changes", source: "market", type: "skill" }];
	}
	if (capabilityId === DOMAIN_SKILL_CAPABILITIES.LIST_INSTALLED.id) {
		return {
			review: {
				name: "review",
				version: "1.0.0",
				installedAt: "2026-01-01T00:00:00.000Z",
				source: "market",
				enabled: true,
				type: "skill",
			},
		};
	}
	if (capabilityId === DOMAIN_SKILL_CAPABILITIES.SET_ENABLED.id) return { name: "review", enabled: false };
	if (capabilityId === DOMAIN_SHORTCUT_CAPABILITIES.GET_SETTINGS.id) {
		return {
			bindings: [
				{
					id: "new-session",
					defaultShortcut: "mod+n",
					shortcut: "mod+n",
					isDefault: true,
				},
			],
			quickPanel: { trigger: "none", postSendBehavior: "foreground" },
		};
	}
	if (
		capabilityId === DOMAIN_SHORTCUT_CAPABILITIES.SET_BINDING.id ||
		capabilityId === DOMAIN_SHORTCUT_CAPABILITIES.RESET_ALL_BINDINGS.id
	) {
		return { bindings: [] };
	}
	if (capabilityId === DOMAIN_SHORTCUT_CAPABILITIES.RESET_BINDING.id) {
		return { bindings: [], shortcut: "mod+n" };
	}
	if (Object.values(DOMAIN_QUICK_PANEL_CAPABILITIES).some((capability) => capability.id === capabilityId)) {
		return { trigger: "mod", postSendBehavior: "foreground" };
	}
	if (capabilityId === DOMAIN_DOWNLOAD_CAPABILITIES.LIST.id) {
		return [
			{
				id: "download",
				url: "https://example.com/file",
				filename: "file",
				path: "C:/downloads/file",
				totalBytes: 10,
				receivedBytes: 10,
				status: "completed",
				createdAt: 1,
				completedAt: 2,
			},
		];
	}
	if (capabilityId === DOMAIN_UPDATER_CAPABILITIES.GET_CURRENT_VERSION.id) return "1.0.0";
	if (
		capabilityId === DOMAIN_UPDATER_CAPABILITIES.GET_STATE.id ||
		capabilityId === DOMAIN_UPDATER_CAPABILITIES.CHECK.id ||
		capabilityId === DOMAIN_UPDATER_CAPABILITIES.DOWNLOAD.id
	) {
		return { phase: "idle", currentVersion: "1.0.0" };
	}
	if (capabilityId === DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_BASES.id) {
		return [
			{
				id: "default_kb",
				name: "default_kb",
				updatedAt: 1,
				isDefault: true,
				nodes: [],
			},
		];
	}
	if (capabilityId === DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_FILE_STATUSES.id) return {};
	if (capabilityId === DOMAIN_KNOWLEDGE_CAPABILITIES.GET_PROCESSING_STATUS.id) return false;
	if (
		capabilityId === DOMAIN_KNOWLEDGE_CAPABILITIES.GET_PROCESSING_SETTINGS.id ||
		capabilityId === DOMAIN_KNOWLEDGE_CAPABILITIES.SET_PROCESSING_SETTINGS.id
	) {
		return { enabled: true, pollIntervalMinutes: 5, agentConcurrency: 3, ocrConcurrency: 1 };
	}
	if (
		capabilityId === DOMAIN_KNOWLEDGE_CAPABILITIES.SCAN_NOW.id ||
		capabilityId === DOMAIN_KNOWLEDGE_CAPABILITIES.RETRY_FAILED.id
	) {
		return { skipped: true, reason: "no-model" };
	}
	if (
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.LIST_TASKS.id ||
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.GET_TASK.id ||
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.CREATE_TASK.id ||
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.UPDATE_TASK.id ||
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.SET_ENABLED.id
	) {
		const task = {
			id: "task",
			name: "Daily",
			prompt: "Run",
			cron: "0 9 * * *",
			isOnce: false,
			enabled: true,
			cwd: "C:/workspace",
			createdAt: 1,
			updatedAt: 1,
			lastRunAt: null,
			lastRunStatus: null,
		};
		return capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.LIST_TASKS.id ? [task] : task;
	}
	if (capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.LIST_HISTORY.id) return [];
	if (
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.DELETE_TASK.id ||
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.RUN_TASK.id ||
		capabilityId === DOMAIN_SCHEDULER_CAPABILITIES.ABORT_TASK.id
	) {
		return { status: "accepted", taskId: "task" };
	}
	if (
		capabilityId === DOMAIN_PROJECT_CAPABILITIES.CREATE.id ||
		capabilityId === DOMAIN_PROJECT_CAPABILITIES.OPEN.id ||
		capabilityId === DOMAIN_PROJECT_CAPABILITIES.RENAME.id
	) {
		return { path: "C:/workspace/demo", name: "demo" };
	}
	if (capabilityId === DOMAIN_WEBHOOK_CAPABILITIES.LIST_ENDPOINTS.id) {
		return [
			{
				id: "endpoint",
				kind: "feishu",
				name: "Release",
				enabled: true,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		];
	}
	if (capabilityId === DOMAIN_WEBHOOK_CAPABILITIES.LIST_PROVIDERS.id) {
		return [{ kind: "feishu", displayName: "Feishu" }];
	}
	if (
		capabilityId === DOMAIN_WEBHOOK_CAPABILITIES.CREATE_ENDPOINT.id ||
		capabilityId === DOMAIN_WEBHOOK_CAPABILITIES.UPDATE_ENDPOINT.id ||
		capabilityId === DOMAIN_WEBHOOK_CAPABILITIES.SET_ENABLED.id
	) {
		return {
			id: "endpoint",
			kind: "feishu",
			name: "Release",
			enabled: true,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
	}
	if (
		capabilityId === DOMAIN_WEBHOOK_CAPABILITIES.TEST_ENDPOINT.id ||
		capabilityId === DOMAIN_WEBHOOK_CAPABILITIES.SEND_MESSAGE.id
	) {
		return { ok: true };
	}
	return undefined;
}

/** Mock capability outputs for RecordingAccessFactory.invoke. */
export function capabilityOutputFor(capabilityId: CapabilityId): unknown {
	const foundation = foundationOutput(capabilityId);
	if (foundation !== undefined) return foundation;
	const domain = domainOutput(capabilityId);
	if (domain !== undefined) return domain;
	return undefined;
}
