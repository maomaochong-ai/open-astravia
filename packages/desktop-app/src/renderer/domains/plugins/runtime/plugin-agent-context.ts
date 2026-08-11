import type { InstalledPlugin, PluginAgentHookHostRegistration, PluginAgentToolRegistration } from "@preload/api";
import { pluginAgentToolLabelsAtom, type RegisteredAgentToolLabel } from "@shared/store/atoms";
import type {
	PluginAgentToolHandler,
	PluginAppActionHandler,
	PluginAppActionReadyHandler,
	PluginCodingAgentHookEventName,
	PluginCodingAgentHookHandler,
	PluginContext,
	PluginConversationApi,
	PluginFsApi,
	PluginToolCallSlotContribution,
} from "@vetta-org/plugin-sdk";
import { PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import {
	registerPluginAgentHookHandler,
	registerPluginAgentToolHandler,
	registerPluginAppActionHandler,
	registerPluginContinuationHandler,
	registerPluginSystemPromptHandler,
} from "./plugin-host-bridge";
import {
	createPluginPermissionApi as createPermissionApi,
	hasPluginPermission as hasPermission,
	noopDisposable,
	warnSkippedPluginContribution as warnSkippedContribution,
} from "./plugin-permissions";

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
export function clearAgentToolLabelsForPlugin(pluginId: string): void {
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

export function debugPluginAgent(message: string, data?: Record<string, unknown>): void {
	console.info(`[plugin-agent] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
}

export interface CreatePluginAgentApiOptions {
	plugin: InstalledPlugin;
	activationId: string;
	fs: PluginFsApi;
	conversation: PluginConversationApi;
	toolCallSlots: PluginToolCallSlotContribution[];
	pendingRuntimeRegistrations: Promise<void>[];
}

export interface PluginAgentApiRegistration {
	api: PluginContext["agent"];
	onToolCallSlotRegistered(toolName: string): void;
}

export function createPluginAgentApi({
	plugin,
	activationId,
	fs,
	conversation,
	toolCallSlots,
	pendingRuntimeRegistrations,
}: CreatePluginAgentApiOptions): PluginAgentApiRegistration {
	const registeredAgentTools = new Map<string, PluginAgentToolRegistration>();
	const hasToolCallSlot = (toolName: string): boolean => toolCallSlots.some((slot) => slot.toolName === toolName);
	const pushAgentToolRegistration = (payload: PluginAgentToolRegistration): Promise<void> =>
		window.vetta.plugins
			.registerAgentTool(plugin.id, payload)
			.then(() => undefined)
			.catch((error: Error) => {
				console.error(`Plugin ${plugin.id} failed to register agent tool ${payload.id}`, error);
			});
	const api: PluginContext["agent"] = {
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
		registerHook: (registration) => {
			if (!hasPermission(plugin, "agent.hooks.register")) {
				warnSkippedContribution(plugin, "agent.hooks.register", "agent hook");
				return noopDisposable;
			}
			if (!hasPermission(plugin, "agent.hookHandler.execute")) {
				warnSkippedContribution(plugin, "agent.hookHandler.execute", "agent hook handler");
				return noopDisposable;
			}
			if (typeof registration.id !== "string" || registration.id.trim().length === 0) {
				throw new Error("Agent hook id is required");
			}
			if (!PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES.includes(registration.eventName)) {
				throw new Error("Coding Agent Hook eventName is invalid");
			}
			if (!Array.isArray(registration.scope_use) || registration.scope_use.length === 0) {
				throw new Error("Agent hook scope_use is required");
			}
			if (typeof registration.handler !== "function") {
				throw new Error("Agent hook handler is required");
			}
			const hookId = registration.id.trim();
			const handlerId = `${hookId}:${crypto.randomUUID()}`;
			const handlerHandle = registerPluginAgentHookHandler({
				pluginId: plugin.id,
				handlerId,
				handler: registration.handler as unknown as PluginCodingAgentHookHandler<PluginCodingAgentHookEventName>,
				api: { fs, conversation },
			});
			const payload: PluginAgentHookHostRegistration = {
				id: hookId,
				eventName: registration.eventName,
				handlerId,
				activationId,
				timeoutMs: registration.timeoutMs,
				scope_use: registration.scope_use,
				agent_mode: registration.agent_mode,
				toolNames: registration.toolNames,
			};
			const registrationPromise = window.vetta.plugins
				.registerAgentHook(plugin.id, payload)
				.catch((error: Error) => {
					handlerHandle.dispose();
					console.error(`Plugin ${plugin.id} failed to register agent hook ${hookId}`, error);
				});
			pendingRuntimeRegistrations.push(registrationPromise);
			return {
				dispose: () => {
					void window.vetta.plugins
						.unregisterAgentHook(plugin.id, hookId, activationId)
						.finally(() => handlerHandle.dispose());
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
	};
	return {
		api,
		onToolCallSlotRegistered: (toolName) => {
			const registered = registeredAgentTools.get(toolName);
			if (registered && registered.rendersCard !== true) {
				registered.rendersCard = true;
				pendingRuntimeRegistrations.push(pushAgentToolRegistration(registered));
			}
		},
	};
}

export interface CreatePluginAppActionsApiOptions {
	plugin: InstalledPlugin;
	activationId: string;
	disposers: Array<() => void>;
	pendingRuntimeRegistrations: Promise<void>[];
}

export function createPluginAppActionsApi({
	plugin,
	activationId,
	disposers,
	pendingRuntimeRegistrations,
}: CreatePluginAppActionsApiOptions): PluginContext["appActions"] {
	return {
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
				throw new Error("App action id must be 1-64 chars: lowercase letters, numbers, dot, underscore, or dash");
			}
			if (
				registration.publicId !== undefined &&
				(typeof registration.publicId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(registration.publicId))
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
	};
}
