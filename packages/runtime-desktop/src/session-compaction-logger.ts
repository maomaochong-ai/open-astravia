import type { SessionEvent } from "@vetta/runtime-core";
import { sanitizeRuntimeErrorMessage } from "./session-error-logger.js";

type RuntimeSessionCompactionEvent = Extract<SessionEvent, { readonly type: "compaction.start" | "compaction.end" }>;

export interface RuntimeSessionCompactionLogger {
	info(message: string, fields: Readonly<Record<string, unknown>>): void;
	warn(message: string, fields: Readonly<Record<string, unknown>>): void;
}

interface ActiveCompaction {
	readonly reason: "threshold" | "overflow";
	readonly startedAt: number;
}

/**
 * 将自动上下文压缩生命周期写成不含对话正文和摘要内容的结构化日志。
 * 返回的观察器是纯旁路：日志实现抛错时由 RuntimeHost 隔离，不改变压缩结果。
 */
export function createRuntimeSessionCompactionLogger(
	logger: RuntimeSessionCompactionLogger,
): (event: RuntimeSessionCompactionEvent) => void {
	const active = new Map<string, ActiveCompaction>();
	return (event) => {
		if (event.type === "compaction.start") {
			active.set(event.sessionId, { reason: event.reason, startedAt: event.timestamp });
			logger.info("[agent-runtime] context compaction started", {
				sessionId: event.sessionId,
				eventId: event.eventId,
				source: event.source,
				reason: event.reason,
				...(event.contextTokens === undefined ? {} : { contextTokens: event.contextTokens }),
				...(event.contextWindow === undefined ? {} : { contextWindow: event.contextWindow }),
				...(event.thresholdTokens === undefined ? {} : { thresholdTokens: event.thresholdTokens }),
				...(event.contextTokens === undefined || event.contextWindow === undefined || event.contextWindow <= 0
					? {}
					: { usagePercent: Number(((event.contextTokens / event.contextWindow) * 100).toFixed(2)) }),
			});
			return;
		}

		const started = active.get(event.sessionId);
		active.delete(event.sessionId);
		const fields = {
			sessionId: event.sessionId,
			eventId: event.eventId,
			source: event.source,
			reason: event.reason ?? started?.reason ?? "unknown",
			success: event.success,
			...(event.tokensBefore === undefined ? {} : { tokensBefore: event.tokensBefore }),
			...(started === undefined ? {} : { durationMs: Math.max(0, event.timestamp - started.startedAt) }),
			...(event.errorMessage === undefined ? {} : { errorMessage: sanitizeRuntimeErrorMessage(event.errorMessage) }),
			...(event.failure === undefined
				? {}
				: {
						failureCode: event.failure.code,
						failureOrigin: event.failure.origin,
						failureRetryable: event.failure.retryable,
					}),
		};
		if (event.success) logger.info("[agent-runtime] context compaction completed", fields);
		else logger.warn("[agent-runtime] context compaction failed", fields);
	};
}
