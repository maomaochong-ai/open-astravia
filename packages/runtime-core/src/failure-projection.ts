import { type AIErrorDetails, getAIErrorDetails, isAIError } from "@vetta/ai";
import type { RuntimeFailure, RuntimeFailureDetails, RuntimeFailureOrigin } from "./failure-contract.js";

/**
 * Projects an arbitrary boundary error into the Runtime failure contract.
 * Provider errors retain their structured AI diagnostics; non-AI errors get a
 * conservative runtime projection so observation producers do not invent local
 * error shapes or retry classifiers.
 */
export function runtimeFailureFromError(
	error: unknown,
	options: {
		readonly origin?: RuntimeFailureOrigin;
		readonly code?: string;
		readonly retryable?: boolean;
	} = {},
): RuntimeFailure {
	if (isAIError(error)) {
		return runtimeFailureFromAIErrorDetails(getAIErrorDetails(error));
	}

	const message = error instanceof Error ? error.message : String(error);
	return {
		code: options.code ?? "INTERNAL_ERROR",
		message,
		retryable: options.retryable ?? false,
		origin: options.origin ?? "runtime",
	};
}

/** Projects an already sanitized AI error across the Runtime boundary. */
export function runtimeFailureFromAIErrorDetails(details: AIErrorDetails): RuntimeFailure {
	return {
		code: details.code,
		message: details.message,
		retryable: details.retryable,
		origin: "provider",
		details: aiDetailsToRuntimeDetails(details),
	};
}

function aiDetailsToRuntimeDetails(details: ReturnType<typeof getAIErrorDetails>): RuntimeFailureDetails | undefined {
	const {
		statusCode,
		provider,
		modelId,
		requestId,
		providerCode,
		phase,
		url,
		responseHeaders,
		responseBodyPreview,
		retryAfterMs,
	} = details;
	if (
		statusCode === undefined &&
		provider === undefined &&
		modelId === undefined &&
		requestId === undefined &&
		providerCode === undefined &&
		phase === undefined &&
		url === undefined &&
		responseHeaders === undefined &&
		responseBodyPreview === undefined &&
		retryAfterMs === undefined
	) {
		return undefined;
	}
	return {
		...(statusCode === undefined ? {} : { statusCode }),
		...(provider === undefined ? {} : { provider }),
		...(modelId === undefined ? {} : { modelId }),
		...(requestId === undefined ? {} : { requestId }),
		...(providerCode === undefined ? {} : { providerCode }),
		...(phase === undefined ? {} : { phase }),
		...(url === undefined ? {} : { url }),
		...(responseHeaders === undefined ? {} : { responseHeaders }),
		...(responseBodyPreview === undefined ? {} : { responseBodyPreview }),
		...(retryAfterMs === undefined ? {} : { retryAfterMs }),
	};
}
