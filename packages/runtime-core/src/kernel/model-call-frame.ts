import type { ContextCompositionSectionInput } from "../context-composition/contracts.js";
import { runtimeObservationFailure } from "../observation/index.js";
import type {
	InstructionBlock,
	ModelCallContribution,
	ModelCallContributionContext,
	ModelCallFrame,
	RuntimeSnapshot,
	RuntimeToolDefinition,
} from "./contracts.js";
import { featureConflictError } from "./errors.js";
import { compilePromptCacheLayout, sanitizePromptCacheLayout } from "./prompt-cache-layout.js";
import {
	RUNTIME_PROMPT_CACHE_LAYOUT_ISSUE_OBSERVATION,
	RUNTIME_PROMPT_FRAME_OBSERVATION,
	RUNTIME_TOOL_EXECUTION_OBSERVATION,
} from "./runtime-observations.js";
import { freezeInstruction, freezeTool, ImmutableReadonlyMap } from "./runtime-values.js";

type PromptCacheLayoutSource = "automatic" | "composer" | "unspecified" | "degraded";

export async function resolveModelCallFrame(
	snapshot: RuntimeSnapshot,
	context: ModelCallContributionContext,
): Promise<ModelCallFrame> {
	const startedAt = Date.now();
	const publisher = snapshot.observationPublisher;
	publisher?.record(
		RUNTIME_PROMPT_FRAME_OBSERVATION,
		{ phase: "started", providerCount: snapshot.modelCallProviders?.length ?? 0 },
		{ sessionId: context.sessionId, turnId: context.turnId },
	);
	try {
		const contributions: ModelCallContribution[] = [];
		for (const provider of snapshot.modelCallProviders ?? []) {
			context.signal.throwIfAborted();
			contributions.push(await provider.contribute(context));
		}

		const callInstructions = contributions.flatMap((contribution) => contribution.instructions ?? []);
		const callInstructionIds = new Set(callInstructions.map(({ id }) => id));
		const candidateWithoutLayout = createModelCallFrame(
			[...snapshot.instructions, ...callInstructions],
			[...snapshot.tools.values(), ...contributions.flatMap((contribution) => contribution.tools ?? [])],
		);
		const candidate = withPromptCacheLayout(
			candidateWithoutLayout,
			compilePromptCacheLayout(candidateWithoutLayout.instructions, ({ id }) =>
				callInstructionIds.has(id) ? "volatile" : "stable",
			),
		);
		if (!snapshot.modelCallFrameComposer) {
			return observeResolvedFrame(candidate, "automatic", context, publisher, startedAt);
		}

		context.signal.throwIfAborted();
		const composed = await snapshot.modelCallFrameComposer.compose({
			sessionId: context.sessionId,
			turnId: context.turnId,
			signal: context.signal,
			input: context.input,
			messages: context.messages ?? [],
			modelBinding: context.modelBinding,
			frame: candidate,
		});
		context.signal.throwIfAborted();
		const composedFrame = createModelCallFrame(
			composed.instructions,
			[...composed.tools.values()],
			composed.contextCompositionSections,
			composed.promptCacheKey,
		);
		const resolved = resolveComposedPromptCacheLayout(
			composedFrame,
			composed.systemPromptStableLength,
			composed.promptCacheSystemPromptBlocks,
		);
		if (resolved.degradationReason) {
			publisher?.record(
				RUNTIME_PROMPT_CACHE_LAYOUT_ISSUE_OBSERVATION,
				{
					reason: resolved.degradationReason,
					declaredBlockCount: composed.promptCacheSystemPromptBlocks?.length ?? 0,
					stableLengthDeclared: composed.systemPromptStableLength !== undefined,
				},
				{ sessionId: context.sessionId, turnId: context.turnId },
			);
		}
		return observeResolvedFrame(resolved.frame, resolved.source, context, publisher, startedAt);
	} catch (error) {
		publisher?.record(
			RUNTIME_PROMPT_FRAME_OBSERVATION,
			{
				phase: "failed",
				durationMs: Date.now() - startedAt,
				failure: runtimeObservationFailure(error, context.signal),
			},
			{ sessionId: context.sessionId, turnId: context.turnId },
		);
		throw error;
	}
}

function observeResolvedFrame(
	frame: ModelCallFrame,
	cacheLayoutSource: PromptCacheLayoutSource,
	context: ModelCallContributionContext,
	publisher: RuntimeSnapshot["observationPublisher"],
	startedAt: number,
): ModelCallFrame {
	const observedFrame = publisher ? withObservedTools(frame, publisher) : frame;
	const cacheBlocks = observedFrame.promptCacheSystemPromptBlocks ?? [];
	publisher?.record(
		RUNTIME_PROMPT_FRAME_OBSERVATION,
		{
			phase: "completed",
			durationMs: Date.now() - startedAt,
			instructionCount: observedFrame.instructions.length,
			toolCount: observedFrame.tools.size,
			cacheLayoutSource,
			...(observedFrame.systemPromptStableLength !== undefined
				? { stableCharacterCount: observedFrame.systemPromptStableLength }
				: {}),
			stableBlockCount: cacheBlocks.filter(({ cacheability }) => cacheability === "stable").length,
			volatileBlockCount: cacheBlocks.filter(({ cacheability }) => cacheability === "volatile").length,
		},
		{ sessionId: context.sessionId, turnId: context.turnId },
	);
	return observedFrame;
}

function withObservedTools(
	frame: ModelCallFrame,
	publisher: NonNullable<RuntimeSnapshot["observationPublisher"]>,
): ModelCallFrame {
	const tools = [...frame.tools.values()].map((tool) => {
		const execute = tool.execute.bind(tool);
		return freezeTool({
			...tool,
			async execute(request) {
				const startedAt = Date.now();
				const observationContext = {
					sessionId: request.sessionId,
					turnId: request.turnId,
					toolCallId: request.toolCallId,
				};
				publisher.record(
					RUNTIME_TOOL_EXECUTION_OBSERVATION,
					{ phase: "started", toolName: tool.name, inputFieldCount: Object.keys(request.input).length },
					observationContext,
				);
				try {
					const result = await execute(request);
					publisher.record(
						RUNTIME_TOOL_EXECUTION_OBSERVATION,
						{
							phase: "completed",
							toolName: tool.name,
							durationMs: Date.now() - startedAt,
							contentItemCount: result.content.length,
							hasDetails: result.details !== undefined,
						},
						observationContext,
					);
					return result;
				} catch (error) {
					publisher.record(
						RUNTIME_TOOL_EXECUTION_OBSERVATION,
						{
							phase: "failed",
							toolName: tool.name,
							durationMs: Date.now() - startedAt,
							failure: runtimeObservationFailure(error, request.signal),
						},
						observationContext,
					);
					throw error;
				}
			},
		});
	});
	return Object.freeze({
		...frame,
		tools: new ImmutableReadonlyMap(tools.map((tool) => [tool.name, tool])),
	});
}

function createModelCallFrame(
	instructionValues: readonly InstructionBlock[],
	toolValues: readonly RuntimeToolDefinition[],
	contextCompositionSections?: readonly ContextCompositionSectionInput[],
	promptCacheKey?: string,
): ModelCallFrame {
	const instructions = uniqueValues("instruction", instructionValues, ({ id }) => id)
		.sort(compareInstruction)
		.map(freezeInstruction);
	const tools = orderTools(uniqueValues("tool", toolValues, ({ name }) => name)).map(freezeTool);

	return Object.freeze({
		instructions: Object.freeze(instructions),
		tools: new ImmutableReadonlyMap(tools.map((tool) => [tool.name, tool])),
		...(promptCacheKey !== undefined ? { promptCacheKey } : {}),
		contextCompositionSections: contextCompositionSections
			? Object.freeze(
					contextCompositionSections.map((section) =>
						Object.freeze({ ...section, source: Object.freeze({ ...section.source }) }),
					),
				)
			: undefined,
	});
}

function resolveComposedPromptCacheLayout(
	frame: ModelCallFrame,
	stableLength: number | undefined,
	blocks: ModelCallFrame["promptCacheSystemPromptBlocks"],
): {
	readonly frame: ModelCallFrame;
	readonly source: PromptCacheLayoutSource;
	readonly degradationReason?: "invalid-stable-length" | "invalid-block-layout";
} {
	if (stableLength !== undefined || blocks !== undefined) {
		const sanitized = sanitizePromptCacheLayout(frame.instructions, stableLength, blocks);
		return {
			frame: withPromptCacheLayout(frame, sanitized),
			source: sanitized.degraded ? "degraded" : "composer",
			...(sanitized.degradationReason ? { degradationReason: sanitized.degradationReason } : {}),
		};
	}
	if (frame.instructions.some(({ cacheability }) => cacheability !== undefined)) {
		return {
			frame: withPromptCacheLayout(
				frame,
				compilePromptCacheLayout(frame.instructions, () => "volatile"),
			),
			source: "automatic",
		};
	}
	return { frame, source: "unspecified" };
}

function withPromptCacheLayout(
	frame: ModelCallFrame,
	layout: Pick<ModelCallFrame, "systemPromptStableLength" | "promptCacheSystemPromptBlocks">,
): ModelCallFrame {
	return Object.freeze({
		...frame,
		systemPromptStableLength: layout.systemPromptStableLength,
		promptCacheSystemPromptBlocks: layout.promptCacheSystemPromptBlocks
			? Object.freeze(layout.promptCacheSystemPromptBlocks.map((block) => Object.freeze({ ...block })))
			: undefined,
	});
}

function orderTools(tools: readonly RuntimeToolDefinition[]): RuntimeToolDefinition[] {
	return tools
		.map((tool, contributionIndex) => ({ tool, contributionIndex }))
		.sort((left, right) => {
			const leftOrder = left.tool.modelOrder;
			const rightOrder = right.tool.modelOrder;
			if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
			if (leftOrder !== undefined) return -1;
			if (rightOrder !== undefined) return 1;
			return left.contributionIndex - right.contributionIndex;
		})
		.map(({ tool }) => tool);
}

function uniqueValues<T>(kind: string, values: readonly T[], getId: (value: T) => string): T[] {
	const byId = new Map<string, T>();
	for (const value of values) {
		const id = getId(value);
		if (byId.has(id)) {
			throw featureConflictError(`Duplicate ${kind} id: ${id}`);
		}
		byId.set(id, value);
	}
	return [...byId.values()];
}

export function composeModelCallSystemPrompt(frame: Pick<ModelCallFrame, "instructions">): string {
	return [...frame.instructions]
		.sort(compareInstruction)
		.map(({ content }) => content)
		.filter((content) => content.length > 0)
		.join("\n\n");
}

function compareInstruction(
	left: { readonly id: string; readonly priority: number },
	right: { readonly id: string; readonly priority: number },
): number {
	return left.priority - right.priority || left.id.localeCompare(right.id);
}
