import type { IpcRenderer, IpcRendererEvent, WebUtils } from "electron";
import { PROJECTS_CHANNELS } from "../../shared/projects-ipc.js";
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
	| "shell"
	| "clipboard"
	| "window"
	| "updater"
	| "tray"
	| "debug"
	| "diagnostics"
	| "project"
	| "permissions"
> {
	return {
		dialog: {
			selectFolder: () => ipc.invoke("astravia:dialog:select-folder"),
			selectFolders: () => ipc.invoke("astravia:dialog:select-folders"),
			selectImages: () => ipc.invoke("astravia:dialog:select-images"),
			selectFiles: (defaultPath) => ipc.invoke("astravia:dialog:select-files", defaultPath),
			saveHtml: (defaultFileName, content) => ipc.invoke("astravia:dialog:save-html", defaultFileName, content),
			saveData: (defaultFileName, content, encoding, options) =>
				ipc.invoke("astravia:dialog:save-data", defaultFileName, content, encoding, options),
			saveCopy: (sourcePath, options) => ipc.invoke("astravia:dialog:save-copy", sourcePath, options),
			persistImages: (sessionId, images) => ipc.invoke("astravia:dialog:persist-images", sessionId, images),
		},
		theme: {
			set: (mode) => ipc.invoke("astravia:theme:set", mode),
			getNative: () => ipc.invoke("astravia:theme:get-native"),
			onNativeChanged: (handler) => onIpcEvent(ipc, "astravia:theme:native-changed", handler),
			onModeRequested: (handler) => onIpcEvent(ipc, "astravia:theme:mode-requested", handler),
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
						(state) => ipc.send("astravia:theme:change-response", { requestId: request.requestId, state }),
						(error: unknown) =>
							ipc.send("astravia:theme:change-response", {
								requestId: request.requestId,
								error: error instanceof Error ? error.message : String(error),
							}),
					);
				};
				ipc.on("astravia:theme:change-requested", listener);
				return () => ipc.removeListener("astravia:theme:change-requested", listener);
			},
			onStateRequested: (handler) => {
				const listener = (_event: IpcRendererEvent, data: unknown) => {
					const request = data as { requestId?: unknown };
					if (typeof request.requestId !== "string") return;
					void Promise.resolve(handler()).then(
						(state) => ipc.send("astravia:theme:state-response", { requestId: request.requestId, state }),
						(error: unknown) =>
							ipc.send("astravia:theme:state-response", {
								requestId: request.requestId,
								error: error instanceof Error ? error.message : String(error),
							}),
					);
				};
				ipc.on("astravia:theme:state-requested", listener);
				return () => ipc.removeListener("astravia:theme:state-requested", listener);
			},
			onHelpRequested: (handler) => {
				const listener = (_event: IpcRendererEvent, data: unknown) => {
					const request = data as { requestId?: unknown };
					if (typeof request.requestId !== "string") return;
					void Promise.resolve(handler()).then(
						(help) => ipc.send("astravia:theme:help-response", { requestId: request.requestId, help }),
						(error: unknown) =>
							ipc.send("astravia:theme:help-response", {
								requestId: request.requestId,
								error: error instanceof Error ? error.message : String(error),
							}),
					);
				};
				ipc.on("astravia:theme:help-requested", listener);
				return () => ipc.removeListener("astravia:theme:help-requested", listener);
			},
		},
		fs: {
			readDir: (dirPath) => ipc.invoke("astravia:fs:read-dir", dirPath),
			readFile: (filePath) => ipc.invoke("astravia:fs:read-file", filePath),
			readEditableTextFile: (filePath) => ipc.invoke("astravia:fs:read-editable-text", filePath),
			saveEditableTextFile: (filePath, content, options) =>
				ipc.invoke("astravia:fs:save-editable-text", filePath, content, options),
			writeFile: (filePath, content, encoding) =>
				ipc.invoke("astravia:fs:write-file", filePath, content, encoding ?? "utf8"),
			stat: (filePath) => ipc.invoke("astravia:fs:stat", filePath),
			rename: (oldPath, newPath) => ipc.invoke("astravia:fs:rename", oldPath, newPath),
			delete: (targetPath) => ipc.invoke("astravia:fs:delete", targetPath),
			move: (sourcePath, destDir) => ipc.invoke("astravia:fs:move", sourcePath, destDir),
			prepareDrop: (files, destinationDirectory) => {
				const sourcePaths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
				return ipc.invoke("astravia:file-transfer:prepare-drop", sourcePaths, destinationDirectory);
			},
			prepareTransfer: (sourcePaths, destinationDirectory) =>
				ipc.invoke("astravia:file-transfer:prepare-drop", [...sourcePaths], destinationDirectory),
			commitDrop: (planId, action, conflictPolicy) =>
				ipc.invoke("astravia:file-transfer:commit-drop", planId, action, conflictPolicy),
			cancelDrop: (planId) => ipc.invoke("astravia:file-transfer:cancel-drop", planId),
			startDrag: (paths) => ipc.send("astravia:file-transfer:start-drag", [...paths]),
			cacheDragIcon: (path, pngDataUrl) => ipc.send("astravia:file-transfer:cache-drag-icon", path, pngDataUrl),
			createEntry: (parentDirectory, name, kind) =>
				ipc.invoke("astravia:fs:create-entry", parentDirectory, name, kind),
			createDirectory: (dirPath) => ipc.invoke("astravia:fs:create-directory", dirPath),
			listSubDirs: (dirPath) => ipc.invoke("astravia:fs:list-sub-dirs", dirPath),
			listFilesRecursive: (rootPath) => ipc.invoke("astravia:fs:list-files-recursive", rootPath),
			watchDir: (dirPath) => ipc.invoke("astravia:fs:watch-dir", dirPath),
			unwatchDir: (dirPath) => ipc.invoke("astravia:fs:unwatch-dir", dirPath),
			onDirChanged: (handler) => onIpcEvent(ipc, "astravia:fs:dir-changed", handler),
			pathForFile: (file) => webUtils.getPathForFile(file),
		},
		skills: {
			list: (cwd) => ipc.invoke("astravia:skills:list", cwd),
			installFromMarket: (name, archiveBuffer, type, meta) =>
				ipc.invoke("astravia:skills:install-from-market", name, archiveBuffer, type, meta),
			importCustom: (archiveBuffer) => ipc.invoke("astravia:skills:import-custom", archiveBuffer),
			uninstall: (name, type) => ipc.invoke("astravia:skills:uninstall", name, type),
			toggle: (name) => ipc.invoke("astravia:skills:toggle", name),
			getMarketManifest: () => ipc.invoke("astravia:skills:get-market-manifest"),
			getSkillMdPath: (name, type) => ipc.invoke("astravia:skills:get-skill-md-path", name, type),
		},
		config: {
			get: () => ipc.invoke("astravia:config:get"),
			set: (config) => ipc.invoke("astravia:config:set", config),
			onShortcutsChanged: (handler) => onIpcEvent(ipc, "astravia:shortcuts:changed", handler),
			onProjectsChanged: (handler) => onIpcVoidEvent(ipc, PROJECTS_CHANNELS.CHANGED, handler),
		},
		knowledge: {
			scanNow: () => ipc.invoke("astravia:kb:scan-now"),
			retryFailed: () => ipc.invoke("astravia:kb:retry-failed"),
			reload: () => ipc.invoke("astravia:kb:reload"),
			list: () => ipc.invoke("astravia:kb:list"),
			listDir: (kbId, relPath) => ipc.invoke("astravia:kb:list-dir", kbId, relPath),
			fileStatuses: () => ipc.invoke("astravia:kb:statuses"),
			addFiles: (kbId, sourcePaths, move) => ipc.invoke("astravia:kb:add-files", kbId, sourcePaths, move),
			deleteEntry: (kbId, relPath) => ipc.invoke("astravia:kb:delete-entry", kbId, relPath),
			renameEntry: (kbId, relPath, newName) => ipc.invoke("astravia:kb:rename-entry", kbId, relPath, newName),
			create: (name) => ipc.invoke("astravia:kb:create", name),
			delete: (name) => ipc.invoke("astravia:kb:delete", name),
			rename: (oldName, newName) => ipc.invoke("astravia:kb:rename", oldName, newName),
			clearWiki: () => ipc.invoke("astravia:kb:clear-wiki"),
			clearRecords: () => ipc.invoke("astravia:kb:clear-records"),
			deleteWiki: (kbId, relPaths) => ipc.invoke("astravia:kb:delete-wiki", kbId, relPaths),
			isProcessing: () => ipc.invoke("astravia:kb:is-processing"),
			onProcessingChanged: (handler) => onIpcEvent(ipc, "astravia:kb:processing-changed", handler),
			onStatusesChanged: (handler) => onIpcEvent(ipc, "astravia:kb:statuses-changed", handler),
		},
		models: {
			get: () => ipc.invoke("astravia:models:get"),
			set: (config) => ipc.invoke("astravia:models:set", config),
			copyApiKey: (providerId) => ipc.invoke("astravia:models:copy-api-key", providerId),
			listPresets: () => ipc.invoke("astravia:models:list-presets"),
			refreshPresetModels: (providerId, apiKey) =>
				ipc.invoke("astravia:models:refresh-preset-models", providerId, apiKey),
			refreshPresetCatalog: () => ipc.invoke("astravia:models:refresh-preset-catalog"),
			onPresetsUpdated: (handler) => onIpcVoidEvent(ipc, "astravia:models:presets-updated", handler),
			probe: (ref) => ipc.invoke("astravia:models:probe", ref),
			fetchProviderModels: (providerName) => ipc.invoke("astravia:models:fetch-provider-models", providerName),
		},
		mcp: {
			get: () => ipc.invoke("astravia:mcp:get"),
			set: (config) => ipc.invoke("astravia:mcp:set", config),
			login: (serverName, options) => ipc.invoke("astravia:mcp:login", serverName, options),
			logout: (serverName) => ipc.invoke("astravia:mcp:logout", serverName),
			hasAuth: (serverName) => ipc.invoke("astravia:mcp:has-auth", serverName),
			authStatus: (serverNames) => ipc.invoke("astravia:mcp:auth-status", serverNames),
		},
		media: {
			getAudioMetadata: (filePath) => ipc.invoke("astravia:media:audio-metadata", filePath),
		},
		runtimes: {
			getStatus: () => ipc.invoke("astravia:runtimes:get-status"),
			reinstall: (type) => ipc.invoke("astravia:runtimes:reinstall", type),
			redetect: () => ipc.invoke("astravia:runtimes:redetect"),
		},
		shell: {
			showInFolder: (fullPath) => ipc.invoke("astravia:shell:show-in-folder", fullPath),
			showItemInFolder: (fullPath) => ipc.invoke("astravia:shell:show-item-in-folder", fullPath),
			openExternal: (url) => ipc.invoke("astravia:shell:open-external", url),
		},
		clipboard: {
			writeImage: (dataUrl) => ipc.invoke("astravia:clipboard:write-image", dataUrl),
		},
		window: {
			minimize: () => ipc.invoke("astravia:window:minimize"),
			maximize: () => ipc.invoke("astravia:window:maximize"),
			close: () => ipc.invoke("astravia:window:close"),
			isMaximized: () => ipc.invoke("astravia:window:is-maximized"),
			onMaximizedChanged: (handler) => onIpcEvent(ipc, "astravia:window:maximized-changed", handler),
			toggleAlwaysOnTop: () => ipc.invoke("astravia:window:toggle-always-on-top"),
			isAlwaysOnTop: () => ipc.invoke("astravia:window:is-always-on-top"),
			captureRegion: (rect, defaultFileName) => ipc.invoke("astravia:window:capture-region", rect, defaultFileName),
		},
		updater: {
			check: () => ipc.invoke("astravia:updater:check"),
			getState: () => ipc.invoke("astravia:updater:get-state"),
			getCurrentVersion: () => ipc.invoke("astravia:updater:get-current-version"),
			download: () => ipc.invoke("astravia:updater:download"),
			install: () => ipc.invoke("astravia:updater:install"),
			dismiss: () => ipc.invoke("astravia:updater:dismiss"),
			cancel: () => ipc.invoke("astravia:updater:cancel"),
			onStateChanged: (handler) => onIpcEvent(ipc, "astravia:updater:state", handler),
		},
		tray: {
			setQuitBehavior: (hideToTray) => ipc.invoke("astravia:tray:set-quit-behavior", hideToTray),
			getQuitBehavior: () => ipc.invoke("astravia:tray:get-quit-behavior"),
			setTooltip: (text) => ipc.invoke("astravia:tray:set-tooltip", text),
		},
		debug: {
			parseToolCalls: (sessionPath) => ipc.invoke("astravia:debug:parse-tool-calls", sessionPath),
			listRequestFiles: (projectName, sessionId) =>
				ipc.invoke("astravia:debug:list-request-files", projectName, sessionId),
			clearDebugDir: () => ipc.invoke("astravia:debug:clear-debug-dir"),
		},
		diagnostics: {
			exportDiagnosticsPackage: () => ipc.invoke("astravia:diagnostics:export"),
			getLogDir: () => ipc.invoke("astravia:diagnostics:get-log-dir"),
		},
		project: {
			export: (projectDir) => ipc.invoke("astravia:project:export", projectDir),
			import: () => ipc.invoke("astravia:project:import"),
			readMeta: (projectDir) => ipc.invoke("astravia:project:read-meta", projectDir),
		},
		permissions: {
			checkAll: () => ipc.invoke("astravia:permissions:check-all"),
			openPane: (kind) => ipc.invoke("astravia:permissions:open-pane", kind),
		},
	};
}
