import type {
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	ThinkingBudgets,
	ThinkingLevel,
} from "../../types.js";
import { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { buildBaseOptions, clampReasoning } from "../simple-options.js";
import type { GoogleGeminiCliOptions, GoogleThinkingLevel } from "./options.js";
import {
	buildGoogleCloudCodeHeaders,
	buildRequest,
	parseGoogleCloudCodeCredentials,
	resolveGoogleCloudCodeEndpoints,
} from "./request.js";
import { streamGoogleCloudCodeResponse } from "./response.js";
import { fetchGoogleCloudCodeResponse, sleepWithAbort } from "./retry.js";

const MAX_EMPTY_STREAM_RETRIES = 2;
const EMPTY_STREAM_BASE_DELAY_MS = 500;

export const streamGoogleGeminiCli: StreamFunction<"google-gemini-cli", GoogleGeminiCliOptions> = (
	model: Model<"google-gemini-cli">,
	context: Context,
	options?: GoogleGeminiCliOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	(async () => {
		const output = createAssistantMessage(model);
		try {
			const { accessToken, projectId } = parseGoogleCloudCodeCredentials(options?.apiKey);
			const antigravity = model.provider === "google-antigravity";
			const requestBody = buildRequest(model, context, projectId, options, antigravity);
			options?.onPayload?.(requestBody);
			const requestHeaders = buildGoogleCloudCodeHeaders(model, accessToken, options);
			const requestBodyJson = JSON.stringify(requestBody);
			const { response, requestUrl } = await fetchGoogleCloudCodeResponse(
				resolveGoogleCloudCodeEndpoints(model),
				requestHeaders,
				requestBodyJson,
				options,
			);

			let started = false;
			const ensureStarted = () => {
				if (started) return;
				stream.push({ type: "start", partial: output });
				started = true;
			};
			let receivedContent = false;
			let currentResponse = response;
			for (let attempt = 0; attempt <= MAX_EMPTY_STREAM_RETRIES; attempt++) {
				if (options?.signal?.aborted) throw new Error("Request was aborted");
				if (attempt > 0) {
					await sleepWithAbort(EMPTY_STREAM_BASE_DELAY_MS * 2 ** (attempt - 1), options?.signal);
					currentResponse = await fetch(requestUrl, {
						method: "POST",
						headers: requestHeaders,
						body: requestBodyJson,
						signal: options?.signal,
					});
					if (!currentResponse.ok) {
						const errorText = await currentResponse.text();
						throw new Error(`Cloud Code Assist API error (${currentResponse.status}): ${errorText}`);
					}
				}

				if (
					await streamGoogleCloudCodeResponse(
						currentResponse,
						output,
						stream,
						model,
						ensureStarted,
						options?.signal,
					)
				) {
					receivedContent = true;
					break;
				}
				if (attempt < MAX_EMPTY_STREAM_RETRIES) {
					resetAssistantMessage(output);
					started = false;
				}
			}

			if (!receivedContent) throw new Error("Cloud Code Assist API returned an empty response");
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				if ("index" in block) Reflect.deleteProperty(block, "index");
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
};

export const streamSimpleGoogleGeminiCli: StreamFunction<"google-gemini-cli", SimpleStreamOptions> = (
	model: Model<"google-gemini-cli">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey;
	if (!apiKey) {
		throw new Error("Google Cloud Code Assist requires OAuth authentication. Use /login to authenticate.");
	}
	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamGoogleGeminiCli(model, context, {
			...base,
			thinking: { enabled: false },
		} satisfies GoogleGeminiCliOptions);
	}
	const effort = clampReasoning(options.reasoning)!;
	if (model.id.includes("3-pro") || model.id.includes("3-flash")) {
		return streamGoogleGeminiCli(model, context, {
			...base,
			thinking: { enabled: true, level: getGeminiCliThinkingLevel(effort, model.id) },
		} satisfies GoogleGeminiCliOptions);
	}
	const defaultBudgets: ThinkingBudgets = { minimal: 1024, low: 2048, medium: 8192, high: 16384 };
	const budgets = { ...defaultBudgets, ...options.thinkingBudgets };
	const minimumOutputTokens = 1024;
	let thinkingBudget = budgets[effort]!;
	const maxTokens = Math.min((base.maxTokens || 0) + thinkingBudget, model.maxTokens);
	if (maxTokens <= thinkingBudget) thinkingBudget = Math.max(0, maxTokens - minimumOutputTokens);
	return streamGoogleGeminiCli(model, context, {
		...base,
		maxTokens,
		thinking: { enabled: true, budgetTokens: thinkingBudget },
	} satisfies GoogleGeminiCliOptions);
};

function createAssistantMessage(model: Model<"google-gemini-cli">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "google-gemini-cli",
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

function resetAssistantMessage(output: AssistantMessage): void {
	output.content = [];
	output.usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	output.stopReason = "stop";
	output.errorMessage = undefined;
	output.timestamp = Date.now();
}

type ClampedThinkingLevel = Exclude<ThinkingLevel, "xhigh">;

function getGeminiCliThinkingLevel(effort: ClampedThinkingLevel, modelId: string): GoogleThinkingLevel {
	if (modelId.includes("3-pro")) {
		switch (effort) {
			case "minimal":
			case "low":
				return "LOW";
			case "medium":
			case "high":
				return "HIGH";
		}
	}
	switch (effort) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
			return "HIGH";
	}
}
