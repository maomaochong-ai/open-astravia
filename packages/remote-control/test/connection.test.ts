import { describe, expect, it } from "vitest";
import { FakeTransport, RemoteConnection } from "../src/index.js";

const capabilities = { chat: true, sessionRead: true } as const;

function pair() {
	const mobileTransport = new FakeTransport();
	const desktopTransport = new FakeTransport();
	mobileTransport.connectPeer(desktopTransport);
	return { mobileTransport, desktopTransport };
}

async function connectClient(
	client: RemoteConnection,
	peerTransport: FakeTransport,
	peerDeviceId = "desktop-1",
): Promise<void> {
	await peerTransport.connect({
		onFrame: (frame) => {
			if (frame.type === "hello") {
				void peerTransport.send({
					type: "hello_ack",
					protocolVersion: 1,
					connectionId: frame.connectionId,
					peerDeviceId,
				});
			}
		},
		onClose: () => undefined,
	});
	await client.connect();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RemoteConnection", () => {
	it("correlates request and response and reports RTT", async () => {
		const { mobileTransport, desktopTransport } = pair();
		let now = 100;
		const mobile = new RemoteConnection(mobileTransport, {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities,
			now: () => now,
			requestTimeoutMs: 100,
		});
		await desktopTransport.connect({
			onFrame: (frame) => {
				if (frame.type === "hello") {
					void desktopTransport.send({
						type: "hello_ack",
						protocolVersion: 1,
						connectionId: frame.connectionId,
						peerDeviceId: "desktop-1",
					});
				}
				if (frame.type === "request") {
					now = 125;
					void desktopTransport.send({
						type: "response",
						requestId: frame.requestId,
						success: true,
						payload: { ok: true },
					});
				}
			},
			onClose: () => undefined,
		});
		await mobile.connect();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mobile.getSnapshot().state).toBe("online");

		await expect(mobile.request("diagnostics.snapshot")).resolves.toEqual({ ok: true });
		expect(mobile.getSnapshot().lastRttMs).toBe(25);
	});

	it("moves to reconnecting on transport close and ignores duplicate events", async () => {
		const { mobileTransport, desktopTransport } = pair();
		const mobile = new RemoteConnection(mobileTransport, {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities,
			requestTimeoutMs: 100,
		});
		const events: string[] = [];
		mobile.onEvent((event) => {
			if (event.type === "remote-event") events.push(event.event.eventId);
		});
		await connectClient(mobile, desktopTransport);
		await desktopTransport.send({
			type: "event",
			eventId: "e1",
			sequence: 1,
			name: "session.state",
			payload: { state: "idle" },
		});
		await desktopTransport.send({
			type: "event",
			eventId: "e1",
			sequence: 1,
			name: "session.state",
			payload: { state: "idle" },
		});
		expect(events).toEqual(["e1"]);
		mobileTransport.forceDisconnect();
		expect(mobile.getSnapshot().state).toBe("reconnecting");
	});

	it("requests missing events when sequence contains a gap", async () => {
		const { mobileTransport, desktopTransport } = pair();
		const mobile = new RemoteConnection(mobileTransport, {
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "Phone",
			capabilities,
		});
		const receivedByPeer: string[] = [];
		await desktopTransport.connect({
			onFrame: (frame) => {
				receivedByPeer.push(frame.type);
				if (frame.type === "hello") {
					void desktopTransport.send({
						type: "hello_ack",
						protocolVersion: 1,
						connectionId: frame.connectionId,
						peerDeviceId: "desktop-1",
					});
				}
			},
			onClose: () => undefined,
		});
		await mobile.connect();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await desktopTransport.send({ type: "event", eventId: "e2", sequence: 2, name: "session.state" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mobile.getSnapshot().state).toBe("recovering");
		expect(receivedByPeer).toContain("resume");
		expect(mobile.getSnapshot().lastEventSequence).toBe(0);
	});
});
