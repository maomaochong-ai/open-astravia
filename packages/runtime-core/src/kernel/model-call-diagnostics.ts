import {
	type AssistantMessage,
	type Context,
	createPromptCacheDiagnostics,
	type LanguageModelStreamEvent,
	type ModelStreamResponse,
} from "@vetta/ai";

/** Adds privacy-safe prompt-prefix diagnostics to terminal model-call usage. */
export function withPromptCacheDiagnostics(response: ModelStreamResponse, context: Context): ModelStreamResponse {
	const diagnostics = createPromptCacheDiagnostics(context);
	return {
		...response,
		events: attachDiagnosticsToEvents(response.events, diagnostics),
		result: response.result.then((message) => attachDiagnostics(message, diagnostics)),
	};
}

async function* attachDiagnosticsToEvents(
	events: AsyncIterable<LanguageModelStreamEvent>,
	diagnostics: ReturnType<typeof createPromptCacheDiagnostics>,
): AsyncIterable<LanguageModelStreamEvent> {
	for await (const event of events) {
		if (event.type === "done") {
			yield { ...event, message: attachDiagnostics(event.message, diagnostics) };
		} else if (event.type === "error") {
			yield { ...event, error: attachDiagnostics(event.error, diagnostics) };
		} else {
			yield event;
		}
	}
}

function attachDiagnostics(
	message: AssistantMessage,
	diagnostics: ReturnType<typeof createPromptCacheDiagnostics>,
): AssistantMessage {
	return { ...message, usage: { ...message.usage, promptCache: diagnostics } };
}
