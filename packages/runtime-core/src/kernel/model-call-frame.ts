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
import { RUNTIME_PROMPT_FRAME_OBSERVATION, RUNTIME_TOOL_EXECUTION_OBSERVATION } from "./runtime-observations.js";
import { freezeInstruction, freezeTool, ImmutableReadonlyMap } from "./runtime-values.js";

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

		const candidate = createModelCallFrame(
			[...snapshot.instructions, ...contributions.flatMap((contribution) => contribution.instructions ?? [])],
			[...snapshot.tools.values(), ...contributions.flatMap((contribution) => contribution.tools ?? [])],
		);
		if (!snapshot.modelCallFrameComposer) {
			return observeResolvedFrame(candidate, context, publisher, startedAt);
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
		const frame = createModelCallFrame(
			composed.instructions,
			[...composed.tools.values()],
			composed.contextCompositionSections,
			composed.systemPromptStableLength,
			composed.promptCacheSystemPromptBlocks,
		);
		return observeResolvedFrame(frame, context, publisher, startedAt);
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
	context: ModelCallContributionContext,
	publisher: RuntimeSnapshot["observationPublisher"],
	startedAt: number,
): ModelCallFrame {
	const observedFrame = publisher ? withObservedTools(frame, publisher) : frame;
	publisher?.record(
		RUNTIME_PROMPT_FRAME_OBSERVATION,
		{
			phase: "completed",
			durationMs: Date.now() - startedAt,
			instructionCount: observedFrame.instructions.length,
			toolCount: observedFrame.tools.size,
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
	systemPromptStableLength?: number,
	promptCacheSystemPromptBlocks?: ModelCallFrame["promptCacheSystemPromptBlocks"],
): ModelCallFrame {
	const instructions = uniqueValues("instruction", instructionValues, ({ id }) => id)
		.sort(compareInstruction)
		.map(freezeInstruction);
	const tools = orderTools(uniqueValues("tool", toolValues, ({ name }) => name)).map(freezeTool);

	return Object.freeze({
		instructions: Object.freeze(instructions),
		tools: new ImmutableReadonlyMap(tools.map((tool) => [tool.name, tool])),
		systemPromptStableLength,
		promptCacheSystemPromptBlocks: promptCacheSystemPromptBlocks
			? Object.freeze(promptCacheSystemPromptBlocks.map((block) => Object.freeze({ ...block })))
			: undefined,
		contextCompositionSections: contextCompositionSections
			? Object.freeze(
					contextCompositionSections.map((section) =>
						Object.freeze({ ...section, source: Object.freeze({ ...section.source }) }),
					),
				)
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
