import type {
	AgentPluginRuntimeConfig,
	AgentPluginTurnHandlerLease,
	AgentPluginTurnHandlerLeaseProvider,
	ContextCompositionSectionInput,
} from "@vetta/runtime-core";
import type {
	InstructionBlock,
	ModelCallFrame,
	ModelCallFrameComposer,
	ModelCallFrameCompositionContext,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import type {
	CodingAgentPluginMcpToolComposer,
	CodingAgentSystemPromptOptionsResolver,
} from "../runtime-contracts/index.js";
import { type BuildSystemPromptOptions, buildSystemPromptDraft } from "./product-prompt.js";
import { compileSystemPromptDraft, type SystemPromptDiagnostics, type SystemPromptDraft } from "./prompt-document.js";

export type CodingAgentSystemPromptOptions = Omit<BuildSystemPromptOptions, "selectedTools">;

export type {
	CodingAgentModelCallPromptContext,
	CodingAgentSystemPromptOptionsResolver,
} from "../runtime-contracts/index.js";

export interface CodingAgentModelCallFrameComposerOptions {
	readonly resolveSystemPromptOptions: CodingAgentSystemPromptOptionsResolver;
	readonly bindSystemPromptOptions?: (
		context: RuntimeSnapshotAcquireContext,
	) => CodingAgentSystemPromptOptionsResolver;
	readonly readMcpPromptState?: () => CodingAgentMcpPromptState;
	readonly readAvailableTools?: () => ReadonlyMap<string, RuntimeToolDefinition>;
	readonly readActiveToolNamesOverride?: () => readonly string[] | undefined;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpToolComposer;
	readonly readAgentMode?: () => string | undefined;
	readonly isMcpToolVisible?: (toolName: string) => boolean;
	readonly pluginRunOrchestrator?: CodingAgentModelCallPluginRunPort;
	readonly pluginToolRuntime?: CodingAgentModelCallPluginToolPort;
	readonly readAgentPlugins?: () => AgentPluginRuntimeConfig | undefined;
	readonly pluginHandlerLeaseProvider?: AgentPluginTurnHandlerLeaseProvider;
	/** 系统提示词额外公布、但不加入可执行 Tool Frame 的既有宿主工具名称。 */
	readonly systemPromptAdvertisedToolNames?: readonly string[];
	readonly wrapTools?: CodingAgentModelCallToolWrapper;
	readonly bindToolWrapper?: (context: RuntimeSnapshotAcquireContext) => {
		readonly wrapTools: CodingAgentModelCallToolWrapper;
		release(): Promise<void> | void;
	};
	readonly extensionEvents?: CodingAgentModelCallExtensionEvents;
	readonly extensionToolRuntime?: CodingAgentModelCallExtensionToolPort;
	readonly resolveExtensionToolActivation?: (context: ModelCallFrameCompositionContext) => CodingToolActivation;
	readonly bindExtensionToolActivation?: (
		context: RuntimeSnapshotAcquireContext,
	) => (context: ModelCallFrameCompositionContext) => CodingToolActivation;
	readonly onPromptDiagnostics?: (diagnostics: SystemPromptDiagnostics) => void;
	readonly releaseTurnBinding?: () => Promise<void> | void;
}

export interface CodingAgentMcpPromptState {
	readonly tools: readonly {
		readonly name: string;
		readonly description: string;
	}[];
	readonly deferred: boolean;
}

export interface CodingAgentModelCallToolSurface {
	readonly frame: ModelCallFrame;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
}

export interface CodingAgentModelCallExtensionEvents {
	recordSystemPrompt(systemPrompt: string): void;
}

export interface CodingAgentModelCallExtensionToolPort {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): CodingAgentModelCallExtensionToolPort;
	releaseTurnBinding?(): Promise<void> | void;
	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		activation: CodingToolActivation,
	): CodingAgentModelCallToolSurface;
	contributePrompt?(
		draft: SystemPromptDraft,
		input: { readonly sessionId: string; readonly activeToolNames: readonly string[] },
	): SystemPromptDraft;
}

export interface CodingAgentModelCallPluginToolPort {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): CodingAgentModelCallPluginToolPort;
	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
	): CodingAgentModelCallToolSurface;
}

export interface CodingAgentModelCallPluginRunPort {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): CodingAgentModelCallPluginRunPort;
	compose(input: {
		readonly context: ModelCallFrameCompositionContext;
		readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
		readonly createDraft: (activeToolNames: readonly string[]) => SystemPromptDraft;
	}): Promise<{
		readonly draft: SystemPromptDraft;
		readonly tools: ReadonlyMap<string, RuntimeToolDefinition>;
	}>;
}

export type CodingAgentModelCallToolWrapper = (
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	context: ModelCallFrameCompositionContext,
) => ReadonlyMap<string, RuntimeToolDefinition>;

/**
 * 在 Coding Agent 产品边界内把调用级资源编译成最终系统提示词。
 *
 * Runtime Core 只看到最终 InstructionBlock；Legacy 的 Prompt block、Plugin 静态操作、
 * Skill、Mode 与 Persona 等产品语义继续由既有结构化 Prompt 编译器解释。
 */
export class CodingAgentModelCallFrameComposer implements ModelCallFrameComposer {
	constructor(private readonly options: CodingAgentModelCallFrameComposerOptions) {}

	async bindForTurn(context: RuntimeSnapshotAcquireContext): Promise<ModelCallFrameComposer> {
		context.signal.throwIfAborted();
		const agentPlugins = this.options.readAgentPlugins?.();
		const pluginHandlerLeaseResult = this.options.pluginHandlerLeaseProvider?.bindForTurn(agentPlugins, {
			sessionId: context.sessionId,
			turnId: context.operationId,
			signal: context.signal,
		});
		const availableTools = this.options.readAvailableTools ? new Map(this.options.readAvailableTools()) : undefined;
		const activeToolNamesOverride = this.options.readActiveToolNamesOverride?.();
		const mcpPromptState = this.options.readMcpPromptState?.();
		const agentMode = this.options.readAgentMode?.();
		const visibleMcpTools = availableTools
			? new Set([...availableTools.keys()].filter((toolName) => this.options.isMcpToolVisible?.(toolName) ?? true))
			: undefined;
		const pluginMcpRuntime = this.options.pluginMcpRuntime?.bindForTurn?.(context) ?? this.options.pluginMcpRuntime;
		const extensionToolRuntime =
			this.options.extensionToolRuntime?.bindForTurn?.(context) ?? this.options.extensionToolRuntime;
		const boundToolWrapper = this.options.bindToolWrapper?.(context);
		const pluginRunOrchestrator =
			this.options.pluginRunOrchestrator?.bindForTurn?.(context) ?? this.options.pluginRunOrchestrator;
		const pluginToolRuntime =
			this.options.pluginToolRuntime?.bindForTurn?.(context) ?? this.options.pluginToolRuntime;
		const resolveExtensionToolActivation =
			this.options.bindExtensionToolActivation?.(context) ?? this.options.resolveExtensionToolActivation;
		const resolveSystemPromptOptions =
			this.options.bindSystemPromptOptions?.(context) ?? this.options.resolveSystemPromptOptions;
		let pluginHandlerLease: AgentPluginTurnHandlerLease | undefined;
		try {
			pluginHandlerLease = await pluginHandlerLeaseResult;
			context.signal.throwIfAborted();
		} catch (error) {
			await Promise.allSettled([
				pluginMcpRuntime?.releaseTurnBinding?.(),
				extensionToolRuntime?.releaseTurnBinding?.(),
				boundToolWrapper?.release(),
			]);
			throw error;
		}
		return new CodingAgentModelCallFrameComposer({
			...this.options,
			pluginRunOrchestrator,
			pluginToolRuntime,
			pluginMcpRuntime,
			extensionToolRuntime,
			resolveExtensionToolActivation,
			resolveSystemPromptOptions,
			readAvailableTools: availableTools ? () => availableTools : undefined,
			readActiveToolNamesOverride: () => activeToolNamesOverride,
			readMcpPromptState: mcpPromptState ? () => mcpPromptState : undefined,
			readAgentMode: () => agentMode,
			isMcpToolVisible: visibleMcpTools ? (toolName) => visibleMcpTools.has(toolName) : undefined,
			wrapTools: boundToolWrapper?.wrapTools ?? this.options.wrapTools,
			releaseTurnBinding: () =>
				releaseTurnBindings(pluginMcpRuntime, pluginHandlerLease, extensionToolRuntime, boundToolWrapper),
		});
	}

	releaseTurnBinding(): Promise<void> | void {
		return this.options.releaseTurnBinding?.();
	}

	async compose(context: ModelCallFrameCompositionContext): Promise<ModelCallFrame> {
		const prepared = await this.prepare(context);
		const pluginFrame = await this.options.pluginRunOrchestrator?.compose({
			context: prepared.effectiveContext,
			availableTools: prepared.availableTools,
			createDraft: prepared.createDraft,
		});
		const draft = prepared.override
			? prepared.createDraft(prepared.activeToolNames)
			: (pluginFrame?.draft ?? prepared.createDraft(prepared.activeToolNames));
		const selectedTools = prepared.override
			? new Map(
					prepared.activeToolNames.flatMap((toolName) =>
						prepared.availableTools.get(toolName) ? [[toolName, prepared.availableTools.get(toolName)!]] : [],
					),
				)
			: (pluginFrame?.tools ?? prepared.effectiveContext.frame.tools);
		const compiledPrompt = compileSystemPromptDraft(draft);
		this.options.onPromptDiagnostics?.(compiledPrompt.diagnostics);
		const systemPrompt = compiledPrompt.content;
		this.options.extensionEvents?.recordSystemPrompt(systemPrompt);
		const orderedTools = orderModelTools(selectedTools);
		const tools = this.options.wrapTools?.(orderedTools, prepared.effectiveContext) ?? orderedTools;
		return {
			instructions: [
				{
					id: "coding-agent.system-prompt",
					content: systemPrompt,
					priority: 0,
				},
			],
			tools,
			// 整段 Prompt 只落在这一个 InstructionBlock 里，因此编译期算出的切分点可以直接透传给 Provider。
			systemPromptStableLength: compiledPrompt.stableLength,
			contextCompositionSections: composeContextSections(draft, tools),
		};
	}

	/**
	 * 初始化 ExtensionContext.getSystemPrompt() 的同步基线。
	 *
	 * Legacy input 事件发生在 before_agent_start 之前，因此这里只编译基础 Prompt，
	 * 不运行可能产生调用级副作用的 Plugin orchestrator。
	 */
	async previewSystemPrompt(context: ModelCallFrameCompositionContext): Promise<string> {
		const prepared = await this.prepare(context);
		const compiledPrompt = compileSystemPromptDraft(prepared.createDraft(prepared.activeToolNames));
		this.options.onPromptDiagnostics?.(compiledPrompt.diagnostics);
		const systemPrompt = compiledPrompt.content;
		this.options.extensionEvents?.recordSystemPrompt(systemPrompt);
		return systemPrompt;
	}

	private async prepare(context: ModelCallFrameCompositionContext): Promise<PreparedModelCallFrame> {
		context.signal.throwIfAborted();
		const baseAvailableTools = new Map(this.options.readAvailableTools?.() ?? context.frame.tools);
		for (const [name, tool] of context.frame.tools) {
			baseAvailableTools.set(name, tool);
		}
		const extensionToolSurface = this.options.extensionToolRuntime?.compose(
			context,
			baseAvailableTools,
			this.options.resolveExtensionToolActivation?.(context) ?? { mode: "scope" },
		);
		const extensionContext: ModelCallFrameCompositionContext = extensionToolSurface
			? { ...context, frame: extensionToolSurface.frame }
			: context;
		const extensionAvailableTools = extensionToolSurface?.availableTools ?? baseAvailableTools;
		const pluginMcpSurface = this.options.pluginMcpRuntime?.compose(extensionContext, extensionAvailableTools, {
			agentMode: this.options.readAgentMode?.(),
			isToolVisible: this.options.isMcpToolVisible ?? (() => true),
		});
		const mcpContext: ModelCallFrameCompositionContext = pluginMcpSurface
			? { ...extensionContext, frame: pluginMcpSurface.frame }
			: extensionContext;
		const mcpAvailableTools = pluginMcpSurface?.availableTools ?? extensionAvailableTools;
		const pluginToolSurface = this.options.pluginToolRuntime?.compose(mcpContext, mcpAvailableTools);
		const effectiveContext: ModelCallFrameCompositionContext = pluginToolSurface
			? { ...mcpContext, frame: pluginToolSurface.frame }
			: mcpContext;
		const availableTools = pluginToolSurface?.availableTools ?? mcpAvailableTools;
		const override = this.options.readActiveToolNamesOverride?.();
		const activeToolNames = override
			? override.filter((toolName) => availableTools.has(toolName))
			: [...effectiveContext.frame.tools.keys()];
		const promptOptions = await this.options.resolveSystemPromptOptions({
			...effectiveContext,
			activeToolNames,
		});
		context.signal.throwIfAborted();
		const mcpPromptState = this.options.readMcpPromptState?.();
		const createDraft = (selectedTools: readonly string[]): SystemPromptDraft => {
			const advertisedTools = [
				...new Set([...selectedTools, ...(this.options.systemPromptAdvertisedToolNames ?? [])]),
			];
			const draft = buildSystemPromptDraft({
				...promptOptions,
				selectedTools: orderModelToolNames(advertisedTools, availableTools),
				toolDescriptions: Object.fromEntries([...availableTools].map(([name, tool]) => [name, tool.description])),
				...(mcpPromptState
					? {
							mcpTools: mcpPromptState.tools.map(({ name, description }) => ({ name, description })),
							mcpDeferred: mcpPromptState.deferred,
						}
					: {}),
			});
			appendFeatureInstructions(draft, effectiveContext.frame.instructions);
			return (
				this.options.extensionToolRuntime?.contributePrompt?.(draft, {
					sessionId: context.sessionId,
					activeToolNames: selectedTools,
				}) ?? draft
			);
		};
		return {
			effectiveContext,
			availableTools,
			override,
			activeToolNames,
			createDraft,
		};
	}
}

async function releaseTurnBindings(
	pluginMcpRuntime: CodingAgentPluginMcpToolComposer | undefined,
	pluginHandlerLease: AgentPluginTurnHandlerLease | undefined,
	extensionToolRuntime: CodingAgentModelCallExtensionToolPort | undefined,
	boundToolWrapper:
		| { readonly wrapTools: CodingAgentModelCallToolWrapper; release(): Promise<void> | void }
		| undefined,
): Promise<void> {
	const results = await Promise.allSettled([
		pluginMcpRuntime?.releaseTurnBinding?.(),
		pluginHandlerLease?.release(),
		extensionToolRuntime?.releaseTurnBinding?.(),
		boundToolWrapper?.release(),
	]);
	const errors = results
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map(({ reason }) => reason);
	if (errors.length > 0) throw new AggregateError(errors, "Failed to release Plugin Turn resources");
}

function composeContextSections(
	draft: SystemPromptDraft,
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
): readonly ContextCompositionSectionInput[] {
	const instructions = draft.blocks
		.filter((block) => block.enabled && block.content.length > 0)
		.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
		.map(
			(block): ContextCompositionSectionInput => ({
				id: `instruction:${block.id}`,
				kind: "instruction",
				category: block.type,
				source: {
					owner:
						block.type === "skills"
							? "skill"
							: block.type === "mcp"
								? "mcp"
								: block.source.kind === "plugin"
									? "plugin"
									: "core",
					id: block.source.pluginId ?? block.id,
				},
				content: block.content,
			}),
		);
	const toolSchemas = [...tools.values()].map(
		(tool): ContextCompositionSectionInput => ({
			id: `tool:${tool.name}`,
			kind: "tool_schema",
			category: tool.contextCategory,
			source: tool.contextSource ?? { owner: "runtime", id: tool.name },
			content: JSON.stringify({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}),
		}),
	);
	return [...instructions, ...toolSchemas];
}

interface PreparedModelCallFrame {
	readonly effectiveContext: ModelCallFrameCompositionContext;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
	readonly override: readonly string[] | undefined;
	readonly activeToolNames: readonly string[];
	readonly createDraft: (selectedTools: readonly string[]) => SystemPromptDraft;
}

function orderModelTools(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
): ReadonlyMap<string, RuntimeToolDefinition> {
	const entries = [...tools.entries()].map(([name, tool], sourceIndex) => ({ name, tool, sourceIndex }));
	entries.sort((left, right) => {
		const leftOrder = left.tool.modelOrder;
		const rightOrder = right.tool.modelOrder;
		if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
		if (leftOrder !== undefined) return -1;
		if (rightOrder !== undefined) return 1;
		return left.sourceIndex - right.sourceIndex;
	});
	return new Map(entries.map(({ name, tool }) => [name, tool]));
}

function orderModelToolNames(
	names: readonly string[],
	availableTools: ReadonlyMap<string, RuntimeToolDefinition>,
): string[] {
	return [...names]
		.map((name, sourceIndex) => ({ name, sourceIndex, modelOrder: availableTools.get(name)?.modelOrder }))
		.sort((left, right) => {
			if (left.modelOrder !== undefined && right.modelOrder !== undefined) {
				return left.modelOrder - right.modelOrder;
			}
			if (left.modelOrder !== undefined) return -1;
			if (right.modelOrder !== undefined) return 1;
			return left.sourceIndex - right.sourceIndex;
		})
		.map(({ name }) => name);
}

function appendFeatureInstructions(draft: SystemPromptDraft, instructions: readonly InstructionBlock[]): void {
	const blockIds = new Set(draft.blocks.map(({ id }) => id));
	for (const instruction of instructions) {
		if (blockIds.has(instruction.id)) {
			throw new Error(`Duplicate Coding Agent system prompt block id: ${instruction.id}`);
		}
		blockIds.add(instruction.id);
		draft.blocks.push({
			id: instruction.id,
			type: "plugin",
			source: { kind: "plugin", pluginId: `feature:${instruction.id}` },
			content: instruction.content,
			priority: instruction.priority,
			enabled: instruction.content.length > 0,
		});
	}
}
