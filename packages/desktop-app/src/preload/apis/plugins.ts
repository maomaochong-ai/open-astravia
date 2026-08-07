import type { IpcRenderer, IpcRendererEvent, WebUtils } from "electron";
import { PLUGIN_CAPABILITY_CHANNELS, PLUGIN_SYSTEM_CHANNELS } from "../../shared/plugin-capability-ipc.js";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

type SettingsChangedListener = Parameters<DesktopApi["plugins"]["onSettingsChanged"]>[0];
type SettingsChangedPayload = Parameters<SettingsChangedListener>[0];

export function createPluginsApi(ipc: IpcRenderer, webUtils: WebUtils): Pick<DesktopApi, "plugins"> {
	const settingsChangedSubscriptions = new Set<{ readonly listener: SettingsChangedListener }>();
	const handleSettingsChanged = (_event: IpcRendererEvent, payload: SettingsChangedPayload): void => {
		for (const subscription of [...settingsChangedSubscriptions]) subscription.listener(payload);
	};
	const onSettingsChanged = (listener: SettingsChangedListener): (() => void) => {
		const subscription = { listener };
		settingsChangedSubscriptions.add(subscription);
		if (settingsChangedSubscriptions.size === 1) {
			ipc.on("vetta:plugins:settings-changed", handleSettingsChanged);
		}
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			settingsChangedSubscriptions.delete(subscription);
			if (settingsChangedSubscriptions.size === 0) {
				ipc.removeListener("vetta:plugins:settings-changed", handleSettingsChanged);
			}
		};
	};

	return {
		plugins: {
			internalCapabilities: {
				openSession: (pluginId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.OPEN_SESSION, pluginId),
				closeSession: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.CLOSE_SESSION, sessionId),
				artifacts: {
					persist: (sessionId, input) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.ARTIFACT_PERSIST, sessionId, input),
					release: (sessionId, artifactId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.ARTIFACT_RELEASE, sessionId, artifactId),
				},
				ai: {
					listModels: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.AI_MODEL_LIST, sessionId),
					complete: (sessionId, input) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.AI_COMPLETE, sessionId, input),
				},
				agentSettings: {
					getExperimental: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.AGENT_SETTINGS_EXPERIMENTAL_GET, sessionId),
					setExperimental: (sessionId, input) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.AGENT_SETTINGS_EXPERIMENTAL_SET, sessionId, input),
				},
				generalSettings: {
					get: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_GET, sessionId),
					setNotifications: (sessionId, enabled) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_NOTIFICATIONS_SET, sessionId, enabled),
					setDefaultExecutionMode: (sessionId, mode) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_DEFAULT_EXECUTION_MODE_SET, sessionId, mode),
					setWorkspace: (sessionId, path) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.GENERAL_SETTINGS_WORKSPACE_SET, sessionId, path),
				},
				im: {
					getStatus: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.IM_STATUS_GET, sessionId),
					listLogs: (sessionId, limit) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.IM_LOG_LIST, sessionId, limit),
					setEnabled: (sessionId, enabled) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.IM_ENABLED_SET, sessionId, enabled),
					restart: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.IM_RESTART, sessionId),
					setAgentModel: (sessionId, modelKey, reasoningLevel) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.IM_AGENT_MODEL_SET, sessionId, modelKey, reasoningLevel),
				},
				models: {
					list: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_LIST, sessionId),
					getConfig: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_CONFIG_GET, sessionId),
					getProvider: (sessionId, provider) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_PROVIDER_GET, sessionId, provider),
					probe: (sessionId, provider, model) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_PROBE, sessionId, provider, model),
					validateModelKey: (sessionId, modelKey, operation) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_KEY_VALIDATE, sessionId, modelKey, operation),
					setDefault: (sessionId, modelKey) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_DEFAULT_SET, sessionId, modelKey),
					upsertProvider: (sessionId, provider, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_PROVIDER_UPSERT, sessionId, provider, data),
					removeProvider: (sessionId, provider) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MODEL_PROVIDER_REMOVE, sessionId, provider),
				},
				media: {
					listProviders: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MEDIA_PROVIDER_LIST, sessionId),
					submit: (sessionId, input) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MEDIA_SUBMIT, sessionId, input),
				},
				jobs: {
					get: (sessionId, id) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.JOB_GET, sessionId, id),
					cancel: (sessionId, id) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.JOB_CANCEL, sessionId, id),
				},
				mcp: {
					list: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_LIST, sessionId),
					get: (sessionId, name) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_GET, sessionId, name),
					upsert: (sessionId, name, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_UPSERT, sessionId, name, data),
					setEnabled: (sessionId, name, enabled) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_SET_ENABLED, sessionId, name, enabled),
					remove: (sessionId, name) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.MCP_SERVER_REMOVE, sessionId, name),
				},
				batchTasks: {
					listProjects: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_LIST, sessionId),
					getProject: (sessionId, projectId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_GET, sessionId, projectId),
					createProject: (sessionId, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_CREATE, sessionId, data),
					updateProject: (sessionId, projectId, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_UPDATE, sessionId, projectId, data),
					deleteProject: (sessionId, projectId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_DELETE, sessionId, projectId),
					runTask: (sessionId, projectId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RUN, sessionId, projectId, taskId),
					retryTask: (sessionId, projectId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RETRY, sessionId, projectId, taskId),
					stopTask: (sessionId, projectId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_STOP, sessionId, projectId, taskId),
					deleteTask: (sessionId, projectId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_DELETE, sessionId, projectId, taskId),
					resumeTask: (sessionId, projectId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RESUME, sessionId, projectId, taskId),
					resumeTaskWithText: (sessionId, projectId, taskId, text) =>
						ipc.invoke(
							PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_RESUME_WITH_TEXT,
							sessionId,
							projectId,
							taskId,
							text,
						),
					deleteTaskSession: (sessionId, projectId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_TASK_SESSION_DELETE, sessionId, projectId, taskId),
					deleteAllTasks: (sessionId, projectId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_TASK_DELETE_ALL, sessionId, projectId),
					startProject: (sessionId, projectId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_START, sessionId, projectId),
					stopProject: (sessionId, projectId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_STOP, sessionId, projectId),
					resetProject: (sessionId, projectId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_RESET, sessionId, projectId),
					resetFailedTasks: (sessionId, projectId, taskIds) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.BATCH_PROJECT_FAILED_TASK_RESET, sessionId, projectId, taskIds),
				},
				filesystem: {
					readDirectory: (sessionId, path) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_READ_DIRECTORY, sessionId, path),
					readFile: (sessionId, path) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_READ_FILE, sessionId, path),
					readBinaryFile: (sessionId, path) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_READ_BINARY_FILE, sessionId, path),
					writeFile: (sessionId, path, content, encoding) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_WRITE_FILE, sessionId, path, content, encoding),
					stat: (sessionId, path) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_STAT, sessionId, path),
					rename: (sessionId, oldPath, newPath) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_RENAME, sessionId, oldPath, newPath),
					delete: (sessionId, path) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_DELETE, sessionId, path),
					move: (sessionId, sourcePath, destinationDirectory) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_MOVE, sessionId, sourcePath, destinationDirectory),
					createDirectory: (sessionId, path) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_CREATE_DIRECTORY, sessionId, path),
					listFilesRecursive: (sessionId, path) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.FS_LIST_FILES_RECURSIVE, sessionId, path),
				},
				downloads: {
					list: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.DOWNLOAD_LIST, sessionId),
					cancel: (sessionId, id) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.DOWNLOAD_CANCEL, sessionId, id),
				},
				updater: {
					getState: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.UPDATER_STATE_GET, sessionId),
					getCurrentVersion: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.UPDATER_CURRENT_VERSION_GET, sessionId),
					check: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.UPDATER_CHECK, sessionId),
					download: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.UPDATER_DOWNLOAD, sessionId),
					install: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.UPDATER_INSTALL, sessionId),
					dismiss: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.UPDATER_DISMISS, sessionId),
					cancel: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.UPDATER_CANCEL, sessionId),
				},
				knowledge: {
					listBases: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_LIST, sessionId),
					listFileStatuses: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_FILE_STATUS_LIST, sessionId),
					isProcessing: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_STATUS_GET, sessionId),
					getProcessing: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_SETTINGS_GET, sessionId),
					createBase: (sessionId, name) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_CREATE, sessionId, name),
					renameBase: (sessionId, name, newName) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_RENAME, sessionId, name, newName),
					deleteBase: (sessionId, name) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_BASE_DELETE, sessionId, name),
					addFiles: (sessionId, kbId, paths, move) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_ENTRY_ADD_FILES, sessionId, kbId, paths, move),
					deleteEntry: (sessionId, kbId, relPath) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_ENTRY_DELETE, sessionId, kbId, relPath),
					scanNow: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_SCAN, sessionId),
					retryFailed: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_RETRY_FAILED, sessionId),
					setProcessing: (sessionId, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.KNOWLEDGE_PROCESSING_SETTINGS_SET, sessionId, data),
				},
				projects: {
					list: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.PROJECT_LIST, sessionId),
					create: (sessionId, name, path) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.PROJECT_CREATE, sessionId, name, path),
					open: (sessionId, path, name) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.PROJECT_OPEN, sessionId, path, name),
					rename: (sessionId, path, name) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.PROJECT_RENAME, sessionId, path, name),
					archive: (sessionId, path) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.PROJECT_ARCHIVE, sessionId, path),
					unarchive: (sessionId, path) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.PROJECT_UNARCHIVE, sessionId, path),
					remove: (sessionId, path) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.PROJECT_REMOVE, sessionId, path),
				},
				sessions: {
					list: (sessionId, cwd) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SESSION_LIST, sessionId, cwd),
					listRuntimeProjects: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SESSION_LIST_RUNTIME_PROJECTS, sessionId),
				},
				skills: {
					list: (sessionId, cwd) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SKILL_LIST, sessionId, cwd),
					listInstalled: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SKILL_INSTALLED_LIST, sessionId),
					setEnabled: (sessionId, name, enabled) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SKILL_INSTALLED_SET_ENABLED, sessionId, name, enabled),
					uninstall: (sessionId, name, type) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SKILL_INSTALLED_UNINSTALL, sessionId, name, type),
				},
				pluginSystem: {
					list: (sessionId) => ipc.invoke(PLUGIN_SYSTEM_CHANNELS.LIST, sessionId),
					installFromUrl: (sessionId, url) => ipc.invoke(PLUGIN_SYSTEM_CHANNELS.INSTALL_FROM_URL, sessionId, url),
					installFromPath: (sessionId, path, options) =>
						ipc.invoke(PLUGIN_SYSTEM_CHANNELS.INSTALL_FROM_PATH, sessionId, path, options),
					uninstall: (sessionId, id) => ipc.invoke(PLUGIN_SYSTEM_CHANNELS.UNINSTALL, sessionId, id),
					setEnabled: (sessionId, id, enabled) =>
						ipc.invoke(PLUGIN_SYSTEM_CHANNELS.SET_ENABLED, sessionId, id, enabled),
					reload: (sessionId, id) => ipc.invoke(PLUGIN_SYSTEM_CHANNELS.RELOAD, sessionId, id),
				},
				shortcuts: {
					getSettings: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_SETTINGS_GET, sessionId),
					setBinding: (sessionId, id, shortcut) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_BINDING_SET, sessionId, id, shortcut),
					resetBinding: (sessionId, id) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_BINDING_RESET, sessionId, id),
					resetAllBindings: (sessionId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SHORTCUT_BINDING_RESET_ALL, sessionId),
					setQuickPanelTrigger: (sessionId, trigger) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.QUICK_PANEL_TRIGGER_SET, sessionId, trigger),
					setQuickPanelPostSendBehavior: (sessionId, behavior) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.QUICK_PANEL_POST_SEND_BEHAVIOR_SET, sessionId, behavior),
				},
				scheduler: {
					listTasks: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_LIST, sessionId),
					getTask: (sessionId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_GET, sessionId, taskId),
					listHistory: (sessionId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_HISTORY_LIST, sessionId, taskId),
					createTask: (sessionId, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_CREATE, sessionId, data),
					updateTask: (sessionId, taskId, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_UPDATE, sessionId, taskId, data),
					deleteTask: (sessionId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_DELETE, sessionId, taskId),
					setEnabled: (sessionId, taskId, enabled) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_SET_ENABLED, sessionId, taskId, enabled),
					runTask: (sessionId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_RUN, sessionId, taskId),
					abortTask: (sessionId, taskId) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.SCHEDULER_TASK_ABORT, sessionId, taskId),
				},
				webhook: {
					listEndpoints: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_LIST, sessionId),
					listProviders: (sessionId) => ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_PROVIDER_LIST, sessionId),
					createEndpoint: (sessionId, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_CREATE, sessionId, data),
					updateEndpoint: (sessionId, id, data) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_UPDATE, sessionId, id, data),
					deleteEndpoint: (sessionId, id) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_DELETE, sessionId, id),
					setEnabled: (sessionId, id, enabled) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_SET_ENABLED, sessionId, id, enabled),
					testEndpoint: (sessionId, id) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_TEST, sessionId, id),
					sendMessage: (sessionId, id, message) =>
						ipc.invoke(PLUGIN_CAPABILITY_CHANNELS.WEBHOOK_ENDPOINT_SEND, sessionId, id, message),
				},
			},
			list: () => ipc.invoke("vetta:plugins:list"),
			listAll: () => ipc.invoke("vetta:plugins:list-all"),
			installFromArchive: (archiveBuffer, options) =>
				ipc.invoke("vetta:plugins:install-from-archive", archiveBuffer, options),
			installFromUrl: (url, options) => ipc.invoke("vetta:plugins:install-from-url", url, options),
			installFromPath: (path, options) => ipc.invoke("vetta:plugins:install-from-path", path, options),
			uninstall: (id) => ipc.invoke("vetta:plugins:uninstall", id),
			setEnabled: (id, enabled) => ipc.invoke("vetta:plugins:set-enabled", id, enabled),
			grantPermissions: (id, permissions) => ipc.invoke("vetta:plugins:grant-permissions", id, permissions),
			revokePermissions: (id, permissions) => ipc.invoke("vetta:plugins:revoke-permissions", id, permissions),
			grantCommands: (id, names) => ipc.invoke("vetta:plugins:grant-commands", id, names),
			revokeCommands: (id, names) => ipc.invoke("vetta:plugins:revoke-commands", id, names),
			runCommand: (pluginId, file, args, options) =>
				ipc.invoke("vetta:plugins:command-run", pluginId, file, args, options),
			spawnCommand: (pluginId, file, args, options) =>
				ipc.invoke("vetta:plugins:command-spawn", pluginId, file, args, options),
			stopCommandSpawn: (pluginId, spawnId) => ipc.invoke("vetta:plugins:command-spawn-stop", pluginId, spawnId),
			getCommandSpawnStatus: (pluginId, spawnId) =>
				ipc.invoke("vetta:plugins:command-spawn-status", pluginId, spawnId),
			onCommandSpawnExit: (handler) => onIpcEvent(ipc, "vetta:plugins:command-spawn-exit", handler),
			offscreenCapture: (pluginId, options) => ipc.invoke("vetta:plugins:offscreen-capture", pluginId, options),
			offscreenRelease: (pluginId, sessionKey) =>
				ipc.invoke("vetta:plugins:offscreen-release", pluginId, sessionKey),
			reload: (id) => ipc.invoke("vetta:plugins:reload", id),
			startDevWatch: (id, projectDir) => ipc.invoke("vetta:plugins:dev-watch-start", id, projectDir),
			stopDevWatch: (id) => ipc.invoke("vetta:plugins:dev-watch-stop", id),
			registerModeGate: (pluginId) => ipc.invoke("vetta:plugins:register-mode-gate", pluginId),
			setContributionMode: (pluginId, active) => ipc.invoke("vetta:plugins:set-contribution-mode", pluginId, active),
			beginAgentContributionsLoad: (pluginId, activationId) =>
				ipc.invoke("vetta:plugins:agent-contributions-begin-load", pluginId, activationId),
			registerAgentTool: (pluginId, registration) =>
				ipc.invoke("vetta:plugins:agent-tool-register", pluginId, registration),
			unregisterAgentTool: (pluginId, toolId, activationId) =>
				ipc.invoke("vetta:plugins:agent-tool-unregister", pluginId, toolId, activationId),
			clearAgentContributions: (pluginId, activationId) =>
				ipc.invoke("vetta:plugins:agent-contributions-clear", pluginId, activationId),
			onAgentToolRequest: (handler) => onIpcEvent(ipc, "vetta:plugins:agent-tool-request", handler),
			respondAgentTool: (requestId, result) => ipc.invoke("vetta:plugins:agent-tool-response", requestId, result),
			registerAppAction: (pluginId, registration) =>
				ipc.invoke("vetta:plugins:app-action-register", pluginId, registration),
			commitAppActionActivation: (pluginId, activationId) =>
				ipc.invoke("vetta:plugins:app-action-activation-commit", pluginId, activationId),
			abortAppActionActivation: (pluginId, activationId) =>
				ipc.invoke("vetta:plugins:app-action-activation-abort", pluginId, activationId),
			unregisterAppAction: (pluginId, actionId, activationId) =>
				ipc.invoke("vetta:plugins:app-action-unregister", pluginId, actionId, activationId),
			onAppActionRequest: (handler) => onIpcEvent(ipc, "vetta:plugins:app-action-request", handler),
			onAppActionCancel: (handler) => onIpcEvent(ipc, "vetta:plugins:app-action-cancel", handler),
			respondAppAction: (requestId, result) => ipc.invoke("vetta:plugins:app-action-response", requestId, result),
			registerContinuationProvider: (pluginId, registration) =>
				ipc.invoke("vetta:plugins:continuation-register", pluginId, registration),
			unregisterContinuationProvider: (pluginId, providerId, activationId) =>
				ipc.invoke("vetta:plugins:continuation-unregister", pluginId, providerId, activationId),
			onContinuationRequest: (handler) => onIpcEvent(ipc, "vetta:plugins:continuation-request", handler),
			respondContinuation: (requestId, result) =>
				ipc.invoke("vetta:plugins:continuation-response", requestId, result),
			registerSystemPromptProvider: (pluginId, registration) =>
				ipc.invoke("vetta:plugins:system-prompt-provider-register", pluginId, registration),
			unregisterSystemPromptProvider: (pluginId, providerId, activationId) =>
				ipc.invoke("vetta:plugins:system-prompt-provider-unregister", pluginId, providerId, activationId),
			onSystemPromptRequest: (handler) => onIpcEvent(ipc, "vetta:plugins:system-prompt-request", handler),
			respondSystemPrompt: (requestId, result) =>
				ipc.invoke("vetta:plugins:system-prompt-response", requestId, result),
			registerMediaProvider: (pluginId, registration) =>
				ipc.invoke("vetta:plugins:media-provider-register", pluginId, registration),
			unregisterMediaProvider: (pluginId, providerId, activationId) =>
				ipc.invoke("vetta:plugins:media-provider-unregister", pluginId, providerId, activationId),
			onMediaProvidersChanged: (handler) => onIpcEvent(ipc, "vetta:plugins:media-providers-changed", handler),
			onMediaProviderRequest: (handler) => onIpcEvent(ipc, "vetta:plugins:media-provider-request", handler),
			respondMediaProvider: (requestId, result) =>
				ipc.invoke("vetta:plugins:media-provider-response", requestId, result),
			uploadMediaProviderInput: (requestId, inputId, request) =>
				ipc.invoke("vetta:plugins:media-provider-input-upload", requestId, inputId, request),
			getSettings: (id) => ipc.invoke("vetta:plugins:get-settings", id),
			setSettings: (id, values) => ipc.invoke("vetta:plugins:set-settings", id, values),
			networkRequest: (sessionId, request) => ipc.invoke("vetta:plugins:network:request", sessionId, request),
			gatewayRequest: (sessionId, request) => ipc.invoke("vetta:plugins:gateway:request", sessionId, request),
			storageReadJson: (sessionId, key) => ipc.invoke("vetta:plugins:storage:read-json", sessionId, key),
			storageWriteJson: (sessionId, key, value) =>
				ipc.invoke("vetta:plugins:storage:write-json", sessionId, key, value),
			storageList: (sessionId, prefix) => ipc.invoke("vetta:plugins:storage:list", sessionId, prefix),
			storageReadFile: (sessionId, path) => ipc.invoke("vetta:plugins:storage:read-file", sessionId, path),
			storageWriteFile: (sessionId, path, data) =>
				ipc.invoke("vetta:plugins:storage:write-file", sessionId, path, data),
			storagePutBlob: (sessionId, input) => ipc.invoke("vetta:plugins:storage:put-blob", sessionId, input),
			storagePutBlobFromFile: (sessionId, input) => {
				const path = webUtils.getPathForFile(input.file);
				if (!path) return Promise.reject(new Error("Plugin blob import requires a filesystem-backed File"));
				return ipc.invoke("vetta:plugins:storage:put-blob-from-file", sessionId, {
					...(input.id === undefined ? {} : { id: input.id }),
					path,
					mimeType: input.mimeType,
				});
			},
			storageReadBlob: (sessionId, id) => ipc.invoke("vetta:plugins:storage:read-blob", sessionId, id),
			storageGetBlobRef: (sessionId, id) => ipc.invoke("vetta:plugins:storage:get-blob-ref", sessionId, id),
			onSettingsChanged,
			onPluginsChanged: (listener) => {
				const handler = (_event: IpcRendererEvent, payload?: Parameters<typeof listener>[0]) => listener(payload);
				ipc.on("vetta:plugins:changed", handler);
				return () => ipc.removeListener("vetta:plugins:changed", handler);
			},
		},
	};
}
