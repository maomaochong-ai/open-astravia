import type { InstalledPlugin } from "@preload/api";
import { languageAtom } from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type {
	Disposable,
	PluginArtifactsApi,
	PluginCaptureApi,
	PluginCommandApi,
	PluginCommandSpawnExit,
	PluginCommandSpawnHandle,
	PluginConversationApi,
	PluginFsApi,
	PluginGatewayApi,
	PluginI18nApi,
	PluginJob,
	PluginJobsApi,
	PluginMediaApi,
	PluginNetworkApi,
	PluginSettingsApi,
	PluginStorageApi,
} from "@vetta-org/plugin-sdk";
import { resolveCatalogKey, resolvePluginText } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { router } from "../../../router";
import { pluginHostBridge, registerPluginMediaProviderHandler } from "./plugin-host-bridge";
import { createPluginPermissionApi as createPermissionApi } from "./plugin-permissions";

export function createConversationApi(plugin: InstalledPlugin): PluginConversationApi {
	const permissions = createPermissionApi(plugin);
	return {
		sendPrompt: async (text) => {
			permissions.require("agent.session.write");
			return pluginHostBridge.conversation.sendPrompt(text);
		},
		createSession: async (cwd, options) => {
			// 与 sendPrompt 同权限：都是「让 agent 开始干活」，不另开权限位。
			permissions.require("agent.session.write");
			return pluginHostBridge.conversation.createSession(cwd, options);
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

export function createFsApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginFsApi {
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

export function createPluginSettingsApi(
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

export function createNetworkApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginNetworkApi {
	return {
		request: (request) => {
			createPermissionApi(plugin).require("network.fetch");
			return window.vetta.plugins.networkRequest(capabilitySessionId, request);
		},
	};
}

export function createMediaApi(
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

export function createJobsApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginJobsApi {
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

export function createArtifactsApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginArtifactsApi {
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
export function createGatewayApi(capabilitySessionId: string): PluginGatewayApi {
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

export function createStorageApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginStorageApi {
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

export function createI18nApi(plugin: InstalledPlugin): PluginI18nApi {
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
export function resolvePluginDisplayText(plugin: InstalledPlugin, raw: string): string {
	return resolvePluginText(
		raw,
		plugin.locales ?? {},
		getDefaultStore().get(languageAtom),
		plugin.defaultLocale ?? "zh",
	);
}

/** Format a plugin error for clipboard + console (plugin id/version + stack). */
export function formatPluginErrorDetail(plugin: InstalledPlugin, error: unknown): string {
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

export async function copyTextToClipboard(text: string): Promise<boolean> {
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

export function createCommandApi(
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

export function createCaptureApi(plugin: InstalledPlugin, disposers: Array<() => void>): PluginCaptureApi {
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
