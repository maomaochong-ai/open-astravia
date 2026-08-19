import { describe, expect, it } from "vitest";
import { FakeRelay, RemoteConnection } from "../src/index.js";

const capabilities = { chat: true, sessionRead: true } as const;

function client(relay: FakeRelay, role: "mobile" | "desktop", deviceId: string) {
	return new RemoteConnection(relay.createTransport("pair-1", role), {
		role,
		deviceId,
		deviceName: deviceId,
		capabilities,
		connectionId: `${role}-connection`,
	});
}

describe("FakeRelay", () => {
	it("pairs mobile and desktop then forwards requests and replayable events", async () => {
		const relay = new FakeRelay();
		const mobile = client(relay, "mobile", "phone-1");
		const desktop = client(relay, "desktop", "desktop-1");
		const events: string[] = [];
		desktop.onEvent((event) => {
			if (event.type !== "remote-request") return;
			void desktop.respond(event.request.requestId, { success: true, payload: { received: event.request.payload } });
		});
		mobile.onEvent((event) => {
			if (event.type === "remote-event") events.push(event.event.eventId);
		});

		await mobile.connect();
		await desktop.connect();
		await Promise.resolve();
		expect(mobile.getSnapshot().state).toBe("online");
		expect(desktop.getSnapshot().state).toBe("online");

		await expect(mobile.request("session.prompt", { text: "hello" }, "session-1")).resolves.toEqual({
			received: { text: "hello" },
		});
		const emitted = await desktop.emitEvent("session.message", { text: "private answer" }, "session-1");
		expect(events).toEqual([emitted.eventId]);
		expect(desktop.getSnapshot().lastAckSequence).toBe(1);
	});
});
