import { getEnvApiKey } from "../../env-api-keys.js";
import { createResponsesAdapter } from "../openai-responses/adapter.js";
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

export const openAICodexResponsesAdapter = createResponsesAdapter<
	"openai-codex-responses",
	OpenAICodexResponsesOptions
>("openai-codex-responses", async ({ request, output, stream, start }) => {
	const { model, context, options } = request;
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
					start();
				},
				options,
			);
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
		options?.fetch,
	);
	if (!response.body) throw new Error("No response body");
	start();
	await processCodexSseResponse(response, output, stream, model);
});
