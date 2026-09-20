import type { Api } from "../../protocol/index.js";
import { normalizeProviderError } from "../../provider-kit/index.js";
import type { ModelCallRequest } from "../../runtime/language-model-adapter.js";
import type { StreamOptions } from "../../types.js";
import { resolveProviderMaxRetries } from "../retry-policy.js";

const BASE_DELAY_MS = 1_000;

export async function sendGoogleSdkRequestWithRetries<TApi extends Api, TOptions extends StreamOptions, TResult>(
	operation: () => Promise<TResult>,
	request: ModelCallRequest<TApi, TOptions>,
	sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void> = sleepWithAbort,
): Promise<TResult> {
	const maxRetries = resolveProviderMaxRetries(request.options?.maxRetries);
	for (let attempt = 0; ; attempt++) {
		try {
			return await operation();
		} catch (error) {
			if (attempt >= maxRetries) throw error;
			const normalized = normalizeProviderError(error, request.model);
			if (!normalized.retryable) throw error;
			const serverDelay = normalized.retryAfterMs;
			const maxDelay = request.options?.maxRetryDelayMs ?? 60_000;
			if (serverDelay !== undefined && maxDelay > 0 && serverDelay > maxDelay) throw error;
			await sleep(serverDelay ?? BASE_DELAY_MS * 2 ** attempt, request.options?.signal);
		}
	}
}

function sleepWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}
		let timeout: ReturnType<typeof setTimeout>;
		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cleanup();
			reject(new Error("Request was aborted"));
		};
		timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, milliseconds);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
