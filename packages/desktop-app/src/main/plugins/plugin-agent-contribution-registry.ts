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

interface PendingActivation {
	readonly activationId: string;
	readonly tools: Map<string, RegisteredAgentTool>;
	readonly hooks: Map<string, DesktopPluginHookRegistration>;
	readonly continuations: Map<string, RegisteredContinuationProvider>;
	readonly systemPrompts: Map<string, RegisteredSystemPromptProvider>;
}

export interface PendingPluginAgentContributions {
	readonly tools: readonly RegisteredAgentTool[];
	readonly hooks: readonly DesktopPluginHookRegistration[];
	readonly continuations: readonly RegisteredContinuationProvider[];
	readonly systemPrompts: readonly RegisteredSystemPromptProvider[];
}

/** Owns published Agent contributions plus one isolated activation candidate per plugin. */
export class PluginAgentContributionRegistry {
	private readonly activations = new Map<string, string>();
	private readonly pending = new Map<string, PendingActivation>();
	private readonly tools = new Map<string, Map<string, RegisteredAgentTool>>();
	private readonly continuations = new Map<string, Map<string, RegisteredContinuationProvider>>();
	private readonly systemPrompts = new Map<string, Map<string, RegisteredSystemPromptProvider>>();

	constructor(private readonly hooks: DesktopPluginHookRegistry) {}

	beginLoad(pluginId: string, activationId: string): PluginAgentContributionCounts {
		this.pending.set(pluginId, {
			activationId,
			tools: new Map(),
			hooks: new Map(),
			continuations: new Map(),
			systemPrompts: new Map(),
		});
		return this.counts(pluginId);
	}

	commit(pluginId: string, activationId: string): boolean {
		const candidate = this.pending.get(pluginId);
		if (!candidate || candidate.activationId !== activationId) return false;
		this.pending.delete(pluginId);
		this.activations.set(pluginId, activationId);
		setOrDelete(this.tools, pluginId, candidate.tools);
		setOrDelete(this.continuations, pluginId, candidate.continuations);
		setOrDelete(this.systemPrompts, pluginId, candidate.systemPrompts);
		this.hooks.clear(pluginId);
		for (const hook of candidate.hooks.values()) this.hooks.register(pluginId, hook);
		return true;
	}

	isPendingActivation(pluginId: string, activationId: string): boolean {
		return this.pending.get(pluginId)?.activationId === activationId;
	}

	readPending(pluginId: string, activationId: string): PendingPluginAgentContributions | undefined {
		const candidate = this.pending.get(pluginId);
		if (!candidate || candidate.activationId !== activationId) return undefined;
		return {
			tools: [...candidate.tools.values()],
			hooks: [...candidate.hooks.values()],
			continuations: [...candidate.continuations.values()],
			systemPrompts: [...candidate.systemPrompts.values()],
		};
	}

	registerTool(pluginId: string, tool: RegisteredAgentTool): boolean {
		const target = this.registrationTarget(pluginId, tool.activationId, this.tools, (pending) => pending.tools);
		if (!target) return false;
		target.set(tool.id, tool);
		return true;
	}

	unregisterTool(pluginId: string, toolId: string, activationId?: string): boolean {
		return this.unregisterProvider(this.tools, pluginId, toolId, activationId, (pending) => pending.tools);
	}

	registerHook(pluginId: string, hook: DesktopPluginHookRegistration): boolean {
		const candidate = this.pending.get(pluginId);
		if (hook.activationId !== undefined) {
			if (!candidate || candidate.activationId !== hook.activationId) return false;
			candidate.hooks.set(hook.id, hook);
			return true;
		}
		this.hooks.register(pluginId, hook);
		return true;
	}

	unregisterHook(pluginId: string, hookId: string, activationId?: string): boolean {
		const candidate = this.pending.get(pluginId);
		if (activationId !== undefined && candidate?.activationId === activationId) {
			return candidate.hooks.delete(hookId);
		}
		if (activationId !== undefined && activationId !== this.activations.get(pluginId)) return false;
		return this.hooks.unregister(pluginId, hookId, activationId);
	}

	registerContinuation(pluginId: string, provider: RegisteredContinuationProvider): boolean {
		const target = this.registrationTarget(
			pluginId,
			provider.activationId,
			this.continuations,
			(pending) => pending.continuations,
		);
		if (!target) return false;
		target.set(provider.id, provider);
		return true;
	}

	unregisterContinuation(pluginId: string, providerId: string, activationId?: string): boolean {
		return this.unregisterProvider(
			this.continuations,
			pluginId,
			providerId,
			activationId,
			(pending) => pending.continuations,
		);
	}

	registerSystemPrompt(pluginId: string, provider: RegisteredSystemPromptProvider): boolean {
		const target = this.registrationTarget(
			pluginId,
			provider.activationId,
			this.systemPrompts,
			(pending) => pending.systemPrompts,
		);
		if (!target) return false;
		target.set(provider.id, provider);
		return true;
	}

	unregisterSystemPrompt(pluginId: string, providerId: string, activationId?: string): boolean {
		return this.unregisterProvider(
			this.systemPrompts,
			pluginId,
			providerId,
			activationId,
			(pending) => pending.systemPrompts,
		);
	}

	clear(pluginId: string, activationId?: string): PluginAgentContributionCounts | undefined {
		const candidate = this.pending.get(pluginId);
		if (activationId !== undefined && candidate?.activationId === activationId) {
			this.pending.delete(pluginId);
			return countsOf(candidate);
		}
		if (activationId !== undefined && activationId !== this.activations.get(pluginId)) return undefined;
		const previous = this.counts(pluginId);
		this.tools.delete(pluginId);
		this.hooks.clear(pluginId);
		this.continuations.delete(pluginId);
		this.systemPrompts.delete(pluginId);
		this.activations.delete(pluginId);
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

	private registrationTarget<T>(
		pluginId: string,
		activationId: string | undefined,
		published: Map<string, Map<string, T>>,
		readPending: (pending: PendingActivation) => Map<string, T>,
	): Map<string, T> | undefined {
		if (activationId !== undefined) {
			const candidate = this.pending.get(pluginId);
			return candidate?.activationId === activationId ? readPending(candidate) : undefined;
		}
		let target = published.get(pluginId);
		if (!target) {
			target = new Map();
			published.set(pluginId, target);
		}
		return target;
	}

	private unregisterProvider<T extends { activationId?: string }>(
		published: Map<string, Map<string, T>>,
		pluginId: string,
		providerId: string,
		activationId: string | undefined,
		readPending: (pending: PendingActivation) => Map<string, T>,
	): boolean {
		if (activationId !== undefined) {
			const candidate = this.pending.get(pluginId);
			if (candidate?.activationId === activationId) return readPending(candidate).delete(providerId);
			if (activationId !== this.activations.get(pluginId)) return false;
		}
		const providers = published.get(pluginId);
		if (!providers) return false;
		const deleted = providers.delete(providerId);
		if (providers.size === 0) published.delete(pluginId);
		return deleted;
	}
}

function setOrDelete<T>(target: Map<string, Map<string, T>>, pluginId: string, values: Map<string, T>): void {
	if (values.size > 0) target.set(pluginId, values);
	else target.delete(pluginId);
}

function countsOf(candidate: PendingActivation): PluginAgentContributionCounts {
	return {
		toolCount: candidate.tools.size,
		hookCount: candidate.hooks.size,
		continuationCount: candidate.continuations.size,
	};
}
