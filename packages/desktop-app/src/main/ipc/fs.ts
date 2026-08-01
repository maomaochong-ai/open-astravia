import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	clearMcpOAuthState,
	hasMcpOAuthTokens,
	loginHttpMcpServer,
	loginMcpDeviceFlow,
} from "@vetta/coding-agent/core/mcp/index.js";
import { resolveConfigValue } from "@vetta/coding-agent/core/resolve-config-value.js";
import { BrowserWindow, clipboard, ipcMain } from "electron";
import type {
	McpConfigData,
	McpHttpServerConfigData,
	McpServerCommonConfigData,
	McpServerConfigData,
	McpStdioServerConfigData,
} from "../../preload/api-types/mcp.js";
import type {
	FsEditableTextSnapshot,
	FsEntry,
	FsFileRef,
	FsSaveEditableTextOptions,
	FsSaveEditableTextResult,
} from "../../preload/fs-types.js";
import {
	type AppshotConfig,
	type AppshotGesture,
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_CONVERSATION_SESSION_DIR,
	DEFAULT_IM_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_SESSION_DIR,
	type DesktopConfig,
	type ExperimentalConfig,
	expandTildePath,
	KB_PROCESSING_CWD,
	KB_PROCESSING_SESSION_DIR,
	type KnowledgeBaseConfig,
	normalizeAgentMode,
	normalizeAppshot,
	normalizeExecutionMode,
	normalizeExperimental,
	normalizeKnowledgeBase,
	normalizeQuickPanel,
	normalizeShortcuts,
	type ProjectEntry,
	persistVettaCliPaths,
	type QuickPanelConfig,
	type QuickPanelTrigger,
	readConfigSync,
	readDesktopConfig,
	writeDesktopConfig,
} from "../config/desktop-config-store.js";
import {
	allowProjectRoot,
	createFilesystemDirectory,
	createFilesystemEntry,
	deleteFilesystemPath,
	listFilesystemFilesRecursive,
	moveFilesystemPath,
	readEditableTextFile,
	readFilesystemDirectory,
	readFilesystemFile,
	renameFilesystemPath,
	saveEditableTextFile,
	statFilesystemPath,
	writeFilesystemFile,
} from "../filesystem/filesystem-service.js";
import { getDesktopMcpSettingsService, readMcpConfig, writeMcpConfig } from "../mcp/mcp-settings-service.js";
import { fetchProviderModels } from "../models/fetch-models.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import type { ModelsConfig } from "../models/model-settings-service.js";
import { probeModelProvider } from "../models/probe.js";
import { openExternalUrl } from "../open-external.js";
import { getLinuxSandboxCapability, getSandboxCapability, type SandboxCapability } from "../sandbox/capability.js";
import { getDesktopShortcutService } from "../shortcuts/shortcut-service.js";

export interface LinuxSandboxConfigState {
	status: "unknown" | "available" | "unavailable";
	backend: "bundled-bwrap" | "system-bwrap" | null;
	reason?: string;
	details?: string;
	checkedAt?: number;
}

export interface DesktopConfigSnapshot extends DesktopConfig {
	sandbox: SandboxCapability;
	linuxSandbox: LinuxSandboxConfigState;
	/** 默认「对话」项目的绝对路径（~/.vetta/conversation），主进程已确保目录存在。 */
	defaultConversationCwd: string;
	/** im-gateway 自己的 cwd（~/.vetta/im-gateway/conversation）。Claw tab 据此判定一条 session 是否来自 IM。 */
	defaultImConversationCwd: string;
	/** 知识库加工特殊项目的绝对路径（~/.vetta/knowledges/processing_records）。 */
	knowledgeProcessingCwd: string;
}

export {
	type AppshotConfig,
	type AppshotGesture,
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_CONVERSATION_SESSION_DIR,
	DEFAULT_IM_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_SESSION_DIR,
	type DesktopConfig,
	type ExperimentalConfig,
	KB_PROCESSING_CWD,
	KB_PROCESSING_SESSION_DIR,
	type KnowledgeBaseConfig,
	persistVettaCliPaths,
	type ProjectEntry,
	type QuickPanelConfig,
	type QuickPanelTrigger,
	readConfigSync,
	readDesktopConfig,
	writeDesktopConfig,
};
export { readMcpConfig, writeMcpConfig };

// ─── MCP config ───

export type McpServerCommonConfig = McpServerCommonConfigData;
export type McpStdioServerConfig = McpStdioServerConfigData;
export type McpHttpServerConfig = McpHttpServerConfigData;
export type McpServerConfig = McpServerConfigData;
export type McpConfig = McpConfigData;

const CHANNELS = {
	READ_DIR: "vetta:fs:read-dir",
	READ_FILE: "vetta:fs:read-file",
	READ_EDITABLE_TEXT: "vetta:fs:read-editable-text",
	SAVE_EDITABLE_TEXT: "vetta:fs:save-editable-text",
	WRITE_FILE: "vetta:fs:write-file",
	STAT: "vetta:fs:stat",
	RENAME: "vetta:fs:rename",
	DELETE: "vetta:fs:delete",
	MOVE: "vetta:fs:move",
	CREATE_ENTRY: "vetta:fs:create-entry",
	CREATE_DIRECTORY: "vetta:fs:create-directory",
	LIST_SUB_DIRS: "vetta:fs:list-sub-dirs",
	LIST_FILES_RECURSIVE: "vetta:fs:list-files-recursive",
	WATCH_DIR: "vetta:fs:watch-dir",
	UNWATCH_DIR: "vetta:fs:unwatch-dir",
	DIR_CHANGED: "vetta:fs:dir-changed",
	CONFIG_GET: "vetta:config:get",
	CONFIG_SET: "vetta:config:set",
	MODELS_GET: "vetta:models:get",
	MODELS_SET: "vetta:models:set",
	MODELS_COPY_API_KEY: "vetta:models:copy-api-key",
	MODELS_PROBE: "vetta:models:probe",
	MODELS_FETCH_PROVIDER_MODELS: "vetta:models:fetch-provider-models",
	MCP_GET: "vetta:mcp:get",
	MCP_SET: "vetta:mcp:set",
	MCP_LOGIN: "vetta:mcp:login",
	MCP_LOGOUT: "vetta:mcp:logout",
	MCP_HAS_AUTH: "vetta:mcp:has-auth",
	MCP_AUTH_STATUS: "vetta:mcp:auth-status",
} as const;

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid ${fieldName}`);
	}
}

export { allowProjectRoot, assertPathReadableForPreview } from "../filesystem/filesystem-service.js";

export function registerFsIpc(): () => void {
	const mcp = getDesktopMcpSettingsService();
	const models = getDesktopModelSettingsService();
	const shortcuts = getDesktopShortcutService();
	let apiKeyClipboardClearTimer: ReturnType<typeof setTimeout> | undefined;
	let copiedApiKey: string | undefined;
	const clearCopiedApiKey = (): void => {
		if (copiedApiKey && clipboard.readText() === copiedApiKey) clipboard.clear();
		copiedApiKey = undefined;
		apiKeyClipboardClearTimer = undefined;
	};
	ipcMain.handle(CHANNELS.READ_DIR, async (_event, dirPath: unknown): Promise<FsEntry[]> => {
		assertNonEmptyString(dirPath, "dirPath");
		return readFilesystemDirectory(dirPath);
	});

	ipcMain.handle(
		CHANNELS.READ_FILE,
		async (_event, filePath: unknown): Promise<{ content: string; encoding: "utf8" | "base64" }> => {
			assertNonEmptyString(filePath, "filePath");
			return readFilesystemFile(filePath);
		},
	);

	ipcMain.handle(CHANNELS.READ_EDITABLE_TEXT, async (_event, filePath: unknown): Promise<FsEditableTextSnapshot> => {
		assertNonEmptyString(filePath, "filePath");
		return readEditableTextFile(filePath);
	});

	ipcMain.handle(
		CHANNELS.SAVE_EDITABLE_TEXT,
		async (_event, filePath: unknown, content: unknown, options: unknown): Promise<FsSaveEditableTextResult> => {
			assertNonEmptyString(filePath, "filePath");
			if (typeof content !== "string") throw new Error("Invalid content");
			if (typeof options !== "object" || options === null) throw new Error("Invalid options");
			const saveOptions = options as Partial<FsSaveEditableTextOptions>;
			assertNonEmptyString(saveOptions.expectedRevision, "expectedRevision");
			if (saveOptions.force !== undefined && typeof saveOptions.force !== "boolean") {
				throw new Error("Invalid force");
			}
			if (saveOptions.hasBom !== undefined && typeof saveOptions.hasBom !== "boolean") {
				throw new Error("Invalid hasBom");
			}
			return saveEditableTextFile(filePath, content, {
				expectedRevision: saveOptions.expectedRevision,
				force: saveOptions.force,
				hasBom: saveOptions.hasBom,
			});
		},
	);

	ipcMain.handle(CHANNELS.WRITE_FILE, async (_event, filePath: unknown, content: unknown, encoding: unknown) => {
		assertNonEmptyString(filePath, "filePath");
		if (typeof content !== "string") throw new Error("Invalid content");
		await writeFilesystemFile(filePath, content, encoding === "base64" ? "base64" : "utf8");
	});

	ipcMain.handle(
		CHANNELS.STAT,
		async (_event, filePath: unknown): Promise<{ size: number; modifiedAt: number; createdAt: number } | null> => {
			assertNonEmptyString(filePath, "filePath");
			return statFilesystemPath(filePath);
		},
	);

	ipcMain.handle(CHANNELS.RENAME, async (_event, oldPath: unknown, newPath: unknown) => {
		assertNonEmptyString(oldPath, "oldPath");
		assertNonEmptyString(newPath, "newPath");
		await renameFilesystemPath(oldPath, newPath);
	});

	ipcMain.handle(CHANNELS.DELETE, async (_event, targetPath: unknown) => {
		assertNonEmptyString(targetPath, "targetPath");
		await deleteFilesystemPath(targetPath);
	});

	ipcMain.handle(CHANNELS.MOVE, async (_event, sourcePath: unknown, destDir: unknown) => {
		assertNonEmptyString(sourcePath, "sourcePath");
		assertNonEmptyString(destDir, "destDir");
		await moveFilesystemPath(sourcePath, destDir);
	});

	ipcMain.handle(
		CHANNELS.CREATE_ENTRY,
		async (_event, parentDirectory: unknown, name: unknown, kind: unknown): Promise<FsEntry> => {
			assertNonEmptyString(parentDirectory, "parentDirectory");
			assertNonEmptyString(name, "name");
			if (kind !== "file" && kind !== "directory") throw new Error("Invalid kind");
			return createFilesystemEntry(parentDirectory, name, kind);
		},
	);

	ipcMain.handle(CHANNELS.CREATE_DIRECTORY, async (_event, dirPath: unknown) => {
		assertNonEmptyString(dirPath, "dirPath");
		await createFilesystemDirectory(dirPath);
	});

	ipcMain.handle(CHANNELS.LIST_FILES_RECURSIVE, async (_event, rootPath: unknown): Promise<FsFileRef[]> => {
		assertNonEmptyString(rootPath, "rootPath");
		return listFilesystemFilesRecursive(rootPath);
	});

	ipcMain.handle(CHANNELS.LIST_SUB_DIRS, async (_event, dirPath: unknown): Promise<FsEntry[]> => {
		assertNonEmptyString(dirPath, "dirPath");
		const resolved = resolve(expandTildePath(dirPath));
		allowProjectRoot(resolved);
		try {
			const entries = await readdir(resolved, { withFileTypes: true });
			const results: FsEntry[] = [];
			for (const entry of entries) {
				if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
				const fullPath = join(resolved, entry.name);
				allowProjectRoot(fullPath);
				try {
					const stats = await stat(fullPath);
					results.push({
						name: entry.name,
						path: fullPath,
						isDirectory: true,
						size: stats.size,
						modifiedAt: stats.mtimeMs,
					});
				} catch {
					// Skip entries we can't stat
				}
			}
			results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
			return results;
		} catch {
			return [];
		}
	});

	// ─── Directory watchers ───

	const DEBOUNCE_MS = 300;
	// Ref-counted: multiple consumers (file tree, plugin previews) may watch the
	// same directory. Only close the underlying watcher when the last releases it.
	const watchers = new Map<string, { watcher: FSWatcher; count: number }>();
	const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

	function broadcastDirChanged(dirPath: string): void {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send(CHANNELS.DIR_CHANGED, dirPath);
		}
	}

	ipcMain.handle(CHANNELS.WATCH_DIR, async (_event, dirPath: unknown) => {
		assertNonEmptyString(dirPath, "dirPath");
		const resolved = resolve(dirPath);
		const existing = watchers.get(resolved);
		if (existing) {
			existing.count++;
			return;
		}
		try {
			const watcher = watch(resolved, (_eventType) => {
				// Debounce to avoid flooding on rapid changes
				const existing = debounceTimers.get(resolved);
				if (existing) clearTimeout(existing);
				debounceTimers.set(
					resolved,
					setTimeout(() => {
						debounceTimers.delete(resolved);
						broadcastDirChanged(resolved);
					}, DEBOUNCE_MS),
				);
			});
			watcher.on("error", () => {
				// Directory deleted or became inaccessible — clean up
				watchers.delete(resolved);
				watcher.close();
			});
			watchers.set(resolved, { watcher, count: 1 });
		} catch {
			// Ignore errors (directory may not exist or no permission)
		}
	});

	ipcMain.handle(CHANNELS.UNWATCH_DIR, async (_event, dirPath: unknown) => {
		assertNonEmptyString(dirPath, "dirPath");
		const resolved = resolve(dirPath);
		const entry = watchers.get(resolved);
		if (entry) {
			entry.count--;
			if (entry.count <= 0) {
				entry.watcher.close();
				watchers.delete(resolved);
				const timer = debounceTimers.get(resolved);
				if (timer) {
					clearTimeout(timer);
					debounceTimers.delete(resolved);
				}
			}
		}
	});

	ipcMain.handle(CHANNELS.CONFIG_GET, async (): Promise<DesktopConfigSnapshot> => {
		const config = await readDesktopConfig();
		// Ensure all known paths are authorized for file operations
		for (const p of config.projects) allowProjectRoot(p.path);
		for (const p of config.archivedProjects) allowProjectRoot(p.path);
		if (config.workspacePath) allowProjectRoot(config.workspacePath);
		allowProjectRoot(DEFAULT_CONVERSATION_CWD);
		allowProjectRoot(DEFAULT_IM_CONVERSATION_CWD);
		allowProjectRoot(KB_PROCESSING_CWD);
		return {
			...config,
			sandbox: getSandboxCapability(),
			linuxSandbox: getLinuxSandboxCapability(),
			defaultConversationCwd: DEFAULT_CONVERSATION_CWD,
			defaultImConversationCwd: DEFAULT_IM_CONVERSATION_CWD,
			knowledgeProcessingCwd: KB_PROCESSING_CWD,
		};
	});

	ipcMain.handle(CHANNELS.CONFIG_SET, async (_event, config: unknown) => {
		if (typeof config !== "object" || config === null) throw new Error("Invalid config");
		const current = await readDesktopConfig();
		const patch = config as Partial<DesktopConfig>;
		const next: DesktopConfig = {
			projects: patch.projects ?? current.projects,
			archivedProjects: patch.archivedProjects ?? current.archivedProjects,
			workspacePath: patch.workspacePath ?? current.workspacePath,
			defaultExecutionMode:
				patch.defaultExecutionMode !== undefined
					? normalizeExecutionMode(patch.defaultExecutionMode)
					: current.defaultExecutionMode,
			agentMode: patch.agentMode !== undefined ? normalizeAgentMode(patch.agentMode) : current.agentMode,
			debugMode: patch.debugMode ?? current.debugMode,
			vettaAppPath: patch.vettaAppPath ?? current.vettaAppPath,
			vettaCliAppPath: patch.vettaCliAppPath ?? current.vettaCliAppPath,
			notificationsEnabled: patch.notificationsEnabled ?? current.notificationsEnabled,
			language: patch.language ?? current.language,
			experimental:
				patch.experimental !== undefined
					? normalizeExperimental({ ...current.experimental, ...patch.experimental })
					: current.experimental,
			knowledgeBase:
				patch.knowledgeBase !== undefined
					? normalizeKnowledgeBase({ ...current.knowledgeBase, ...patch.knowledgeBase })
					: current.knowledgeBase,
			// bindings 整表替换（支持 reset 删键）；GUI/Action 均传完整 map。
			shortcuts: patch.shortcuts !== undefined ? normalizeShortcuts(patch.shortcuts) : current.shortcuts,
			quickPanel:
				patch.quickPanel !== undefined
					? normalizeQuickPanel({ ...current.quickPanel, ...patch.quickPanel })
					: current.quickPanel,
			appshot:
				patch.appshot !== undefined ? normalizeAppshot({ ...current.appshot, ...patch.appshot }) : current.appshot,
		};
		// Allow all known roots for file operations
		for (const p of next.projects) allowProjectRoot(p.path);
		for (const p of next.archivedProjects) allowProjectRoot(p.path);
		if (next.workspacePath) allowProjectRoot(next.workspacePath);
		await writeDesktopConfig(next);
		if (patch.shortcuts !== undefined) {
			const bindings = next.shortcuts?.bindings ?? {};
			shortcuts.notifyBindingsChanged(bindings as Record<string, string>);
		}
	});

	ipcMain.handle(CHANNELS.MODELS_GET, async (): Promise<ModelsConfig> => {
		return models.getRendererConfig();
	});

	ipcMain.handle(CHANNELS.MODELS_SET, async (_event, config: unknown) => {
		if (typeof config !== "object" || config === null) throw new Error("Invalid models config");
		await models.replaceConfig(config as ModelsConfig);
	});

	ipcMain.handle(CHANNELS.MODELS_COPY_API_KEY, async (_event, providerId: unknown): Promise<boolean> => {
		assertNonEmptyString(providerId, "providerId");
		const keyConfig = await models.getProviderApiKey(providerId.trim());
		const apiKey = keyConfig ? resolveConfigValue(keyConfig) : undefined;
		if (!apiKey) return false;

		clipboard.writeText(apiKey);
		if (apiKeyClipboardClearTimer) clearTimeout(apiKeyClipboardClearTimer);
		copiedApiKey = apiKey;
		apiKeyClipboardClearTimer = setTimeout(clearCopiedApiKey, 30_000);
		return true;
	});

	ipcMain.handle(CHANNELS.MODELS_PROBE, async (_event, ref: { provider: string; model: string }) => {
		return probeModelProvider(ref);
	});

	ipcMain.handle(CHANNELS.MODELS_FETCH_PROVIDER_MODELS, async (_event, providerName: unknown) => {
		if (typeof providerName !== "string" || !providerName.trim()) throw new Error("Invalid provider name");
		return fetchProviderModels(providerName.trim());
	});

	ipcMain.handle(CHANNELS.MCP_GET, async (): Promise<McpConfig> => {
		return mcp.getConfig();
	});

	ipcMain.handle(CHANNELS.MCP_SET, async (_event, config: unknown) => {
		await mcp.replaceConfig(config);
		// 不再在保存时 fan-out 重建所有 session。改为每个 session 在用户发
		// prompt 时按需 diff-reload（见 AgentSession._maybeReloadMcpForPrompt）。
		// 这样未使用的 session 不付出代价，且批量任务也能自然感知到变化。
	});

	ipcMain.handle(CHANNELS.MCP_LOGIN, async (_event, serverName: unknown, options?: unknown) => {
		if (typeof serverName !== "string" || !serverName.trim()) {
			throw new Error("Invalid server name");
		}
		const name = serverName.trim();
		const opts = typeof options === "object" && options !== null ? (options as Record<string, unknown>) : {};
		const optionUrl = typeof opts.url === "string" ? opts.url.trim() : "";
		let oauthClientId = typeof opts.oauthClientId === "string" ? opts.oauthClientId.trim() : "";
		let deviceFlow = opts.oauthDeviceFlow === true;
		let scopes = typeof opts.oauthScopes === "string" ? opts.oauthScopes : "";

		let serverUrl = optionUrl;
		// Read mcp.json for anything not passed by the renderer (re-authorize path).
		if (!serverUrl || !oauthClientId || !deviceFlow || !scopes) {
			const config = await mcp.getConfig();
			const server = config.mcpServers[name];
			if (!serverUrl) {
				if (!server) throw new Error(`MCP server '${name}' not found`);
				if (server.type !== "http" || typeof server.url !== "string" || !server.url.trim()) {
					throw new Error(`MCP server '${name}' is not a remote HTTP server`);
				}
				serverUrl = server.url.trim();
			}
			if (server?.type === "http") {
				if (!oauthClientId && typeof server.oauthClientId === "string") oauthClientId = server.oauthClientId.trim();
				if (!deviceFlow && server.oauthDeviceFlow === true) deviceFlow = true;
				if (!scopes && typeof server.oauthScopes === "string") scopes = server.oauthScopes;
			}
		}

		if (deviceFlow) {
			if (!oauthClientId) throw new Error(`MCP server '${name}' is missing oauthClientId for the device flow`);
			await loginMcpDeviceFlow({
				serverName: name,
				serverUrl,
				clientId: oauthClientId,
				scopes: scopes || undefined,
				openUrl: (url) => openExternalUrl(url),
			});
			return;
		}

		await loginHttpMcpServer({
			serverName: name,
			serverUrl,
			oauthClientId: oauthClientId || undefined,
			openUrl: (url) => openExternalUrl(url),
		});
	});

	ipcMain.handle(CHANNELS.MCP_LOGOUT, async (_event, serverName: unknown) => {
		if (typeof serverName !== "string" || !serverName.trim()) {
			throw new Error("Invalid server name");
		}
		clearMcpOAuthState(serverName.trim());
	});

	ipcMain.handle(CHANNELS.MCP_HAS_AUTH, async (_event, serverName: unknown): Promise<boolean> => {
		if (typeof serverName !== "string" || !serverName.trim()) return false;
		return hasMcpOAuthTokens(serverName.trim());
	});

	ipcMain.handle(CHANNELS.MCP_AUTH_STATUS, async (_event, serverNames: unknown): Promise<Record<string, boolean>> => {
		if (!Array.isArray(serverNames)) return {};
		const result: Record<string, boolean> = {};
		for (const name of serverNames) {
			if (typeof name === "string" && name.trim()) {
				result[name.trim()] = hasMcpOAuthTokens(name.trim());
			}
		}
		return result;
	});

	return () => {
		// Close all directory watchers
		for (const entry of watchers.values()) entry.watcher.close();
		watchers.clear();
		for (const timer of debounceTimers.values()) clearTimeout(timer);
		debounceTimers.clear();
		if (apiKeyClipboardClearTimer) clearTimeout(apiKeyClipboardClearTimer);
		clearCopiedApiKey();

		ipcMain.removeHandler(CHANNELS.READ_DIR);
		ipcMain.removeHandler(CHANNELS.READ_FILE);
		ipcMain.removeHandler(CHANNELS.READ_EDITABLE_TEXT);
		ipcMain.removeHandler(CHANNELS.SAVE_EDITABLE_TEXT);
		ipcMain.removeHandler(CHANNELS.WRITE_FILE);
		ipcMain.removeHandler(CHANNELS.STAT);
		ipcMain.removeHandler(CHANNELS.RENAME);
		ipcMain.removeHandler(CHANNELS.DELETE);
		ipcMain.removeHandler(CHANNELS.MOVE);
		ipcMain.removeHandler(CHANNELS.CREATE_ENTRY);
		ipcMain.removeHandler(CHANNELS.READ_DIR);
		ipcMain.removeHandler(CHANNELS.CREATE_DIRECTORY);
		ipcMain.removeHandler(CHANNELS.LIST_SUB_DIRS);
		ipcMain.removeHandler(CHANNELS.LIST_FILES_RECURSIVE);
		ipcMain.removeHandler(CHANNELS.WATCH_DIR);
		ipcMain.removeHandler(CHANNELS.UNWATCH_DIR);
		ipcMain.removeHandler(CHANNELS.CONFIG_GET);
		ipcMain.removeHandler(CHANNELS.CONFIG_SET);
		ipcMain.removeHandler(CHANNELS.MODELS_GET);
		ipcMain.removeHandler(CHANNELS.MODELS_SET);
		ipcMain.removeHandler(CHANNELS.MODELS_COPY_API_KEY);
		ipcMain.removeHandler(CHANNELS.MODELS_PROBE);
		ipcMain.removeHandler(CHANNELS.MODELS_FETCH_PROVIDER_MODELS);
		ipcMain.removeHandler(CHANNELS.MCP_GET);
		ipcMain.removeHandler(CHANNELS.MCP_SET);
		ipcMain.removeHandler(CHANNELS.MCP_LOGIN);
		ipcMain.removeHandler(CHANNELS.MCP_LOGOUT);
		ipcMain.removeHandler(CHANNELS.MCP_HAS_AUTH);
		ipcMain.removeHandler(CHANNELS.MCP_AUTH_STATUS);
	};
}
