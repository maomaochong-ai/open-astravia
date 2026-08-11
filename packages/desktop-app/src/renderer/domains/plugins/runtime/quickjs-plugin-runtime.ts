import type { QuickJsDeclarativeViewStore } from "@domains/plugins/components/QuickJsDeclarativePanel";
import { QuickJsDeclarativePanel } from "@domains/plugins/components/QuickJsDeclarativePanel";
import type { InstalledPlugin } from "@preload/api";
import type {
	Disposable,
	PluginContext,
	PluginDeclarativeActionEvent,
	PluginDeclarativeNode,
	PluginDefinition,
	PluginNetworkRequest,
	PluginPutBlobInput,
} from "@vetta-org/plugin-sdk";
import { createElement } from "react";
import {
	parseQuickJsWorkerMessage,
	type QuickJsHostMethod,
	type QuickJsWorkerInboundMessage,
} from "./quickjs-plugin-protocol";

const ENTRY_SIZE_LIMIT_BYTES = 2 * 1024 * 1024;
const STARTUP_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 250;

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.stack?.trim() || error.message;
	return String(error);
}

function stringArgument(args: unknown[], index: number, method: string): string {
	const value = args[index];
	if (typeof value !== "string") throw new Error(`QuickJS ${method} argument ${index} must be a string`);
	return value;
}

function optionalStringArgument(args: unknown[], index: number, method: string): string | undefined {
	const value = args[index];
	if (value === undefined || value === null) return undefined;
	return stringArgument(args, index, method);
}

function recordArgument(args: unknown[], index: number, method: string): Record<string, unknown> {
	const value = args[index];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`QuickJS ${method} argument ${index} must be an object`);
	}
	return value as Record<string, unknown>;
}

class QuickJsViewStore implements QuickJsDeclarativeViewStore {
	readonly #views = new Map<string, PluginDeclarativeNode>();
	readonly #listeners = new Map<string, Set<() => void>>();
	#worker: Worker | undefined;

	bindWorker(worker: Worker): void {
		this.#worker = worker;
	}

	getView(tabId: string): PluginDeclarativeNode | null {
		return this.#views.get(tabId) ?? null;
	}

	setView(tabId: string, view: PluginDeclarativeNode): void {
		this.#views.set(tabId, view);
		for (const listener of this.#listeners.get(tabId) ?? []) listener();
	}

	deleteView(tabId: string): void {
		this.#views.delete(tabId);
		for (const listener of this.#listeners.get(tabId) ?? []) listener();
	}

	subscribe(tabId: string, listener: () => void): () => void {
		const listeners = this.#listeners.get(tabId) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(tabId, listeners);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.#listeners.delete(tabId);
		};
	}

	dispatch(event: PluginDeclarativeActionEvent): void {
		this.#worker?.postMessage({ type: "action", event } satisfies QuickJsWorkerInboundMessage);
	}

	clear(): void {
		for (const tabId of this.#views.keys()) this.deleteView(tabId);
		this.#listeners.clear();
		this.#worker = undefined;
	}
}

async function invokeHostMethod(context: PluginContext, method: QuickJsHostMethod, args: unknown[]): Promise<unknown> {
	switch (method) {
		case "network.request":
			return context.network.request(args[0] as PluginNetworkRequest);
		case "storage.readJson":
			return context.storage.readJson(stringArgument(args, 0, method));
		case "storage.writeJson":
			return context.storage.writeJson(stringArgument(args, 0, method), args[1]);
		case "storage.list":
			return context.storage.list(optionalStringArgument(args, 0, method));
		case "storage.readFile":
			return context.storage.readFile(stringArgument(args, 0, method));
		case "storage.writeFile":
			return context.storage.writeFile(stringArgument(args, 0, method), stringArgument(args, 1, method));
		case "storage.putBlob":
			return context.storage.putBlob(recordArgument(args, 0, method) as unknown as PluginPutBlobInput);
		case "storage.readBlob":
			return context.storage.readBlob(stringArgument(args, 0, method));
		case "storage.getBlobRef":
			return context.storage.getBlobRef(stringArgument(args, 0, method));
		case "i18n.t": {
			const params = args[1] === undefined || args[1] === null ? undefined : recordArgument(args, 1, method);
			return context.i18n.t(stringArgument(args, 0, method), params as Record<string, string | number> | undefined);
		}
	}
}

function readPluginSource(plugin: InstalledPlugin): Promise<string> {
	return fetch(plugin.entryUrl, { cache: "no-store" }).then(async (response) => {
		if (!response.ok) throw new Error(`QuickJS plugin entry returned HTTP ${response.status}`);
		const code = await response.text();
		if (new Blob([code]).size > ENTRY_SIZE_LIMIT_BYTES) {
			throw new Error("QuickJS plugin entry exceeds the 2 MB limit");
		}
		return code;
	});
}

export function createQuickJsPluginDefinition(plugin: InstalledPlugin): PluginDefinition {
	let worker: Worker | undefined;
	let viewStore: QuickJsViewStore | undefined;
	let subscriptions: Disposable[] = [];
	let tabRegistrations = new Map<string, Disposable>();
	let disposeAcknowledged: Promise<void> | undefined;
	let resolveDisposeAcknowledged: (() => void) | undefined;
	return {
		async activate(context) {
			const code = await readPluginSource(plugin);
			const nextWorker = new Worker(new URL("./quickjs-plugin-worker.ts", import.meta.url), { type: "module" });
			const nextViewStore = new QuickJsViewStore();
			nextViewStore.bindWorker(nextWorker);
			worker = nextWorker;
			viewStore = nextViewStore;
			disposeAcknowledged = new Promise((resolve) => {
				resolveDisposeAcknowledged = resolve;
			});

			let startupSettled = false;
			let resolveStartup: (() => void) | undefined;
			let rejectStartup: ((error: Error) => void) | undefined;
			const startup = new Promise<void>((resolve, reject) => {
				resolveStartup = resolve;
				rejectStartup = reject;
			});
			const failStartup = (error: Error): void => {
				if (startupSettled) {
					console.error(`QuickJS plugin ${plugin.id} runtime error`, error);
					return;
				}
				startupSettled = true;
				rejectStartup?.(error);
			};
			const startupTimer = window.setTimeout(() => {
				failStartup(new Error(`QuickJS plugin ${plugin.id} startup timed out`));
				nextWorker.terminate();
			}, STARTUP_TIMEOUT_MS);

			nextWorker.onerror = (event) => {
				failStartup(new Error(event.message || `QuickJS plugin ${plugin.id} worker failed`));
			};
			nextWorker.onmessage = (event: MessageEvent<unknown>) => {
				try {
					const message = parseQuickJsWorkerMessage(event.data);
					switch (message.type) {
						case "ready":
							if (!startupSettled) {
								startupSettled = true;
								resolveStartup?.();
							}
							break;
						case "disposed":
							resolveDisposeAcknowledged?.();
							break;
						case "registerActivityTab": {
							if (tabRegistrations.has(message.contribution.id)) {
								throw new Error(`QuickJS plugin registered duplicate activity tab: ${message.contribution.id}`);
							}
							nextViewStore.setView(message.contribution.id, message.contribution.view);
							const tabId = message.contribution.id;
							const TabComponent = () => createElement(QuickJsDeclarativePanel, { tabId, store: nextViewStore });
							const registration = context.ui.registerActivityTab({
								id: tabId,
								label: message.contribution.label,
								component: TabComponent,
								scope_use: message.contribution.scope_use,
								initiallyVisible: message.contribution.initiallyVisible,
							});
							tabRegistrations.set(tabId, registration);
							break;
						}
						case "updateActivityTab":
							if (!tabRegistrations.has(message.tabId)) {
								throw new Error(`QuickJS plugin updated an unknown activity tab: ${message.tabId}`);
							}
							nextViewStore.setView(message.tabId, message.view);
							break;
						case "openActivityTab":
							context.ui.openActivityTab(message.tabId, { width: message.width });
							break;
						case "setActivityTabVisible":
							context.ui.setActivityTabVisible(message.tabId, message.visible);
							break;
						case "notify":
							context.ui.notify(message.options);
							break;
						case "hostCall":
							void invokeHostMethod(context, message.method, message.args).then(
								(value) =>
									nextWorker.postMessage({
										type: "hostResponse",
										callId: message.callId,
										ok: true,
										value: value ?? null,
									} satisfies QuickJsWorkerInboundMessage),
								(error: unknown) =>
									nextWorker.postMessage({
										type: "hostResponse",
										callId: message.callId,
										ok: false,
										value: errorMessage(error),
									} satisfies QuickJsWorkerInboundMessage),
							);
							break;
						case "error":
							failStartup(new Error(message.message));
							break;
					}
				} catch (error) {
					failStartup(error instanceof Error ? error : new Error(String(error)));
				}
			};

			subscriptions = [
				context.settings.onChange((values) => {
					nextWorker.postMessage({ type: "settingsChanged", values } satisfies QuickJsWorkerInboundMessage);
				}),
				context.i18n.onChange((locale) => {
					nextWorker.postMessage({ type: "localeChanged", locale } satisfies QuickJsWorkerInboundMessage);
				}),
			];
			nextWorker.postMessage({
				type: "initialize",
				plugin: {
					id: plugin.id,
					version: plugin.activeVersion,
					...(plugin.iconUrl ? { iconUrl: plugin.iconUrl } : {}),
				},
				permissions: plugin.permissions.filter((permission) => plugin.grantedPermissions.includes(permission)),
				settings: context.settings.getAll(),
				locale: context.i18n.locale,
				code,
				filename: plugin.entryUrl,
			} satisfies QuickJsWorkerInboundMessage);
			try {
				await startup;
			} finally {
				window.clearTimeout(startupTimer);
			}
		},
		async deactivate() {
			const activeWorker = worker;
			if (activeWorker) {
				activeWorker.postMessage({ type: "dispose" } satisfies QuickJsWorkerInboundMessage);
				if (disposeAcknowledged) {
					await Promise.race([
						disposeAcknowledged,
						new Promise<void>((resolve) => window.setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
					]);
				}
				activeWorker.terminate();
			}
			worker = undefined;
			disposeAcknowledged = undefined;
			resolveDisposeAcknowledged = undefined;
			for (const subscription of subscriptions) subscription.dispose();
			subscriptions = [];
			for (const registration of tabRegistrations.values()) registration.dispose();
			tabRegistrations = new Map();
			viewStore?.clear();
			viewStore = undefined;
		},
	};
}
