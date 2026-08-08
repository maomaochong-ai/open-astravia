import type { GoogleGeminiCliOptions } from "./options.js";
import { buildGoogleCloudCodeUrl } from "./request.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export interface GoogleCloudCodeResponse {
	response: Response;
	requestUrl: string;
}

export function extractRetryDelay(errorText: string, response?: Response | Headers): number | undefined {
	const normalizeDelay = (milliseconds: number): number | undefined =>
		milliseconds > 0 ? Math.ceil(milliseconds + 1000) : undefined;
	const headers = response instanceof Headers ? response : response?.headers;
	if (headers) {
		const retryAfter = headers.get("retry-after");
		if (retryAfter) {
			const seconds = Number(retryAfter);
			if (Number.isFinite(seconds)) {
				const delay = normalizeDelay(seconds * 1000);
				if (delay !== undefined) return delay;
			}
			const date = new Date(retryAfter).getTime();
			if (!Number.isNaN(date)) {
				const delay = normalizeDelay(date - Date.now());
				if (delay !== undefined) return delay;
			}
		}
		const reset = headers.get("x-ratelimit-reset");
		if (reset) {
			const seconds = Number.parseInt(reset, 10);
			if (!Number.isNaN(seconds)) {
				const delay = normalizeDelay(seconds * 1000 - Date.now());
				if (delay !== undefined) return delay;
			}
		}
		const resetAfter = headers.get("x-ratelimit-reset-after");
		if (resetAfter) {
			const seconds = Number(resetAfter);
			if (Number.isFinite(seconds)) {
				const delay = normalizeDelay(seconds * 1000);
				if (delay !== undefined) return delay;
			}
		}
	}

	const duration = errorText.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
	if (duration) {
		const hours = duration[1] ? Number.parseInt(duration[1], 10) : 0;
		const minutes = duration[2] ? Number.parseInt(duration[2], 10) : 0;
		const seconds = Number.parseFloat(duration[3]);
		if (!Number.isNaN(seconds)) {
			const delay = normalizeDelay(((hours * 60 + minutes) * 60 + seconds) * 1000);
			if (delay !== undefined) return delay;
		}
	}
	const retryIn = errorText.match(/Please retry in ([0-9.]+)(ms|s)/i);
	if (retryIn?.[1]) {
		const delay = parseMatchedDelay(retryIn[1], retryIn[2], normalizeDelay);
		if (delay !== undefined) return delay;
	}
	const retryDelay = errorText.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i);
	if (retryDelay?.[1]) return parseMatchedDelay(retryDelay[1], retryDelay[2], normalizeDelay);
	return undefined;
}

export async function fetchGoogleCloudCodeResponse(
	endpoints: readonly string[],
	headers: Record<string, string>,
	body: string,
	options?: GoogleGeminiCliOptions,
): Promise<GoogleCloudCodeResponse> {
	let response: Response | undefined;
	let lastError: Error | undefined;
	let requestUrl: string | undefined;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (options?.signal?.aborted) throw new Error("Request was aborted");
		try {
			requestUrl = buildGoogleCloudCodeUrl(endpoints[Math.min(attempt, endpoints.length - 1)]);
			response = await fetch(requestUrl, { method: "POST", headers, body, signal: options?.signal });
			if (response.ok) return { response, requestUrl };
			const errorText = await response.text();
			if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
				const serverDelay = extractRetryDelay(errorText, response);
				const delay = serverDelay ?? BASE_DELAY_MS * 2 ** attempt;
				const maxDelay = options?.maxRetryDelayMs ?? 60000;
				if (maxDelay > 0 && serverDelay && serverDelay > maxDelay) {
					throw new Error(
						`Server requested ${Math.ceil(serverDelay / 1000)}s retry delay (max: ${Math.ceil(maxDelay / 1000)}s). ${extractErrorMessage(errorText)}`,
					);
				}
				await sleepWithAbort(delay, options?.signal);
				continue;
			}
			throw new Error(`Cloud Code Assist API error (${response.status}): ${extractErrorMessage(errorText)}`);
		} catch (error) {
			if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
				throw new Error("Request was aborted");
			}
			lastError = error instanceof Error ? error : new Error(String(error));
			if (lastError.message === "fetch failed" && lastError.cause instanceof Error) {
				lastError = new Error(`Network error: ${lastError.cause.message}`);
			}
			if (attempt < MAX_RETRIES) {
				await sleepWithAbort(BASE_DELAY_MS * 2 ** attempt, options?.signal);
				continue;
			}
			throw lastError;
		}
	}
	throw lastError ?? new Error("Failed to get response after retries");
}

export function sleepWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
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

function parseMatchedDelay(
	valueText: string,
	unit: string,
	normalize: (milliseconds: number) => number | undefined,
): number | undefined {
	const value = Number.parseFloat(valueText);
	if (Number.isNaN(value) || value <= 0) return undefined;
	return normalize(unit.toLowerCase() === "ms" ? value : value * 1000);
}

function isRetryableError(status: number, errorText: string): boolean {
	if ([429, 500, 502, 503, 504].includes(status)) return true;
	return /resource.?exhausted|rate.?limit|overloaded|service.?unavailable|other.?side.?closed/i.test(errorText);
}

function extractErrorMessage(errorText: string): string {
	try {
		const parsed = JSON.parse(errorText) as { error?: { message?: string } };
		if (parsed.error?.message) return parsed.error.message;
	} catch {}
	return errorText;
}
