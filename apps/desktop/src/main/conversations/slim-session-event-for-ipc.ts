import { type AssistantMessage, createAssistantMessage } from "@vetta/ai";
import type { AssistantSessionEvent, SessionEvent } from "@vetta/runtime-core";

/**
 * Shared stub for renderer IPC. `text_delta` / `thinking_delta` consumers only
 * read `delta`; structured-clone of the growing `partial` is the hot-path cost.
 * Tool-call events keep `partial` because the renderer merges args from it.
 */
export const SLIM_ASSISTANT_PARTIAL: AssistantMessage = Object.freeze(
	createAssistantMessage({ api: "openai-completions", provider: "vetta-ipc", model: "slim" }, { timestamp: 0 }),
);

type SlimmableAssistantDelta = Extract<AssistantSessionEvent, { type: "text_delta" | "thinking_delta" }>;

function isSlimmableAssistantDelta(event: SessionEvent): event is SlimmableAssistantDelta {
	return event.channel === "assistant" && (event.type === "text_delta" || event.type === "thinking_delta");
}

export function slimSessionEventForIpc(event: SessionEvent): SessionEvent {
	if (!isSlimmableAssistantDelta(event)) return event;
	if (event.partial === SLIM_ASSISTANT_PARTIAL) return event;
	return { ...event, partial: SLIM_ASSISTANT_PARTIAL };
}
