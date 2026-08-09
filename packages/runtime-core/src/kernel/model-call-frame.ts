import type { ContextCompositionSectionInput } from "../context-composition/contracts.js";
import type {
	InstructionBlock,
	ModelCallContribution,
	ModelCallContributionContext,
	ModelCallFrame,
	RuntimeSnapshot,
	RuntimeToolDefinition,
} from "./contracts.js";
import { featureConflictError } from "./errors.js";
import { freezeInstruction, freezeTool, ImmutableReadonlyMap } from "./runtime-values.js";

export async function resolveModelCallFrame(
	snapshot: RuntimeSnapshot,
	context: ModelCallContributionContext,
): Promise<ModelCallFrame> {
	const contributions: ModelCallContribution[] = [];
	for (const provider of snapshot.modelCallProviders ?? []) {
		context.signal.throwIfAborted();
		contributions.push(await provider.contribute(context));
	}

	const candidate = createModelCallFrame(
		[...snapshot.instructions, ...contributions.flatMap((contribution) => contribution.instructions ?? [])],
		[...snapshot.tools.values(), ...contributions.flatMap((contribution) => contribution.tools ?? [])],
	);
	if (!snapshot.modelCallFrameComposer) return candidate;

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
	return createModelCallFrame(
		composed.instructions,
		[...composed.tools.values()],
		composed.contextCompositionSections,
	);
}

function createModelCallFrame(
	instructionValues: readonly InstructionBlock[],
	toolValues: readonly RuntimeToolDefinition[],
	contextCompositionSections?: readonly ContextCompositionSectionInput[],
): ModelCallFrame {
	const instructions = uniqueValues("instruction", instructionValues, ({ id }) => id)
		.sort(compareInstruction)
		.map(freezeInstruction);
	const tools = orderTools(uniqueValues("tool", toolValues, ({ name }) => name)).map(freezeTool);

	return Object.freeze({
		instructions: Object.freeze(instructions),
		tools: new ImmutableReadonlyMap(tools.map((tool) => [tool.name, tool])),
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
