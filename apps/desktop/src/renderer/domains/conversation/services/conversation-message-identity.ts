/** Stable Renderer identity for one assistant segment inside a durable Turn. */
export function conversationAssistantMessageId(turnId: string, segment: number): string {
	return `assistant:${turnId}:${segment}`;
}
