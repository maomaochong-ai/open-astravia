import { AIAbortedError } from "../../protocol/index.js";
import { EmptyProviderStreamError, normalizeProviderError, validateWirePayload } from "../../provider-kit/index.js";
import {
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../../runtime/language-model-adapter.js";
import { createGoogleAssistantMessage } from "../google-stream/adapter.js";
import { GeminiEventReducer } from "../google-stream/events.js";
import type { GoogleGeminiCliOptions } from "./options.js";
import { cloudCodeAssistResponseChunkSchema } from "./protocol.js";
import {
	buildGoogleCloudCodeHeaders,
	buildRequest,
	parseGoogleCloudCodeCredentials,
	resolveGoogleCloudCodeEndpoints,
} from "./request.js";
import { parseGoogleCloudCodeResponse } from "./response.js";
import {
	assertGoogleCloudCodeResponse,
	fetchGoogleCloudCodeResponse,
	fetchGoogleCloudCodeUrl,
	sleepWithAbort,
} from "./retry.js";

const MAX_EMPTY_STREAM_RETRIES = 2;
const EMPTY_STREAM_BASE_DELAY_MS = 500;

export const googleGeminiCliAdapter: LanguageModelAdapter<"google-gemini-cli", GoogleGeminiCliOptions> = {
	api: "google-gemini-cli",
	async stream(request) {
		return createGoogleGeminiCliModelStream(request);
	},
};

function createGoogleGeminiCliModelStream(
	request: ModelCallRequest<"google-gemini-cli", GoogleGeminiCliOptions>,
): ModelStreamResponse {
	const stream = new LanguageModelStream();
	void produceGoogleGeminiCliStream(request, stream);
	return { events: stream, result: stream.result() };
}

async function produceGoogleGeminiCliStream(
	request: ModelCallRequest<"google-gemini-cli", GoogleGeminiCliOptions>,
	stream: LanguageModelStream,
): Promise<void> {
	const { model, context, options } = request;
	let output = createGoogleAssistantMessage(model);
	try {
		if (options?.signal?.aborted) throw new AIAbortedError();
		const { accessToken, projectId } = parseGoogleCloudCodeCredentials(options?.apiKey);
		const body = buildRequest(model, context, projectId, options, model.provider === "google-antigravity");
		options?.onPayload?.(body);
		const headers = buildGoogleCloudCodeHeaders(model, accessToken, options);
		const bodyJson = JSON.stringify(body);
		const initial = await fetchGoogleCloudCodeResponse(
			resolveGoogleCloudCodeEndpoints(model),
			headers,
			bodyJson,
			options,
		);
		let response = initial.response;
		let started = false;
		let completed = false;

		for (let attempt = 0; attempt <= MAX_EMPTY_STREAM_RETRIES; attempt++) {
			if (options?.signal?.aborted) throw new AIAbortedError();
			if (attempt > 0) {
				await sleepWithAbort(EMPTY_STREAM_BASE_DELAY_MS * 2 ** (attempt - 1), options?.signal);
				response = await assertGoogleCloudCodeResponse(
					await fetchGoogleCloudCodeUrl(initial.requestUrl, headers, bodyJson, options),
				);
			}

			const reducer = new GeminiEventReducer(output, model, stream);
			let receivedProviderEvent = false;
			for await (const rawChunk of parseGoogleCloudCodeResponse(response, options?.signal)) {
				receivedProviderEvent = true;
				if (!started) {
					stream.push({ type: "start", partial: output });
					started = true;
				}
				const chunk = validateWirePayload(cloudCodeAssistResponseChunkSchema, rawChunk, {
					provider: model.provider,
					payloadType: "Cloud Code Assist stream event",
				});
				if (chunk.response) reducer.consume(chunk.response);
			}
			if (!receivedProviderEvent) {
				if (attempt < MAX_EMPTY_STREAM_RETRIES) {
					output = createGoogleAssistantMessage(model);
					continue;
				}
				throw new EmptyProviderStreamError();
			}
			reducer.finish();
			completed = true;
			break;
		}

		if (!completed) throw new EmptyProviderStreamError();
		if (options?.signal?.aborted) throw new AIAbortedError();
		if (output.stopReason === "error" || output.stopReason === "aborted") {
			throw new Error("Cloud Code Assist returned a failed response status");
		}
		stream.push({ type: "done", reason: output.stopReason, message: output });
	} catch (error) {
		stream.fail(
			options?.signal?.aborted
				? new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, cause: error })
				: normalizeProviderError(error, model),
		);
	}
}
