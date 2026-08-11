import { describe, expect, it, vi } from "vitest";
import { AgentMessageQueue } from "../src/runtime/message-queue.js";
import type { AgentMessage } from "../src/types.js";

function message(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 1 };
}

describe("AgentMessageQueue", () => {
	it("drains steering messages according to the configured mode", () => {
		const queue = new AgentMessageQueue("one-at-a-time", "one-at-a-time");
		queue.enqueueSteering(message("first"));
		queue.enqueueSteering(message("second"));

		expect(queue.dequeueSteering()).toEqual([message("first")]);
		queue.setSteeringMode("all");
		expect(queue.dequeueSteering()).toEqual([message("second")]);
		expect(queue.dequeueSteering()).toEqual([]);
	});

	it("queues continuation-provider messages behind existing follow-ups", async () => {
		const queue = new AgentMessageQueue("one-at-a-time", "all");
		const signal = new AbortController().signal;
		const provider = vi.fn(async () => [message("injected")]);
		queue.enqueueFollowUp(message("queued"));

		await expect(queue.collectContinuation(provider, signal)).resolves.toEqual([
			message("queued"),
			message("injected"),
		]);
		expect(provider).toHaveBeenCalledWith(signal);
		expect(queue.hasMessages()).toBe(false);
	});

	it("clears steering and follow-up queues independently", async () => {
		const queue = new AgentMessageQueue("all", "all");
		queue.enqueueSteering(message("steer"));
		queue.enqueueFollowUp(message("follow"));

		queue.clearSteering();
		expect(queue.dequeueSteering()).toEqual([]);
		expect(queue.hasMessages()).toBe(true);

		queue.clearFollowUp();
		expect(await queue.collectContinuation()).toEqual([]);
		expect(queue.hasMessages()).toBe(false);
	});
});
