import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import type { AssistantMessage, Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { adjustMaxTokensForThinking, buildBaseOptions, clampReasoning } from "../simple-options.js";
import { createBedrockClient } from "./client.js";
import { type BedrockStreamBlock, handleBedrockStreamEvent } from "./events.js";
import type { BedrockOptions } from "./options.js";
import { supportsAdaptiveThinking } from "./options.js";
import { buildBedrockCommandInput } from "./request.js";

export const streamBedrock: StreamFunction<"bedrock-converse-stream", BedrockOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options: BedrockOptions = {},
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	(async () => {
		const output = createAssistantMessage(model);
		const blocks = output.content as BedrockStreamBlock[];
		try {
			const client = await createBedrockClient(options);
			const commandInput = buildBedrockCommandInput(model, context, options);
			options.onPayload?.(commandInput);
			const response = await client.send(new ConverseStreamCommand(commandInput), {
				abortSignal: options.signal,
			});
			for await (const item of response.stream!) {
				handleBedrockStreamEvent(item, blocks, output, stream, model);
			}
			if (options.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "error" || output.stopReason === "aborted") {
				throw new Error("An unknown error occurred");
			}
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				Reflect.deleteProperty(block, "index");
				Reflect.deleteProperty(block, "partialJson");
			}
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
};

export const streamSimpleBedrock: StreamFunction<"bedrock-converse-stream", SimpleStreamOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const base = buildBaseOptions(model, options, undefined);
	if (!options?.reasoning) {
		return streamBedrock(model, context, { ...base, reasoning: undefined } satisfies BedrockOptions);
	}
	if (model.id.includes("anthropic.claude") || model.id.includes("anthropic/claude")) {
		if (supportsAdaptiveThinking(model.id)) {
			return streamBedrock(model, context, {
				...base,
				reasoning: options.reasoning,
				thinkingBudgets: options.thinkingBudgets,
			} satisfies BedrockOptions);
		}
		const adjusted = adjustMaxTokensForThinking(
			base.maxTokens || 0,
			model.maxTokens,
			options.reasoning,
			options.thinkingBudgets,
		);
		return streamBedrock(model, context, {
			...base,
			maxTokens: adjusted.maxTokens,
			reasoning: options.reasoning,
			thinkingBudgets: {
				...(options.thinkingBudgets || {}),
				[clampReasoning(options.reasoning)!]: adjusted.thinkingBudget,
			},
		} satisfies BedrockOptions);
	}
	return streamBedrock(model, context, {
		...base,
		reasoning: options.reasoning,
		thinkingBudgets: options.thinkingBudgets,
	} satisfies BedrockOptions);
};

function createAssistantMessage(model: Model<"bedrock-converse-stream">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "bedrock-converse-stream",
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}
