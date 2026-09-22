import { describe, expect, it } from "vitest";
import { FakeRelay, generateIdentityKeyPair, RemoteConnection } from "../src/index.js";

const capabilities = { chat: true, sessionRead: true } as const;

function client(relay: FakeRelay, role: "mobile" | "desktop", deviceId: string) {
	return new RemoteConnection(relay.createTransport("pair-1", role), {
		role,
		deviceId,
		deviceName: deviceId,
		capabilities,
		identity: generateIdentityKeyPair(),
		connectionId: `${role}-connection`,
	});
}

describe("FakeRelay", () => {
	it("pairs mobile and desktop then forwards sealed requests and replayable events", async () => {
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
		for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mobile.getSnapshot().state).toBe("online");
		expect(desktop.getSnapshot().state).toBe("online");

		await expect(mobile.request("session.prompt", { text: "hello" }, "session-1")).resolves.toEqual({
			received: { text: "hello" },
		});
		const emitted = await desktop.emitEvent("session.message", { text: "private answer" }, "session-1");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toEqual([emitted.eventId]);
		expect(desktop.getSnapshot().lastAckSequence).toBe(1);
	});

	it("refuses to forward anything that is not sealed after the handshake", async () => {
		const relay = new FakeRelay();
		const transport = relay.createTransport("pair-2", "mobile");
		await transport.connect({ onFrame: () => undefined, onClose: () => undefined });
		await expect(transport.send({ type: "ack", sequence: 1 })).rejects.toThrow(/plaintext/);
	});
});
