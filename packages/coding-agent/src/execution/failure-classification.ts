export type RuntimeFailureKind = "aborted" | "input-too-large" | "transient" | "permanent";

export function classifyRuntimeFailure(error: unknown, signal?: AbortSignal): RuntimeFailureKind {
	if (signal?.aborted) return "aborted";
	const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	if (/AbortError|\baborted\b|\bcancelled\b/i.test(message)) return "aborted";
	if (
		/context.?length|prompt is too long|input.?too.?long|maximum context|too many tokens|request entity too large|payload too large|\b413\b/i.test(
			message,
		)
	) {
		return "input-too-large";
	}
	return isRetryableRuntimeError(message) ? "transient" : "permanent";
}

export function isRetryableRuntimeError(message: string): boolean {
	if (
		/额度已用尽|额度不足|窗口额度|余额不足|Token Plan|insufficient.?quota|insufficient.?balance|quota.?exhausted|quota.?exceeded|out of quota|exceeded your current quota/i.test(
			message,
		)
	) {
		return false;
	}
	return /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error|connection.?error|connection.?refused|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|other side closed|fetch failed|upstream.?connect|reset before headers|terminated|retry delay/i.test(
		message,
	);
}
