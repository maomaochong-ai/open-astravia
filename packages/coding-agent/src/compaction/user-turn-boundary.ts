import type { AgentMessage } from "@vetta/agent-core";

/** Index of the oldest real user message among the latest N user turns. */
export function findRecentUserTurnBoundary(messages: readonly AgentMessage[], protectedTurns: number): number {
	if (protectedTurns <= 0) return messages.length;
	let remaining = protectedTurns;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role !== "user") continue;
		remaining -= 1;
		if (remaining === 0) return index;
	}
	const firstUserIndex = messages.findIndex((message) => message.role === "user");
	return firstUserIndex === -1 ? 0 : firstUserIndex;
}
