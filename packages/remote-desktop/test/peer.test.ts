import { describe, expect, it, vi } from "vitest";
import { RemoteDesktopHost } from "../src/index.js";

describe("remote desktop host negotiation", () => {
	it("waits for a relay peer-ready event before sending the offer", async () => {
		const peer = fakePeerConnection();
		const sent: unknown[] = [];
		const host = new RemoteDesktopHost(
			{
				sessionId: "pairing_0123456789abcdefghijklmnop",
				createPeerConnection: () => peer.connection,
			},
			(signal) => {
				sent.push(signal);
			},
			() => undefined,
		);

		await host.start(fakeStream(), { waitForPeerReady: true });
		expect(peer.createOffer).not.toHaveBeenCalled();
		expect(sent).toEqual([]);

		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });

		expect(peer.createOffer).toHaveBeenCalledOnce();
		expect(sent).toEqual([
			{
				type: "offer",
				protocolVersion: 1,
				sessionId: "pairing_0123456789abcdefghijklmnop",
				sdp: "v=0\r\n",
			},
		]);

		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
	});

	it("opens a reliable control channel and forwards only text payloads", async () => {
		const peer = fakePeerConnection();
		const messages: string[] = [];
		const opened = vi.fn();
		const closed = vi.fn();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
			{ onOpen: opened, onMessage: (message) => messages.push(message), onClose: closed },
		);

		await host.start(fakeStream(), { waitForPeerReady: true });
		expect(peer.createDataChannel).toHaveBeenNthCalledWith(1, "vetta-input-v1", { ordered: true });
		expect(peer.createDataChannel).toHaveBeenNthCalledWith(2, "vetta-control-v2", { ordered: true });
		const control = peer.channels[1];
		control.onopen?.(new Event("open"));
		expect(opened).toHaveBeenCalledOnce();
		control.onmessage?.({ data: '{"type":"hello"}' } as MessageEvent);
		expect(messages).toEqual(['{"type":"hello"}']);

		Object.defineProperty(control, "readyState", { value: "open", configurable: true });
		host.sendControl("sealed");
		expect(control.send).toHaveBeenCalledWith("sealed");

		control.onmessage?.({ data: new ArrayBuffer(1) } as MessageEvent);
		expect(control.close).toHaveBeenCalledOnce();
	});
});

describe("remote desktop host screen on demand", () => {
	it("opens with an empty video slot and swaps the screen in and out without renegotiating", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);

		await host.start(undefined, { waitForPeerReady: true });
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(peer.addTransceiver).toHaveBeenCalledWith("video", { direction: "sendonly" });
		expect(peer.connection.addTrack).not.toHaveBeenCalled();
		expect(peer.sender.track).toBeNull();

		const first = fakeTrack();
		await host.replaceScreen(first);
		expect(peer.sender.track).toBe(first);

		const second = fakeTrack();
		await host.replaceScreen(second);
		expect(first.stop).toHaveBeenCalledOnce();
		expect(peer.sender.track).toBe(second);

		await host.replaceScreen(null);
		expect(second.stop).toHaveBeenCalledOnce();
		expect(peer.sender.track).toBeNull();
		expect(peer.createOffer).toHaveBeenCalledOnce();
	});

	it("refuses to swap the screen of a session started with a fixed stream", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start(fakeStream());
		await expect(host.replaceScreen(fakeTrack())).rejects.toThrow("fixed screen stream");
	});

	it("stops a track handed to a closed session instead of leaking the capture", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start();
		host.close();
		const late = fakeTrack();
		await host.replaceScreen(late);
		expect(late.stop).toHaveBeenCalledOnce();
	});
});

function fakeTrack(): MediaStreamTrack & { readonly stop: ReturnType<typeof vi.fn> } {
	return { stop: vi.fn() } as unknown as MediaStreamTrack & { readonly stop: ReturnType<typeof vi.fn> };
}

function fakePeerConnection(): {
	readonly connection: RTCPeerConnection;
	readonly createOffer: ReturnType<typeof vi.fn>;
	readonly createDataChannel: ReturnType<typeof vi.fn>;
	readonly channels: RTCDataChannel[];
	readonly addTransceiver: ReturnType<typeof vi.fn>;
	readonly sender: { track: MediaStreamTrack | null };
} {
	const createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "v=0\r\n" }));
	const channels: RTCDataChannel[] = [];
	const createDataChannel = vi.fn(() => {
		const channel = {
			close: vi.fn(),
			onclose: null,
			onerror: null,
			onmessage: null,
			onopen: null,
			readyState: "connecting",
			send: vi.fn(),
		} as unknown as RTCDataChannel;
		channels.push(channel);
		return channel;
	});
	const sender = {
		track: null as MediaStreamTrack | null,
		replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
			sender.track = track;
		}),
	};
	const addTransceiver = vi.fn(() => ({ sender }));
	const connection = {
		addTransceiver,
		addIceCandidate: vi.fn(async () => undefined),
		addTrack: vi.fn(),
		close: vi.fn(),
		connectionState: "new",
		createDataChannel,
		createOffer,
		getSenders: vi.fn(() => []),
		onconnectionstatechange: null,
		onicecandidate: null,
		remoteDescription: null,
		setLocalDescription: vi.fn(async () => undefined),
		signalingState: "stable",
	} as unknown as RTCPeerConnection;
	return { connection, createOffer, createDataChannel, channels, addTransceiver, sender };
}

function fakeStream(): MediaStream {
	const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
	return {
		getTracks: () => [track],
		getVideoTracks: () => [track],
	} as unknown as MediaStream;
}
