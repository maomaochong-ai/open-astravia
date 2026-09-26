import { describe, expect, it } from "vitest";
import type { RemoteConnectionEvent, RemoteHelloDecision } from "../src/index.js";
import {
	FakeRelay,
	FakeTransport,
	generateIdentityKeyPair,
	RemoteConnection,
	RemoteEventJournal,
	toBase64Url,
} from "../src/index.js";

const capabilities = { chat: true, sessionRead: true } as const;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(rounds = 6) {
	for (let index = 0; index < rounds; index += 1) await tick();
}

function directPair() {
	const mobileTransport = new FakeTransport();
	const desktopTransport = new FakeTransport();
	mobileTransport.connectPeer(desktopTransport);
	return { mobileTransport, desktopTransport };
}

interface EndpointOptions {
	readonly identity?: ReturnType<typeof generateIdentityKeyPair>;
	readonly expectedPeerIdentityKey?: Uint8Array;
	readonly onHello?: (hello: unknown) => RemoteHelloDecision | Promise<RemoteHelloDecision>;
	readonly journal?: RemoteEventJournal;
	readonly resumeFrom?: number;
	readonly now?: () => number;
	readonly requestTimeoutMs?: number;
	readonly connectionId?: string;
}

function mobile(transport: FakeTransport | ReturnType<FakeRelay["createTransport"]>, options: EndpointOptions = {}) {
	return new RemoteConnection(transport, {
		role: "mobile",
		deviceId: "phone-1",
		deviceName: "Phone",
		capabilities,
		identity: options.identity ?? generateIdentityKeyPair(),
		expectedPeerIdentityKey: options.expectedPeerIdentityKey,
		journal: options.journal,
		resumeFrom: options.resumeFrom,
		now: options.now,
		requestTimeoutMs: options.requestTimeoutMs,
		connectionId: options.connectionId,
	});
}

function desktop(
	transport: FakeTransport | ReturnType<FakeRelay["createTransport"]>,
	options: EndpointOptions & { readonly handshake?: "initiate" | "accept" } = {},
) {
	return new RemoteConnection(transport, {
		role: "desktop",
		deviceId: "desktop-1",
		deviceName: "MacBook",
		capabilities,
		handshake: options.handshake ?? "accept",
		identity: options.identity ?? generateIdentityKeyPair(),
		expectedPeerIdentityKey: options.expectedPeerIdentityKey,
		onHello: options.onHello as never,
		journal: options.journal,
		now: options.now,
	});
}

function collect(connection: RemoteConnection) {
	const events: RemoteConnectionEvent[] = [];
	connection.onEvent((event) => events.push(event));
	return events;
}

describe("RemoteConnection over a direct link (LAN)", () => {
	it("completes the handshake for a pinned peer and seals traffic both ways", async () => {
		const { mobileTransport, desktopTransport } = directPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktopIdentity = generateIdentityKeyPair();
		const phone = mobile(mobileTransport, {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		});
		const host = desktop(desktopTransport, {
			identity: desktopIdentity,
			expectedPeerIdentityKey: mobileIdentity.publicKey,
		});
		const wire: string[] = [];
		const originalSend = mobileTransport.send.bind(mobileTransport);
		mobileTransport.send = async (frame) => {
			wire.push(frame.type);
			return originalSend(frame);
		};
		host.onEvent((event) => {
			if (event.type === "remote-request") {
				void host.respond(event.request.requestId, { success: true, payload: { echoed: event.request.method } });
			}
		});
		await host.connect();
		await phone.connect();
		await settle();

		expect(phone.getSnapshot().state).toBe("online");
		expect(host.getSnapshot().state).toBe("online");
		expect(phone.getSnapshot().peerDeviceId).toBe("desktop-1");
		expect(host.getSnapshot().peerIdentityKey).toBe(toBase64Url(mobileIdentity.publicKey));
		expect(phone.getSnapshot().verificationCode).toBe(host.getSnapshot().verificationCode);
		await expect(phone.request("session.list")).resolves.toEqual({ echoed: "session.list" });
		expect(wire.filter((type) => type !== "hello").every((type) => type === "sealed")).toBe(true);
	});

	it("rejects a peer whose identity does not match the pinned key", async () => {
		const { mobileTransport, desktopTransport } = directPair();
		const phone = mobile(mobileTransport);
		const host = desktop(desktopTransport, { expectedPeerIdentityKey: generateIdentityKeyPair().publicKey });
		const hostEvents = collect(host);
		await host.connect();
		await phone.connect();
		await settle();

		expect(host.getSnapshot().state).toBe("failed");
		expect(hostEvents.some((event) => event.type === "error" && event.error.code === "unauthorized")).toBe(true);
		expect(phone.getSnapshot().state).not.toBe("online");
	});

	it("holds a manual pairing in pending_approval on both ends until the desktop approves", async () => {
		const { mobileTransport, desktopTransport } = directPair();
		let approve: (value: boolean) => void = () => undefined;
		const approval = new Promise<boolean>((resolve) => {
			approve = resolve;
		});
		const phone = mobile(mobileTransport);
		const host = desktop(desktopTransport, { onHello: () => ({ kind: "pending", approval }) });
		await host.connect();
		await phone.connect();
		await settle();

		expect(host.getSnapshot().state).toBe("pending_approval");
		expect(phone.getSnapshot().state).toBe("pending_approval");
		expect(phone.getSnapshot().verificationCode).toMatch(/^\d{6}$/);
		expect(phone.getSnapshot().verificationCode).toBe(host.getSnapshot().verificationCode);

		approve(true);
		await settle();
		expect(host.getSnapshot().state).toBe("online");
		expect(phone.getSnapshot().state).toBe("online");
	});

	it("fails with approval_rejected when the desktop declines a manual pairing", async () => {
		const { mobileTransport, desktopTransport } = directPair();
		const phone = mobile(mobileTransport);
		const host = desktop(desktopTransport, {
			onHello: () => ({ kind: "pending", approval: Promise.resolve(false) }),
		});
		const hostEvents = collect(host);
		await host.connect();
		await phone.connect();
		await settle();

		expect(host.getSnapshot().state).toBe("failed");
		expect(hostEvents.some((event) => event.type === "error" && event.error.code === "approval_rejected")).toBe(true);
		expect(phone.getSnapshot().state).toBe("reconnecting");
	});

	it("closes the link when a plaintext session frame arrives after the handshake", async () => {
		const { mobileTransport, desktopTransport } = directPair();
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const phone = mobile(mobileTransport, {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		});
		const host = desktop(desktopTransport, {
			identity: desktopIdentity,
			expectedPeerIdentityKey: mobileIdentity.publicKey,
		});
		await host.connect();
		await phone.connect();
		await settle();
		expect(host.getSnapshot().state).toBe("online");

		await mobileTransport.send({ type: "request", requestId: "r1", method: "session.list" });
		await settle();
		expect(host.getSnapshot().state).toBe("failed");
		expect(host.getSnapshot().lastErrorCode).toBe("invalid_frame");
	});

	it("re-keys in place when the phone starts over on a transport the desktop keeps open", async () => {
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktopTransport = new FakeTransport();
		const firstTransport = new FakeTransport();
		firstTransport.connectPeer(desktopTransport);
		const host = desktop(desktopTransport, {
			identity: desktopIdentity,
			expectedPeerIdentityKey: mobileIdentity.publicKey,
		});
		host.onEvent((event) => {
			if (event.type === "remote-request") void host.respond(event.request.requestId, { success: true, payload: 1 });
		});
		await host.connect();
		await mobile(firstTransport, {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		}).connect();
		await settle();
		expect(host.getSnapshot().state).toBe("online");
		const hostEvents = collect(host);

		// The phone rebuilds its link: a new connection arrives on the same desktop transport.
		const secondTransport = new FakeTransport();
		secondTransport.connectPeer(desktopTransport);
		const phone = mobile(secondTransport, {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		});
		await phone.connect();
		await settle();

		expect(phone.getSnapshot().state).toBe("online");
		expect(host.getSnapshot().state).toBe("online");
		expect(hostEvents.some((event) => event.type === "state" && event.state !== "online")).toBe(false);
		await expect(phone.request("session.list")).resolves.toBe(1);
	});

	it("still refuses a different identity that sends a hello while online", async () => {
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktopTransport = new FakeTransport();
		const firstTransport = new FakeTransport();
		firstTransport.connectPeer(desktopTransport);
		const host = desktop(desktopTransport, {
			identity: desktopIdentity,
			expectedPeerIdentityKey: mobileIdentity.publicKey,
		});
		await host.connect();
		await mobile(firstTransport, {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		}).connect();
		await settle();

		const intruderTransport = new FakeTransport();
		intruderTransport.connectPeer(desktopTransport);
		await mobile(intruderTransport, { expectedPeerIdentityKey: desktopIdentity.publicKey }).connect();
		await settle();

		expect(host.getSnapshot().state).toBe("failed");
		expect(host.getSnapshot().lastErrorCode).toBe("unauthorized");
	});
});

describe("RemoteConnection through a relay", () => {
	function relayPair(relay: FakeRelay, options: { journal?: RemoteEventJournal; resumeFrom?: number } = {}) {
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const phone = mobile(relay.createTransport("room-1", "mobile"), {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
			resumeFrom: options.resumeFrom,
			requestTimeoutMs: 100,
		});
		const host = desktop(relay.createTransport("room-1", "desktop"), {
			handshake: "initiate",
			identity: desktopIdentity,
			expectedPeerIdentityKey: mobileIdentity.publicKey,
			journal: options.journal,
		});
		return { phone, host, desktopIdentity, mobileIdentity };
	}

	it("brings both initiators online once the relay pairs them", async () => {
		const relay = new FakeRelay();
		const { phone, host } = relayPair(relay);
		await host.connect();
		await phone.connect();
		await settle();
		expect(phone.getSnapshot().state).toBe("online");
		expect(host.getSnapshot().state).toBe("online");
		expect(phone.getSnapshot().peerDeviceId).toBe("desktop-1");
		expect(host.getSnapshot().peerDeviceId).toBe("phone-1");
	});

	it("ignores a hello acknowledgement for a stale connection", async () => {
		const { mobileTransport, desktopTransport } = directPair();
		const phone = mobile(mobileTransport, { connectionId: "mobile-connection" });
		const desktopIdentity = generateIdentityKeyPair();
		await desktopTransport.connect({
			onFrame: (frame) => {
				if (frame.type === "hello") {
					void desktopTransport.send({
						type: "hello_ack",
						protocolVersion: 2,
						connectionId: "stale-connection",
						peerDeviceId: "desktop-1",
						peerIdentityKey: toBase64Url(desktopIdentity.publicKey),
						peerEphemeralKey: toBase64Url(generateIdentityKeyPair().publicKey),
					});
				}
			},
			onClose: () => undefined,
		});
		await phone.connect();
		await settle();
		expect(phone.getSnapshot().state).toBe("connecting");
		expect(phone.getSnapshot().peerDeviceId).toBeUndefined();
	});

	it("correlates request and response and reports RTT", async () => {
		const relay = new FakeRelay();
		let now = 100;
		const desktopIdentity = generateIdentityKeyPair();
		const phone = mobile(relay.createTransport("room-1", "mobile"), {
			expectedPeerIdentityKey: desktopIdentity.publicKey,
			now: () => now,
			requestTimeoutMs: 100,
		});
		const host = desktop(relay.createTransport("room-1", "desktop"), {
			handshake: "initiate",
			identity: desktopIdentity,
		});
		host.onEvent((event) => {
			if (event.type === "remote-request") {
				now = 125;
				void host.respond(event.request.requestId, { success: true, payload: { ok: true } });
			}
		});
		await host.connect();
		await phone.connect();
		await settle();
		await expect(phone.request("diagnostics.snapshot")).resolves.toEqual({ ok: true });
		expect(phone.getSnapshot().lastRttMs).toBe(25);
	});

	it("rejects pending requests when the relay reports the peer offline", async () => {
		const relay = new FakeRelay();
		const { phone, host } = relayPair(relay);
		await host.connect();
		await phone.connect();
		await settle();
		const pending = phone.request("session.list");
		pending.catch(() => undefined);
		await host.close();
		await settle();
		await expect(pending).rejects.toThrow(/offline|closed/);
	});

	it("delivers events in order, ignores duplicates and recovers from a gap", async () => {
		const relay = new FakeRelay();
		const { phone, host } = relayPair(relay);
		const received: number[] = [];
		phone.onEvent((event) => {
			if (event.type === "remote-event") received.push(event.event.sequence);
		});
		await host.connect();
		await phone.connect();
		await settle();

		await host.emitEvent("session.state", { state: "running" }, "s1");
		await host.emitEvent("session.message", { kind: "delta", text: "hi" }, "s1");
		await settle();
		expect(received).toEqual([1, 2]);
		expect(host.getSnapshot().lastAckSequence).toBe(2);
	});

	it("replays journaled events when the phone reconnects on a fresh transport", async () => {
		const relay = new FakeRelay();
		const journal = new RemoteEventJournal();
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const host = desktop(relay.createTransport("room-1", "desktop"), {
			handshake: "initiate",
			identity: desktopIdentity,
			expectedPeerIdentityKey: mobileIdentity.publicKey,
			journal,
		});
		const firstPhone = mobile(relay.createTransport("room-1", "mobile"), {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		});
		const seen: number[] = [];
		firstPhone.onEvent((event) => {
			if (event.type === "remote-event") seen.push(event.event.sequence);
		});
		await host.connect();
		await firstPhone.connect();
		await settle();
		await host.emitEvent("session.state", { state: "running" }, "s1");
		await settle();
		await firstPhone.close();
		await settle();

		// Emitted while the phone is away: journaled, delivered on resume.
		await host.emitEvent("session.message", { kind: "delta", text: "a" }, "s1");
		await host.emitEvent("session.message", { kind: "delta", text: "b" }, "s1");

		const secondPhone = mobile(relay.createTransport("room-1", "mobile"), {
			identity: mobileIdentity,
			expectedPeerIdentityKey: desktopIdentity.publicKey,
			resumeFrom: firstPhone.getSnapshot().lastEventSequence,
		});
		secondPhone.onEvent((event) => {
			if (event.type === "remote-event") seen.push(event.event.sequence);
		});
		await host.connect();
		await secondPhone.connect();
		await settle(10);
		expect(seen).toEqual([1, 2, 3]);
		expect(secondPhone.getSnapshot().state).toBe("online");
	});

	it("tells a peer that fell behind the journal to resync instead of waiting forever", async () => {
		const relay = new FakeRelay();
		const journal = new RemoteEventJournal({ capacity: 2 });
		const { phone, host } = relayPair(relay, { journal });
		for (let index = 0; index < 5; index += 1) await host.emitEvent("session.state", { index }, "s1");
		const names: string[] = [];
		phone.onEvent((event) => {
			if (event.type === "remote-event") names.push(event.event.name);
		});
		await host.connect();
		await phone.connect();
		await settle(10);
		expect(names).toEqual(["session.resync"]);
		expect(phone.getSnapshot().state).toBe("online");
		expect(phone.getSnapshot().lastEventSequence).toBe(6);
	});

	it("resyncs a phone that resumes past a journal the desktop lost on restart", async () => {
		const relay = new FakeRelay();
		// The phone kept sequence 40 from before the restart; the new journal starts at 0.
		const { phone, host } = relayPair(relay, { journal: new RemoteEventJournal(), resumeFrom: 40 });
		const names: string[] = [];
		phone.onEvent((event) => {
			if (event.type === "remote-event") names.push(event.event.name);
		});
		await host.connect();
		await phone.connect();
		await settle(10);
		await host.emitEvent("session.message", { kind: "assistant_delta", text: "hi" }, "s1");
		await settle(10);
		expect(names).toEqual(["session.resync", "session.message"]);
		expect(phone.getSnapshot().lastEventSequence).toBe(2);
	});
});
