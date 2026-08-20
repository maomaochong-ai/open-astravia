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
});

function fakePeerConnection(): {
	readonly connection: RTCPeerConnection;
	readonly createOffer: ReturnType<typeof vi.fn>;
} {
	const createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "v=0\r\n" }));
	const channel = {
		close: vi.fn(),
		onmessage: null,
		readyState: "connecting",
		send: vi.fn(),
	} as unknown as RTCDataChannel;
	const connection = {
		addIceCandidate: vi.fn(async () => undefined),
		addTrack: vi.fn(),
		close: vi.fn(),
		connectionState: "new",
		createDataChannel: vi.fn(() => channel),
		createOffer,
		getSenders: vi.fn(() => []),
		onconnectionstatechange: null,
		onicecandidate: null,
		remoteDescription: null,
		setLocalDescription: vi.fn(async () => undefined),
		signalingState: "stable",
	} as unknown as RTCPeerConnection;
	return { connection, createOffer };
}

function fakeStream(): MediaStream {
	const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
	return {
		getTracks: () => [track],
		getVideoTracks: () => [track],
	} as unknown as MediaStream;
}
