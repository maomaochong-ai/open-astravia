import type { ErrorEvent } from "@vetta/runtime-core";

const MAX_ERROR_MESSAGE_LENGTH = 2_048;

type RuntimeSessionErrorEvent = ErrorEvent;

export interface RuntimeSessionErrorLogger {
	error(message: string, fields: Readonly<Record<string, unknown>>): void;
}

/**
 * 把 Runtime 的最终失败事件投影为隐私安全的结构化日志。
 * 只记录错误合同中的白名单字段，不记录请求体、响应体、prompt 或消息历史。
 */
export function logRuntimeSessionError(event: RuntimeSessionErrorEvent, logger: RuntimeSessionErrorLogger): void {
	const { details } = event.error;
	logger.error("[agent-runtime] turn failed", {
		sessionId: event.sessionId,
		eventId: event.eventId,
		source: event.source,
		code: event.error.code,
		origin: event.error.origin,
		retryable: event.error.retryable,
		retryAttempts: event.retryAttempts ?? 0,
		message: sanitizeRuntimeErrorMessage(event.error.message),
		...(details?.statusCode === undefined ? {} : { statusCode: details.statusCode }),
		...(details?.provider === undefined ? {} : { provider: details.provider }),
		...(details?.modelId === undefined ? {} : { modelId: details.modelId }),
		...(details?.requestId === undefined ? {} : { requestId: details.requestId }),
	});
}

export function sanitizeRuntimeErrorMessage(message: string): string {
	const singleLine = message
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
		.replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
		.replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[REDACTED]")
		.replace(/(["']?(?:api[_-]?key|token|authorization)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, "$1[REDACTED]");
	return singleLine.length <= MAX_ERROR_MESSAGE_LENGTH
		? singleLine
		: `${singleLine.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`;
}
