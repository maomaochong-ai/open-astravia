import type { AgentMessage } from "@vetta/agent-core";

/** Index of the oldest real user message among the latest N user turns. */
export function findRecentUserTurnBoundary(messages: readonly AgentMessage[], protectedTurns: number): number {
	return findRecentMatchingUserTurnBoundary(messages, protectedTurns, (message) => message.role === "user");
}

export function findRecentMatchingUserTurnBoundary(
	messages: readonly AgentMessage[],
	protectedTurns: number,
	isUserTurn: (message: AgentMessage, index: number) => boolean,
): number {
	if (protectedTurns <= 0) return messages.length;
	let remaining = protectedTurns;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || !isUserTurn(message, index)) continue;
		remaining -= 1;
		if (remaining === 0) return index;
	}
	const firstUserIndex = messages.findIndex(isUserTurn);
	return firstUserIndex === -1 ? 0 : firstUserIndex;
}
