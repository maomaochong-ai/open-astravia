import { type SimpleStreamFunction, type SimpleStreamOptions, streamSimple } from "@vetta/ai";

const SESSION_AFFINITY_HEADER = "X-Session-ID";

/** Adds the host's local-gateway affinity contract without changing provider semantics. */
export function createLoopbackSessionAffinityStream(
	downstream: SimpleStreamFunction = streamSimple,
): SimpleStreamFunction {
	return (model, context, options) => downstream(model, context, withLoopbackSessionHeader(model, options));
}

function withLoopbackSessionHeader(
	model: Parameters<SimpleStreamFunction>[0],
	options: SimpleStreamOptions | undefined,
): SimpleStreamOptions | undefined {
	if (!options) return undefined;
	const sessionId = options.sessionId?.trim();
	if (!sessionId || !isLoopbackEndpoint(model.gatewayUrl ?? model.baseUrl)) return options;
	if (hasHeader(model.headers, SESSION_AFFINITY_HEADER) || hasHeader(options.headers, SESSION_AFFINITY_HEADER)) {
		return options;
	}
	return {
		...options,
		headers: { ...options.headers, [SESSION_AFFINITY_HEADER]: sessionId },
	};
}

function hasHeader(headers: Readonly<Record<string, string>> | undefined, target: string): boolean {
	const normalizedTarget = target.toLowerCase();
	return Object.keys(headers ?? {}).some((name) => name.toLowerCase() === normalizedTarget);
}

function isLoopbackEndpoint(endpoint: string): boolean {
	try {
		const hostname = new URL(endpoint).hostname.toLowerCase().replace(/^\[|\]$/g, "");
		return hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
	} catch {
		return false;
	}
}
