import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
	RuntimeToolExecutionRequest,
	RuntimeToolResult,
} from "@vetta/runtime-core/kernel";
import { RuntimeToolExecutionError } from "@vetta/runtime-core/kernel";
import type {
	AgentPluginRuntimeConfig,
	AgentPluginToolContribution,
	AgentPluginToolInvoker,
} from "../../model-context/index.js";
import { type ConversationScenario, resolveActiveToolNames } from "../../profiles/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { CodingAgentPluginRunOrchestrator } from "./run-orchestrator.js";
import { validatePluginToolHandlerResult } from "./runtime-effect-schema.js";

export type CodingAgentPluginToolActivation =
	| {
			readonly mode: "explicit";
			readonly toolNames: readonly string[];
	  }
	| {
			readonly mode: "scope";
			readonly scenario: ConversationScenario;
			readonly capabilities?: ReadonlySet<string>;
			readonly additionallyEnabledToolNames?: readonly string[];
			readonly agentMode?: string;
	  };

export interface CodingAgentPluginToolRuntimeOptions {
	readonly readAgentPlugins: () => AgentPluginRuntimeConfig | undefined;
	readonly invokeTool?: AgentPluginToolInvoker;
	readonly runOrchestrator: CodingAgentPluginRunOrchestrator;
	readonly resolveActivation: (context: ModelCallFrameCompositionContext) => CodingAgentPluginToolActivation;
	/**
	 * 标记在既有注册顺序中晚于 Plugin Tool 的宿主工具。
	 * 这些工具发生同名冲突时保留宿主实现，例如动态 MCP Tool。
	 */
	readonly shouldPreserveBaseTool?: (toolName: string) => boolean;
	readonly now?: () => number;
}

export interface CodingAgentPluginToolSurface {
	readonly frame: ModelCallFrame;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
}

/**
 * Session-local Plugin Tool 编译器。
 *
 * 每次模型调用读取最新贡献并生成本次调用的工具表；工具不会写入共享 Registry。
 * 工具真正执行前会再次确认贡献仍存在，避免宿主在运行中撤销工具后继续调用旧 handler。
 */
export class CodingAgentPluginToolRuntime {
	private readonly now: () => number;

	constructor(private readonly options: CodingAgentPluginToolRuntimeOptions) {
		this.now = options.now ?? Date.now;
	}

	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
	): CodingAgentPluginToolSurface {
		const config = this.options.readAgentPlugins();
		const contributions = this.options.invokeTool
			? resolveWinningToolContributions(config?.toolContributions ?? [])
			: new Map<string, AgentPluginToolContribution>();
		const availableTools = new Map(baseAvailableTools);
		const activeTools = new Map(context.frame.tools);
		const activation = this.options.resolveActivation(context);

		for (const [name, contribution] of contributions) {
			if (this.shouldPreserveBaseTool(name, baseAvailableTools)) continue;
			const tool = this.createToolDefinition(contribution, context);
			availableTools.set(name, tool);
			if (isContributionActive(contribution, activation)) {
				activeTools.set(name, tool);
			} else {
				activeTools.delete(name);
			}
		}

		for (const policy of config?.toolPolicyContributions ?? []) {
			for (const name of policy.allow ?? []) {
				const tool = availableTools.get(name);
				if (tool) activeTools.set(name, tool);
			}
			for (const name of policy.deny ?? []) {
				activeTools.delete(name);
			}
		}

		return {
			frame: {
				instructions: context.frame.instructions,
				tools: activeTools,
			},
			availableTools,
		};
	}

	private createToolDefinition(
		contribution: AgentPluginToolContribution,
		context: ModelCallFrameCompositionContext,
	): RuntimeToolDefinition {
		return {
			name: contribution.name,
			label: contribution.label ?? contribution.name,
			description: contribution.description,
			modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.plugin,
			inputSchema: contribution.rendersCard
				? (withMdIntroParameter(contribution.parameters) as Readonly<Record<string, unknown>>)
				: contribution.parameters,
			execute: (request) => this.executeContribution(contribution, context, request),
		};
	}

	private async executeContribution(
		advertised: AgentPluginToolContribution,
		context: ModelCallFrameCompositionContext,
		request: RuntimeToolExecutionRequest,
	): Promise<RuntimeToolResult> {
		const current = resolveWinningToolContributions(this.options.readAgentPlugins()?.toolContributions ?? []).get(
			advertised.name,
		);
		if (!current || !isSameContribution(advertised, current)) {
			throw new RuntimeToolExecutionError(`Plugin tool is no longer available: ${advertised.name}`, {
				code: "plugin_tool_revoked",
				retryable: false,
				metadata: {
					pluginId: advertised.pluginId,
					toolId: advertised.id,
					toolName: advertised.name,
				},
			});
		}

		const invoke = this.options.invokeTool;
		if (!invoke) {
			throw new RuntimeToolExecutionError(
				`Plugin tool is unavailable because no host bridge is registered: ${advertised.name}`,
				{
					code: "plugin_tool_bridge_unavailable",
					retryable: false,
					metadata: {
						pluginId: advertised.pluginId,
						toolId: advertised.id,
						toolName: advertised.name,
					},
				},
			);
		}

		const messages = request.messages ?? context.messages;
		const rawResult = await invokeWithTimeout(
			(signal) =>
				invoke(
					{
						pluginId: current.pluginId,
						toolId: current.id,
						toolName: current.name,
						handlerId: current.handlerId,
						input: current.rendersCard ? stripMdIntroParameter(request.input) : request.input,
						...this.options.runOrchestrator.createToolHandlerContext({
							turnId: request.turnId,
							messages,
							modelBinding: context.modelBinding,
							includeMessages: current.context?.conversation === "messages",
						}),
						trigger: {
							kind: "tool-call",
							timestamp: this.now(),
							toolCallId: request.toolCallId,
						},
					},
					signal,
				),
			request.signal,
			current.timeoutMs,
		);
		const result = validatePluginToolHandlerResult(rawResult);
		this.options.runOrchestrator.commitToolEffects(request.turnId, current.pluginId, result.effects);
		const { cards, rest } = liftPluginToolCards(result.value);
		return {
			content: [{ type: "text", text: formatPluginToolResult(rest) }],
			details: {
				pluginId: current.pluginId,
				toolId: current.id,
				result: rest,
				...(cards ? { cards } : {}),
			},
		};
	}

	private shouldPreserveBaseTool(
		name: string,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
	): boolean {
		return baseAvailableTools.has(name) && this.options.shouldPreserveBaseTool?.(name) === true;
	}
}

function isContributionActive(
	contribution: AgentPluginToolContribution,
	activation: CodingAgentPluginToolActivation,
): boolean {
	if (activation.mode === "explicit") {
		return activation.toolNames.includes(contribution.name);
	}
	if (activation.additionallyEnabledToolNames?.includes(contribution.name)) {
		return true;
	}
	return (
		resolveActiveToolNames(
			activation.scenario,
			[contribution],
			activation.capabilities ?? new Set<string>(),
			activation.agentMode,
		).length > 0
	);
}

function resolveWinningToolContributions(
	contributions: readonly AgentPluginToolContribution[],
): ReadonlyMap<string, AgentPluginToolContribution> {
	const winning = new Map<string, AgentPluginToolContribution>();
	for (const contribution of contributions) {
		winning.set(contribution.name, contribution);
	}
	return winning;
}

function isSameContribution(advertised: AgentPluginToolContribution, current: AgentPluginToolContribution): boolean {
	return (
		advertised.pluginId === current.pluginId &&
		advertised.id === current.id &&
		advertised.handlerId === current.handlerId &&
		advertised.name === current.name
	);
}

const MD_INTRO_PARAM = "md_intro";

const MD_INTRO_PROPERTY = {
	type: "string",
	description:
		"Optional markdown rendered directly above this call's result card, as the lead-in the reader sees before the deliverable. Structure it from context, do not toss in a careless sentence: (a) the card already has its own title/subtitle (most do) — write ONE sentence stating its headline finding in the user's language, and do not repeat that title; (b) the deliverable has no built-in title, or the reader needs a line of context to read it — lead with a short **bold headline line**, then one or two sentences of body below it; (c) a minor inline artifact — a single sentence is enough. Never put data scope, sources, methodology or caveats here; those belong in the card's own title/subtitle. Omit entirely when the call is not part of your answer.",
	maxLength: 600,
};

export function withMdIntroParameter(parameters: unknown): unknown {
	if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) return parameters;
	const schema = parameters as Record<string, unknown>;
	const properties = schema.properties;
	if (typeof properties !== "object" || properties === null) return parameters;
	if (MD_INTRO_PARAM in properties) return parameters;
	return {
		...schema,
		properties: { ...properties, [MD_INTRO_PARAM]: MD_INTRO_PROPERTY },
	};
}

export function stripMdIntroParameter(params: unknown): unknown {
	if (typeof params !== "object" || params === null || Array.isArray(params)) return params;
	if (!(MD_INTRO_PARAM in params)) return params;
	const { [MD_INTRO_PARAM]: _dropped, ...rest } = params;
	return rest;
}

function liftPluginToolCards(result: unknown): { readonly cards?: unknown[]; readonly rest: unknown } {
	if (!result || typeof result !== "object" || Array.isArray(result)) return { rest: result };
	const record = result as Record<string, unknown>;
	if (!Array.isArray(record.cards)) return { rest: result };
	const { cards, ...rest } = record;
	return { cards, rest };
}

function formatPluginToolResult(result: unknown): string {
	if (result === undefined) return "Plugin tool completed without a return value.";
	if (typeof result === "string") return result;
	if (typeof result === "object" && result !== null) {
		const record = result as Record<string, unknown>;
		if (typeof record.text === "string") return record.text;
		if (typeof record.content === "string") return record.content;
	}
	return JSON.stringify(result, null, 2);
}

async function invokeWithTimeout<T>(
	invoke: (signal: AbortSignal) => Promise<T>,
	signal: AbortSignal,
	timeoutMs: number | undefined,
): Promise<T> {
	if (!timeoutMs || timeoutMs <= 0) {
		return invoke(signal);
	}
	const controller = new AbortController();
	const onAbort = (): void => controller.abort(signal.reason);
	if (signal.aborted) controller.abort(signal.reason);
	else signal.addEventListener("abort", onAbort, { once: true });
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => {
				controller.abort();
				reject(new Error(`Plugin tool timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		return await Promise.race([invoke(controller.signal), timeoutPromise]);
	} finally {
		if (timeout) clearTimeout(timeout);
		signal.removeEventListener("abort", onAbort);
	}
}
