import type { AgentMessage } from "../types.js";

export type AgentMessageQueueMode = "all" | "one-at-a-time";
export type AgentContinuationProvider = (signal?: AbortSignal) => AgentMessage[] | Promise<AgentMessage[]>;

export class AgentMessageQueue {
	private steering: AgentMessage[] = [];
	private followUp: AgentMessage[] = [];

	constructor(
		private steeringMode: AgentMessageQueueMode,
		private followUpMode: AgentMessageQueueMode,
	) {}

	setSteeringMode(mode: AgentMessageQueueMode): void {
		this.steeringMode = mode;
	}

	getSteeringMode(): AgentMessageQueueMode {
		return this.steeringMode;
	}

	setFollowUpMode(mode: AgentMessageQueueMode): void {
		this.followUpMode = mode;
	}

	getFollowUpMode(): AgentMessageQueueMode {
		return this.followUpMode;
	}

	enqueueSteering(message: AgentMessage): void {
		this.steering.push(message);
	}

	enqueueFollowUp(message: AgentMessage): void {
		this.followUp.push(message);
	}

	dequeueSteering(): AgentMessage[] {
		return this.dequeue("steering", this.steeringMode);
	}

	async collectContinuation(provider?: AgentContinuationProvider, signal?: AbortSignal): Promise<AgentMessage[]> {
		if (provider) {
			const injected = await provider(signal);
			if (injected.length > 0) this.followUp.push(...injected);
		}
		return this.dequeue("followUp", this.followUpMode);
	}

	clearSteering(): void {
		this.steering = [];
	}

	clearFollowUp(): void {
		this.followUp = [];
	}

	clear(): void {
		this.clearSteering();
		this.clearFollowUp();
	}

	hasMessages(): boolean {
		return this.steering.length > 0 || this.followUp.length > 0;
	}

	private dequeue(queue: "steering" | "followUp", mode: AgentMessageQueueMode): AgentMessage[] {
		const messages = this[queue];
		if (mode === "one-at-a-time") {
			if (messages.length === 0) return [];
			this[queue] = messages.slice(1);
			return [messages[0]];
		}

		this[queue] = [];
		return messages.slice();
	}
}
