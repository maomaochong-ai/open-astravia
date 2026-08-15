import {
	AI_ERROR_CODES,
	type AIErrorDetails,
	calculatePromptCacheMetrics,
	getAIErrorDetails,
	isAIError,
	type Model,
	type SimpleStreamFunction,
} from "@vetta/ai";
import type { CodingAgentModelRuntime } from "@vetta/coding-agent/host-services";

const PREFLIGHT_SYSTEM_PROMPT = "You are a provider connection probe. Reply with OK only.";
const PREFLIGHT_USER_PROMPT = "OK";

export type ProviderPreflightFailureCode =
	| "MODEL_NOT_FOUND"
	| "CREDENTIAL_MISSING"
	| "AUTHENTICATION_FAILED"
	| "BILLING_REQUIRED"
	| "RATE_LIMITED"
	| "TIMEOUT"
	| "REQUEST_FAILED";

export class ProviderPreflightError extends Error {
	constructor(
		readonly code: ProviderPreflightFailureCode,
		message: string,
		readonly details: Readonly<Record<string, unknown>> = {},
	) {
		super(message);
		this.name = "ProviderPreflightError";
	}
}

export interface ProviderPreflightDependencies {
	readonly models: Pick<
		CodingAgentModelRuntime,
		"find" | "getApiKey" | "getAvailable" | "isRemote" | "isUsingOAuth" | "loadRemoteModels"
	>;
	readonly streamFn: SimpleStreamFunction;
	readonly now?: () => number;
}

export interface ProviderPreflightRequest {
	readonly modelKey: string;
	readonly timeoutMs: number;
}

export async function runProviderPreflight(
	dependencies: ProviderPreflightDependencies,
	request: ProviderPreflightRequest,
	signal?: AbortSignal,
): Promise<Readonly<Record<string, unknown>>> {
	const { provider, modelId } = parseModelKey(request.modelKey);
	const startedAt = (dependencies.now ?? Date.now)();
	const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
	const callSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
	try {
		let model = dependencies.models.find(provider, modelId);
		let remoteLoadStatus: "unauthorized" | undefined;
		if (!model) {
			remoteLoadStatus = await waitForSignal(dependencies.models.loadRemoteModels(), callSignal);
			model = dependencies.models.find(provider, modelId);
		}
		if (!model) {
			if (remoteLoadStatus === "unauthorized") {
				throw new ProviderPreflightError(
					"AUTHENTICATION_FAILED",
					"Desktop login could not load the remote model catalog.",
					{ modelKey: request.modelKey, credentialKind: "desktop-login" },
				);
			}
			throw new ProviderPreflightError("MODEL_NOT_FOUND", `Model is not available: ${request.modelKey}`, {
				modelKey: request.modelKey,
				availableModelKeys: dependencies.models.getAvailable().map(toModelKey).sort(),
			});
		}
		const apiKey = await waitForSignal(dependencies.models.getApiKey(model), callSignal);
		if (!apiKey) {
			throw new ProviderPreflightError("CREDENTIAL_MISSING", `No credential is available for ${request.modelKey}`, {
				modelKey: request.modelKey,
			});
		}

		const stream = dependencies.streamFn(
			model,
			{
				systemPrompt: PREFLIGHT_SYSTEM_PROMPT,
				systemPromptStableLength: PREFLIGHT_SYSTEM_PROMPT.length,
				messages: [{ role: "user", content: PREFLIGHT_USER_PROMPT, timestamp: startedAt }],
			},
			{
				apiKey,
				cacheRetention: "none",
				maxTokens: 16,
				signal: callSignal,
			},
		);
		const message = await waitForSignal(stream.result(), callSignal);
		if (message.stopReason === "error" || message.stopReason === "aborted") {
			throw mapTerminalFailure(message.failure, request.modelKey, message.stopReason === "aborted");
		}
		const cache = calculatePromptCacheMetrics(message.usage);
		return {
			status: "ready",
			modelKey: request.modelKey,
			api: model.api,
			credentialKind: resolveCredentialKind(dependencies.models, model),
			durationMs: Math.max(0, (dependencies.now ?? Date.now)() - startedAt),
			stopReason: message.stopReason,
			usage: {
				input: message.usage.input,
				output: message.usage.output,
				cacheRead: message.usage.cacheRead,
				cacheWrite: message.usage.cacheWrite,
				cacheUsageReporting: message.usage.cacheUsageReporting ?? "unavailable",
				promptTokens: cache.promptTokens,
			},
		};
	} catch (error) {
		throw mapPreflightError(error, request.modelKey, timeoutSignal.aborted || signal?.aborted === true);
	}
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		void promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

function parseModelKey(modelKey: string): { provider: string; modelId: string } {
	const separator = modelKey.indexOf("/");
	if (separator <= 0 || separator === modelKey.length - 1) {
		throw new ProviderPreflightError("MODEL_NOT_FOUND", `Invalid modelKey: ${modelKey}`, { modelKey });
	}
	return { provider: modelKey.slice(0, separator), modelId: modelKey.slice(separator + 1) };
}

function toModelKey(model: Model<string>): string {
	return `${model.provider}/${model.id}`;
}

function resolveCredentialKind(
	models: Pick<CodingAgentModelRuntime, "isRemote" | "isUsingOAuth">,
	model: Model<string>,
): "desktop-login" | "oauth" | "api-key" {
	if (models.isRemote(model)) return "desktop-login";
	return models.isUsingOAuth(model) ? "oauth" : "api-key";
}

function mapPreflightError(error: unknown, modelKey: string, timedOut: boolean): ProviderPreflightError {
	if (error instanceof ProviderPreflightError) return error;
	if (timedOut)
		return new ProviderPreflightError("TIMEOUT", `Provider preflight timed out for ${modelKey}`, { modelKey });
	if (!isAIError(error)) {
		return new ProviderPreflightError("REQUEST_FAILED", `Provider preflight failed for ${modelKey}`, {
			modelKey,
		});
	}
	return mapFailureDetails(getAIErrorDetails(error), modelKey);
}

function mapTerminalFailure(
	failure: AIErrorDetails | undefined,
	modelKey: string,
	aborted: boolean,
): ProviderPreflightError {
	if (failure) return mapFailureDetails(failure, modelKey);
	return new ProviderPreflightError(
		aborted ? "TIMEOUT" : "REQUEST_FAILED",
		aborted ? `Provider preflight was aborted for ${modelKey}` : `Provider returned an error for ${modelKey}`,
		{ modelKey },
	);
}

function mapFailureDetails(failure: AIErrorDetails, modelKey: string): ProviderPreflightError {
	const details = { modelKey, failure: toSafeFailureDetails(failure) };
	switch (failure.code) {
		case AI_ERROR_CODES.AUTHENTICATION_FAILED:
		case AI_ERROR_CODES.PERMISSION_DENIED:
			return new ProviderPreflightError(
				"AUTHENTICATION_FAILED",
				`Provider authentication failed for ${modelKey}`,
				details,
			);
		case AI_ERROR_CODES.BILLING_REQUIRED:
			return new ProviderPreflightError(
				"BILLING_REQUIRED",
				`Provider billing is unavailable for ${modelKey}`,
				details,
			);
		case AI_ERROR_CODES.RATE_LIMITED:
			return new ProviderPreflightError("RATE_LIMITED", `Provider rate limit reached for ${modelKey}`, details);
		case AI_ERROR_CODES.TIMEOUT:
		case AI_ERROR_CODES.ABORTED:
			return new ProviderPreflightError("TIMEOUT", `Provider preflight timed out for ${modelKey}`, details);
		default:
			return new ProviderPreflightError("REQUEST_FAILED", `Provider preflight failed for ${modelKey}`, details);
	}
}

function toSafeFailureDetails(failure: AIErrorDetails): Readonly<Record<string, unknown>> {
	return {
		code: failure.code,
		retryable: failure.retryable,
		...(failure.statusCode === undefined ? {} : { statusCode: failure.statusCode }),
		...(failure.provider === undefined ? {} : { provider: failure.provider }),
		...(failure.modelId === undefined ? {} : { modelId: failure.modelId }),
		...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
		...(failure.providerCode === undefined ? {} : { providerCode: failure.providerCode }),
		...(failure.phase === undefined ? {} : { phase: failure.phase }),
		...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
	};
}
