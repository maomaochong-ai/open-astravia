import type { AgentModelCallLifecycle, StreamFn } from "@vetta/agent-core";
import {
	type Api,
	type AssistantMessage,
	AssistantMessageEventStream,
	type Context,
	type Message,
	type Model,
	streamSimple,
} from "@vetta/ai";
import {
	buildContextCompositionReport,
	completeContextCompositionReport,
	HeuristicTokenEstimator,
	instructionSection,
	messageSection,
	stableJsonStringify,
	type TokenEstimator,
	toolSchemaSection,
} from "../context-composition/index.js";
import type { ContextCompositionPublisher, ModelCallFrame, SessionInput } from "./contracts.js";

export interface ContextCompositionLifecycleOptions {
	readonly turnId: string;
	readonly snapshotId: string;
	readonly model: Model<Api>;
	readonly publisher: ContextCompositionPublisher;
	readonly readFrame: () => ModelCallFrame | undefined;
	readonly input?: SessionInput;
	readonly estimator?: TokenEstimator;
	readonly now?: () => number;
}

/** Builds privacy-safe reports from the exact provider-facing model context. */
export function createContextCompositionLifecycle(
	options: ContextCompositionLifecycleOptions,
): AgentModelCallLifecycle {
	const estimator = options.estimator ?? new HeuristicTokenEstimator();
	const now = options.now ?? Date.now;
	let callIndex = 0;
	let preparedReport: Awaited<ReturnType<typeof buildContextCompositionReport>> | undefined;

	return {
		async prepared(context) {
			callIndex += 1;
			preparedReport = await buildContextCompositionReport(
				{
					callId: `${options.turnId}:model-call:${callIndex}`,
					snapshotId: options.snapshotId,
					createdAt: now(),
					model: {
						provider: options.model.provider,
						modelId: options.model.id,
						contextWindow: options.model.contextWindow,
					},
					sections: buildSections(options.readFrame(), context, options.input),
				},
				estimator,
			);
			await options.publisher.publishContextComposition(preparedReport);
		},
		async completed(_context, message) {
			if (!preparedReport) return;
			const completed = completeContextCompositionReport(preparedReport, providerInputTokens(message));
			preparedReport = undefined;
			await options.publisher.publishContextComposition(completed);
		},
		failed() {
			preparedReport = undefined;
		},
	};
}

/** Wraps the provider stream so report publication precedes terminal delivery. */
export function wrapStreamFnWithModelCallLifecycle(
	lifecycle: AgentModelCallLifecycle,
	streamFn: StreamFn = streamSimple,
): StreamFn {
	return async (...args) => {
		const context = args[1];
		const signal = args[2]?.signal;
		await lifecycle.prepared(context, signal);
		let source: Awaited<ReturnType<StreamFn>>;
		try {
			source = await streamFn(...args);
		} catch (error) {
			await lifecycle.failed(context, error, signal);
			throw error;
		}

		const target = new AssistantMessageEventStream();
		void forwardModelStream(source, target, lifecycle, context, signal);
		return target;
	};
}

async function forwardModelStream(
	source: AssistantMessageEventStream,
	target: AssistantMessageEventStream,
	lifecycle: AgentModelCallLifecycle,
	context: Readonly<Context>,
	signal: AbortSignal | undefined,
): Promise<void> {
	let terminalReported = false;
	try {
		for await (const event of source) {
			if (event.type === "done") {
				await lifecycle.completed(context, event.message, signal);
				terminalReported = true;
			} else if (event.type === "error") {
				await lifecycle.failed(context, event.error, signal);
				terminalReported = true;
			}
			target.push(event);
		}
		if (terminalReported) return;
		const result = await source.result();
		if (result.stopReason === "error" || result.stopReason === "aborted") {
			await lifecycle.failed(context, result, signal);
		} else {
			await lifecycle.completed(context, result, signal);
		}
		target.end(result);
	} catch (error) {
		if (!terminalReported) await lifecycle.failed(context, error, signal);
		target.fail(error);
	}
}

function buildSections(frame: ModelCallFrame | undefined, context: Readonly<Context>, input: SessionInput | undefined) {
	const frameSections = frame?.contextCompositionSections ?? [];
	const instructionSections = frameSections.filter((section) => section.kind === "instruction");
	const effectiveInstructions = instructionsMatchContext(instructionSections, context)
		? instructionSections
		: [
				instructionSection({
					id: "instruction:effective-system-prompt",
					category: "effective",
					source: { owner: "unknown", id: "effective-system-prompt" },
					content: context.systemPrompt ?? "",
				}),
			];
	const frameToolSections = frameSections.filter((section) => section.kind === "tool_schema");
	const attributedContextSections = frameSections.filter(
		(section) => section.kind !== "instruction" && section.kind !== "tool_schema",
	);
	const toolSections =
		frameToolSections.length > 0
			? frameToolSections
			: (context.tools ?? []).map((tool) =>
					toolSchemaSection({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.parameters,
						source: { owner: "unknown", id: tool.name },
					}),
				);
	const currentInputIndex = findCurrentInputIndex(context.messages, input?.message);
	const messages = context.messages.map((message, index) =>
		messageSection({
			id: `message:${index}`,
			kind: index === currentInputIndex ? "user_input" : "history",
			source:
				index === currentInputIndex
					? { owner: "user", id: "current-input" }
					: { owner: "unknown", id: `history:${index}` },
			message,
		}),
	);
	return [...effectiveInstructions, ...toolSections, ...attributedContextSections, ...messages];
}

function instructionsMatchContext(
	sections: readonly NonNullable<ModelCallFrame["contextCompositionSections"]>[number][],
	context: Readonly<Context>,
): boolean {
	return (
		sections.length > 0 &&
		sections.every((section) => section.content !== undefined) &&
		sections.map((section) => section.content).join("\n\n") === (context.systemPrompt ?? "")
	);
}

function findCurrentInputIndex(messages: readonly Message[], input: Message | undefined): number {
	if (!input) return -1;
	const inputKey = stableJsonStringify(input);
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (stableJsonStringify(messages[index]) === inputKey) return index;
	}
	return -1;
}

function providerInputTokens(message: Readonly<AssistantMessage>): number {
	return message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
}
