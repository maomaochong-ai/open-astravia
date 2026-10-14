import type { AssistantMessage, Model } from "../../types.js";
import type { ResponsesEventSink } from "../openai-responses/events.js";
import { acquireResponsesWebSocket, readResponsesWebSocketEvents } from "../openai-responses/websocket.js";
import { processCodexEvents } from "./events.js";
import type { CodexRequestBody, OpenAICodexResponsesOptions } from "./options.js";

export async function processCodexWebSocketStream(
	url: string,
	body: CodexRequestBody,
	headers: Headers,
	output: AssistantMessage,
	stream: ResponsesEventSink,
	model: Model<"openai-codex-responses">,
	onStart: () => void,
	options?: OpenAICodexResponsesOptions,
): Promise<void> {
	const { socket, release } = await acquireResponsesWebSocket(
		url,
		headersToRecord(headers),
		options?.sessionId,
		options?.signal,
	);
	let keepConnection = true;
	try {
		socket.send(JSON.stringify({ type: "response.create", ...body }));
		onStart();
		await processCodexEvents(
			readResponsesWebSocketEvents(socket, model.provider, options?.signal),
			output,
			stream,
			model,
		);
		if (options?.signal?.aborted) keepConnection = false;
	} catch (error) {
		keepConnection = false;
		throw error;
	} finally {
		release({ keep: keepConnection });
	}
}

function headersToRecord(headers: Headers): Record<string, string> {
	const record: Record<string, string> = {};
	for (const [key, value] of headers.entries()) record[key] = value;
	return record;
}
