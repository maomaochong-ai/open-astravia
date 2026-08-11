import type {
	AgentPluginContinuationContribution,
	AgentPluginSystemPromptProviderContribution,
	AgentPluginToolContribution,
} from "@vetta/runtime-core";
import type { DesktopPluginHookRegistration, DesktopPluginHookRegistry } from "./coding-agent-hook-registry.js";

export type RegisteredAgentTool = Omit<AgentPluginToolContribution, "pluginId"> & { activationId?: string };
export type RegisteredContinuationProvider = Omit<AgentPluginContinuationContribution, "pluginId"> & {
	activationId?: string;
};
export type RegisteredSystemPromptProvider = Omit<AgentPluginSystemPromptProviderContribution, "pluginId"> & {
	activationId?: string;
};

export interface PluginAgentContributionCounts {
	toolCount: number;
	hookCount: number;
	continuationCount: number;
}

/** Owns renderer-registered Agent contributions and rejects stale activation updates. */
export class PluginAgentContributionRegistry {
	private readonly activations = new Map<string, string>();
	private readonly tools = new Map<string, Map<string, RegisteredAgentTool>>();
	private readonly continuations = new Map<string, Map<string, RegisteredContinuationProvider>>();
	private readonly systemPrompts = new Map<string, Map<string, RegisteredSystemPromptProvider>>();

	constructor(private readonly hooks: DesktopPluginHookRegistry) {}

	beginLoad(pluginId: string, activationId: string): PluginAgentContributionCounts {
		this.activations.set(pluginId, activationId);
		const previous = this.counts(pluginId);
		this.tools.delete(pluginId);
		this.hooks.clear(pluginId);
		this.continuations.delete(pluginId);
		this.systemPrompts.delete(pluginId);
		return previous;
	}

	registerTool(pluginId: string, tool: RegisteredAgentTool): boolean {
		if (this.isStale(pluginId, tool.activationId)) return false;
		let tools = this.tools.get(pluginId);
		if (!tools) {
			tools = new Map();
			this.tools.set(pluginId, tools);
		}
		tools.set(tool.id, tool);
		return true;
	}

	unregisterTool(pluginId: string, toolId: string, activationId?: string): boolean {
		if (this.isStale(pluginId, activationId)) return false;
		const tools = this.tools.get(pluginId);
		const tool = tools?.get(toolId);
		if (!tools || (activationId && tool?.activationId && tool.activationId !== activationId)) return false;
		const deleted = tools.delete(toolId);
		if (tools.size === 0) this.tools.delete(pluginId);
		return deleted;
	}

	registerHook(pluginId: string, hook: DesktopPluginHookRegistration): boolean {
		if (hook.activationId !== undefined && hook.activationId !== this.activations.get(pluginId)) return false;
		this.hooks.register(pluginId, hook);
		return true;
	}

	unregisterHook(pluginId: string, hookId: string, activationId?: string): boolean {
		if (activationId !== undefined && activationId !== this.activations.get(pluginId)) return false;
		return this.hooks.unregister(pluginId, hookId, activationId);
	}

	registerContinuation(pluginId: string, provider: RegisteredContinuationProvider): boolean {
		if (this.isStale(pluginId, provider.activationId)) return false;
		let providers = this.continuations.get(pluginId);
		if (!providers) {
			providers = new Map();
			this.continuations.set(pluginId, providers);
		}
		providers.set(provider.id, provider);
		return true;
	}

	unregisterContinuation(pluginId: string, providerId: string, activationId?: string): boolean {
		return this.unregisterProvider(this.continuations, pluginId, providerId, activationId);
	}

	registerSystemPrompt(pluginId: string, provider: RegisteredSystemPromptProvider): boolean {
		if (this.isStale(pluginId, provider.activationId)) return false;
		let providers = this.systemPrompts.get(pluginId);
		if (!providers) {
			providers = new Map();
			this.systemPrompts.set(pluginId, providers);
		}
		providers.set(provider.id, provider);
		return true;
	}

	unregisterSystemPrompt(pluginId: string, providerId: string, activationId?: string): boolean {
		return this.unregisterProvider(this.systemPrompts, pluginId, providerId, activationId);
	}

	clear(pluginId: string, activationId?: string): PluginAgentContributionCounts | undefined {
		if (this.isStale(pluginId, activationId)) return undefined;
		const previous = this.counts(pluginId);
		this.tools.delete(pluginId);
		this.hooks.clear(pluginId);
		this.continuations.delete(pluginId);
		this.systemPrompts.delete(pluginId);
		if (!activationId || this.activations.get(pluginId) === activationId) this.activations.delete(pluginId);
		return previous;
	}

	getTools(pluginId: string): readonly RegisteredAgentTool[] {
		return [...(this.tools.get(pluginId)?.values() ?? [])];
	}

	getContinuations(pluginId: string): readonly RegisteredContinuationProvider[] {
		return [...(this.continuations.get(pluginId)?.values() ?? [])];
	}

	getSystemPrompts(pluginId: string): readonly RegisteredSystemPromptProvider[] {
		return [...(this.systemPrompts.get(pluginId)?.values() ?? [])];
	}

	getToolSummary(): readonly { pluginId: string; tools: readonly string[] }[] {
		return [...this.tools].map(([pluginId, tools]) => ({
			pluginId,
			tools: [...tools.values()].map((tool) => tool.name),
		}));
	}

	private counts(pluginId: string): PluginAgentContributionCounts {
		return {
			toolCount: this.tools.get(pluginId)?.size ?? 0,
			hookCount: this.hooks.count(pluginId),
			continuationCount: this.continuations.get(pluginId)?.size ?? 0,
		};
	}

	private isStale(pluginId: string, activationId: string | undefined): boolean {
		const current = this.activations.get(pluginId);
		return Boolean(activationId && current && activationId !== current);
	}

	private unregisterProvider<T extends { activationId?: string }>(
		registry: Map<string, Map<string, T>>,
		pluginId: string,
		providerId: string,
		activationId?: string,
	): boolean {
		if (this.isStale(pluginId, activationId)) return false;
		const providers = registry.get(pluginId);
		const provider = providers?.get(providerId);
		if (!providers || (activationId && provider?.activationId && provider.activationId !== activationId))
			return false;
		const deleted = providers.delete(providerId);
		if (providers.size === 0) registry.delete(pluginId);
		return deleted;
	}
}
