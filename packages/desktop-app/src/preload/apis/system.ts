import type { IpcRenderer, IpcRendererEvent, WebUtils } from "electron";
import type { DesktopApi } from "../api.js";
import type { DesktopThemeChangeRequest } from "../api-types/theme.js";
import { onIpcEvent, onIpcVoidEvent } from "./helper.js";

export function createSystemApi(
	ipc: IpcRenderer,
	webUtils: WebUtils,
): Pick<
	DesktopApi,
	| "dialog"
	| "theme"
	| "fs"
	| "skills"
	| "config"
	| "knowledge"
	| "models"
	| "mcp"
	| "media"
	| "runtimes"
	| "settings"
	| "subscription"
	| "shell"
	| "window"
	| "auth"
	| "updater"
	| "tray"
	| "debug"
	| "diagnostics"
	| "project"
	| "permissions"
> {
	return {
		dialog: {
			selectFolder: () => ipc.invoke("vetta:dialog:select-folder"),
			selectFolders: () => ipc.invoke("vetta:dialog:select-folders"),
			selectImages: () => ipc.invoke("vetta:dialog:select-images"),
			selectFiles: (defaultPath) => ipc.invoke("vetta:dialog:select-files", defaultPath),
			saveHtml: (defaultFileName, content) => ipc.invoke("vetta:dialog:save-html", defaultFileName, content),
			saveCopy: (sourcePath, options) => ipc.invoke("vetta:dialog:save-copy", sourcePath, options),
			persistImages: (sessionId, images) => ipc.invoke("vetta:dialog:persist-images", sessionId, images),
		},
		theme: {
			set: (mode) => ipc.invoke("vetta:theme:set", mode),
			getNative: () => ipc.invoke("vetta:theme:get-native"),
			onNativeChanged: (handler) => onIpcEvent(ipc, "vetta:theme:native-changed", handler),
			onModeRequested: (handler) => onIpcEvent(ipc, "vetta:theme:mode-requested", handler),
			onChangeRequested: (handler) => {
				const listener = (_event: IpcRendererEvent, data: unknown) => {
					const request = data as {
						requestId?: unknown;
						mode?: unknown;
						themeId?: unknown;
						cursorStyle?: unknown;
					};
					if (typeof request.requestId !== "string") return;
					const changeRequest: DesktopThemeChangeRequest = {};
					if (request.mode === "light" || request.mode === "dark" || request.mode === "auto") {
						changeRequest.mode = request.mode;
					}
					if (typeof request.themeId === "string") {
						changeRequest.themeId = request.themeId;
					}
					if (request.cursorStyle === "default" || request.cursorStyle === "stoat") {
						changeRequest.cursorStyle = request.cursorStyle;
					}
					void Promise.resolve(handler(changeRequest)).then(
						(state) => ipc.send("vetta:theme:change-response", { requestId: request.requestId, state }),
						(error: unknown) =>
							ipc.send("vetta:theme:change-response", {
								requestId: request.requestId,
								error: error instanceof Error ? error.message : String(error),
							}),
					);
				};
				ipc.on("vetta:theme:change-requested", listener);
				return () => ipc.removeListener("vetta:theme:change-requested", listener);
			},
			onStateRequested: (handler) => {
				const listener = (_event: IpcRendererEvent, data: unknown) => {
					const request = data as { requestId?: unknown };
					if (typeof request.requestId !== "string") return;
					void Promise.resolve(handler()).then(
						(state) => ipc.send("vetta:theme:state-response", { requestId: request.requestId, state }),
						(error: unknown) =>
							ipc.send("vetta:theme:state-response", {
								requestId: request.requestId,
								error: error instanceof Error ? error.message : String(error),
							}),
					);
				};
				ipc.on("vetta:theme:state-requested", listener);
				return () => ipc.removeListener("vetta:theme:state-requested", listener);
			},
			onHelpRequested: (handler) => {
				const listener = (_event: IpcRendererEvent, data: unknown) => {
					const request = data as { requestId?: unknown };
					if (typeof request.requestId !== "string") return;
					void Promise.resolve(handler()).then(
						(help) => ipc.send("vetta:theme:help-response", { requestId: request.requestId, help }),
						(error: unknown) =>
							ipc.send("vetta:theme:help-response", {
								requestId: request.requestId,
								error: error instanceof Error ? error.message : String(error),
							}),
					);
				};
				ipc.on("vetta:theme:help-requested", listener);
				return () => ipc.removeListener("vetta:theme:help-requested", listener);
			},
		},
		fs: {
			readDir: (dirPath) => ipc.invoke("vetta:fs:read-dir", dirPath),
			readFile: (filePath) => ipc.invoke("vetta:fs:read-file", filePath),
			writeFile: (filePath, content, encoding) =>
				ipc.invoke("vetta:fs:write-file", filePath, content, encoding ?? "utf8"),
			stat: (filePath) => ipc.invoke("vetta:fs:stat", filePath),
			rename: (oldPath, newPath) => ipc.invoke("vetta:fs:rename", oldPath, newPath),
			delete: (targetPath) => ipc.invoke("vetta:fs:delete", targetPath),
			move: (sourcePath, destDir) => ipc.invoke("vetta:fs:move", sourcePath, destDir),
			prepareDrop: (files, destinationDirectory) => {
				const sourcePaths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
				return ipc.invoke("vetta:file-transfer:prepare-drop", sourcePaths, destinationDirectory);
			},
			commitDrop: (planId, action, conflictPolicy) =>
				ipc.invoke("vetta:file-transfer:commit-drop", planId, action, conflictPolicy),
			cancelDrop: (planId) => ipc.invoke("vetta:file-transfer:cancel-drop", planId),
			startDrag: (paths) => ipc.send("vetta:file-transfer:start-drag", [...paths]),
			createDirectory: (dirPath) => ipc.invoke("vetta:fs:create-directory", dirPath),
			listSubDirs: (dirPath) => ipc.invoke("vetta:fs:list-sub-dirs", dirPath),
			listFilesRecursive: (rootPath) => ipc.invoke("vetta:fs:list-files-recursive", rootPath),
			watchDir: (dirPath) => ipc.invoke("vetta:fs:watch-dir", dirPath),
			unwatchDir: (dirPath) => ipc.invoke("vetta:fs:unwatch-dir", dirPath),
			onDirChanged: (handler) => onIpcEvent(ipc, "vetta:fs:dir-changed", handler),
			pathForFile: (file) => webUtils.getPathForFile(file),
		},
		skills: {
			list: (cwd) => ipc.invoke("vetta:skills:list", cwd),
			installFromMarket: (name, archiveBuffer, type, meta) =>
				ipc.invoke("vetta:skills:install-from-market", name, archiveBuffer, type, meta),
			importCustom: (archiveBuffer) => ipc.invoke("vetta:skills:import-custom", archiveBuffer),
			uninstall: (name, type) => ipc.invoke("vetta:skills:uninstall", name, type),
			toggle: (name) => ipc.invoke("vetta:skills:toggle", name),
			getMarketManifest: () => ipc.invoke("vetta:skills:get-market-manifest"),
			getSkillMdPath: (name, type) => ipc.invoke("vetta:skills:get-skill-md-path", name, type),
		},
		config: {
			get: () => ipc.invoke("vetta:config:get"),
			set: (config) => ipc.invoke("vetta:config:set", config),
			onShortcutsChanged: (handler) => onIpcEvent(ipc, "vetta:shortcuts:changed", handler),
		},
		knowledge: {
			scanNow: () => ipc.invoke("vetta:kb:scan-now"),
			retryFailed: () => ipc.invoke("vetta:kb:retry-failed"),
			reload: () => ipc.invoke("vetta:kb:reload"),
			list: () => ipc.invoke("vetta:kb:list"),
			listDir: (kbId, relPath) => ipc.invoke("vetta:kb:list-dir", kbId, relPath),
			fileStatuses: () => ipc.invoke("vetta:kb:statuses"),
			addFiles: (kbId, sourcePaths, move) => ipc.invoke("vetta:kb:add-files", kbId, sourcePaths, move),
			deleteEntry: (kbId, relPath) => ipc.invoke("vetta:kb:delete-entry", kbId, relPath),
			renameEntry: (kbId, relPath, newName) => ipc.invoke("vetta:kb:rename-entry", kbId, relPath, newName),
			create: (name) => ipc.invoke("vetta:kb:create", name),
			delete: (name) => ipc.invoke("vetta:kb:delete", name),
			rename: (oldName, newName) => ipc.invoke("vetta:kb:rename", oldName, newName),
			clearWiki: () => ipc.invoke("vetta:kb:clear-wiki"),
			clearRecords: () => ipc.invoke("vetta:kb:clear-records"),
			deleteWiki: (kbId, relPaths) => ipc.invoke("vetta:kb:delete-wiki", kbId, relPaths),
			isProcessing: () => ipc.invoke("vetta:kb:is-processing"),
			onProcessingChanged: (handler) => onIpcEvent(ipc, "vetta:kb:processing-changed", handler),
			onStatusesChanged: (handler) => onIpcEvent(ipc, "vetta:kb:statuses-changed", handler),
		},
		models: {
			get: () => ipc.invoke("vetta:models:get"),
			set: (config) => ipc.invoke("vetta:models:set", config),
			fetchRemote: () => ipc.invoke("vetta:models:fetch-remote"),
			listPresets: () => ipc.invoke("vetta:models:list-presets"),
			refreshPresetModels: (providerId, apiKey) =>
				ipc.invoke("vetta:models:refresh-preset-models", providerId, apiKey),
			refreshPresetCatalog: () => ipc.invoke("vetta:models:refresh-preset-catalog"),
			onPresetsUpdated: (handler) => onIpcVoidEvent(ipc, "vetta:models:presets-updated", handler),
			probe: (ref) => ipc.invoke("vetta:models:probe", ref),
			fetchProviderModels: (providerName) => ipc.invoke("vetta:models:fetch-provider-models", providerName),
		},
		mcp: {
			get: () => ipc.invoke("vetta:mcp:get"),
			set: (config) => ipc.invoke("vetta:mcp:set", config),
			login: (serverName, options) => ipc.invoke("vetta:mcp:login", serverName, options),
			logout: (serverName) => ipc.invoke("vetta:mcp:logout", serverName),
			hasAuth: (serverName) => ipc.invoke("vetta:mcp:has-auth", serverName),
			authStatus: (serverNames) => ipc.invoke("vetta:mcp:auth-status", serverNames),
		},
		media: {
			getAudioMetadata: (filePath) => ipc.invoke("vetta:media:audio-metadata", filePath),
		},
		runtimes: {
			getStatus: () => ipc.invoke("vetta:runtimes:get-status"),
			reinstall: (type) => ipc.invoke("vetta:runtimes:reinstall", type),
			redetect: () => ipc.invoke("vetta:runtimes:redetect"),
		},
		settings: {
			getServerUrl: () => ipc.invoke("vetta:settings:get-server-url"),
			getSiteUrl: () => ipc.invoke("vetta:settings:get-site-url"),
			getServerToken: () => ipc.invoke("vetta:settings:get-server-token"),
			setServerToken: (token) => ipc.invoke("vetta:settings:set-server-token", token),
			getServerRefreshToken: () => ipc.invoke("vetta:settings:get-server-refresh-token"),
			setServerRefreshToken: (token) => ipc.invoke("vetta:settings:set-server-refresh-token", token),
		},
		subscription: {
			getStatus: () => ipc.invoke("vetta:subscription:status"),
		},
		shell: {
			showInFolder: (fullPath) => ipc.invoke("vetta:shell:show-in-folder", fullPath),
			showItemInFolder: (fullPath) => ipc.invoke("vetta:shell:show-item-in-folder", fullPath),
			openExternal: (url) => ipc.invoke("vetta:shell:open-external", url),
		},
		window: {
			minimize: () => ipc.invoke("vetta:window:minimize"),
			maximize: () => ipc.invoke("vetta:window:maximize"),
			close: () => ipc.invoke("vetta:window:close"),
			isMaximized: () => ipc.invoke("vetta:window:is-maximized"),
			onMaximizedChanged: (handler) => onIpcEvent(ipc, "vetta:window:maximized-changed", handler),
			toggleAlwaysOnTop: () => ipc.invoke("vetta:window:toggle-always-on-top"),
			isAlwaysOnTop: () => ipc.invoke("vetta:window:is-always-on-top"),
			captureRegion: (rect, defaultFileName) => ipc.invoke("vetta:window:capture-region", rect, defaultFileName),
		},
		auth: {
			openExternal: (url) => ipc.invoke("vetta:shell:open-external", url),
			startOAuth: () => ipc.invoke("vetta:auth:start-oauth"),
			reopenOAuth: () => ipc.invoke("vetta:auth:reopen-oauth"),
			refreshToken: () => ipc.invoke("vetta:auth:refresh-token"),
			onOAuthCallback: (handler) => onIpcEvent(ipc, "vetta:auth:oauth-callback", handler),
			onOAuthRejected: (handler) => onIpcVoidEvent(ipc, "vetta:auth:oauth-rejected", handler),
			onUnauthorized: (handler) => onIpcVoidEvent(ipc, "vetta:auth:unauthorized", handler),
			onTokenRefreshed: (handler) => onIpcEvent(ipc, "vetta:auth:token-refreshed", handler),
		},
		updater: {
			check: () => ipc.invoke("vetta:updater:check"),
			getState: () => ipc.invoke("vetta:updater:get-state"),
			getCurrentVersion: () => ipc.invoke("vetta:updater:get-current-version"),
			download: () => ipc.invoke("vetta:updater:download"),
			install: () => ipc.invoke("vetta:updater:install"),
			dismiss: () => ipc.invoke("vetta:updater:dismiss"),
			cancel: () => ipc.invoke("vetta:updater:cancel"),
			onStateChanged: (handler) => onIpcEvent(ipc, "vetta:updater:state", handler),
		},
		tray: {
			setQuitBehavior: (hideToTray) => ipc.invoke("vetta:tray:set-quit-behavior", hideToTray),
			getQuitBehavior: () => ipc.invoke("vetta:tray:get-quit-behavior"),
			setTooltip: (text) => ipc.invoke("vetta:tray:set-tooltip", text),
		},
		debug: {
			parseToolCalls: (sessionPath) => ipc.invoke("vetta:debug:parse-tool-calls", sessionPath),
			listRequestFiles: (projectName, sessionId) =>
				ipc.invoke("vetta:debug:list-request-files", projectName, sessionId),
			clearDebugDir: () => ipc.invoke("vetta:debug:clear-debug-dir"),
		},
		diagnostics: {
			exportDiagnosticsPackage: () => ipc.invoke("vetta:diagnostics:export"),
			getLogDir: () => ipc.invoke("vetta:diagnostics:get-log-dir"),
		},
		project: {
			export: (projectDir) => ipc.invoke("vetta:project:export", projectDir),
			import: () => ipc.invoke("vetta:project:import"),
			readMeta: (projectDir) => ipc.invoke("vetta:project:read-meta", projectDir),
		},
		permissions: {
			checkAll: () => ipc.invoke("vetta:permissions:check-all"),
			openPane: (kind) => ipc.invoke("vetta:permissions:open-pane", kind),
		},
	};
}
