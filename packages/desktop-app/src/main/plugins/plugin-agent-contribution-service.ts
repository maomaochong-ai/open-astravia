import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";
import { validatePluginId } from "@vetta-org/plugin-sdk/manifest";
import type { InstalledPlugin, PluginPermission } from "../../preload/api-types/plugins.js";
import type {
	DesktopPluginAgentHandlerKind,
	DesktopPluginAgentHandlerRegistry,
	DesktopPluginAgentHandlerReleasedEvent,
} from "./coding-agent-handler-registry.js";
import type {
	DesktopPluginHookRegistration,
	DesktopPluginHookRegistry,
	DesktopPluginHookReleasedHandler,
} from "./coding-agent-hook-registry.js";
import {
	PluginAgentContributionRegistry,
	type RegisteredAgentTool,
	type RegisteredContinuationProvider,
	type RegisteredSystemPromptProvider,
} from "./plugin-agent-contribution-registry.js";
import { pluginVisibleInAgentMode } from "./plugin-agent-mode-policy.js";
import { versionedPluginPath } from "./plugin-package.js";
import { buildPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";

interface PluginAgentContributionLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	warn(message: string, error?: unknown): void;
}

export interface PluginAgentContributionServiceDependencies {
	listPlugins(): InstalledPlugin[];
	isDevLinked(pluginId: string): boolean;
	resolveFilePath(pluginId: string, relativePath: string): string;
	logger: PluginAgentContributionLogger;
	hooks: DesktopPluginHookRegistry;
	handlers: DesktopPluginAgentHandlerRegistry;
}

export class PluginAgentContributionService {
	private readonly registry: PluginAgentContributionRegistry;
	private readonly modeGatedPluginIds = new Set<string>();
	private readonly activeContributionModeIds = new Set<string>();
	private currentAgentMode: string | undefined;

	constructor(private readonly dependencies: PluginAgentContributionServiceDependencies) {
		this.registry = new PluginAgentContributionRegistry(dependencies.hooks);
	}

	registerModeGate(pluginId: string): void {
		validatePluginId(pluginId);
		this.modeGatedPluginIds.add(pluginId);
	}

	setContributionMode(pluginId: string, active: boolean): void {
		validatePluginId(pluginId);
		this.modeGatedPluginIds.add(pluginId);
		if (active) this.activeContributionModeIds.add(pluginId);
		else this.activeContributionModeIds.delete(pluginId);
	}

	isContributionModeActive(pluginId: string): boolean {
		return !this.modeGatedPluginIds.has(pluginId) || this.activeContributionModeIds.has(pluginId);
	}

	setAgentMode(mode: string | undefined): void {
		this.currentAgentMode = mode;
	}

	getAgentMode(): string | undefined {
		return this.currentAgentMode;
	}

	canInvokeHook(pluginId: string): boolean {
		const plugin = this.findPlugin(pluginId);
		return Boolean(
			plugin?.enabled &&
				this.isContributionModeActive(pluginId) &&
				pluginVisibleInAgentMode(plugin, this.currentAgentMode) &&
				hasGrantedPermission(plugin, "agent.hooks.register") &&
				hasGrantedPermission(plugin, "agent.hookHandler.execute"),
		);
	}

	readHookInvocationRejection(pluginId: string, handlerId: string, activationId?: string): string | undefined {
		return this.dependencies.hooks.readInvocationRejection(pluginId, handlerId, activationId);
	}

	readHandlerInvocationRejection(
		kind: DesktopPluginAgentHandlerKind,
		pluginId: string,
		handlerId: string,
		activationId?: string,
	): string | undefined {
		return this.dependencies.handlers.readInvocationRejection(kind, pluginId, handlerId, activationId);
	}

	hardRevokeHandlers(
		pluginId: string,
		reason: string,
		kinds?: readonly (DesktopPluginAgentHandlerKind | "hook")[],
	): number {
		validatePluginId(pluginId);
		const selected = new Set<DesktopPluginAgentHandlerKind | "hook">(
			kinds ?? ["tool", "hook", "continuation", "system-prompt"],
		);
		return (
			(selected.has("hook") ? this.dependencies.hooks.hardRevoke(pluginId, reason) : 0) +
			this.dependencies.handlers.hardRevoke(pluginId, reason, selected)
		);
	}

	onHookHandlerReleased(listener: (handler: DesktopPluginHookReleasedHandler) => void): () => void {
		return this.dependencies.hooks.onHandlerReleased(listener);
	}

	onAgentHandlerReleased(listener: (handler: DesktopPluginAgentHandlerReleasedEvent) => void): () => void {
		return this.dependencies.handlers.onReleased(listener);
	}

	bindAgentHandlersForTurn(agentPlugins: AgentPluginRuntimeConfig | undefined) {
		return this.dependencies.handlers.acquire(agentPlugins);
	}

	buildRuntimeConfig(): AgentPluginRuntimeConfig | undefined {
		return buildPluginRuntimeConfig({
			plugins: this.dependencies.listPlugins(),
			agentMode: this.currentAgentMode,
			isContributionModeActive: (pluginId) => this.isContributionModeActive(pluginId),
			contributions: this.registry,
			resolveResource: (plugin, relativePath) =>
				this.dependencies.resolveFilePath(plugin.id, this.resourceRelativePath(plugin, relativePath)),
			resolveMcpRoot: (plugin) =>
				plugin.source === "system" || this.dependencies.isDevLinked(plugin.id)
					? this.dependencies.resolveFilePath(plugin.id, ".")
					: this.dependencies.resolveFilePath(plugin.id, `versions/${encodeURIComponent(plugin.activeVersion)}`),
			logger: this.dependencies.logger,
		});
	}

	beginLoad(pluginId: string, activationId: string): void {
		this.requirePlugin(pluginId);
		const previous = this.registry.beginLoad(pluginId, activationId);
		this.debug("dynamic agent contribution activation began", {
			pluginId,
			activationId,
			previousToolCount: previous.toolCount,
			previousHookCount: previous.hookCount,
			previousContinuationCount: previous.continuationCount,
		});
	}

	commitLoad(pluginId: string, activationId: string): void {
		this.requirePlugin(pluginId);
		if (!this.registry.commit(pluginId, activationId)) {
			throw new Error(`Plugin Agent contribution activation is stale: ${pluginId}/${activationId}`);
		}
		this.syncPublishedHandlers(pluginId);
		this.debug("dynamic agent contribution activation committed", { pluginId, activationId });
	}

	registerTool(pluginId: string, tool: RegisteredAgentTool): void {
		const plugin = this.requirePlugin(pluginId);
		if (!hasGrantedPermission(plugin, "agent.tools.register")) {
			throw new Error("Plugin permission denied: agent.tools.register");
		}
		if (!this.registry.registerTool(pluginId, tool)) {
			this.debug("ignore stale dynamic tool register", {
				pluginId,
				toolId: tool.id,
				toolName: tool.name,
				activationId: tool.activationId,
			});
			return;
		}
		if (tool.activationId === undefined) this.syncPublishedHandlers(pluginId);
		this.debug("dynamic tool registered", {
			pluginId,
			toolId: tool.id,
			toolName: tool.name,
			handlerId: tool.handlerId,
			activationId: tool.activationId,
			pluginToolCount: this.registry.getTools(pluginId).length,
		});
	}

	unregisterTool(pluginId: string, toolId: string, activationId?: string): void {
		validatePluginId(pluginId);
		const staged = activationId !== undefined && this.registry.isPendingActivation(pluginId, activationId);
		const handlerId = this.registry.getTools(pluginId).find((tool) => tool.id === toolId)?.handlerId;
		if (!this.registry.unregisterTool(pluginId, toolId, activationId)) {
			this.debug("ignore stale dynamic tool unregister", { pluginId, toolId, activationId });
			return;
		}
		if (handlerId && !staged) this.dependencies.handlers.unregister("tool", pluginId, handlerId);
		this.debug("dynamic tool unregistered", {
			pluginId,
			toolId,
			remainingPluginToolCount: this.registry.getTools(pluginId).length,
		});
	}

	registerHook(pluginId: string, hook: DesktopPluginHookRegistration): void {
		const plugin = this.requirePlugin(pluginId);
		if (!hasGrantedPermission(plugin, "agent.hooks.register")) {
			throw new Error("Plugin permission denied: agent.hooks.register");
		}
		if (!hasGrantedPermission(plugin, "agent.hookHandler.execute")) {
			throw new Error("Plugin permission denied: agent.hookHandler.execute");
		}
		if (!hook.scope_use?.length) throw new Error("Plugin hook scope_use must not be empty");
		this.registry.registerHook(pluginId, hook);
	}

	unregisterHook(pluginId: string, hookId: string, activationId?: string): void {
		validatePluginId(pluginId);
		this.registry.unregisterHook(pluginId, hookId, activationId);
	}

	registerContinuation(pluginId: string, provider: RegisteredContinuationProvider): void {
		const plugin = this.requirePlugin(pluginId);
		if (!hasGrantedPermission(plugin, "agent.continuation.register")) {
			throw new Error("Plugin permission denied: agent.continuation.register");
		}
		if (!this.registry.registerContinuation(pluginId, provider)) return;
		if (provider.activationId === undefined) this.syncPublishedHandlers(pluginId);
	}

	unregisterContinuation(pluginId: string, providerId: string, activationId?: string): void {
		validatePluginId(pluginId);
		const staged = activationId !== undefined && this.registry.isPendingActivation(pluginId, activationId);
		const handlerId = this.registry
			.getContinuations(pluginId)
			.find((provider) => provider.id === providerId)?.handlerId;
		if (!this.registry.unregisterContinuation(pluginId, providerId, activationId)) return;
		if (handlerId && !staged) this.dependencies.handlers.unregister("continuation", pluginId, handlerId);
	}

	registerSystemPrompt(pluginId: string, provider: RegisteredSystemPromptProvider): void {
		const plugin = this.requirePlugin(pluginId);
		if (
			!hasGrantedPermission(plugin, "agent.systemPrompt.write") &&
			!hasGrantedPermission(plugin, "agent.systemPrompt.fullControl")
		) {
			throw new Error("Plugin permission denied: agent.systemPrompt.write");
		}
		if (!this.registry.registerSystemPrompt(pluginId, provider)) return;
		if (provider.activationId === undefined) this.syncPublishedHandlers(pluginId);
		this.dependencies.logger.debug("[plugin-system-prompt] provider registered", {
			pluginId,
			providerId: provider.id,
			handlerId: provider.handlerId,
			activationId: provider.activationId,
			timeoutMs: provider.timeoutMs,
			providerCount: this.registry.getSystemPrompts(pluginId).length,
		});
	}

	unregisterSystemPrompt(pluginId: string, providerId: string, activationId?: string): void {
		validatePluginId(pluginId);
		const staged = activationId !== undefined && this.registry.isPendingActivation(pluginId, activationId);
		const handlerId = this.registry
			.getSystemPrompts(pluginId)
			.find((provider) => provider.id === providerId)?.handlerId;
		if (!this.registry.unregisterSystemPrompt(pluginId, providerId, activationId)) return;
		if (handlerId && !staged) this.dependencies.handlers.unregister("system-prompt", pluginId, handlerId);
		this.dependencies.logger.debug("[plugin-system-prompt] provider unregistered", {
			pluginId,
			providerId,
			activationId,
			remainingProviderCount: this.registry.getSystemPrompts(pluginId).length,
		});
	}

	clear(pluginId: string, activationId?: string): void {
		validatePluginId(pluginId);
		const discardedCandidate =
			activationId !== undefined && this.registry.isPendingActivation(pluginId, activationId);
		const pending = activationId !== undefined ? this.registry.readPending(pluginId, activationId) : undefined;
		const previous = this.registry.clear(pluginId, activationId);
		if (!previous) {
			this.debug("ignore stale dynamic tools clear", { pluginId, activationId });
			return;
		}
		if (discardedCandidate && pending) this.releaseUnpublishedHandlers(pluginId, pending);
		else this.dependencies.handlers.clear(pluginId);
		this.debug("dynamic agent contributions cleared", {
			pluginId,
			activationId,
			previousToolCount: previous.toolCount,
			previousHookCount: previous.hookCount,
			previousContinuationCount: previous.continuationCount,
		});
	}

	private resourceRelativePath(plugin: InstalledPlugin, relativePath: string): string {
		return plugin.source === "system" || this.dependencies.isDevLinked(plugin.id)
			? relativePath
			: versionedPluginPath(plugin.activeVersion, relativePath);
	}

	private syncPublishedHandlers(pluginId: string): void {
		this.dependencies.handlers.clear(pluginId);
		for (const tool of this.registry.getTools(pluginId)) {
			this.dependencies.handlers.register({
				kind: "tool",
				pluginId,
				handlerId: tool.handlerId,
				activationId: tool.activationId,
			});
		}
		for (const provider of this.registry.getContinuations(pluginId)) {
			this.dependencies.handlers.register({
				kind: "continuation",
				pluginId,
				handlerId: provider.handlerId,
				activationId: provider.activationId,
			});
		}
		for (const provider of this.registry.getSystemPrompts(pluginId)) {
			this.dependencies.handlers.register({
				kind: "system-prompt",
				pluginId,
				handlerId: provider.handlerId,
				activationId: provider.activationId,
			});
		}
	}

	private releaseUnpublishedHandlers(
		pluginId: string,
		pending: NonNullable<ReturnType<PluginAgentContributionRegistry["readPending"]>>,
	): void {
		for (const tool of pending.tools) {
			this.dependencies.handlers.releaseUnpublished({
				kind: "tool",
				pluginId,
				handlerId: tool.handlerId,
				activationId: tool.activationId,
			});
		}
		for (const hook of pending.hooks) {
			this.dependencies.hooks.releaseUnpublished({
				pluginId,
				handlerId: hook.handlerId,
				activationId: hook.activationId,
			});
		}
		for (const provider of pending.continuations) {
			this.dependencies.handlers.releaseUnpublished({
				kind: "continuation",
				pluginId,
				handlerId: provider.handlerId,
				activationId: provider.activationId,
			});
		}
		for (const provider of pending.systemPrompts) {
			this.dependencies.handlers.releaseUnpublished({
				kind: "system-prompt",
				pluginId,
				handlerId: provider.handlerId,
				activationId: provider.activationId,
			});
		}
	}

	private findPlugin(pluginId: string): InstalledPlugin | undefined {
		return this.dependencies.listPlugins().find((plugin) => plugin.id === pluginId);
	}

	private requirePlugin(pluginId: string): InstalledPlugin {
		validatePluginId(pluginId);
		const plugin = this.findPlugin(pluginId);
		if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
		return plugin;
	}

	private debug(message: string, data: Record<string, unknown>): void {
		this.dependencies.logger.debug(message, data);
	}
}

function hasGrantedPermission(plugin: InstalledPlugin, permission: PluginPermission): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}
