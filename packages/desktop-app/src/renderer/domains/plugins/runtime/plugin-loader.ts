import {
	createInstance,
	type ModuleFederation,
	type ModuleFederationRuntimePlugin,
} from "@module-federation/enhanced/runtime";
import type { InstalledPlugin, PluginAgentToolRegistration } from "@preload/api";
import type { ActivityTabKey } from "@shared/lib/project-profile";
import {
	activeInputActionIdsAtom,
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	agentModeAtom,
	attachedPluginTabsAtom,
	filePreviewAtom,
	languageAtom,
	persistCurrentInputActionState,
	pluginAgentToolLabelsAtom,
	pluginInputActionsAtom,
	promptAttachmentAtom,
	type RegisteredAgentToolLabel,
	setActivityPanelWidthAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type {
	Disposable,
	PluginActivityTabContribution,
	PluginAgentToolHandler,
	PluginAppActionHandler,
	PluginAppActionReadyHandler,
	PluginArtifactsApi,
	PluginCaptureApi,
	PluginCardRendererContribution,
	PluginCommandApi,
	PluginCommandSpawnExit,
	PluginCommandSpawnHandle,
	PluginContext,
	PluginConversationApi,
	PluginDefinition,
	PluginFileExplorerContextMenuContribution,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerToolbarContribution,
	PluginFilePreviewContribution,
	PluginFsApi,
	PluginGatewayApi,
	PluginGlobalSlotContribution,
	PluginI18nApi,
	PluginImageRef,
	PluginInputActionContribution,
	PluginJob,
	PluginJobsApi,
	PluginLocales,
	PluginMediaApi,
	PluginNetworkApi,
	PluginNotifyOptions,
	PluginOpenActivityTabOptions,
	PluginPermission,
	PluginPromptAttachment,
	PluginSettingsApi,
	PluginShortcutScopeContribution,
	PluginStorageApi,
	PluginToolCallSlotContribution,
	PluginTurnCardContribution,
} from "@vetta-org/plugin-sdk";
import { resolveCatalogKey, resolvePluginText } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import type { ComponentType } from "react";
import { router } from "../../../router";
import { explicitTabVisibility, withPluginTabVisibility } from "./attached-tabs";
import { createPluginAiApi } from "./plugin-ai";
import {
	getPluginFileExplorerSelection,
	getPluginFileExplorerWorkspaceRoots,
	onPluginFileExplorerFilesChanged,
	onPluginFileExplorerSelectionChanged,
	refreshPluginFileExplorer,
	revealPluginFileExplorerPath,
} from "./plugin-file-explorer-host";
import {
	pluginHostBridge,
	registerPluginAgentToolHandler,
	registerPluginAppActionHandler,
	registerPluginContinuationHandler,
	registerPluginMediaProviderHandler,
	registerPluginSystemPromptHandler,
} from "./plugin-host-bridge";
import { createPluginOfficialApi } from "./plugin-official-api";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";
import { createPluginRuntimeShared } from "./plugin-shared-modules";
import {
	assertPluginShortcutScopeKind,
	normalizePluginShortcutBindings,
	registerPluginShortcutScopeOnHost,
} from "./plugin-shortcut-scope";
import { createQuickJsPluginDefinition } from "./quickjs-plugin-runtime";

export interface LoadedPlugin {
	id: string;
	name: string;
	version: string;
	/** Fallback locale for `%key%` resolution (ADR-0033). */
	defaultLocale: string;
	/** This plugin's catalogs, keyed by locale code. */
	locales: PluginLocales;
	slots: PluginGlobalSlotContribution[];
	filePreviews: PluginFilePreviewContribution[];
	fileExplorerContextMenuActions: PluginFileExplorerContextMenuContribution[];
	fileExplorerToolbarActions: PluginFileExplorerToolbarContribution[];
	fileExplorerDecorationProviders: PluginFileExplorerDecorationProvider[];
	activityTabs: PluginActivityTabContribution[];
	inputActions: PluginInputActionContribution[];
	cardRenderers: PluginCardRendererContribution[];
	toolCallSlots: PluginToolCallSlotContribution[];
	turnCards: PluginTurnCardContribution[];
	dispose(): Promise<void>;
}

/**
 * Mirror `registerTool({ label })` into the chat display table.
 * First registration wins on tool-name collision; only the owning plugin can clear.
 */
function setAgentToolLabel(pluginId: string, toolName: string, label: string | null): void {
	getDefaultStore().set(pluginAgentToolLabelsAtom, (prev) => {
		const existing = prev[toolName];
		if (label == null) {
			if (!existing || existing.pluginId !== pluginId) return prev;
			const next = { ...prev };
			delete next[toolName];
			return next;
		}
		if (existing && existing.pluginId !== pluginId) return prev;
		if (existing?.label === label) return prev;
		const entry: RegisteredAgentToolLabel = { pluginId, toolName, label };
		return { ...prev, [toolName]: entry };
	});
}

/** Drop all tool labels owned by a plugin (unload / failed activate). */
function clearAgentToolLabelsForPlugin(pluginId: string): void {
	getDefaultStore().set(pluginAgentToolLabelsAtom, (prev) => {
		let changed = false;
		const next: Record<string, RegisteredAgentToolLabel> = {};
		for (const [name, entry] of Object.entries(prev)) {
			if (entry.pluginId === pluginId) {
				changed = true;
				continue;
			}
			next[name] = entry;
		}
		return changed ? next : prev;
	});
}

/**
 * 记下插件对某个 tab 的显式显隐态（上栏/下栏），不激活、不展开面板。插件据此
 * 实现自己的出现条件（git 只在仓库里上栏、工作台跟随输入栏 toggle）。返回写入
 * 是否落地——无活动会话 cwd 时无处可记。
 */
function setPluginActivityTabVisible(pluginId: string, tabId: string, visible: boolean): boolean {
	const store = getDefaultStore();
	const cwd = store.get(activeSessionAtom)?.cwd ?? null;
	if (!cwd) return false;
	const next = withPluginTabVisibility(store.get(attachedPluginTabsAtom), cwd, `${pluginId}:${tabId}`, visible);
	if (next) store.set(attachedPluginTabsAtom, next);
	return true;
}

/**
 * Attach + activate a plugin's own activity tab and open the panel, driven
 * directly off the jotai store so it works regardless of whether the activity
 * panel component is currently mounted/expanded. Keyed by the active
 * conversation's cwd (same key the attach records use, see ADR-0026).
 */
function openPluginActivityTab(pluginId: string, tabId: string, width?: number | "max"): void {
	const store = getDefaultStore();
	const cwd = store.get(activeSessionAtom)?.cwd ?? null;
	if (!cwd) {
		console.warn("[plugin] openActivityTab: no active conversation cwd");
		return;
	}
	const key = `${pluginId}:${tabId}`;
	const alreadyAttached = explicitTabVisibility(store.get(attachedPluginTabsAtom).get(cwd) ?? [], key) === true;
	setPluginActivityTabVisible(pluginId, tabId, true);
	const active = new Map(store.get(activityPanelTabByProjectAtom));
	active.set(cwd, `plugin:${key}` as ActivityTabKey);
	store.set(activityPanelTabByProjectAtom, active);
	store.set(activityPanelOpenAtom, true);
	// width 只在首次 attach 时生效：插件 activate 里的 openActivityTab 会随
	// reload/热更新重放，不能每次都把用户手动拖出的面板宽度覆盖回初始值。
	if (width != null && !alreadyAttached) store.set(setActivityPanelWidthAtom, width);
}

interface PluginModule {
	default?: PluginDefinition;
	activate?: PluginDefinition["activate"];
	deactivate?: PluginDefinition["deactivate"];
}

let moduleFederationHost: ModuleFederation | undefined;
const registeredRemotes = new Map<string, { alias: string; entry: string }>();
/** remoteName → 当前 reload token（取自 manifest entryUrl 的 query，重载即变）。 */
const remoteReloadTokens = new Map<string, string>();
const pluginDevRuntimePromises = new Map<string, Promise<void>>();

interface PluginDevModuleGlobal {
	__VETTA_PLUGIN_DEV_MODULES__?: Map<string, unknown>;
}

async function ensurePluginDevRuntime(plugin: InstalledPlugin): Promise<void> {
	const origin = plugin.devWatch?.origin;
	if (!origin) return;
	let pending = pluginDevRuntimePromises.get(origin);
	if (!pending) {
		pending = import(/* @vite-ignore */ `${origin}/@vetta-plugin-dev-preamble`)
			.then(() => undefined)
			.catch((error: unknown) => {
				pluginDevRuntimePromises.delete(origin);
				throw error;
			});
		pluginDevRuntimePromises.set(origin, pending);
	}
	await pending;
}

function getLatestPluginDevModule(pluginId: string): unknown {
	return (globalThis as typeof globalThis & PluginDevModuleGlobal).__VETTA_PLUGIN_DEV_MODULES__?.get(pluginId);
}

function extractReloadToken(entryUrl: string): string | null {
	try {
		const params = new URL(entryUrl).searchParams;
		return params.get("reload") ?? params.get("v");
	} catch {
		return null;
	}
}

/**
 * remoteEntry.js 是 ESM 容器（manifest `type: "module"`），MF 用原生 `import()`
 * 加载——浏览器 ES module registry 按 URL 永久缓存，协议层 no-store 与 MF 的
 * force/removeRemote 都清不掉它。manifest 上的 reload token 经相对解析不会带到
 * remoteEntry URL 上，导致 reload/热更新永远拿回旧模块（只有换版本路径段的
 * 卸载重装才生效）。此插件在 afterResolve（snapshot 插件已把 remoteInfo.entry
 * 设为 remoteEntry.js URL 之后）把 token 追加到 entry query，使每轮重载的
 * import URL 唯一。async chunk 文件名含内容 hash，天然失效，无需处理。
 */
function createReloadBustPlugin(): ModuleFederationRuntimePlugin {
	return {
		name: "vetta-reload-bust",
		afterResolve(args) {
			const token = remoteReloadTokens.get(args.remoteInfo.name);
			if (token && args.remoteInfo.entry && !args.remoteInfo.entry.includes("reloadBust=")) {
				const sep = args.remoteInfo.entry.includes("?") ? "&" : "?";
				args.remoteInfo.entry = `${args.remoteInfo.entry}${sep}reloadBust=${encodeURIComponent(token)}`;
			}
			return args;
		},
	};
}

function getModuleFederationHost(): ModuleFederation {
	moduleFederationHost ??= createInstance({
		name: "vetta_plugin_host",
		remotes: [],
		shared: createPluginRuntimeShared(),
		shareStrategy: "loaded-first",
		plugins: [createReloadBustPlugin()],
	});
	return moduleFederationHost;
}

function assertPluginModule(value: unknown): PluginModule {
	if (value == null || typeof value !== "object") {
		throw new Error("Plugin module must export a plugin definition");
	}
	return value as PluginModule;
}

function normalizePluginDefinition(module: PluginModule): PluginDefinition {
	if (module.default) return module.default;
	if (module.activate) {
		return {
			activate: module.activate,
			deactivate: module.deactivate,
		};
	}
	throw new Error("Plugin module must export default definePlugin(...) or activate()");
}

function hasPermission(plugin: InstalledPlugin, permission: PluginPermission): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}

function createPermissionApi(plugin: InstalledPlugin): PluginContext["permissions"] {
	return {
		has: (permission) => hasPermission(plugin, permission),
		require: (permission) => {
			if (!hasPermission(plugin, permission)) {
				throw new Error(`Plugin permission denied: ${permission}`);
			}
		},
	};
}

const noopDisposable: Disposable = { dispose: () => {} };

function debugPluginAgent(message: string, data?: Record<string, unknown>): void {
	console.info(`[plugin-agent] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
}

function warnSkippedContribution(plugin: InstalledPlugin, permission: PluginPermission, contribution: string): void {
	console.warn(`Plugin ${plugin.id} skipped ${contribution}: missing permission ${permission}`);
}

function loadPluginStyles(plugin: InstalledPlugin): Disposable {
	const pluginLayer = `vetta-plugins.${CSS.escape(plugin.id)}`;
	const styles = plugin.styleUrls.map((href) => {
		const style = document.createElement("style");
		style.dataset.vettaPluginId = plugin.id;
		style.textContent = `@import ${JSON.stringify(href)} layer(${pluginLayer});`;
		document.head.append(style);
		return style;
	});
	return {
		dispose: () => {
			for (const style of styles) style.remove();
		},
	};
}

function createConversationApi(plugin: InstalledPlugin): PluginConversationApi {
	const permissions = createPermissionApi(plugin);
	return {
		sendPrompt: async (text) => {
			permissions.require("agent.session.write");
			await pluginHostBridge.conversation.sendPrompt(text);
		},
		insertText: (text) => {
			permissions.require("agent.session.write");
			pluginHostBridge.conversation.insertText(text);
		},
		abort: async () => {
			permissions.require("agent.session.write");
			await pluginHostBridge.conversation.abort();
		},
		on: (listener) => {
			permissions.require("agent.session.read");
			return pluginHostBridge.conversation.on(listener);
		},
	};
}

function createFsApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginFsApi {
	const permissions = createPermissionApi(plugin);
	const filesystem = window.vetta.plugins.internalCapabilities.filesystem;
	return {
		readDir: (dirPath) => {
			permissions.require("fs.read");
			return filesystem.readDirectory(capabilitySessionId, dirPath);
		},
		readFile: (filePath) => {
			permissions.require("fs.read");
			return filesystem.readFile(capabilitySessionId, filePath);
		},
		readBinaryFile: (filePath) => {
			permissions.require("fs.read");
			return filesystem.readBinaryFile(capabilitySessionId, filePath);
		},
		writeFile: (filePath, content, encoding) => {
			permissions.require("fs.write");
			return filesystem.writeFile(capabilitySessionId, filePath, content, encoding);
		},
		stat: (filePath) => {
			permissions.require("fs.read");
			return filesystem.stat(capabilitySessionId, filePath);
		},
		rename: (oldPath, newPath) => {
			permissions.require("fs.write");
			return filesystem.rename(capabilitySessionId, oldPath, newPath);
		},
		delete: (targetPath) => {
			permissions.require("fs.write");
			return filesystem.delete(capabilitySessionId, targetPath);
		},
		move: (sourcePath, destDir) => {
			permissions.require("fs.write");
			return filesystem.move(capabilitySessionId, sourcePath, destDir);
		},
		createDirectory: (dirPath) => {
			permissions.require("fs.write");
			return filesystem.createDirectory(capabilitySessionId, dirPath);
		},
		listFilesRecursive: (rootPath) => {
			permissions.require("fs.read");
			return filesystem.listFilesRecursive(capabilitySessionId, rootPath);
		},
		saveAs: (defaultFileName, content, encoding, options) => {
			permissions.require("fs.write");
			return window.vetta.dialog.saveData(defaultFileName, content, encoding, options);
		},
		watchDirectory: (dirPath, listener) => {
			permissions.require("fs.read");
			const unsubscribe = window.vetta.fs.onDirChanged(listener);
			void window.vetta.fs.watchDir(dirPath).catch((error: unknown) => {
				unsubscribe();
				console.error(`Plugin ${plugin.id} failed to watch directory ${dirPath}`, error);
			});
			return {
				dispose: () => {
					unsubscribe();
					void window.vetta.fs.unwatchDir(dirPath);
				},
			};
		},
	};
}

function createSettingsApi(
	plugin: InstalledPlugin,
	initial: Record<string, unknown>,
	disposers: Array<() => void>,
): PluginSettingsApi {
	let values = initial;
	const listeners = new Set<(values: Record<string, unknown>) => void>();
	const unsub = window.vetta.plugins.onSettingsChanged((payload) => {
		if (payload.pluginId !== plugin.id) return;
		values = payload.values;
		for (const listener of listeners) listener(values);
	});
	disposers.push(() => {
		unsub();
		listeners.clear();
	});
	return {
		get<T = unknown>(key: string): T | undefined {
			return values[key] as T | undefined;
		},
		getAll(): Record<string, unknown> {
			return { ...values };
		},
		onChange(listener: (values: Record<string, unknown>) => void): Disposable {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
	};
}

function createNetworkApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginNetworkApi {
	return {
		request: (request) => {
			createPermissionApi(plugin).require("network.fetch");
			return window.vetta.plugins.networkRequest(capabilitySessionId, request);
		},
	};
}

function createMediaApi(
	plugin: InstalledPlugin,
	capabilitySessionId: string,
	activationId: string,
	disposers: Array<() => void>,
	pendingRuntimeRegistrations: Promise<void>[],
): PluginMediaApi {
	const permissions = createPermissionApi(plugin);
	const media = window.vetta.plugins.internalCapabilities.media;
	return {
		registerProvider: (registration) => {
			permissions.require("media.provider.register");
			if (typeof registration.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(registration.id)) {
				throw new Error("Media provider id must be 1-64 lowercase characters, numbers, dot, underscore, or dash");
			}
			if (!Array.isArray(registration.capabilities) || registration.capabilities.length === 0) {
				throw new Error("Media provider capabilities are required");
			}
			if (typeof registration.submit !== "function") throw new Error("Media provider submit handler is required");
			const handlerId = `${registration.id}:${crypto.randomUUID()}`;
			const handlerHandle = registerPluginMediaProviderHandler({
				pluginId: plugin.id,
				handlerId,
				registration,
			});
			const registrationPromise = window.vetta.plugins
				.registerMediaProvider(plugin.id, {
					id: registration.id,
					displayName: registration.displayName?.trim() || undefined,
					capabilities: registration.capabilities,
					handlerId,
					activationId,
					hasGetJob: typeof registration.getJob === "function",
					hasCancelJob: typeof registration.cancelJob === "function",
				})
				.catch((error: Error) => {
					handlerHandle.dispose();
					throw error;
				});
			pendingRuntimeRegistrations.push(registrationPromise);
			let disposed = false;
			const dispose = (): void => {
				if (disposed) return;
				disposed = true;
				handlerHandle.dispose();
				void window.vetta.plugins.unregisterMediaProvider(plugin.id, registration.id, activationId);
			};
			disposers.push(dispose);
			return { dispose };
		},
		listProviders: () => {
			permissions.require("media.generate");
			return media.listProviders(capabilitySessionId);
		},
		onProvidersChanged: (listener) => {
			permissions.require("media.generate");
			const unsubscribe = window.vetta.plugins.onMediaProvidersChanged(listener);
			return { dispose: unsubscribe };
		},
		submit: (request) => {
			permissions.require("media.generate");
			return media.submit(capabilitySessionId, toJsonValue(request) as Parameters<typeof media.submit>[1]);
		},
	};
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

function waitForPoll(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortError(signal));
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			window.clearTimeout(timeout);
			reject(signal ? abortError(signal) : new DOMException("The operation was aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function createJobsApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginJobsApi {
	const permissions = createPermissionApi(plugin);
	const jobs = window.vetta.plugins.internalCapabilities.jobs;
	const idOf = (job: string | { id: string }): string => (typeof job === "string" ? job : job.id);
	return {
		get: (job) => {
			permissions.require("media.generate");
			return jobs.get(capabilitySessionId, idOf(job));
		},
		cancel: (job) => {
			permissions.require("media.generate");
			return jobs.cancel(capabilitySessionId, idOf(job));
		},
		wait: async <TJob extends PluginJob>(
			job: TJob | { id: string } | string,
			options?: Parameters<PluginJobsApi["wait"]>[1],
		) => {
			permissions.require("media.generate");
			const id = idOf(job);
			let current =
				typeof job === "object" && "status" in job ? job : ((await jobs.get(capabilitySessionId, id)) as TJob);
			const terminal = new Set(["succeeded", "failed", "cancelled"]);
			while (!terminal.has(current.status)) {
				await waitForPoll(options?.pollIntervalMs ?? 500, options?.signal);
				current = (await jobs.get(capabilitySessionId, id)) as TJob;
			}
			return current;
		},
	};
}

function createArtifactsApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginArtifactsApi {
	const permissions = createPermissionApi(plugin);
	const artifacts = window.vetta.plugins.internalCapabilities.artifacts;
	return {
		persist: async (artifact, destination) => {
			permissions.require("media.generate");
			const persisted = await artifacts.persist(capabilitySessionId, {
				artifactId: typeof artifact === "string" ? artifact : artifact.id,
				destination,
			});
			return persisted.type === "storage-blob"
				? { ...persisted, type: "plugin-blob", blobId: persisted.id }
				: { ...persisted, type: "workspace-file" };
		},
		release: (artifact) => {
			permissions.require("media.generate");
			return artifacts.release(capabilitySessionId, typeof artifact === "string" ? artifact : artifact.id);
		},
	};
}

/**
 * 网关调用不挂可声明权限，只按来源收口：`ctx.gateway` 仅对随包分发的 official
 * 插件挂载，第三方插件读到 undefined（ADR-0056）。主进程的 capability 适配层
 * 会再校验一次 session 的 official 属性，这里只是不把入口暴露出去。
 */
function createGatewayApi(capabilitySessionId: string): PluginGatewayApi {
	return {
		// 同样按 JSON 归一化：请求体也要过 capability 的 CapabilityJsonValue 校验，
		// body 里带一个 undefined 字段就会让整次调用被拒（见 toJsonValue）。
		request: (request) =>
			window.vetta.plugins.gatewayRequest(capabilitySessionId, toJsonValue(request) as typeof request),
	};
}

/**
 * 按 JSON 语义归一化再过 IPC。
 *
 * capability 的 CapabilityJsonValue 不接受 undefined，而 Electron 的 structured
 * clone 会原样保留值为 undefined 的键——插件写一个带可选字段的普通对象
 * （`{ parent: undefined }`）就会被 capability 层判为非法输入而整体拒绝。
 * writeJson 的契约本就是「写 JSON」，这里按 JSON.stringify 的语义丢弃 undefined，
 * 与插件作者的预期一致。
 */
function toJsonValue(value: unknown): unknown {
	if (value === undefined) return null;
	return JSON.parse(JSON.stringify(value));
}

function createStorageApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginStorageApi {
	const requireRead = (): void => createPermissionApi(plugin).require("storage.read");
	const requireWrite = (): void => createPermissionApi(plugin).require("storage.write");
	return {
		readJson: (key) => {
			requireRead();
			return window.vetta.plugins.storageReadJson(capabilitySessionId, key);
		},
		writeJson: (key, value) => {
			requireWrite();
			return window.vetta.plugins.storageWriteJson(capabilitySessionId, key, toJsonValue(value));
		},
		list: (prefix) => {
			requireRead();
			return window.vetta.plugins.storageList(capabilitySessionId, prefix);
		},
		readFile: (path) => {
			requireRead();
			return window.vetta.plugins.storageReadFile(capabilitySessionId, path);
		},
		writeFile: (path, data) => {
			requireWrite();
			return window.vetta.plugins.storageWriteFile(capabilitySessionId, path, data);
		},
		putBlob: (input) => {
			requireWrite();
			return window.vetta.plugins.storagePutBlob(capabilitySessionId, input);
		},
		putBlobFromFile: (input) => {
			requireWrite();
			return window.vetta.plugins.storagePutBlobFromFile(capabilitySessionId, input);
		},
		readBlob: (id) => {
			requireRead();
			return window.vetta.plugins.storageReadBlob(capabilitySessionId, id);
		},
		getBlobRef: (id) => {
			requireRead();
			return window.vetta.plugins.storageGetBlobRef(capabilitySessionId, id);
		},
	};
}

function createI18nApi(plugin: InstalledPlugin): PluginI18nApi {
	const store = getDefaultStore();
	return {
		get locale(): string {
			return store.get(languageAtom);
		},
		t: (key, params) => resolveCatalogKey(key, plugin.locales, store.get(languageAtom), plugin.defaultLocale, params),
		onChange: (listener) => {
			const unsub = store.sub(languageAtom, () => listener(store.get(languageAtom)));
			return { dispose: unsub };
		},
	};
}

/**
 * Resolve a host-rendered plugin string against that plugin's own catalogs.
 * Manifest fields such as `name` carry `%key%` placeholders; literals pass
 * through untouched.
 */
function resolvePluginDisplayText(plugin: InstalledPlugin, raw: string): string {
	return resolvePluginText(
		raw,
		plugin.locales ?? {},
		getDefaultStore().get(languageAtom),
		plugin.defaultLocale ?? "zh",
	);
}

/** Format a plugin error for clipboard + console (plugin id/version + stack). */
function formatPluginErrorDetail(plugin: InstalledPlugin, error: unknown): string {
	const header = `Plugin: ${plugin.id}@${plugin.activeVersion} (${resolvePluginDisplayText(plugin, plugin.name)})`;
	if (error instanceof Error) {
		const stack = error.stack?.trim() || `${error.name}: ${error.message}`;
		return `${header}\n${stack}`;
	}
	if (typeof error === "string" && error.trim()) {
		return `${header}\n${error.trim()}`;
	}
	try {
		return `${header}\n${JSON.stringify(error, null, 2)}`;
	} catch {
		return `${header}\n${String(error)}`;
	}
}

async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through
	}
	try {
		const el = document.createElement("textarea");
		el.value = text;
		el.setAttribute("readonly", "");
		el.style.position = "fixed";
		el.style.left = "-9999px";
		document.body.appendChild(el);
		el.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(el);
		return ok;
	} catch {
		return false;
	}
}

/** Per-spawn exit listeners, fed by a single lazy IPC subscription. */
const spawnExitListeners = new Map<string, Set<(exit: PluginCommandSpawnExit) => void>>();
let spawnExitSubscribed = false;

function ensureSpawnExitSubscription(): void {
	if (spawnExitSubscribed) return;
	spawnExitSubscribed = true;
	window.vetta.plugins.onCommandSpawnExit((event) => {
		const listeners = spawnExitListeners.get(event.spawnId);
		if (!listeners) return;
		spawnExitListeners.delete(event.spawnId);
		for (const listener of listeners) {
			try {
				listener({ exitCode: event.exitCode, signal: event.signal });
			} catch (error) {
				console.error("plugin spawn exit listener failed", error);
			}
		}
	});
}

function createCommandApi(
	plugin: InstalledPlugin,
	capabilitySessionId: string,
	disposers: Array<() => void>,
): PluginCommandApi {
	const permissions = createPermissionApi(plugin);
	const assertCommandAllowed = (file: unknown): string => {
		if (typeof file !== "string" || file.trim().length === 0) {
			throw new Error("Command file is required");
		}
		if (!plugin.declaredCommands.includes(file)) {
			throw new Error(`Plugin ${plugin.id} command not declared: ${file}`);
		}
		if (!plugin.grantedCommandNames.includes(file)) {
			// User disabled this command — intercept and notify (with a jump to settings).
			showToast({
				variant: "warning",
				title: "命令已禁用",
				message: `「${resolvePluginDisplayText(plugin, plugin.name)}」尝试执行 ${file}，但你已在插件设置里关闭它。`,
				action: {
					label: "前往设置",
					onClick: () => {
						void router.navigate({
							to: "/settings/$tab",
							params: { tab: "plugins" },
							search: { section: `plugin-${plugin.id}` },
						});
					},
				},
			});
			throw new Error(`Plugin ${plugin.id} command disabled by user: ${file}`);
		}
		return file;
	};
	return {
		run: (file, args, options) => {
			permissions.require("agent.command.run");
			const allowed = assertCommandAllowed(file);
			return window.vetta.plugins.runCommand(capabilitySessionId, allowed, args ?? [], options);
		},
		spawn: async (file, args, options): Promise<PluginCommandSpawnHandle> => {
			permissions.require("agent.command.spawn");
			const allowed = assertCommandAllowed(file);
			ensureSpawnExitSubscription();
			const result = await window.vetta.plugins.spawnCommand(capabilitySessionId, allowed, args ?? [], options);
			let stopped = false;
			const stop = async (): Promise<void> => {
				if (stopped) return;
				stopped = true;
				await window.vetta.plugins.stopCommandSpawn(capabilitySessionId, result.spawnId);
			};
			// 插件卸载/重载时统一回收（主进程在 reload/disable/uninstall 也会兜底清扫）。
			disposers.push(() => void stop());
			return {
				spawnId: result.spawnId,
				pid: result.pid,
				port: result.port,
				stop,
				status: () => window.vetta.plugins.getCommandSpawnStatus(capabilitySessionId, result.spawnId),
				onExit: (listener) => {
					const listeners = spawnExitListeners.get(result.spawnId) ?? new Set();
					listeners.add(listener);
					spawnExitListeners.set(result.spawnId, listeners);
					return {
						dispose: () => {
							spawnExitListeners.get(result.spawnId)?.delete(listener);
						},
					};
				},
			};
		},
	};
}

function createCaptureApi(plugin: InstalledPlugin, disposers: Array<() => void>): PluginCaptureApi {
	const permissions = createPermissionApi(plugin);
	// 记住用过的会话键：插件卸载/重载时把还开着的离屏窗口一并释放
	// （主进程在 reload/disable/uninstall 也会兜底清扫）。
	const sessionKeys = new Set<string>();
	disposers.push(() => {
		for (const key of sessionKeys) void window.vetta.plugins.offscreenRelease(plugin.id, key);
		sessionKeys.clear();
	});
	return {
		offscreen: (options) => {
			permissions.require("capture.offscreen");
			if (typeof options?.sessionKey === "string" && options.sessionKey.length > 0) {
				sessionKeys.add(options.sessionKey);
			}
			return window.vetta.plugins.offscreenCapture(plugin.id, options);
		},
		releaseOffscreen: (sessionKey) => {
			permissions.require("capture.offscreen");
			sessionKeys.delete(sessionKey);
			return window.vetta.plugins.offscreenRelease(plugin.id, sessionKey);
		},
	};
}

function createContext(
	plugin: InstalledPlugin,
	slots: PluginGlobalSlotContribution[],
	filePreviews: PluginFilePreviewContribution[],
	fileExplorerContextMenuActions: PluginFileExplorerContextMenuContribution[],
	fileExplorerToolbarActions: PluginFileExplorerToolbarContribution[],
	fileExplorerDecorationProviders: PluginFileExplorerDecorationProvider[],
	activityTabs: PluginActivityTabContribution[],
	inputActions: PluginInputActionContribution[],
	cardRenderers: PluginCardRendererContribution[],
	toolCallSlots: PluginToolCallSlotContribution[],
	turnCards: PluginTurnCardContribution[],
	settingsApi: PluginSettingsApi,
	onChanged: () => void,
	disposers: Array<() => void>,
	pendingRuntimeRegistrations: Promise<void>[],
	activationId: string,
	capabilitySessionId: string,
): PluginContext {
	/**
	 * 已注册的 agent 工具负载，按 toolName 索引。用于「工具先注册、自渲染槽后注册」时回补
	 * `rendersCard`——同一次激活内两者顺序不固定，靠重推让状态收敛（主进程按 tool.id 覆盖，幂等）。
	 */
	const registeredAgentTools = new Map<string, PluginAgentToolRegistration>();
	const hasToolCallSlot = (toolName: string): boolean => toolCallSlots.some((slot) => slot.toolName === toolName);
	const pushAgentToolRegistration = (payload: PluginAgentToolRegistration): Promise<void> =>
		window.vetta.plugins
			.registerAgentTool(plugin.id, payload)
			.then(() => undefined)
			.catch((error: Error) => {
				console.error(`Plugin ${plugin.id} failed to register agent tool ${payload.id}`, error);
			});

	const registerGlobalSlot = (contribution: PluginGlobalSlotContribution): Disposable => {
		if (!hasPermission(plugin, "ui.slot.global")) {
			warnSkippedContribution(plugin, "ui.slot.global", "global slot");
			return noopDisposable;
		}
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Global slot id is required");
		}
		const component = contribution.component as ComponentType;
		if (typeof component !== "function" && typeof component !== "object") {
			throw new Error("Global slot component is invalid");
		}
		const normalized = {
			id: `${plugin.id}:${contribution.id}`,
			component,
		};
		slots.push(normalized);
		onChanged();
		const disposable = {
			dispose: () => {
				const index = slots.findIndex((slot) => slot.id === normalized.id);
				if (index >= 0) slots.splice(index, 1);
				onChanged();
			},
		};
		return disposable;
	};
	const registerFilePreview = (contribution: PluginFilePreviewContribution): Disposable => {
		if (!hasPermission(plugin, "ui.slot.file-preview")) {
			warnSkippedContribution(plugin, "ui.slot.file-preview", "file preview");
			return noopDisposable;
		}
		const extensions = Array.isArray(contribution.extensions)
			? contribution.extensions.map((ext) => ext.trim().toLowerCase()).filter(Boolean)
			: [];
		if (extensions.length === 0) {
			throw new Error("File preview must declare at least one extension");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("File preview component is invalid");
		}
		const normalized: PluginFilePreviewContribution = { extensions, component: contribution.component };
		filePreviews.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = filePreviews.indexOf(normalized);
				if (index >= 0) filePreviews.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerFileExplorerContextMenuAction = (
		contribution: PluginFileExplorerContextMenuContribution,
	): Disposable => {
		createPermissionApi(plugin).require("ui.file-explorer.context-menu");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("File explorer context-menu action id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("File explorer context-menu action label is required");
		}
		if (typeof contribution.run !== "function") {
			throw new Error("File explorer context-menu action handler is required");
		}
		const normalized: PluginFileExplorerContextMenuContribution = {
			...contribution,
			id: `${plugin.id}:${contribution.id.trim()}`,
			label: contribution.label.trim(),
		};
		fileExplorerContextMenuActions.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = fileExplorerContextMenuActions.indexOf(normalized);
				if (index >= 0) fileExplorerContextMenuActions.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerFileExplorerToolbarAction = (contribution: PluginFileExplorerToolbarContribution): Disposable => {
		createPermissionApi(plugin).require("ui.file-explorer.toolbar");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("File explorer toolbar action id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("File explorer toolbar action label is required");
		}
		if (typeof contribution.run !== "function") {
			throw new Error("File explorer toolbar action handler is required");
		}
		const normalized: PluginFileExplorerToolbarContribution = {
			...contribution,
			id: `${plugin.id}:${contribution.id.trim()}`,
			label: contribution.label.trim(),
		};
		fileExplorerToolbarActions.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = fileExplorerToolbarActions.indexOf(normalized);
				if (index >= 0) fileExplorerToolbarActions.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerFileExplorerDecorationProvider = (contribution: PluginFileExplorerDecorationProvider): Disposable => {
		createPermissionApi(plugin).require("ui.file-explorer.decorations");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("File explorer decoration provider id is required");
		}
		if (typeof contribution.provideDecoration !== "function") {
			throw new Error("File explorer decoration provider is required");
		}
		const normalized: PluginFileExplorerDecorationProvider = {
			...contribution,
			id: `${plugin.id}:${contribution.id.trim()}`,
		};
		fileExplorerDecorationProviders.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = fileExplorerDecorationProviders.indexOf(normalized);
				if (index >= 0) fileExplorerDecorationProviders.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerActivityTab = (contribution: PluginActivityTabContribution): Disposable => {
		if (!hasPermission(plugin, "ui.slot.activity-tab")) {
			warnSkippedContribution(plugin, "ui.slot.activity-tab", "activity tab");
			return noopDisposable;
		}
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Activity tab id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("Activity tab label is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Activity tab component is invalid");
		}
		const normalized: PluginActivityTabContribution = {
			id: contribution.id,
			label: contribution.label,
			icon: contribution.icon,
			component: contribution.component,
			scope_use: contribution.scope_use,
			initiallyVisible: contribution.initiallyVisible,
		};
		activityTabs.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = activityTabs.indexOf(normalized);
				if (index >= 0) activityTabs.splice(index, 1);
				onChanged();
			},
		};
	};
	const fs = createFsApi(plugin, capabilitySessionId);
	const conversation = createConversationApi(plugin);
	const registerInputAction = (contribution: PluginInputActionContribution): Disposable => {
		createPermissionApi(plugin).require("ui.slot.input-action");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Input action id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("Input action label is required");
		}
		const userOnToggle = contribution.onToggle;
		const hardIsolation = contribution.hardIsolation === true;
		const namespacedId = `${plugin.id}:${contribution.id}`;
		if (hardIsolation) {
			// Register mode gate immediately so agent contributions stay stripped until toggle on (ADR-0041).
			void window.vetta.plugins.registerModeGate(plugin.id);
			// 会话恢复可能早于插件加载：若工作集已含本 action，立刻放行 contribution。
			if (getDefaultStore().get(activeInputActionIdsAtom).has(namespacedId)) {
				void window.vetta.plugins.setContributionMode(plugin.id, true);
			}
		}
		const normalized: PluginInputActionContribution = {
			id: namespacedId,
			label: contribution.label,
			icon: contribution.icon,
			defaultActive: contribution.defaultActive,
			requiresActiveTool: contribution.requiresActiveTool,
			scope_use: contribution.scope_use,
			hardIsolation,
			onToggle: (active) => {
				const veto = userOnToggle?.(active);
				if (veto === false) return false;
				if (hardIsolation) {
					void window.vetta.plugins.setContributionMode(plugin.id, active);
				}
			},
			decoratePrompt: contribution.decoratePrompt,
		};
		inputActions.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = inputActions.findIndex((action) => action.id === normalized.id);
				if (index >= 0) inputActions.splice(index, 1);
				if (hardIsolation) {
					void window.vetta.plugins.setContributionMode(plugin.id, false);
				}
				onChanged();
			},
		};
	};
	const registerCardRenderer = (contribution: PluginCardRendererContribution): Disposable => {
		createPermissionApi(plugin).require("ui.slot.message");
		if (typeof contribution.type !== "string" || contribution.type.trim().length === 0) {
			throw new Error("Card renderer type is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Card renderer component is invalid");
		}
		// The `type` is the plugin-owned, globally-unique key both the renderer and
		// the descriptor (from a tool's details.cards) agree on — NOT namespaced by
		// the host, unlike slot ids. The plugin is responsible for uniqueness.
		const normalized: PluginCardRendererContribution = {
			type: contribution.type,
			component: contribution.component,
			title: contribution.title,
			icon: contribution.icon,
			pendingFor: contribution.pendingFor,
		};
		cardRenderers.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = cardRenderers.findIndex((renderer) => renderer.type === normalized.type);
				if (index >= 0) cardRenderers.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerToolCallSlot = (contribution: PluginToolCallSlotContribution): Disposable => {
		createPermissionApi(plugin).require("ui.slot.tool-call");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Tool-call slot id is required");
		}
		if (typeof contribution.toolName !== "string" || contribution.toolName.trim().length === 0) {
			throw new Error("Tool-call slot toolName is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Tool-call slot component is invalid");
		}
		const normalized: PluginToolCallSlotContribution = {
			id: `${plugin.id}:${contribution.id}`,
			toolName: contribution.toolName.trim(),
			component: contribution.component,
		};
		toolCallSlots.push(normalized);
		// 工具可能先于槽注册；此时回补 rendersCard 并重推，否则 md_intro 参数会时有时无。
		const registered = registeredAgentTools.get(normalized.toolName);
		if (registered && registered.rendersCard !== true) {
			registered.rendersCard = true;
			pendingRuntimeRegistrations.push(pushAgentToolRegistration(registered));
		}
		onChanged();
		return {
			dispose: () => {
				const index = toolCallSlots.findIndex((slot) => slot.id === normalized.id);
				if (index >= 0) toolCallSlots.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerTurnCard = (contribution: PluginTurnCardContribution): Disposable => {
		createPermissionApi(plugin).require("ui.slot.turn-card");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Turn card id is required");
		}
		if (typeof contribution.component !== "function" && typeof contribution.component !== "object") {
			throw new Error("Turn card component is invalid");
		}
		const normalized: PluginTurnCardContribution = {
			id: `${plugin.id}:${contribution.id}`,
			component: contribution.component,
			scope_use: contribution.scope_use,
		};
		turnCards.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = turnCards.findIndex((card) => card.id === normalized.id);
				if (index >= 0) turnCards.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerShortcutScope = (contribution: PluginShortcutScopeContribution): Disposable => {
		createPermissionApi(plugin).require("ui.shortcuts.register");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("Shortcut scope id is required");
		}
		const kind = assertPluginShortcutScopeKind(contribution.kind);
		const bindingsSource = contribution.bindings;
		const resolveBindings = () => {
			const raw = typeof bindingsSource === "function" ? bindingsSource() : bindingsSource;
			return normalizePluginShortcutBindings(raw);
		};
		const dispose = registerPluginShortcutScopeOnHost({
			scopeId: `${plugin.id}:${contribution.id.trim()}`,
			kind,
			exclusive: contribution.exclusive === true,
			enabled: typeof contribution.enabled === "function" ? contribution.enabled : undefined,
			getBindings: resolveBindings,
		}).dispose;
		disposers.push(dispose);
		return { dispose };
	};
	const openActivityTab = (tabId: string, options?: PluginOpenActivityTabOptions): void => {
		createPermissionApi(plugin).require("ui.slot.activity-tab");
		if (typeof tabId !== "string" || tabId.trim().length === 0) {
			throw new Error("Activity tab id is required");
		}
		openPluginActivityTab(plugin.id, tabId, options?.width);
	};
	const setActivityTabVisible = (tabId: string, visible: boolean): void => {
		createPermissionApi(plugin).require("ui.slot.activity-tab");
		if (typeof tabId !== "string" || tabId.trim().length === 0) {
			throw new Error("Activity tab id is required");
		}
		setPluginActivityTabVisible(plugin.id, tabId, visible === true);
	};
	const setActivityPanelWidth = (width: number | "max"): void => {
		createPermissionApi(plugin).require("ui.slot.activity-tab");
		if (width !== "max" && !Number.isFinite(width)) {
			throw new Error('Activity panel width must be a finite number or "max"');
		}
		getDefaultStore().set(setActivityPanelWidthAtom, width);
	};
	const setPromptAttachment = (attachment: PluginPromptAttachment | null): void => {
		createPermissionApi(plugin).require("ui.slot.input-action");
		const store = getDefaultStore();
		if (attachment === null) {
			if (store.get(promptAttachmentAtom)?.ownerPluginId === plugin.id) {
				store.set(promptAttachmentAtom, null);
			}
			return;
		}
		if (!attachment.id.trim() || !attachment.label.trim()) {
			throw new Error("Prompt attachment id and label are required");
		}
		store.set(promptAttachmentAtom, { ...attachment, ownerPluginId: plugin.id });
		// An attachment activates this plugin's input action so its hidden prompt
		// instructions are contributed to the next turn.
		const myActionIds = store
			.get(pluginInputActionsAtom)
			.filter((action) => action.pluginId === plugin.id)
			.map((action) => action.actionId);
		if (myActionIds.length > 0) {
			store.set(activeInputActionIdsAtom, (prev) => {
				const next = new Set(prev);
				for (const id of myActionIds) next.add(id);
				return next;
			});
			persistCurrentInputActionState(store.get(activeSessionAtom)?.sessionPath);
		}
	};
	const previewImage = (ref: PluginImageRef, group?: PluginImageRef[]): void => {
		createPermissionApi(plugin).require("ui.slot.message");
		const toItem = (r: PluginImageRef) => {
			const ext = (r.mimeType ?? "image/png").split("/")[1] ?? "png";
			return { name: `${r.id}.${ext}`, url: r.url, kind: "image" as const, mime: r.mimeType };
		};
		// 提供图片组（且多于一张）时以图片组形态打开，起始定位到 ref；否则单图
		const images = (group ?? []).filter((r) => r.url);
		if (images.length > 1) {
			const index = Math.max(
				0,
				images.findIndex((r) => r.id === ref.id),
			);
			getDefaultStore().set(filePreviewAtom, { items: images.map(toItem), index });
		} else {
			getDefaultStore().set(filePreviewAtom, toItem(ref));
		}
	};
	const openPluginSettings = (): void => {
		// Host owns navigation; jump to the settings tab + this plugin's section
		// (existing `?section=plugin-<id>` deep-link scrolls + highlights it).
		void router.navigate({
			to: "/settings/$tab",
			params: { tab: "plugins" },
			search: { section: `plugin-${plugin.id}` },
		});
	};
	const captureRegion: PluginContext["ui"]["captureRegion"] = (rect, defaultFileName) => {
		createPermissionApi(plugin).require("ui.slot.activity-tab");
		if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
			throw new Error("captureRegion() requires a finite rectangle with positive dimensions");
		}
		if (defaultFileName.trim().length === 0) {
			throw new Error("captureRegion() default file name is required");
		}
		return window.vetta.window.captureRegion(rect, defaultFileName);
	};
	const copyImage: PluginContext["ui"]["copyImage"] = (dataUrl) => {
		if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
			throw new Error("copyImage() requires a data:image/... URL");
		}
		return window.vetta.clipboard.writeImage(dataUrl);
	};
	const openExternal: PluginContext["ui"]["openExternal"] = async (url) => {
		createPermissionApi(plugin).require("shell.openExternal");
		// 主进程还会再挡一次协议，这里先挡是为了给插件一条能读懂的错误——而不是
		// 让它拿到一个来自 IPC 深处的 "Unsupported external URL protocol"。
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error(`openExternal() requires an absolute URL, got: ${String(url)}`);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error(`openExternal() only accepts http/https URLs, got: ${parsed.protocol}`);
		}
		await window.vetta.shell.openExternal(parsed.toString());
	};
	const notify = (options: PluginNotifyOptions): void => {
		if (options == null || typeof options !== "object" || typeof options.message !== "string") {
			throw new Error("notify() requires { message: string }");
		}
		const message = options.message.trim();
		if (message.length === 0) {
			throw new Error("notify() message must be non-empty");
		}
		const hasError = options.error !== undefined;
		const variant = options.variant ?? (hasError ? "error" : "info");
		// 清单里的 name 通常是 `%plugin.name%` 这种 catalog 键，直接塞进 toast 会原样显示。
		const title = resolvePluginDisplayText(plugin, options.title?.trim() || plugin.name);
		const detail = hasError ? formatPluginErrorDetail(plugin, options.error) : null;
		const durationMs = options.durationMs ?? (hasError ? 0 : undefined);
		showToast({
			variant,
			title,
			message,
			durationMs,
			action: detail
				? {
						label: "复制堆栈",
						onClick: () => {
							void copyTextToClipboard(detail).then((ok) => {
								showToast({
									variant: ok ? "success" : "warning",
									message: ok ? "错误堆栈已复制到剪贴板" : "复制失败，请手动从控制台复制",
									durationMs: 2500,
								});
							});
						},
					}
				: undefined,
		});
		if (detail) {
			console.error(`[plugin:${plugin.id}] ${message}\n${detail}`);
		}
	};
	const permissions = createPermissionApi(plugin);
	return {
		plugin: {
			id: plugin.id,
			version: plugin.activeVersion,
		},
		permissions,
		ui: {
			registerGlobalSlot,
			registerFilePreview,
			registerActivityTab,
			registerInputAction,
			registerCardRenderer,
			registerToolCallSlot,
			registerTurnCard,
			registerShortcutScope,
			openActivityTab,
			setActivityTabVisible,
			setActivityPanelWidth,
			setPromptAttachment,
			previewImage,
			openPluginSettings,
			captureRegion,
			copyImage,
			openExternal,
			notify,
		},
		fileExplorer: {
			getWorkspaceRoots: () => {
				createPermissionApi(plugin).require("workspace.read");
				return getPluginFileExplorerWorkspaceRoots();
			},
			getSelection: () => {
				createPermissionApi(plugin).require("workspace.read");
				return getPluginFileExplorerSelection();
			},
			reveal: (path, options) => {
				createPermissionApi(plugin).require("workspace.read");
				return revealPluginFileExplorerPath(path, options);
			},
			refresh: (path) => {
				createPermissionApi(plugin).require("workspace.read");
				return refreshPluginFileExplorer(path);
			},
			onDidChangeSelection: (listener) => {
				createPermissionApi(plugin).require("workspace.read");
				const handle = onPluginFileExplorerSelectionChanged(listener);
				disposers.push(() => handle.dispose());
				return handle;
			},
			onDidChangeFiles: (listener) => {
				createPermissionApi(plugin).require("workspace.read");
				const handle = onPluginFileExplorerFilesChanged(listener);
				disposers.push(() => handle.dispose());
				return handle;
			},
			registerContextMenuAction: registerFileExplorerContextMenuAction,
			registerToolbarAction: registerFileExplorerToolbarAction,
			registerDecorationProvider: registerFileExplorerDecorationProvider,
		},
		conversation,
		fs,
		command: createCommandApi(plugin, capabilitySessionId, disposers),
		media: createMediaApi(plugin, capabilitySessionId, activationId, disposers, pendingRuntimeRegistrations),
		jobs: createJobsApi(plugin, capabilitySessionId),
		artifacts: createArtifactsApi(plugin, capabilitySessionId),
		capture: createCaptureApi(plugin, disposers),
		agent: {
			registerTool: (registration) => {
				debugPluginAgent("renderer registerTool requested", {
					pluginId: plugin.id,
					toolId: typeof registration.id === "string" ? registration.id.trim() : "(invalid)",
					hasRegisterPermission: hasPermission(plugin, "agent.tools.register"),
					hasExecutePermission: hasPermission(plugin, "agent.toolHandler.execute"),
					activationId,
				});
				if (!hasPermission(plugin, "agent.tools.register")) {
					warnSkippedContribution(plugin, "agent.tools.register", "agent tool");
					return noopDisposable;
				}
				if (typeof registration.id !== "string" || registration.id.trim().length === 0) {
					throw new Error("Agent tool id is required");
				}
				if (typeof registration.description !== "string" || registration.description.trim().length === 0) {
					throw new Error("Agent tool description is required");
				}
				if (typeof registration.parameters !== "object" || registration.parameters === null) {
					throw new Error("Agent tool parameters must be a JSON schema object");
				}
				const toolId = registration.id.trim();
				const toolName = registration.name?.trim() || toolId;
				const handlerId = `${toolId}:${crypto.randomUUID()}`;
				const handlerHandle = registerPluginAgentToolHandler({
					pluginId: plugin.id,
					toolId,
					handlerId,
					handler: registration.handler as PluginAgentToolHandler,
					api: { fs, conversation },
				});
				const label =
					typeof registration.label === "string" && registration.label.trim().length > 0
						? registration.label.trim()
						: undefined;
				const payload: PluginAgentToolRegistration = {
					id: toolId,
					name: toolName,
					label,
					description: registration.description,
					parameters: registration.parameters as Record<string, unknown>,
					handlerId,
					activationId,
					timeoutMs: registration.timeoutMs,
					scope_use: registration.scope_use,
					requires: registration.requires,
					agent_mode: registration.agent_mode,
					context: registration.context,
					// 宿主自动检测：带自渲染槽的工具会被注入可选的 md_intro 参数（见 ADR-0047）。
					rendersCard: hasToolCallSlot(toolName) || undefined,
				};
				registeredAgentTools.set(toolName, payload);
				if (label) setAgentToolLabel(plugin.id, toolName, label);
				const registrationPromise = window.vetta.plugins
					.registerAgentTool(plugin.id, payload)
					.then(() => {
						debugPluginAgent("renderer registerTool completed", {
							pluginId: plugin.id,
							toolId,
							toolName,
							handlerId,
							activationId,
						});
					})
					.catch((error: Error) => {
						// Do not fail the whole plugin load — UI contributions
						// (activity tabs, slots) should still activate.
						handlerHandle.dispose();
						if (label) setAgentToolLabel(plugin.id, toolName, null);
						console.error(`Plugin ${plugin.id} failed to register agent tool ${toolId}`, error);
					});
				pendingRuntimeRegistrations.push(registrationPromise);
				return {
					dispose: () => {
						handlerHandle.dispose();
						registeredAgentTools.delete(toolName);
						if (label) setAgentToolLabel(plugin.id, toolName, null);
						void window.vetta.plugins.unregisterAgentTool(plugin.id, toolId, activationId);
					},
				};
			},
			registerContinuationProvider: (registration) => {
				createPermissionApi(plugin).require("agent.continuation.register");
				if (typeof registration.id !== "string" || registration.id.trim().length === 0) {
					throw new Error("Continuation provider id is required");
				}
				if (typeof registration.handler !== "function") {
					throw new Error("Continuation provider handler is required");
				}
				const providerId = registration.id.trim();
				const handlerId = `${providerId}:${crypto.randomUUID()}`;
				const handlerHandle = registerPluginContinuationHandler({
					pluginId: plugin.id,
					handlerId,
					handler: registration.handler,
					api: { fs, conversation },
				});
				const registrationPromise = window.vetta.plugins
					.registerContinuationProvider(plugin.id, {
						id: providerId,
						handlerId,
						activationId,
						timeoutMs: registration.timeoutMs,
						context: registration.context,
					})
					.catch((error: Error) => {
						handlerHandle.dispose();
						throw error;
					});
				pendingRuntimeRegistrations.push(registrationPromise);
				return {
					dispose: () => {
						handlerHandle.dispose();
						void window.vetta.plugins.unregisterContinuationProvider(plugin.id, providerId, activationId);
					},
				};
			},
			registerSystemPromptProvider: (registration) => {
				if (
					!hasPermission(plugin, "agent.systemPrompt.write") &&
					!hasPermission(plugin, "agent.systemPrompt.fullControl")
				) {
					throw new Error(`Plugin permission denied: agent.systemPrompt.write`);
				}
				if (typeof registration.id !== "string" || registration.id.trim().length === 0) {
					throw new Error("System prompt provider id is required");
				}
				if (typeof registration.handler !== "function") {
					throw new Error("System prompt provider handler is required");
				}
				const providerId = registration.id.trim();
				const handlerId = `${providerId}:${crypto.randomUUID()}`;
				const handlerHandle = registerPluginSystemPromptHandler({
					pluginId: plugin.id,
					handlerId,
					handler: registration.handler,
					api: { fs, conversation },
				});
				const registrationPromise = window.vetta.plugins
					.registerSystemPromptProvider(plugin.id, {
						id: providerId,
						handlerId,
						activationId,
						timeoutMs: registration.timeoutMs,
						context: registration.context,
					})
					.catch((error: Error) => {
						handlerHandle.dispose();
						throw error;
					});
				pendingRuntimeRegistrations.push(registrationPromise);
				return {
					dispose: () => {
						handlerHandle.dispose();
						void window.vetta.plugins.unregisterSystemPromptProvider(plugin.id, providerId, activationId);
					},
				};
			},
		},
		appActions: {
			register: (registration) => {
				if (!hasPermission(plugin, "app.actions.register")) {
					warnSkippedContribution(plugin, "app.actions.register", "app action");
					return noopDisposable;
				}
				if (!hasPermission(plugin, "app.actionHandler.execute")) {
					warnSkippedContribution(plugin, "app.actionHandler.execute", "app action handler");
					return noopDisposable;
				}
				if (typeof registration.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(registration.id)) {
					throw new Error(
						"App action id must be 1-64 chars: lowercase letters, numbers, dot, underscore, or dash",
					);
				}
				if (
					registration.publicId !== undefined &&
					(typeof registration.publicId !== "string" ||
						!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(registration.publicId))
				) {
					throw new Error(
						"App action publicId must be 1-128 chars: lowercase letters, numbers, dot, underscore, or dash",
					);
				}
				if (typeof registration.title !== "string" || registration.title.trim().length === 0) {
					throw new Error("App action title is required");
				}
				if (typeof registration.summary !== "string" || registration.summary.trim().length === 0) {
					throw new Error("App action summary is required");
				}
				if (!(["read", "write", "execute"] as const).includes(registration.effect)) {
					throw new Error("App action effect must be read, write, or execute");
				}
				if (typeof registration.inputSchema !== "object" || registration.inputSchema === null) {
					throw new Error("App action inputSchema must be a JSON Schema object");
				}
				if (typeof registration.handler !== "function") {
					throw new Error("App action handler is required");
				}

				const actionId = registration.id;
				const handlerId = `${actionId}:${crypto.randomUUID()}`;
				const handlerHandle = registerPluginAppActionHandler({
					pluginId: plugin.id,
					handlerId,
					handler: registration.handler as PluginAppActionHandler,
					assertReady: registration.assertReady as PluginAppActionReadyHandler | undefined,
				});
				disposers.push(() => handlerHandle.dispose());
				const registrationPromise = window.vetta.plugins
					.registerAppAction(plugin.id, {
						id: actionId,
						publicId: registration.publicId,
						title: registration.title.trim(),
						summary: registration.summary.trim(),
						description: registration.description?.trim() || undefined,
						keywords: registration.keywords,
						effect: registration.effect,
						approval: registration.approval,
						inputSchema: registration.inputSchema as Record<string, unknown>,
						examples: registration.examples ?? [],
						handlerId,
						activationId,
						hasAssertReady: typeof registration.assertReady === "function",
						timeoutMs: registration.timeoutMs,
					})
					.catch((error: Error) => {
						handlerHandle.dispose();
						throw error;
					});
				pendingRuntimeRegistrations.push(registrationPromise);
				return {
					dispose: () => {
						handlerHandle.dispose();
						void window.vetta.plugins.unregisterAppAction(plugin.id, actionId, activationId);
					},
				};
			},
		},
		ai: createPluginAiApi(permissions, capabilitySessionId),
		official: createPluginOfficialApi(capabilitySessionId),
		network: createNetworkApi(plugin, capabilitySessionId),
		gateway: plugin.trustLevel === "official" ? createGatewayApi(capabilitySessionId) : undefined,
		storage: createStorageApi(plugin, capabilitySessionId),
		settings: settingsApi,
		i18n: createI18nApi(plugin),
		getAgentMode: () => getDefaultStore().get(agentModeAtom),
		onAgentModeChanged: (listener) => {
			const store = getDefaultStore();
			const unsub = store.sub(agentModeAtom, () => listener(store.get(agentModeAtom)));
			return { dispose: unsub };
		},
	};
}

async function assertPluginEntryFetchable(plugin: InstalledPlugin): Promise<void> {
	try {
		const response = await fetch(plugin.entryUrl, { cache: "no-store" });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
		}
		const contentType = response.headers.get("content-type") ?? "";
		const expectedContentType = plugin.runtime === "module-federation" ? "json" : "javascript";
		if (!contentType.includes(expectedContentType)) {
			throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Plugin entry is not fetchable: ${plugin.entryUrl}; ${message}`);
	}
}

async function loadPluginModule(plugin: InstalledPlugin): Promise<PluginModule> {
	if (plugin.runtime === "quickjs") {
		return { default: createQuickJsPluginDefinition(plugin) };
	}
	if (plugin.runtime !== "module-federation") {
		return assertPluginModule(await import(/* @vite-ignore */ plugin.entryUrl));
	}
	const moduleFederation = plugin.moduleFederation;
	if (!moduleFederation) {
		throw new Error("Module Federation plugin is missing moduleFederation metadata");
	}
	await ensurePluginDevRuntime(plugin);
	const host = getModuleFederationHost();
	const remote = {
		name: moduleFederation.remoteName,
		alias: plugin.id,
		entry: plugin.entryUrl,
	};
	// 供 reload-bust 插件给 remoteEntry.js 的 import URL 追加 token（见上方注释）。
	const reloadToken = extractReloadToken(plugin.entryUrl);
	if (reloadToken) remoteReloadTokens.set(remote.name, reloadToken);
	else remoteReloadTokens.delete(remote.name);
	const registeredRemote = registeredRemotes.get(remote.name);
	if (!registeredRemote || registeredRemote.alias !== remote.alias || registeredRemote.entry !== remote.entry) {
		host.registerRemotes([remote], registeredRemote ? { force: true } : undefined);
		registeredRemotes.set(remote.name, {
			alias: remote.alias,
			entry: remote.entry,
		});
	}
	const expose = moduleFederation.expose.replace(/^\.\//, "");
	const loaded = await host.loadRemote<unknown>(`${moduleFederation.remoteName}/${expose}`, { from: "runtime" });
	if (loaded == null) {
		throw new Error(`Module Federation remote returned null: ${moduleFederation.remoteName}/${expose}`);
	}
	return assertPluginModule(getLatestPluginDevModule(plugin.id) ?? loaded);
}

export async function loadPlugin(plugin: InstalledPlugin, onChanged: () => void): Promise<LoadedPlugin> {
	const activationId = crypto.randomUUID();
	debugPluginAgent("load start", {
		pluginId: plugin.id,
		version: plugin.activeVersion,
		runtime: plugin.runtime,
		source: plugin.source,
		activationId,
	});
	const slots: PluginGlobalSlotContribution[] = [];
	const filePreviews: PluginFilePreviewContribution[] = [];
	const fileExplorerContextMenuActions: PluginFileExplorerContextMenuContribution[] = [];
	const fileExplorerToolbarActions: PluginFileExplorerToolbarContribution[] = [];
	const fileExplorerDecorationProviders: PluginFileExplorerDecorationProvider[] = [];
	const activityTabs: PluginActivityTabContribution[] = [];
	const inputActions: PluginInputActionContribution[] = [];
	const cardRenderers: PluginCardRendererContribution[] = [];
	const toolCallSlots: PluginToolCallSlotContribution[] = [];
	const turnCards: PluginTurnCardContribution[] = [];
	const disposers: Array<() => void> = [];
	const styleHandle = loadPluginStyles(plugin);
	let locallyDisposed = false;
	const disposeLocalContributions = () => {
		if (locallyDisposed) return;
		locallyDisposed = true;
		styleHandle.dispose();
		for (const dispose of disposers) dispose();
		slots.splice(0, slots.length);
		filePreviews.splice(0, filePreviews.length);
		fileExplorerContextMenuActions.splice(0, fileExplorerContextMenuActions.length);
		fileExplorerToolbarActions.splice(0, fileExplorerToolbarActions.length);
		fileExplorerDecorationProviders.splice(0, fileExplorerDecorationProviders.length);
		activityTabs.splice(0, activityTabs.length);
		inputActions.splice(0, inputActions.length);
		cardRenderers.splice(0, cardRenderers.length);
		toolCallSlots.splice(0, toolCallSlots.length);
		turnCards.splice(0, turnCards.length);
		clearAgentToolLabelsForPlugin(plugin.id);
		onChanged();
	};
	let definition: PluginDefinition | undefined;
	let activationStarted = false;
	let capabilitySessionId: string | undefined;
	const closeCapabilitySession = async (): Promise<void> => {
		if (capabilitySessionId === undefined) return;
		const sessionId = capabilitySessionId;
		capabilitySessionId = undefined;
		pluginRendererCapabilityHost.closeSession(sessionId);
		await window.vetta.plugins.internalCapabilities.closeSession(sessionId);
	};
	try {
		await window.vetta.plugins.beginAgentContributionsLoad(plugin.id, activationId);
		debugPluginAgent("began dynamic agent contribution activation", { pluginId: plugin.id, activationId });
		await assertPluginEntryFetchable(plugin);
		const module = await loadPluginModule(plugin);
		definition = normalizePluginDefinition(module);
		const initialSettings = plugin.settingsSchema?.length
			? await window.vetta.plugins.getSettings(plugin.id).catch(() => ({}))
			: {};
		const settingsApi = createSettingsApi(plugin, initialSettings, disposers);
		const pendingRuntimeRegistrations: Promise<void>[] = [];
		capabilitySessionId = await window.vetta.plugins.internalCapabilities.openSession(plugin.id);
		pluginRendererCapabilityHost.bindSession(capabilitySessionId, plugin);
		const context = createContext(
			plugin,
			slots,
			filePreviews,
			fileExplorerContextMenuActions,
			fileExplorerToolbarActions,
			fileExplorerDecorationProviders,
			activityTabs,
			inputActions,
			cardRenderers,
			toolCallSlots,
			turnCards,
			settingsApi,
			onChanged,
			disposers,
			pendingRuntimeRegistrations,
			activationId,
			capabilitySessionId,
		);
		activationStarted = true;
		await definition.activate(context);
		debugPluginAgent("activate resolved", {
			pluginId: plugin.id,
			pendingRuntimeRegistrations: pendingRuntimeRegistrations.length,
			activationId,
		});
		await Promise.all(pendingRuntimeRegistrations);
		await window.vetta.plugins.commitAppActionActivation(plugin.id, activationId);
		debugPluginAgent("load complete", {
			pluginId: plugin.id,
			runtimeContributionsRegistered: pendingRuntimeRegistrations.length,
			globalSlots: slots.length,
			activityTabs: activityTabs.length,
			cardRenderers: cardRenderers.length,
			toolCallSlots: toolCallSlots.length,
			activationId,
		});
		return {
			id: plugin.id,
			name: plugin.name,
			version: plugin.activeVersion,
			defaultLocale: plugin.defaultLocale,
			locales: plugin.locales,
			slots,
			filePreviews,
			fileExplorerContextMenuActions,
			fileExplorerToolbarActions,
			fileExplorerDecorationProviders,
			activityTabs,
			inputActions,
			cardRenderers,
			toolCallSlots,
			turnCards,
			dispose: async () => {
				debugPluginAgent("dispose start", { pluginId: plugin.id, activationId });
				try {
					await definition?.deactivate?.();
				} finally {
					try {
						await window.vetta.plugins.clearAgentContributions(plugin.id, activationId);
						debugPluginAgent("cleared dynamic agent contributions on dispose", {
							pluginId: plugin.id,
							activationId,
						});
					} finally {
						try {
							disposeLocalContributions();
						} finally {
							await closeCapabilitySession();
						}
					}
				}
			},
		};
	} catch (error) {
		if (activationStarted) {
			await Promise.resolve(definition?.deactivate?.()).catch((deactivateError: unknown) => {
				console.error(`Plugin ${plugin.id} failed to deactivate after activation failure`, deactivateError);
			});
		}
		await window.vetta.plugins.abortAppActionActivation(plugin.id, activationId).catch((abortError: unknown) => {
			console.error(`Plugin ${plugin.id} failed to abort app action activation`, abortError);
		});
		await window.vetta.plugins.clearAgentContributions(plugin.id, activationId).catch((clearError: unknown) => {
			console.error(`Plugin ${plugin.id} failed to clear contributions after activation failure`, clearError);
		});
		disposeLocalContributions();
		await closeCapabilitySession().catch((closeError: unknown) => {
			console.error(`Plugin ${plugin.id} failed to close capability session`, closeError);
		});
		throw error;
	}
}
