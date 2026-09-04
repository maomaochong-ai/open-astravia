import type { AssistantMessage } from "@vetta/ai";

/** Public Team history may contain text and tool calls, never private reasoning. */
export function publicAssistantMessage(message: AssistantMessage): AssistantMessage {
	return { ...message, content: message.content.filter(isPublicAssistantPart) };
}

export function isPublicAssistantPart(
	part: AssistantMessage["content"][number],
): part is Extract<AssistantMessage["content"][number], { type: "text" | "toolCall" }> {
	return part.type === "text" || part.type === "toolCall";
}
