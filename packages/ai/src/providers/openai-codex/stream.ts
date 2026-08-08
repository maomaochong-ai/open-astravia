import { getEnvApiKey } from "../../env-api-keys.js";
import { supportsXhigh } from "../../models.js";
import type { AssistantMessage, Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { buildBaseOptions, clampReasoning } from "../simple-options.js";
import { processCodexSseResponse } from "./events.js";
import type { OpenAICodexResponsesOptions } from "./options.js";
import {
	buildCodexHeaders,
	buildCodexRequestBody,
	extractCodexAccountId,
	fetchCodexResponse,
	resolveCodexUrl,
	resolveCodexWebSocketUrl,
} from "./request.js";
import { processCodexWebSocketStream } from "./websocket.js";

export const streamOpenAICodexResponses: StreamFunction<"openai-codex-responses", OpenAICodexResponsesOptions> = (
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: OpenAICodexResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	(async () => {
		const output = createAssistantMessage(model);
		try {
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
			const body = buildCodexRequestBody(model, context, options);
			options?.onPayload?.(body);
			const headers = buildCodexHeaders(
				model.headers,
				options?.headers,
				extractCodexAccountId(apiKey),
				apiKey,
				options?.sessionId,
			);
			const transport = options?.transport || "sse";
			if (transport !== "sse") {
				let webSocketStarted = false;
				try {
					await processCodexWebSocketStream(
						resolveCodexWebSocketUrl(model.baseUrl),
						body,
						headers,
						output,
						stream,
						model,
						() => {
							webSocketStarted = true;
						},
						options,
					);
					if (options?.signal?.aborted) throw new Error("Request was aborted");
					finishStream(output, stream);
					return;
				} catch (error) {
					if (transport === "websocket" || webSocketStarted) throw error;
				}
			}

			const response = await fetchCodexResponse(
				resolveCodexUrl(model.baseUrl),
				headers,
				JSON.stringify(body),
				options?.signal,
			);
			if (!response.body) throw new Error("No response body");
			stream.push({ type: "start", partial: output });
			await processCodexSseResponse(response, output, stream, model);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			finishStream(output, stream);
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
};

export const streamSimpleOpenAICodexResponses: StreamFunction<"openai-codex-responses", SimpleStreamOptions> = (
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, options, apiKey);
	return streamOpenAICodexResponses(model, context, {
		...base,
		reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
	} satisfies OpenAICodexResponsesOptions);
};

function createAssistantMessage(model: Model<"openai-codex-responses">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
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

function finishStream(output: AssistantMessage, stream: AssistantMessageEventStream): void {
	stream.push({
		type: "done",
		reason: output.stopReason as "stop" | "length" | "toolUse",
		message: output,
	});
	stream.end();
}
