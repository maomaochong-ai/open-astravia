import { ipcMain } from "electron";
import { PLUGIN_CAPABILITY_CHANNELS } from "../../shared/plugin-capability-ipc.js";
import { getDesktopCapabilityHost } from "../capabilities/capability-host.js";

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a string`);
	return value;
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	return value;
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	return requireString(value, field);
}

function requireNullableString(value: unknown, field: string): string | null {
	if (value === null) return null;
	return requireString(value, field);
}

function requireBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
	return value;
}

function requireNumber(value: unknown, field: string): number {
	if (typeof value !== "number") throw new Error(`${field} must be a number`);
	return value;
}

function requireStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
		throw new Error(`${field} must be an array of strings`);
	}
	return value;
}

function optionalSkillType(value: unknown): "skill" | "scene" | undefined {
	if (value === undefined) return undefined;
	if (value !== "skill" && value !== "scene") throw new Error("type must be skill or scene");
	return value;
}

function requireQuickPanelTrigger(value: unknown): "none" | "mod" | "alt" | "shift" {
	if (value !== "none" && value !== "mod" && value !== "alt" && value !== "shift") {
		throw new Error("trigger must be none, mod, alt, or shift");
	}
	return value;
}

function requireQuickPanelBehavior(value: unknown): "foreground" | "background" {
	if (value !== "foreground" && value !== "background") {
		throw new Error("behavior must be foreground or background");
	}
	return value;
}

function requireExecutionMode(value: unknown): "sandbox" | "full-access" {
	if (value !== "sandbox" && value !== "full-access") {
		throw new Error("mode must be sandbox or full-access");
	}
	return value;
}

export function registerPluginCapabilitiesIpc(): () => void {
	const adapter = getDesktopCapabilityHost().adapters.plugin;
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.OPEN_SESSION, (_event, pluginId: unknown) =>
		adapter.openSession(requireString(pluginId, "pluginId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.CLOSE_SESSION, (_event, sessionId: unknown) =>
		adapter.closeSession(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.AGENT_SETTINGS_EXPERIMENTAL_GET, (_event, sessionId: unknown) =>
		adapter.getAgentExperimental(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.AGENT_SETTINGS_EXPERIMENTAL_SET,
		(_event, sessionId: unknown, input: unknown) =>
			adapter.setAgentExperimental(requireString(sessionId, "sessionId"), input),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_GET, (_event, sessionId: unknown) =>
		adapter.getGeneralSettings(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_NOTIFICATIONS_SET,
		(_event, sessionId: unknown, enabled: unknown) =>
			adapter.setNotifications(requireString(sessionId, "sessionId"), requireBoolean(enabled, "enabled")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_DEFAULT_EXECUTION_MODE_SET,
		(_event, sessionId: unknown, mode: unknown) =>
			adapter.setDefaultExecutionMode(requireString(sessionId, "sessionId"), requireExecutionMode(mode)),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_WORKSPACE_SET,
		(_event, sessionId: unknown, path: unknown) =>
			adapter.setWorkspace(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.IM_STATUS_GET, (_event, sessionId: unknown) =>
		adapter.getImStatus(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.IM_LOG_LIST, (_event, sessionId: unknown, limit: unknown) =>
		adapter.listImLogs(requireString(sessionId, "sessionId"), requireNumber(limit, "limit")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.IM_ENABLED_SET, (_event, sessionId: unknown, enabled: unknown) =>
		adapter.setImEnabled(requireString(sessionId, "sessionId"), requireBoolean(enabled, "enabled")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.IM_RESTART, (_event, sessionId: unknown) =>
		adapter.restartIm(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.IM_AGENT_MODEL_SET,
		(_event, sessionId: unknown, modelKey: unknown, reasoningLevel: unknown) =>
			adapter.setImAgentModel(
				requireString(sessionId, "sessionId"),
				requireNullableString(modelKey, "modelKey"),
				reasoningLevel === undefined ? undefined : requireText(reasoningLevel, "reasoningLevel"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MODEL_LIST, (_event, sessionId: unknown) =>
		adapter.listModels(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MODEL_CONFIG_GET, (_event, sessionId: unknown) =>
		adapter.getModelConfig(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MODEL_PROVIDER_GET, (_event, sessionId: unknown, provider: unknown) =>
		adapter.getModelProvider(requireString(sessionId, "sessionId"), requireString(provider, "provider")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.MODEL_PROBE,
		(_event, sessionId: unknown, provider: unknown, model: unknown) =>
			adapter.probeModel(
				requireString(sessionId, "sessionId"),
				requireString(provider, "provider"),
				requireString(model, "model"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.MODEL_KEY_VALIDATE,
		(_event, sessionId: unknown, modelKey: unknown, operation: unknown) =>
			adapter.validateModelKey(
				requireString(sessionId, "sessionId"),
				requireString(modelKey, "modelKey"),
				optionalString(operation, "operation"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MODEL_DEFAULT_SET, (_event, sessionId: unknown, modelKey: unknown) =>
		adapter.setDefaultModel(requireString(sessionId, "sessionId"), requireString(modelKey, "modelKey")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.MODEL_PROVIDER_UPSERT,
		(_event, sessionId: unknown, provider: unknown, data: unknown) =>
			adapter.upsertModelProvider(requireString(sessionId, "sessionId"), requireString(provider, "provider"), data),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MODEL_PROVIDER_REMOVE, (_event, sessionId: unknown, provider: unknown) =>
		adapter.removeModelProvider(requireString(sessionId, "sessionId"), requireString(provider, "provider")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MEDIA_PROVIDER_LIST, (_event, sessionId: unknown) =>
		adapter.listMediaProviders(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MEDIA_JOB_CREATE, (_event, sessionId: unknown, input: unknown) =>
		adapter.createMediaJob(requireString(sessionId, "sessionId"), input),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MEDIA_JOB_GET, (_event, sessionId: unknown, input: unknown) =>
		adapter.getMediaJob(requireString(sessionId, "sessionId"), input),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MEDIA_JOB_CANCEL, (_event, sessionId: unknown, input: unknown) =>
		adapter.cancelMediaJob(requireString(sessionId, "sessionId"), input),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_LIST, (_event, sessionId: unknown) =>
		adapter.listMcpServers(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_GET, (_event, sessionId: unknown, name: unknown) =>
		adapter.getMcpServer(requireString(sessionId, "sessionId"), requireString(name, "name")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_UPSERT,
		(_event, sessionId: unknown, name: unknown, data: unknown) =>
			adapter.upsertMcpServer(requireString(sessionId, "sessionId"), requireString(name, "name"), data),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_SET_ENABLED,
		(_event, sessionId: unknown, name: unknown, enabled: unknown) =>
			adapter.setMcpServerEnabled(
				requireString(sessionId, "sessionId"),
				requireString(name, "name"),
				requireBoolean(enabled, "enabled"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_REMOVE, (_event, sessionId: unknown, name: unknown) =>
		adapter.removeMcpServer(requireString(sessionId, "sessionId"), requireString(name, "name")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_LIST, (_event, sessionId: unknown) =>
		adapter.listBatchProjects(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_GET, (_event, sessionId: unknown, projectId: unknown) =>
		adapter.getBatchProject(requireString(sessionId, "sessionId"), requireString(projectId, "projectId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_CREATE, (_event, sessionId: unknown, data: unknown) =>
		adapter.createBatchProject(requireString(sessionId, "sessionId"), data),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_UPDATE,
		(_event, sessionId: unknown, projectId: unknown, data: unknown) =>
			adapter.updateBatchProject(requireString(sessionId, "sessionId"), requireString(projectId, "projectId"), data),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_DELETE, (_event, sessionId: unknown, projectId: unknown) =>
		adapter.deleteBatchProject(requireString(sessionId, "sessionId"), requireString(projectId, "projectId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RUN,
		(_event, sessionId: unknown, projectId: unknown, taskId: unknown) =>
			adapter.runBatchTask(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireString(taskId, "taskId"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RETRY,
		(_event, sessionId: unknown, projectId: unknown, taskId: unknown) =>
			adapter.retryBatchTask(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireString(taskId, "taskId"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_STOP,
		(_event, sessionId: unknown, projectId: unknown, taskId: unknown) =>
			adapter.stopBatchTask(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireString(taskId, "taskId"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_DELETE,
		(_event, sessionId: unknown, projectId: unknown, taskId: unknown) =>
			adapter.deleteBatchTask(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireString(taskId, "taskId"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RESUME,
		(_event, sessionId: unknown, projectId: unknown, taskId: unknown) =>
			adapter.resumeBatchTask(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireString(taskId, "taskId"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RESUME_WITH_TEXT,
		(_event, sessionId: unknown, projectId: unknown, taskId: unknown, text: unknown) =>
			adapter.resumeBatchTaskWithText(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireString(taskId, "taskId"),
				requireText(text, "text"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_SESSION_DELETE,
		(_event, sessionId: unknown, projectId: unknown, taskId: unknown) =>
			adapter.deleteBatchTaskSession(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireString(taskId, "taskId"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_TASK_DELETE_ALL,
		(_event, sessionId: unknown, projectId: unknown) =>
			adapter.deleteAllBatchTasks(requireString(sessionId, "sessionId"), requireString(projectId, "projectId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_START, (_event, sessionId: unknown, projectId: unknown) =>
		adapter.startBatchProject(requireString(sessionId, "sessionId"), requireString(projectId, "projectId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_STOP, (_event, sessionId: unknown, projectId: unknown) =>
		adapter.stopBatchProject(requireString(sessionId, "sessionId"), requireString(projectId, "projectId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_RESET, (_event, sessionId: unknown, projectId: unknown) =>
		adapter.resetBatchProject(requireString(sessionId, "sessionId"), requireString(projectId, "projectId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_FAILED_TASK_RESET,
		(_event, sessionId: unknown, projectId: unknown, taskIds: unknown) =>
			adapter.resetFailedBatchTasks(
				requireString(sessionId, "sessionId"),
				requireString(projectId, "projectId"),
				requireStringArray(taskIds, "taskIds"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.FS_READ_DIRECTORY, (_event, sessionId: unknown, path: unknown) =>
		adapter.readDirectory(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.FS_READ_FILE, (_event, sessionId: unknown, path: unknown) =>
		adapter.readFile(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.FS_READ_BINARY_FILE, (_event, sessionId: unknown, path: unknown) =>
		adapter.readBinaryFile(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.FS_WRITE_FILE,
		(_event, sessionId: unknown, path: unknown, content: unknown, encoding: unknown) => {
			if (typeof content !== "string") throw new Error("content must be a string");
			if (encoding !== undefined && encoding !== "utf8" && encoding !== "base64") {
				throw new Error("encoding must be utf8 or base64");
			}
			return adapter.writeFile(
				requireString(sessionId, "sessionId"),
				requireString(path, "path"),
				content,
				encoding,
			);
		},
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.FS_STAT, (_event, sessionId: unknown, path: unknown) =>
		adapter.stat(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.FS_RENAME,
		(_event, sessionId: unknown, oldPath: unknown, newPath: unknown) =>
			adapter.rename(
				requireString(sessionId, "sessionId"),
				requireString(oldPath, "oldPath"),
				requireString(newPath, "newPath"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.FS_DELETE, (_event, sessionId: unknown, path: unknown) =>
		adapter.delete(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.FS_MOVE,
		(_event, sessionId: unknown, sourcePath: unknown, destinationDirectory: unknown) =>
			adapter.move(
				requireString(sessionId, "sessionId"),
				requireString(sourcePath, "sourcePath"),
				requireString(destinationDirectory, "destinationDirectory"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.FS_CREATE_DIRECTORY, (_event, sessionId: unknown, path: unknown) =>
		adapter.createDirectory(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.FS_LIST_FILES_RECURSIVE, (_event, sessionId: unknown, path: unknown) =>
		adapter.listFilesRecursive(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.PROJECT_LIST, (_event, sessionId: unknown) =>
		adapter.listProjects(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.PROJECT_CREATE,
		(_event, sessionId: unknown, name: unknown, path: unknown) =>
			adapter.createProject(
				requireString(sessionId, "sessionId"),
				requireString(name, "name"),
				optionalString(path, "path"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.PROJECT_OPEN, (_event, sessionId: unknown, path: unknown, name: unknown) =>
		adapter.openProject(
			requireString(sessionId, "sessionId"),
			requireString(path, "path"),
			optionalString(name, "name"),
		),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.PROJECT_RENAME,
		(_event, sessionId: unknown, path: unknown, name: unknown) =>
			adapter.renameProject(
				requireString(sessionId, "sessionId"),
				requireString(path, "path"),
				requireString(name, "name"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.PROJECT_ARCHIVE, (_event, sessionId: unknown, path: unknown) =>
		adapter.archiveProject(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.PROJECT_UNARCHIVE, (_event, sessionId: unknown, path: unknown) =>
		adapter.unarchiveProject(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.PROJECT_REMOVE, (_event, sessionId: unknown, path: unknown) =>
		adapter.removeProject(requireString(sessionId, "sessionId"), requireString(path, "path")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SESSION_LIST, (_event, sessionId: unknown, cwd: unknown) =>
		adapter.listSessions(requireString(sessionId, "sessionId"), requireString(cwd, "cwd")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SESSION_LIST_RUNTIME_PROJECTS, (_event, sessionId: unknown) =>
		adapter.listRuntimeProjects(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SKILL_LIST, (_event, sessionId: unknown, cwd: unknown) =>
		adapter.listSkills(requireString(sessionId, "sessionId"), optionalString(cwd, "cwd")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SKILL_INSTALLED_LIST, (_event, sessionId: unknown) =>
		adapter.listInstalledSkills(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.SKILL_INSTALLED_SET_ENABLED,
		(_event, sessionId: unknown, name: unknown, enabled: unknown) =>
			adapter.setSkillEnabled(
				requireString(sessionId, "sessionId"),
				requireString(name, "name"),
				requireBoolean(enabled, "enabled"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.SKILL_INSTALLED_UNINSTALL,
		(_event, sessionId: unknown, name: unknown, type: unknown) =>
			adapter.uninstallSkill(
				requireString(sessionId, "sessionId"),
				requireString(name, "name"),
				optionalSkillType(type),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_SETTINGS_GET, (_event, sessionId: unknown) =>
		adapter.getShortcutSettings(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_BINDING_SET,
		(_event, sessionId: unknown, id: unknown, shortcut: unknown) =>
			adapter.setShortcutBinding(
				requireString(sessionId, "sessionId"),
				requireString(id, "id"),
				requireText(shortcut, "shortcut"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_BINDING_RESET, (_event, sessionId: unknown, id: unknown) =>
		adapter.resetShortcutBinding(requireString(sessionId, "sessionId"), requireString(id, "id")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_BINDING_RESET_ALL, (_event, sessionId: unknown) =>
		adapter.resetAllShortcutBindings(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.QUICK_PANEL_TRIGGER_SET, (_event, sessionId: unknown, trigger: unknown) =>
		adapter.setQuickPanelTrigger(requireString(sessionId, "sessionId"), requireQuickPanelTrigger(trigger)),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.QUICK_PANEL_POST_SEND_BEHAVIOR_SET,
		(_event, sessionId: unknown, behavior: unknown) =>
			adapter.setQuickPanelPostSendBehavior(
				requireString(sessionId, "sessionId"),
				requireQuickPanelBehavior(behavior),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.DOWNLOAD_LIST, (_event, sessionId: unknown) =>
		adapter.listDownloads(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.DOWNLOAD_CANCEL, (_event, sessionId: unknown, id: unknown) =>
		adapter.cancelDownload(requireString(sessionId, "sessionId"), requireString(id, "id")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.UPDATER_STATE_GET, (_event, sessionId: unknown) =>
		adapter.getUpdaterState(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.UPDATER_CURRENT_VERSION_GET, (_event, sessionId: unknown) =>
		adapter.getUpdaterCurrentVersion(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.UPDATER_CHECK, (_event, sessionId: unknown) =>
		adapter.checkUpdater(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.UPDATER_DOWNLOAD, (_event, sessionId: unknown) =>
		adapter.downloadUpdater(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.UPDATER_INSTALL, (_event, sessionId: unknown) =>
		adapter.installUpdater(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.UPDATER_DISMISS, (_event, sessionId: unknown) =>
		adapter.dismissUpdater(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.UPDATER_CANCEL, (_event, sessionId: unknown) =>
		adapter.cancelUpdater(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_LIST, (_event, sessionId: unknown) =>
		adapter.listKnowledgeBases(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_FILE_STATUS_LIST, (_event, sessionId: unknown) =>
		adapter.listKnowledgeFileStatuses(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_STATUS_GET, (_event, sessionId: unknown) =>
		adapter.isKnowledgeProcessing(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_SETTINGS_GET, (_event, sessionId: unknown) =>
		adapter.getKnowledgeProcessing(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_CREATE, (_event, sessionId: unknown, name: unknown) =>
		adapter.createKnowledgeBase(requireString(sessionId, "sessionId"), requireString(name, "name")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_RENAME,
		(_event, sessionId: unknown, name: unknown, newName: unknown) =>
			adapter.renameKnowledgeBase(
				requireString(sessionId, "sessionId"),
				requireString(name, "name"),
				requireString(newName, "newName"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_DELETE, (_event, sessionId: unknown, name: unknown) =>
		adapter.deleteKnowledgeBase(requireString(sessionId, "sessionId"), requireString(name, "name")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_ENTRY_ADD_FILES,
		(_event, sessionId: unknown, kbId: unknown, paths: unknown, move: unknown) =>
			adapter.addKnowledgeFiles(
				requireString(sessionId, "sessionId"),
				requireString(kbId, "kbId"),
				requireStringArray(paths, "paths"),
				requireBoolean(move, "move"),
			),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_ENTRY_DELETE,
		(_event, sessionId: unknown, kbId: unknown, relPath: unknown) =>
			adapter.deleteKnowledgeEntry(
				requireString(sessionId, "sessionId"),
				requireString(kbId, "kbId"),
				requireString(relPath, "relPath"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_SCAN, (_event, sessionId: unknown) =>
		adapter.scanKnowledgeNow(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_RETRY_FAILED, (_event, sessionId: unknown) =>
		adapter.retryFailedKnowledge(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_SETTINGS_SET,
		(_event, sessionId: unknown, data: unknown) =>
			adapter.setKnowledgeProcessing(requireString(sessionId, "sessionId"), data),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_LIST, (_event, sessionId: unknown) =>
		adapter.listScheduledTasks(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_GET, (_event, sessionId: unknown, taskId: unknown) =>
		adapter.getScheduledTask(requireString(sessionId, "sessionId"), requireString(taskId, "taskId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_HISTORY_LIST,
		(_event, sessionId: unknown, taskId: unknown) =>
			adapter.listScheduledTaskHistory(requireString(sessionId, "sessionId"), requireString(taskId, "taskId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_CREATE, (_event, sessionId: unknown, data: unknown) =>
		adapter.createScheduledTask(requireString(sessionId, "sessionId"), data),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_UPDATE,
		(_event, sessionId: unknown, taskId: unknown, data: unknown) =>
			adapter.updateScheduledTask(requireString(sessionId, "sessionId"), requireString(taskId, "taskId"), data),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_DELETE, (_event, sessionId: unknown, taskId: unknown) =>
		adapter.deleteScheduledTask(requireString(sessionId, "sessionId"), requireString(taskId, "taskId")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_SET_ENABLED,
		(_event, sessionId: unknown, taskId: unknown, enabled: unknown) =>
			adapter.setScheduledTaskEnabled(
				requireString(sessionId, "sessionId"),
				requireString(taskId, "taskId"),
				requireBoolean(enabled, "enabled"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_RUN, (_event, sessionId: unknown, taskId: unknown) =>
		adapter.runScheduledTask(requireString(sessionId, "sessionId"), requireString(taskId, "taskId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_ABORT, (_event, sessionId: unknown, taskId: unknown) =>
		adapter.abortScheduledTask(requireString(sessionId, "sessionId"), requireString(taskId, "taskId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_LIST, (_event, sessionId: unknown) =>
		adapter.listWebhookEndpoints(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_PROVIDER_LIST, (_event, sessionId: unknown) =>
		adapter.listWebhookProviders(requireString(sessionId, "sessionId")),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_CREATE, (_event, sessionId: unknown, data: unknown) =>
		adapter.createWebhookEndpoint(requireString(sessionId, "sessionId"), data),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_UPDATE,
		(_event, sessionId: unknown, id: unknown, data: unknown) =>
			adapter.updateWebhookEndpoint(requireString(sessionId, "sessionId"), requireString(id, "id"), data),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_DELETE, (_event, sessionId: unknown, id: unknown) =>
		adapter.deleteWebhookEndpoint(requireString(sessionId, "sessionId"), requireString(id, "id")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_SET_ENABLED,
		(_event, sessionId: unknown, id: unknown, enabled: unknown) =>
			adapter.setWebhookEndpointEnabled(
				requireString(sessionId, "sessionId"),
				requireString(id, "id"),
				requireBoolean(enabled, "enabled"),
			),
	);
	ipcMain.handle(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_TEST, (_event, sessionId: unknown, id: unknown) =>
		adapter.testWebhookEndpoint(requireString(sessionId, "sessionId"), requireString(id, "id")),
	);
	ipcMain.handle(
		PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_SEND,
		(_event, sessionId: unknown, id: unknown, message: unknown) =>
			adapter.sendWebhookMessage(requireString(sessionId, "sessionId"), requireString(id, "id"), message),
	);

	return () => {
		for (const channel of Object.values(PLUGIN_CAPABILITY_CHANNELS)) ipcMain.removeHandler(channel);
	};
}
