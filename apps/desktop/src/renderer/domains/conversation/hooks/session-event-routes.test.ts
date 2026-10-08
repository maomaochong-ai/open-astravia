import type { SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { routeSessionEvent } from "./session-event-routes";

const event = (value: object) => value as SessionEvent;

describe("routeSessionEvent", () => {
	it("sends the assistant stream and Turn facts to the conversation feed", () => {
		expect(routeSessionEvent(event({ channel: "assistant", type: "error" }))).toBe("conversation-feed");
		expect(routeSessionEvent(event({ type: "conversation.turn.started" }))).toBe("conversation-feed");
		expect(routeSessionEvent(event({ type: "error" }))).toBe("conversation-feed");
	});

	it("keeps session-wide state out of the feed and ignores the legacy lifecycle", () => {
		expect(routeSessionEvent(event({ type: "queue.changed" }))).toBe("session-state");
		expect(routeSessionEvent(event({ type: "usage.update" }))).toBe("session-state");
		expect(routeSessionEvent(event({ type: "session.lifecycle" }))).toBe("ignored");
	});
});
