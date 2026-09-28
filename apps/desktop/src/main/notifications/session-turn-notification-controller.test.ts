import type { SessionEvent } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { SessionTurnNotificationController } from "./session-turn-notification-controller.js";

const event = (value: object): SessionEvent => value as SessionEvent;

describe("SessionTurnNotificationController", () => {
	it("emits one completed outcome at the terminal lifecycle event", () => {
		const controller = new SessionTurnNotificationController();
		expect(controller.handle(event({ type: "message.final", message: { stopReason: "stop" } }))).toBeNull();
		expect(controller.handle(event({ type: "session.lifecycle", phase: "agent_end" }))).toBe("completed");
	});

	it("waits through an intermediate error and emits failed only at turn end", () => {
		const controller = new SessionTurnNotificationController();
		expect(controller.handle(event({ channel: "tool", type: "error" }))).toBeNull();
		expect(controller.handle(event({ type: "session.lifecycle", phase: "agent_end" }))).toBe("failed");
	});

	it("does not emit for aborted turns and resets for the next turn", () => {
		const controller = new SessionTurnNotificationController();
		expect(controller.handle(event({ type: "session.lifecycle", phase: "aborted" }))).toBeNull();
		expect(controller.handle(event({ type: "session.lifecycle", phase: "agent_end" }))).toBeNull();
		expect(controller.handle(event({ type: "session.lifecycle", phase: "agent_end" }))).toBe("completed");
	});
});
