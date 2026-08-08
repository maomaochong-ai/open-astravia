import type { AssistantMessage, EventStream } from "@vetta/ai";
import type { AgentContextCheckpointReason, AgentContextCheckpointResult, AgentEvent, AgentMessage } from "../types.js";

export class AgentContextCheckpointFailure extends Error {
	constructor(cause: unknown) {
		super("Agent context checkpoint failed", { cause });
		this.name = "AgentContextCheckpointFailure";
	}
}

export function requestContextCheckpoint(
	reason: AgentContextCheckpointReason,
	messages: readonly AgentMessage[],
	recoveryAttempt: number,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	assistantMessage?: AssistantMessage,
): Promise<AgentContextCheckpointResult | undefined> {
	return new Promise((resolve, reject) => {
		let settled = false;
		stream.push({
			type: "context_checkpoint",
			request: {
				reason,
				messages: [...messages],
				assistantMessage,
				recoveryAttempt,
				complete(result) {
					if (settled) return;
					settled = true;
					resolve(result);
				},
				fail(error) {
					if (settled) return;
					settled = true;
					reject(new AgentContextCheckpointFailure(error));
				},
			},
		});
	});
}
