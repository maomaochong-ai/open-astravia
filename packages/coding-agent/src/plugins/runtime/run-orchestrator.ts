import type { Message, UserMessage } from "@vetta/ai";
import type {
	ContinuationPolicy,
	ContinuationPolicyContext,
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import type {
	AgentPluginContinuationContribution,
	AgentPluginContinuationResult,
	AgentPluginRuntimeConfig,
	AgentPluginRuntimeEffect,
	AgentPluginSystemPromptInvocation,
	AgentPluginToolInvocation,
	SystemPromptDraft,
	SystemPromptOperation,
} from "../../model-context/index.js";
import { applySystemPromptOperations, renderSystemPromptDraft } from "../../model-context/index.js";
import type { CodingAgentPluginRuntimeSource } from "../../runtime-contracts/index.js";
import { validatePluginContinuationHandlerResult, validatePluginRuntimeEffects } from "./runtime-effect-schema.js";

const DEFAULT_PLUGIN_PROVIDER_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_PLUGIN_CONTINUATIONS_PER_TURN = 8;

export type { CodingAgentPluginRuntimeSource } from "../../runtime-contracts/index.js";

export interface CodingAgentPluginProviderFailure {
	readonly kind: "system-prompt" | "continuation";
	readonly pluginId: string;
	readonly providerId: string;
	readonly error: unknown;
}

export interface CodingAgentPluginRunOrchestratorOptions extends CodingAgentPluginRuntimeSource {
	readonly session: {
		readonly id: string;
		readonly cwd: string;
		readonly scenario: string;
	};
	readonly now?: () => number;
	readonly maxContinuationsPerTurn?: number;
	readonly onProviderFailure?: (failure: CodingAgentPluginProviderFailure) => void;
}

export interface CodingAgentPluginFrameCompositionInput {
	readonly context: ModelCallFrameCompositionContext;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
	readonly createDraft: (activeToolNames: readonly string[]) => SystemPromptDraft;
}

export interface CodingAgentPluginFrameComposition {
	readonly draft: SystemPromptDraft;
	readonly tools: ReadonlyMap<string, RuntimeToolDefinition>;
}

interface AppliedPromptEffects {
	readonly pluginId: string;
	readonly operations: readonly SystemPromptOperation[];
}

interface AppliedToolEffect {
	readonly toolName: string;
	readonly enabled: boolean;
}

interface PendingEffects {
	readonly pluginId: string;
	readonly effects: readonly AgentPluginRuntimeEffect[];
}

interface RequestedContinuation {
	readonly pluginId: string;
	readonly result: AgentPluginContinuationResult;
}

interface PluginTurnState {
	readonly turnId: string;
	readonly runIndex: number;
	readonly promptEffects: AppliedPromptEffects[];
	readonly toolEffects: AppliedToolEffect[];
	readonly requestedContinuations: RequestedContinuation[];
	continuationCount: number;
	lastActiveToolNames: readonly string[];
	lastAvailableToolNames: readonly string[];
}

/**
 * Session 独占的 Plugin Run 编排器。
 *
 * Provider 在一个 Turn 内只执行一次；它产出的 Prompt/Tool effect 会在同一 Turn
 * 的后续模型调用上重放。Continuation Provider 的 effect 延迟到下一个 Turn，
 * 与既有“next agent run”语义一致。
 */
export class CodingAgentPluginRunOrchestrator implements ContinuationPolicy {
	private readonly now: () => number;
	private readonly maxContinuationsPerTurn: number;
	private readonly seenContinuationKeys = new Set<string>();
	private readonly pendingNextTurnEffects: PendingEffects[] = [];
	private activeTurn: PluginTurnState | undefined;
	private nextRunIndex = 0;

	constructor(private readonly options: CodingAgentPluginRunOrchestratorOptions) {
		this.now = options.now ?? Date.now;
		this.maxContinuationsPerTurn = options.maxContinuationsPerTurn ?? DEFAULT_MAX_PLUGIN_CONTINUATIONS_PER_TURN;
	}

	readActiveToolNames(): readonly string[] | undefined {
		return this.activeTurn ? [...this.activeTurn.lastActiveToolNames] : undefined;
	}

	readSession(): CodingAgentPluginRunOrchestratorOptions["session"] {
		return this.options.session;
	}

	createToolHandlerContext(input: {
		readonly turnId: string;
		readonly messages: readonly Message[];
		readonly modelBinding: ModelCallFrameCompositionContext["modelBinding"];
		readonly includeMessages: boolean;
	}): Pick<AgentPluginToolInvocation, "session" | "model" | "conversation" | "runtime"> {
		const state = this.requireActiveTurn(input.turnId);
		return {
			session: this.options.session,
			model: toPluginModel(input),
			conversation: toPluginConversation(input.messages, input.includeMessages),
			runtime: {
				activeToolNames: [...state.lastActiveToolNames],
				availableToolNames: [...state.lastAvailableToolNames],
				runIndex: state.runIndex + 1,
			},
		};
	}

	commitToolEffects(turnId: string, pluginId: string, effects: readonly AgentPluginRuntimeEffect[]): void {
		this.applyEffects(this.requireActiveTurn(turnId), pluginId, effects);
	}

	async compose(input: CodingAgentPluginFrameCompositionInput): Promise<CodingAgentPluginFrameComposition> {
		input.context.signal.throwIfAborted();
		let state = this.activeTurn;
		if (!state || state.turnId !== input.context.turnId) {
			state = this.createTurnState(input.context.turnId);
			this.activeTurn = state;
			this.applyPendingEffects(state);
			await this.invokeSystemPromptProviders(state, input);
		}

		const activeToolNames = replayToolEffects(
			[...input.context.frame.tools.keys()],
			state.toolEffects,
			input.availableTools,
		);
		state.lastActiveToolNames = activeToolNames;
		state.lastAvailableToolNames = [...input.availableTools.keys()];
		return {
			draft: replayPromptEffects(input.createDraft(activeToolNames), state.promptEffects),
			tools: new Map(
				activeToolNames.flatMap((name) => {
					const tool = input.availableTools.get(name);
					return tool ? [[name, tool] as const] : [];
				}),
			),
		};
	}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		const state = this.activeTurn;
		if (!state || state.turnId !== context.turnId) return [];
		if (context.signal.aborted || state.continuationCount >= this.maxContinuationsPerTurn) return [];

		const requested = this.takeRequestedContinuation(state);
		if (requested) {
			state.continuationCount += 1;
			return [this.toContinuationMessage(requested)];
		}

		const invoke = this.options.invokeContinuation;
		if (!invoke) return [];
		const contributions = sortContributions(this.options.readAgentPlugins()?.continuationContributions ?? []);
		for (const contribution of contributions) {
			if (context.signal.aborted) return [];
			try {
				const rawResult = await invokeWithTimeout(
					(providerSignal) =>
						invoke(this.createContinuationInvocation(state, contribution, context), providerSignal),
					context.signal,
					contribution.timeoutMs ?? DEFAULT_PLUGIN_PROVIDER_TIMEOUT_MS,
				);
				const result = validatePluginContinuationHandlerResult(rawResult);
				const text = result.value?.text.trim();
				if (!text) {
					this.queueNextTurnEffects(contribution.pluginId, result.effects);
					continue;
				}
				const idempotencyKey = result.value?.idempotencyKey;
				if (
					idempotencyKey &&
					!this.markContinuationKey(`${contribution.pluginId}:${contribution.id}:${idempotencyKey}`)
				) {
					continue;
				}
				this.queueNextTurnEffects(contribution.pluginId, result.effects);
				state.continuationCount += 1;
				return [this.toContinuationMessage(text)];
			} catch (error) {
				this.reportFailure("continuation", contribution.pluginId, contribution.id, error);
			}
		}
		return [];
	}

	private createTurnState(turnId: string): PluginTurnState {
		const state: PluginTurnState = {
			turnId,
			runIndex: this.nextRunIndex,
			promptEffects: [],
			toolEffects: [],
			requestedContinuations: [],
			continuationCount: 0,
			lastActiveToolNames: [],
			lastAvailableToolNames: [],
		};
		this.nextRunIndex += 1;
		return state;
	}

	private requireActiveTurn(turnId: string): PluginTurnState {
		const state = this.activeTurn;
		if (!state || state.turnId !== turnId) {
			throw new Error(`Plugin tool execution does not belong to the active turn: ${turnId}`);
		}
		return state;
	}

	private applyPendingEffects(state: PluginTurnState): void {
		for (const pending of this.pendingNextTurnEffects.splice(0)) {
			this.applyEffects(state, pending.pluginId, pending.effects);
		}
	}

	private async invokeSystemPromptProviders(
		state: PluginTurnState,
		input: CodingAgentPluginFrameCompositionInput,
	): Promise<void> {
		const invoke = this.options.invokeSystemPrompt;
		if (!invoke) return;
		const providers = sortContributions(this.options.readAgentPlugins()?.systemPromptProviderContributions ?? []);
		const baseActiveToolNames = [...input.context.frame.tools.keys()];
		const baseDraft = input.createDraft(baseActiveToolNames);
		for (const provider of providers) {
			try {
				const activeToolNames = replayToolEffects(baseActiveToolNames, state.toolEffects, input.availableTools);
				const currentDraft = replayPromptEffects(input.createDraft(activeToolNames), state.promptEffects);
				const rawEffects = await invokeWithTimeout(
					(providerSignal) =>
						invoke(
							this.createSystemPromptInvocation(
								state,
								provider,
								input.context,
								baseDraft,
								currentDraft,
								activeToolNames,
								[...input.availableTools.keys()],
							),
							providerSignal,
						),
					input.context.signal,
					provider.timeoutMs ?? DEFAULT_PLUGIN_PROVIDER_TIMEOUT_MS,
				);
				this.applyEffects(state, provider.pluginId, validatePluginRuntimeEffects(rawEffects));
			} catch (error) {
				this.reportFailure("system-prompt", provider.pluginId, provider.id, error);
			}
		}
	}

	private createSystemPromptInvocation(
		state: PluginTurnState,
		provider: NonNullable<AgentPluginRuntimeConfig["systemPromptProviderContributions"]>[number],
		context: ModelCallFrameCompositionContext,
		baseDraft: SystemPromptDraft,
		currentDraft: SystemPromptDraft,
		activeToolNames: readonly string[],
		availableToolNames: readonly string[],
	): AgentPluginSystemPromptInvocation {
		const contextMode = provider.context?.systemPrompt ?? "none";
		const conversationMode = provider.context?.conversation ?? "summary";
		return {
			pluginId: provider.pluginId,
			providerId: provider.id,
			handlerId: provider.handlerId,
			session: this.options.session,
			model: toPluginModel(context),
			conversation: toPluginConversation(context.messages, conversationMode === "messages"),
			runtime: {
				activeToolNames: [...activeToolNames],
				availableToolNames: [...availableToolNames],
				runIndex: state.runIndex,
			},
			trigger: { kind: "agent-run", timestamp: this.now() },
			systemPrompt:
				contextMode === "none"
					? undefined
					: {
							base: promptView(baseDraft, contextMode),
							current: promptView(currentDraft, contextMode),
						},
		};
	}

	private createContinuationInvocation(
		state: PluginTurnState,
		contribution: AgentPluginContinuationContribution,
		context: ContinuationPolicyContext,
	) {
		return {
			pluginId: contribution.pluginId,
			providerId: contribution.id,
			handlerId: contribution.handlerId,
			session: this.options.session,
			model: toPluginModel(context),
			conversation: toPluginConversation(context.messages, contribution.context?.conversation === "messages"),
			runtime: {
				activeToolNames: [...state.lastActiveToolNames],
				availableToolNames: [...state.lastAvailableToolNames],
				runIndex: state.runIndex + 1,
			},
			trigger: { kind: "continuation" as const, timestamp: this.now() },
		};
	}

	private applyEffects(state: PluginTurnState, pluginId: string, effects: readonly AgentPluginRuntimeEffect[]): void {
		const promptOperations: SystemPromptOperation[] = [];
		for (const effect of effects) {
			if (effect.type === "setToolEnabled") {
				state.toolEffects.push({ toolName: effect.toolName, enabled: effect.enabled });
			} else if (effect.type === "requestContinuation") {
				state.requestedContinuations.push({ pluginId, result: effect.result });
			} else {
				promptOperations.push(effect);
			}
		}
		if (promptOperations.length > 0) {
			state.promptEffects.push({ pluginId, operations: promptOperations });
		}
	}

	private queueNextTurnEffects(pluginId: string, effects: readonly AgentPluginRuntimeEffect[]): void {
		if (effects.length > 0) {
			this.pendingNextTurnEffects.push({ pluginId, effects: [...effects] });
		}
	}

	private takeRequestedContinuation(state: PluginTurnState): string | undefined {
		while (state.requestedContinuations.length > 0) {
			const requested = state.requestedContinuations.shift();
			if (!requested) return undefined;
			const text = requested.result.text.trim();
			if (!text) continue;
			const idempotencyKey = requested.result.idempotencyKey;
			if (idempotencyKey && !this.markContinuationKey(`${requested.pluginId}:action:${idempotencyKey}`)) {
				continue;
			}
			return text;
		}
		return undefined;
	}

	private markContinuationKey(key: string): boolean {
		if (this.seenContinuationKeys.has(key)) return false;
		this.seenContinuationKeys.add(key);
		return true;
	}

	private toContinuationMessage(text: string): UserMessage {
		return {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: this.now(),
		};
	}

	private reportFailure(
		kind: CodingAgentPluginProviderFailure["kind"],
		pluginId: string,
		providerId: string,
		error: unknown,
	): void {
		const failure = { kind, pluginId, providerId, error };
		if (this.options.onProviderFailure) {
			this.options.onProviderFailure(failure);
			return;
		}
		console.warn(`[plugin-agent] ${kind} provider failed: ${pluginId}/${providerId}`, error);
	}
}

function replayPromptEffects(draft: SystemPromptDraft, effects: readonly AppliedPromptEffects[]): SystemPromptDraft {
	let current = draft;
	for (const contribution of effects) {
		current = applySystemPromptOperations(current, contribution.pluginId, contribution.operations);
	}
	return current;
}

function replayToolEffects(
	baseToolNames: readonly string[],
	effects: readonly AppliedToolEffect[],
	availableTools: ReadonlyMap<string, RuntimeToolDefinition>,
): readonly string[] {
	const active = new Set(baseToolNames.filter((name) => availableTools.has(name)));
	for (const effect of effects) {
		if (effect.enabled && availableTools.has(effect.toolName)) active.add(effect.toolName);
		else if (!effect.enabled) active.delete(effect.toolName);
	}
	return [...active];
}

function promptView(
	draft: SystemPromptDraft,
	mode: "blocks" | "rendered" | "full",
): { blocks?: SystemPromptDraft["blocks"]; rendered?: string } {
	return {
		blocks: mode === "blocks" || mode === "full" ? cloneDraft(draft).blocks : undefined,
		rendered: mode === "rendered" || mode === "full" ? renderSystemPromptDraft(cloneDraft(draft)) : undefined,
	};
}

function cloneDraft(draft: SystemPromptDraft): SystemPromptDraft {
	return {
		blocks: draft.blocks.map((block) => ({ ...block, source: { ...block.source } })),
		metadata: { ...draft.metadata },
	};
}

function toPluginModel(
	context: Pick<ModelCallFrameCompositionContext, "modelBinding"> | Pick<ContinuationPolicyContext, "modelBinding">,
): AgentPluginSystemPromptInvocation["model"] {
	const model = context.modelBinding?.model;
	if (!model) throw new Error("Plugin provider requires a bound model");
	return {
		provider: model.provider,
		id: model.id,
		api: model.api,
		input: [...(model.input ?? [])],
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}

function toPluginConversation(
	messages: readonly Message[],
	includeMessages: boolean,
): AgentPluginSystemPromptInvocation["conversation"] {
	return {
		messages: includeMessages
			? messages.map((message) => ({
					role: message.role,
					text: extractMessageText(message),
					timestamp: message.timestamp,
					toolName: message.role === "toolResult" ? message.toolName : undefined,
				}))
			: [],
		messageCount: messages.length,
	};
}

function extractMessageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.map((item) => {
			if ("text" in item && typeof item.text === "string") return item.text;
			if ("thinking" in item && typeof item.thinking === "string") return item.thinking;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function sortContributions<T extends { readonly pluginId: string; readonly id: string }>(
	contributions: readonly T[],
): readonly T[] {
	return [...contributions].sort(
		(left, right) => left.pluginId.localeCompare(right.pluginId) || left.id.localeCompare(right.id),
	);
}

async function invokeWithTimeout<T>(
	invoke: (signal: AbortSignal) => Promise<T>,
	signal: AbortSignal,
	timeoutMs: number,
): Promise<T> {
	if (timeoutMs <= 0) return invoke(signal);
	const controller = new AbortController();
	const onAbort = (): void => controller.abort(signal.reason);
	if (signal.aborted) controller.abort(signal.reason);
	else signal.addEventListener("abort", onAbort, { once: true });
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => {
				controller.abort();
				reject(new Error(`Plugin provider timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		return await Promise.race([invoke(controller.signal), timeoutPromise]);
	} finally {
		if (timeout) clearTimeout(timeout);
		signal.removeEventListener("abort", onAbort);
	}
}
