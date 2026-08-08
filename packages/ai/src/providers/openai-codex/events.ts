import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { AssistantMessage, Model } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { processResponsesStream } from "../openai-responses-shared.js";

type CodexResponseStatus = "completed" | "incomplete" | "failed" | "cancelled" | "queued" | "in_progress";

const CODEX_RESPONSE_STATUSES = new Set<CodexResponseStatus>([
	"completed",
	"incomplete",
	"failed",
	"cancelled",
	"queued",
	"in_progress",
]);

export async function processCodexEvents(
	events: AsyncIterable<Record<string, unknown>>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"openai-codex-responses">,
): Promise<void> {
	await processResponsesStream(mapCodexEvents(events), output, stream, model);
}

export async function processCodexSseResponse(
	response: Response,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"openai-codex-responses">,
): Promise<void> {
	await processCodexEvents(parseSSE(response), output, stream, model);
}

async function* mapCodexEvents(events: AsyncIterable<Record<string, unknown>>): AsyncGenerator<ResponseStreamEvent> {
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : undefined;
		if (!type) continue;
		if (type === "error") {
			const code = typeof event.code === "string" ? event.code : "";
			const message = typeof event.message === "string" ? event.message : "";
			throw new Error(`Codex error: ${message || code || JSON.stringify(event)}`);
		}
		if (type === "response.failed") {
			const response = event.response;
			const message =
				response && typeof response === "object" && "error" in response
					? (response as { error?: { message?: string } }).error?.message
					: undefined;
			throw new Error(message || "Codex response failed");
		}
		if (type === "response.done" || type === "response.completed") {
			const response = event.response;
			const normalizedResponse =
				response && typeof response === "object"
					? {
							...response,
							status: normalizeCodexStatus("status" in response ? response.status : undefined),
						}
					: response;
			yield { ...event, type: "response.completed", response: normalizedResponse } as ResponseStreamEvent;
			continue;
		}
		yield event as unknown as ResponseStreamEvent;
	}
}

async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let boundary = buffer.indexOf("\n\n");
		while (boundary !== -1) {
			const chunk = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const data = chunk
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim())
				.join("\n")
				.trim();
			if (data && data !== "[DONE]") {
				try {
					yield JSON.parse(data) as Record<string, unknown>;
				} catch {}
			}
			boundary = buffer.indexOf("\n\n");
		}
	}
}

function normalizeCodexStatus(status: unknown): CodexResponseStatus | undefined {
	if (typeof status !== "string") return undefined;
	return CODEX_RESPONSE_STATUSES.has(status as CodexResponseStatus) ? (status as CodexResponseStatus) : undefined;
}
