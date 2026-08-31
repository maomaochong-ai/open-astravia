import type { CodingAgentPluginRuntimeSource } from "@vetta/coding-agent/host-services";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	AgentPluginTurnHandlerLeaseProvider,
} from "@vetta/coding-agent/plugin-runtime";

export interface DesktopCodingAgentPluginRuntimeSourceOptions {
	readonly build: () => AgentPluginRuntimeConfig | undefined;
	readonly additionalSkillPaths: readonly string[];
	/** Optional live source for built-in paths that can change while Desktop stays open. */
	readonly readAdditionalSkillPaths?: () => readonly string[];
	readonly handlerLeaseProvider: AgentPluginTurnHandlerLeaseProvider;
	readonly readPluginIds?: () => readonly string[];
}

/** Desktop Plugin host 到 Coding Agent 产品 Plugin Runtime 的唯一动态 Source。 */
export class DesktopCodingAgentPluginRuntimeSource implements CodingAgentPluginRuntimeSource {
	private current: AgentPluginRuntimeConfig | undefined;
	private base: AgentPluginRuntimeConfig | undefined;
	private additionalSkillPathsSnapshot: readonly string[] = [];
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
			this.base = this.options.build();
			this.additionalSkillPathsSnapshot = this.readAdditionalSkillPaths();
			this.current = this.withAdditionalSkills(this.base, this.additionalSkillPathsSnapshot);
			this.initialized = true;
		} else {
			const nextPaths = this.readAdditionalSkillPaths();
			if (!samePaths(nextPaths, this.additionalSkillPathsSnapshot)) {
				this.additionalSkillPathsSnapshot = nextPaths;
				this.current = this.withAdditionalSkills(this.base, nextPaths);
				for (const listener of this.listeners) listener();
			}
		}
		return this.current;
	};

	readonly readPluginIds = (): readonly string[] => this.options.readPluginIds?.() ?? [];

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
		this.base = agentPlugins;
		this.additionalSkillPathsSnapshot = this.readAdditionalSkillPaths();
		this.current = this.withAdditionalSkills(this.base, this.additionalSkillPathsSnapshot);
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

	private readAdditionalSkillPaths(): readonly string[] {
		return this.options.readAdditionalSkillPaths?.() ?? this.options.additionalSkillPaths;
	}

	private withAdditionalSkills(
		agentPlugins: AgentPluginRuntimeConfig | undefined,
		additionalSkillPaths: readonly string[],
	): AgentPluginRuntimeConfig | undefined {
		if (additionalSkillPaths.length === 0) return agentPlugins;
		return {
			...(agentPlugins ?? {}),
			skillPathContributions: [
				...(agentPlugins?.skillPathContributions ?? []),
				{
					pluginId: "desktop:builtin-skills",
					paths: [...additionalSkillPaths],
				},
			],
		};
	}
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((path, index) => path === right[index]);
}
