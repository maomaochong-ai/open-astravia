import type { Message, TextContent } from "@vetta/ai";
import type { SessionEvent } from "../contracts.js";
import { runtimeError } from "../errors.js";
import type { RuntimeFailure } from "../failure-contract.js";
import { runtimeFailureFromAIErrorDetails } from "../failure-projection.js";
import type { KernelEvent } from "../kernel/contracts.js";
import type { RuntimeSessionObservationEvent } from "../session-observation.js";
import { baseSessionEvent, mapRuntimeSessionObservationEvent } from "./session-events.js";

/** 将 Kernel EventSink 事件适配为宿主 SessionEvent。 */
export function mapKernelEventToSessionEvents(event: KernelEvent): SessionEvent[] {
	if (event.type === "conversation.continued") {
		return [
			{
				...baseSessionEvent(event.sessionId, "runtime-core", event.timestamp),
				type: "session.path_changed",
				previousSessionId: event.sourceSessionId,
				previousPath: event.sourceSessionPath,
				path: event.sessionPath,
				reason: event.reason,
			},
		];
	}

	if (event.type === "session.observation") {
		return [mapRuntimeSessionObservationEvent(event.sessionId, event.observation, event.timestamp)];
	}

	if (event.type === "message.appended" && event.message.role === "assistant") {
		return assistantMessageObservations(event.message, event.turnId, event.failure).map((observation) =>
			mapRuntimeSessionObservationEvent(event.sessionId, observation, event.timestamp),
		);
	}

	if (event.type === "context.compacted") {
		const record = event.record;
		const reason = "reason" in record ? record.reason : undefined;
		if (reason === "manual") return [];
		return [
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{
					type: "compaction.end",
					success: true,
					...(reason === "threshold" || reason === "overflow" ? { reason } : {}),
					...("tokensBefore" in record ? { tokensBefore: record.tokensBefore } : {}),
					source: "agent",
				},
				event.timestamp,
			),
		];
	}

	if (event.type === "queue.changed") {
		return [
			{
				...baseSessionEvent(event.sessionId, "runtime-core", event.timestamp),
				type: "queue.changed",
				paused: event.snapshot.paused,
				entries: event.snapshot.entries.map((entry) => ({
					id: entry.id,
					behavior: entry.behavior,
					displayText: entry.input.message
						? messageText(entry.input.message)
						: (entry.input.request?.displayText ?? ""),
				})),
				snapshot: event.snapshot,
			},
		];
	}

	if (event.type === "turn.cancelled") {
		return [
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{ type: "lifecycle", phase: "aborted", source: "runtime-core" },
				event.timestamp,
			),
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{ type: "lifecycle", phase: "agent_end", source: "runtime-core" },
				event.timestamp,
			),
		];
	}

	if (event.type === "turn.execution_failed") {
		const failure = event.error;
		return [
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{
					type: "error",
					turnId: event.turnId,
					error: {
						code: failure.code,
						message: failure.message,
						retryable: failure.retryable,
						origin: failure.origin,
						...(failure.details ? { details: failure.details } : {}),
					},
					source: "runtime-core",
				},
				event.timestamp,
			),
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{ type: "lifecycle", phase: "agent_end", source: "runtime-core" },
				event.timestamp,
			),
		];
	}

	if (event.type === "turn.failed") {
		const failure = event.error;
		return [
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{
					type: "error",
					turnId: event.turnId,
					error: {
						code: failure.code,
						message: failure.message,
						retryable: failure.retryable ?? false,
						origin: failure.origin ?? "runtime",
						...(failure.details ? { details: failure.details } : {}),
					},
					source: "runtime-core",
				},
				event.timestamp,
			),
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{ type: "lifecycle", phase: "agent_end", source: "runtime-core" },
				event.timestamp,
			),
		];
	}

	return [];
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter(
			(part): part is Extract<(typeof message.content)[number], { readonly type: "text" }> => part.type === "text",
		)
		.map((part) => part.text)
		.join("");
}

function assistantMessageObservations(
	message: Extract<Message, { role: "assistant" }>,
	turnId?: string,
	failure?: RuntimeFailure,
): RuntimeSessionObservationEvent[] {
	const observations: RuntimeSessionObservationEvent[] = [
		{ type: "message.final", message, source: "agent" },
		{
			type: "usage.update",
			input: message.usage.input,
			output: message.usage.output,
			cacheRead: message.usage.cacheRead,
			cacheWrite: message.usage.cacheWrite,
			cacheUsageReporting: message.usage.cacheUsageReporting ?? "unavailable",
			model: { api: message.api, provider: message.provider, id: message.model },
			costTotal: message.usage.cost.total,
			contextPercent: null,
			contextTokens: message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite,
			contextWindow: 0,
			source: "agent",
		},
	];

	if (message.stopReason === "error") {
		const errorText =
			extractAssistantText(message.content) ||
			(message as Message & { errorMessage?: string }).errorMessage ||
			"Assistant response ended with error";
		const messageFailure = message.failure ? runtimeFailureFromAIErrorDetails(message.failure) : undefined;
		observations.push({
			type: "error",
			...(turnId ? { turnId } : {}),
			error: failure ?? messageFailure ?? runtimeError("INTERNAL_ERROR", errorText, false, "provider"),
			source: "agent",
		});
	} else if (message.stopReason === "aborted") {
		observations.push({ type: "lifecycle", phase: "aborted", source: "runtime-core" });
	}

	return observations;
}

function extractAssistantText(content: Message["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((item): item is TextContent => item.type === "text")
		.map((item) => item.text)
		.join("");
}
