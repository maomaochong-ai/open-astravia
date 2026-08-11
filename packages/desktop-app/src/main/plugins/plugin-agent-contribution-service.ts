import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";
import { validatePluginId } from "@vetta-org/plugin-sdk/manifest";
import type { InstalledPlugin, PluginPermission } from "../../preload/api-types/plugins.js";
import type { DesktopPluginHookRegistration, DesktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
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
		if (!this.registry.unregisterTool(pluginId, toolId, activationId)) {
			this.debug("ignore stale dynamic tool unregister", { pluginId, toolId, activationId });
			return;
		}
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
		this.registry.registerContinuation(pluginId, provider);
	}

	unregisterContinuation(pluginId: string, providerId: string, activationId?: string): void {
		validatePluginId(pluginId);
		this.registry.unregisterContinuation(pluginId, providerId, activationId);
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
		if (!this.registry.unregisterSystemPrompt(pluginId, providerId, activationId)) return;
		this.dependencies.logger.debug("[plugin-system-prompt] provider unregistered", {
			pluginId,
			providerId,
			activationId,
			remainingProviderCount: this.registry.getSystemPrompts(pluginId).length,
		});
	}

	clear(pluginId: string, activationId?: string): void {
		validatePluginId(pluginId);
		const previous = this.registry.clear(pluginId, activationId);
		if (!previous) {
			this.debug("ignore stale dynamic tools clear", { pluginId, activationId });
			return;
		}
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
