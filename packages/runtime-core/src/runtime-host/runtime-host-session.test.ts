import { describe, expect, it } from "vitest";
import type { PromptRequest, RuntimeTurnPromptOutcome, SessionEvent } from "../contracts.js";
import type { RuntimeHost } from "./runtime-host.js";
import { RuntimeHostSession } from "./runtime-host-session.js";

describe("RuntimeHostSession convenience API", () => {
	it("accepts a prompt string and exposes one ordered async event stream", async () => {
		const handlers = new Set<(event: SessionEvent) => void>();
		const requests: PromptRequest[] = [];
		const event = {
			schemaVersion: 1,
			sessionId: "session-1",
			eventId: "event-1",
			timestamp: 1,
			source: "runtime-core",
			type: "session.lifecycle",
			phase: "agent_end",
		} satisfies SessionEvent;
		const host = {
			readCanonicalSessionId: () => "session-1",
			subscribe: (_sessionId: string, handler: (value: SessionEvent) => void) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
			prompt: async (_sessionId: string, request: PromptRequest): Promise<RuntimeTurnPromptOutcome> => {
				requests.push(request);
				for (const handler of handlers) handler(event);
				return { status: "completed", turnId: "turn-1" };
			},
		} as unknown as RuntimeHost;
		const session = new RuntimeHostSession(host, "session-1");

		const received: SessionEvent[] = [];
		for await (const item of session.stream("hello")) received.push(item);

		expect(requests).toEqual([{ text: "hello" }]);
		expect(received).toEqual([event]);
		expect(handlers.size).toBe(0);
	});
});
