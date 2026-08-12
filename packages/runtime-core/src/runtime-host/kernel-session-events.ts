import type { Message, TextContent } from "@vetta/ai";
import type { SessionEvent } from "../contracts.js";
import { runtimeError } from "../errors.js";
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
		return assistantMessageObservations(event.message).map((observation) =>
			mapRuntimeSessionObservationEvent(event.sessionId, observation, event.timestamp),
		);
	}

	if (event.type === "context.compacted") {
		if ("reason" in event.record && event.record.reason === "manual") return [];
		return [
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{ type: "compaction.end", success: true, source: "agent" },
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

	if (event.type === "turn.failed") {
		return [
			mapRuntimeSessionObservationEvent(
				event.sessionId,
				{
					type: "error",
					error: {
						code: event.error.code,
						message: event.error.message,
						retryable: false,
						origin: "runtime",
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
): RuntimeSessionObservationEvent[] {
	const observations: RuntimeSessionObservationEvent[] = [
		{ type: "message.final", message, source: "agent" },
		{
			type: "usage.update",
			input: message.usage.input,
			output: message.usage.output,
			cacheRead: message.usage.cacheRead,
			cacheWrite: message.usage.cacheWrite,
			costTotal: message.usage.cost.total,
			contextPercent: null,
			contextWindow: 0,
			source: "agent",
		},
	];

	if (message.stopReason === "error") {
		const errorText =
			extractAssistantText(message.content) ||
			(message as Message & { errorMessage?: string }).errorMessage ||
			"Assistant response ended with error";
		observations.push({
			type: "error",
			error: runtimeError("INTERNAL_ERROR", errorText, true, "provider"),
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
