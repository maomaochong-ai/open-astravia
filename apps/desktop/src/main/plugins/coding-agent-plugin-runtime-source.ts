import type { CodingAgentPluginRuntimeSource } from "@vetta/coding-agent/host-services";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	AgentPluginTurnHandlerLeaseProvider,
} from "@vetta/runtime-core";

export interface DesktopCodingAgentPluginRuntimeSourceOptions {
	readonly build: () => AgentPluginRuntimeConfig | undefined;
	readonly additionalSkillPaths: readonly string[];
	readonly handlerLeaseProvider: AgentPluginTurnHandlerLeaseProvider;
}

/** Desktop Plugin host 到 Coding Agent 产品 Plugin Runtime 的唯一动态 Source。 */
export class DesktopCodingAgentPluginRuntimeSource implements CodingAgentPluginRuntimeSource {
	private current: AgentPluginRuntimeConfig | undefined;
	private initialized = false;
	private toolInvoker: AgentPluginToolInvoker | undefined;
	private continuationInvoker: AgentPluginContinuationInvoker | undefined;
	private systemPromptInvoker: AgentPluginSystemPromptInvoker | undefined;
	private readonly listeners = new Set<() => void>();

	readonly handlerLeaseProvider: AgentPluginTurnHandlerLeaseProvider;

	constructor(private readonly options: DesktopCodingAgentPluginRuntimeSourceOptions) {
		this.handlerLeaseProvider = options.handlerLeaseProvider;
	}

	readonly readAgentPlugins = (): AgentPluginRuntimeConfig | undefined => {
		if (!this.initialized) {
			this.current = this.withAdditionalSkills(this.options.build());
			this.initialized = true;
		}
		return this.current;
	};

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	readonly invokeTool: AgentPluginToolInvoker = (invocation, signal) => {
		const invoke = this.toolInvoker;
		if (!invoke) return Promise.reject(new Error("Desktop Plugin tool host is unavailable"));
		return invoke(invocation, signal);
	};

	readonly invokeContinuation: AgentPluginContinuationInvoker = (invocation, signal) => {
		return this.continuationInvoker?.(invocation, signal) ?? Promise.resolve({ value: null, effects: [] });
	};

	readonly invokeSystemPrompt: AgentPluginSystemPromptInvoker = (invocation, signal) => {
		return this.systemPromptInvoker?.(invocation, signal) ?? Promise.resolve([]);
	};

	publish(agentPlugins: AgentPluginRuntimeConfig | undefined): void {
		this.current = this.withAdditionalSkills(agentPlugins);
		this.initialized = true;
		for (const listener of this.listeners) listener();
	}

	setToolInvoker(invoker: AgentPluginToolInvoker | undefined): void {
		this.toolInvoker = invoker;
	}

	setContinuationInvoker(invoker: AgentPluginContinuationInvoker | undefined): void {
		this.continuationInvoker = invoker;
	}

	setSystemPromptInvoker(invoker: AgentPluginSystemPromptInvoker | undefined): void {
		this.systemPromptInvoker = invoker;
	}

	private withAdditionalSkills(
		agentPlugins: AgentPluginRuntimeConfig | undefined,
	): AgentPluginRuntimeConfig | undefined {
		if (this.options.additionalSkillPaths.length === 0) return agentPlugins;
		return {
			...(agentPlugins ?? {}),
			skillPathContributions: [
				...(agentPlugins?.skillPathContributions ?? []),
				{
					pluginId: "desktop:builtin-skills",
					paths: [...this.options.additionalSkillPaths],
				},
			],
		};
	}
}
