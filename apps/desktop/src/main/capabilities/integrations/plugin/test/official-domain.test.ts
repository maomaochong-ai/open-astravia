import {
	CAPABILITY_ERROR_CODES,
	DOMAIN_AGENT_SETTINGS_CAPABILITIES,
	DOMAIN_BATCH_TASK_CAPABILITIES,
	DOMAIN_DOWNLOAD_CAPABILITIES,
	DOMAIN_GENERAL_SETTINGS_CAPABILITIES,
	DOMAIN_IM_CAPABILITIES,
	DOMAIN_KNOWLEDGE_CAPABILITIES,
	DOMAIN_MCP_CAPABILITIES,
	DOMAIN_MODEL_CAPABILITIES,
	DOMAIN_PROJECT_CAPABILITIES,
	DOMAIN_QUICK_PANEL_CAPABILITIES,
	DOMAIN_SCHEDULER_CAPABILITIES,
	DOMAIN_SESSION_CAPABILITIES,
	DOMAIN_SHORTCUT_CAPABILITIES,
	DOMAIN_SKILL_CAPABILITIES,
	DOMAIN_UPDATER_CAPABILITIES,
	DOMAIN_WEBHOOK_CAPABILITIES,
	FOUNDATION_GATEWAY_CAPABILITIES,
} from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PluginCapabilityAdapter } from "../index.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter official domain capabilities", () => {
	it("grants official domain capabilities only to official plugins and rechecks trust", async () => {
		const access = new RecordingAccessFactory();
		let official = true;
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => official,
			resolvePermissions: () => [],
		});
		const sessionId = adapter.openSession("official");

		expect(() => adapter.assertOfficialSession(sessionId)).not.toThrow();
		expect(access.sessions[0]?.grants.map((grant) => grant.capabilityId)).toEqual([
			// 网关调用不挂可声明权限，只按来源收口给 official 插件（ADR-0056）
			...Object.values(FOUNDATION_GATEWAY_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_AGENT_SETTINGS_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_GENERAL_SETTINGS_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_IM_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_MODEL_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_MCP_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_BATCH_TASK_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_DOWNLOAD_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_UPDATER_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_KNOWLEDGE_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_PROJECT_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_SESSION_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_SKILL_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_SHORTCUT_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_QUICK_PANEL_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_SCHEDULER_CAPABILITIES).map((capability) => capability.id),
			...Object.values(DOMAIN_WEBHOOK_CAPABILITIES).map((capability) => capability.id),
		]);
		await expect(adapter.getAgentExperimental(sessionId)).resolves.toEqual({
			vettaCli: true,
			promptPrediction: false,
			agentSkills: true,
		});
		await expect(adapter.setAgentExperimental(sessionId, { promptPrediction: true })).resolves.toEqual({
			vettaCli: true,
			promptPrediction: false,
			agentSkills: true,
		});
		await expect(adapter.getGeneralSettings(sessionId)).resolves.toHaveProperty("workspacePath", "C:/workspace");
		await expect(adapter.setNotifications(sessionId, false)).resolves.toEqual({ enabled: false });
		await expect(adapter.setDefaultExecutionMode(sessionId, "sandbox")).resolves.toEqual({ mode: "sandbox" });
		await expect(adapter.setWorkspace(sessionId, "C:/next")).resolves.toEqual({ path: "C:/next" });
		await expect(adapter.getImStatus(sessionId)).resolves.toHaveProperty("transport", "feishu");
		await expect(adapter.listImLogs(sessionId, 50)).resolves.toHaveLength(1);
		await expect(adapter.setImEnabled(sessionId, true)).resolves.toEqual({
			transport: "online",
			activeSessions: 1,
			consecutiveStartFailures: 0,
		});
		await expect(adapter.restartIm(sessionId)).resolves.toHaveProperty("transport", "online");
		await expect(adapter.setImAgentModel(sessionId, "openai/gpt-5", "high")).resolves.toHaveProperty(
			"transport",
			"online",
		);
		expect(() => adapter.setImAgentModel(sessionId, "invalid", "high")).toThrowError(
			"IM agent model key must use the provider/model format",
		);
		await expect(adapter.listModels(sessionId)).resolves.toHaveProperty("defaultModel", "openai/gpt-5");
		await expect(adapter.getModelProvider(sessionId, "openai")).resolves.toHaveProperty("apiKey", "***");
		await expect(adapter.validateModelKey(sessionId, "openai/gpt-5")).resolves.toBeUndefined();
		await expect(adapter.setDefaultModel(sessionId, "openai/gpt-5")).resolves.toEqual({
			defaultModel: "openai/gpt-5",
		});
		await expect(adapter.listMcpServers(sessionId)).resolves.toEqual([
			{ name: "web", type: "http", disabled: false, url: "https://mcp.example.com" },
		]);
		await expect(adapter.getMcpServer(sessionId, "web")).resolves.toHaveProperty("headers.Authorization", "***");
		await expect(
			adapter.upsertMcpServer(sessionId, "web", { type: "http", url: "https://mcp.example.com" }),
		).resolves.toHaveProperty("name", "web");
		await expect(adapter.setMcpServerEnabled(sessionId, "web", true)).resolves.toBeUndefined();
		await expect(adapter.removeMcpServer(sessionId, "web")).resolves.toBeUndefined();
		await expect(adapter.listBatchProjects(sessionId)).resolves.toHaveLength(1);
		await expect(adapter.resumeBatchTask(sessionId, "C:/workspace/Batch", "task")).resolves.toEqual({
			status: "accepted",
			projectId: "C:/workspace/Batch",
			affectedTaskIds: ["task"],
			queuedTaskIds: [],
		});
		await expect(adapter.listProjects(sessionId)).resolves.toEqual({
			workspacePath: "C:/workspace",
			projects: [],
			archivedProjects: [],
		});
		await expect(adapter.listSessions(sessionId, "C:/workspace")).resolves.toEqual([
			{
				id: "session",
				path: "C:/workspace/.vetta/sessions/session.jsonl",
				cwd: "C:/workspace",
				firstMessage: "hello",
				modifiedAt: 1,
			},
		]);
		await expect(adapter.listSkills(sessionId, "C:/workspace")).resolves.toHaveLength(1);
		await expect(adapter.setSkillEnabled(sessionId, "review", false)).resolves.toEqual({
			name: "review",
			enabled: false,
		});
		await expect(adapter.uninstallSkill(sessionId, "review")).resolves.toBeUndefined();
		await expect(adapter.getShortcutSettings(sessionId)).resolves.toHaveProperty(
			"quickPanel.postSendBehavior",
			"foreground",
		);
		await expect(adapter.setShortcutBinding(sessionId, "new-session", "mod+shift+n")).resolves.toEqual({
			bindings: [],
		});
		await expect(adapter.resetShortcutBinding(sessionId, "new-session")).resolves.toEqual({
			bindings: [],
			shortcut: "mod+n",
		});
		await expect(adapter.resetAllShortcutBindings(sessionId)).resolves.toEqual({ bindings: [] });
		await expect(adapter.setQuickPanelTrigger(sessionId, "mod")).resolves.toEqual({
			trigger: "mod",
			postSendBehavior: "foreground",
		});
		await expect(adapter.setQuickPanelPostSendBehavior(sessionId, "background")).resolves.toEqual({
			trigger: "mod",
			postSendBehavior: "foreground",
		});
		await expect(adapter.listDownloads(sessionId)).resolves.toEqual([
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
		]);
		await expect(adapter.cancelDownload(sessionId, "download")).resolves.toBeUndefined();
		await expect(adapter.getUpdaterState(sessionId)).resolves.toEqual({
			phase: "idle",
			currentVersion: "1.0.0",
		});
		await expect(adapter.installUpdater(sessionId)).resolves.toBeUndefined();
		await expect(adapter.listKnowledgeBases(sessionId)).resolves.toHaveLength(1);
		await expect(adapter.setKnowledgeProcessing(sessionId, { processingModelKey: null })).resolves.toEqual({
			enabled: true,
			pollIntervalMinutes: 5,
			agentConcurrency: 3,
			ocrConcurrency: 1,
		});
		await expect(adapter.listScheduledTasks(sessionId)).resolves.toHaveLength(1);
		await expect(adapter.runScheduledTask(sessionId, "task")).resolves.toEqual({
			status: "accepted",
			taskId: "task",
		});
		await expect(adapter.listWebhookEndpoints(sessionId)).resolves.toHaveLength(1);
		await expect(adapter.sendWebhookMessage(sessionId, "endpoint", { text: "hello" })).resolves.toEqual({
			ok: true,
		});

		official = false;
		expect(() => adapter.assertOfficialSession(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getAgentExperimental(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getGeneralSettings(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getImStatus(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listModels(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listMcpServers(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listBatchProjects(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listProjects(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listRuntimeProjects(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listSkills(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getShortcutSettings(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listKnowledgeBases(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.getUpdaterState(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listScheduledTasks(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		expect(() => adapter.listWebhookEndpoints(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});
});
